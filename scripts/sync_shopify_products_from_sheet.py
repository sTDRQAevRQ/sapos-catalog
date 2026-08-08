#!/usr/bin/env python3
"""
Synchronise un Google Sheet produits vers Shopify.

Mode de securite :
- par defaut, le script tourne en dry-run (aucune ecriture Shopify ni Google Sheet)
- utilisez --apply pour activer les mutations

Variables d'environnement requises :
- GOOGLE_SHEETS_ID
- GOOGLE_SHEETS_CREDENTIALS (defaut: scripts/google-credentials.json)
- GOOGLE_SHEETS_TAB (defaut: products)

Acces Shopify :
- lit shopify.env a la racine du workspace OpenClaw
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials

from sync_shopify_catalog import (
    API_VER,
    build_brand_meta_map,
    load_env,
    normalize_brand_key,
    refresh_access_token,
)

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = ROOT.parent
ENV_PATH = WORKSPACE_ROOT / "shopify.env"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
DEFAULT_CREDENTIALS_PATH = ROOT / "scripts" / "google-credentials.json"
DEFAULT_SHEET_TAB = "products"
ONLINE_STORE_PUBLICATION_NAME = "Online Store"
TRUE_VALUES = {"1", "oui", "yes", "true", "x", "vrai"}
DEFAULT_BATCH_SIZE = 10
DEFAULT_BATCH_PAUSE_SECONDS = 2.0
DEFAULT_REQUEST_INTERVAL_SECONDS = 0.6
DEFAULT_RETRY_DELAY_SECONDS = 2.0
DEFAULT_MAX_RETRIES = 5
FAMILY_TAG_MAP = {
    "ambré": "parfum ambré",
    "boisé": "parfum boisé",
    "épicé": "parfum épicé",
    "floral": "parfum floral",
    "frais": "parfum frais",
    "fruité": "parfum fruité",
    "gourmand": "parfum gourmand",
    "oriental": "parfum oriental",
    "oud": "oud",
}
STATUS_ACTIVE = {"disponible", "en stock", "rupture", "arrivage", "bientot", "bientôt"}
STATUS_DRAFT = {"brouillon", "draft"}
STATUS_ARCHIVED = {"archive", "archivé", "archived"}
REQUIRED_HEADERS = {
    "sku",
    "brand",
    "title",
    "concentration",
    "volume",
    "product_type",
    "price",
    "stock",
    "status",
    "gender",
    "families",
    "image",
    "notes",
    "sync_enabled",
    "shopify_product_id",
    "shopify_variant_id",
    "handle",
    "product_url",
    "published_status",
    "last_sync_at",
    "last_sync_result",
}


class SyncError(RuntimeError):
    pass


@dataclass
class SheetRow:
    row_number: int
    values: dict[str, str]


@dataclass
class SyncTarget:
    product_id: str
    variant_id: str
    product_gid: str
    variant_gid: str
    inventory_item_id: str
    handle: str
    product_url: str
    published: bool
    image_urls: list[str]
    source: str


@dataclass
class SyncPlan:
    target: SyncTarget | None
    action: str
    reason: str


@dataclass
class ResolvedTarget:
    target: SyncTarget | None
    warnings: list[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync Google Sheet products to Shopify")
    parser.add_argument("--apply", action="store_true", help="active les ecritures Shopify et Google Sheet")
    parser.add_argument("--sku", action="append", dest="skus", help="limite la sync a un ou plusieurs SKU")
    parser.add_argument("--limit", type=int, default=None, help="limite le nombre de lignes traitees")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help="nombre max de lignes traitees avant une pause",
    )
    parser.add_argument(
        "--batch-pause-seconds",
        type=float,
        default=DEFAULT_BATCH_PAUSE_SECONDS,
        help="pause entre deux lots de lignes",
    )
    parser.add_argument(
        "--request-interval-seconds",
        type=float,
        default=DEFAULT_REQUEST_INTERVAL_SECONDS,
        help="intervalle minimal entre deux appels Shopify",
    )
    parser.add_argument(
        "--retry-delay-seconds",
        type=float,
        default=DEFAULT_RETRY_DELAY_SECONDS,
        help="delai de base avant retry Shopify",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=DEFAULT_MAX_RETRIES,
        help="nombre max de retries Shopify apres la premiere tentative",
    )
    parser.add_argument("--sheet-id", default=os.environ.get("GOOGLE_SHEETS_ID"), help="ID du Google Sheet")
    parser.add_argument(
        "--sheet-tab",
        default=os.environ.get("GOOGLE_SHEETS_TAB", DEFAULT_SHEET_TAB),
        help="nom de l'onglet Google Sheet",
    )
    parser.add_argument(
        "--credentials",
        default=os.environ.get("GOOGLE_SHEETS_CREDENTIALS", str(DEFAULT_CREDENTIALS_PATH)),
        help="chemin vers le JSON du compte de service Google",
    )
    return parser.parse_args()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_header(value: str) -> str:
    return re.sub(r"\s+", "_", (value or "").strip().lower())


def as_bool(value: str) -> bool:
    return (value or "").strip().lower() in TRUE_VALUES


def parse_price(value: str) -> float:
    cleaned = str(value or "").replace("€", "").replace(" ", "").replace(",", ".").strip()
    if not cleaned:
        raise SyncError("price vide")
    try:
        return round(float(cleaned), 2)
    except ValueError as exc:
        raise SyncError(f"price invalide: {value}") from exc


def parse_stock(value: str) -> int:
    cleaned = str(value or "").replace(" ", "").replace(",", ".").strip()
    if cleaned == "":
        raise SyncError("stock vide")
    try:
        return int(float(cleaned))
    except ValueError as exc:
        raise SyncError(f"stock invalide: {value}") from exc


def parse_volume(value: str) -> str:
    cleaned = str(value or "").strip()
    if not cleaned:
        raise SyncError("volume vide")
    if cleaned.endswith("ml"):
        cleaned = cleaned[:-2].strip()
    try:
        numeric = float(cleaned.replace(",", "."))
    except ValueError as exc:
        raise SyncError(f"volume invalide: {value}") from exc
    if numeric.is_integer():
        return str(int(numeric))
    return str(numeric).replace(".", ",")


def normalize_image_url(value: str) -> str:
    cleaned = str(value or "").strip()
    if not cleaned:
        return ""
    parsed = urllib.parse.urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise SyncError(f"image invalide: {value}")
    return cleaned


def normalize_shopify_status(value: str) -> str:
    key = (value or "").strip().lower()
    if key in STATUS_DRAFT:
        return "draft"
    if key in STATUS_ARCHIVED:
        return "archived"
    if key in STATUS_ACTIVE:
        return "active"
    return "active"


def split_families(value: str) -> list[str]:
    return [part.strip() for part in str(value or "").split("|") if part.strip()]


def build_tags(row: dict[str, str]) -> list[str]:
    tags: list[str] = []
    gender = (row.get("gender") or "").strip().lower()
    if gender == "homme":
        tags.append("parfum homme")
    elif gender == "femme":
        tags.append("parfum femme")
    else:
        tags.append("parfum mixte")

    for family in split_families(row.get("families") or ""):
        mapped = FAMILY_TAG_MAP.get(family.lower())
        if mapped and mapped not in tags:
            tags.append(mapped)

    concentration = (row.get("concentration") or "").strip().lower()
    if concentration and concentration not in tags:
        tags.append(concentration)

    product_type = (row.get("product_type") or "").strip().lower()
    if product_type and product_type not in tags:
        tags.append(product_type)

    return tags


def build_body_html(notes: str) -> str:
    text = (notes or "").strip()
    if not text:
        return ""
    return f"<p>{html.escape(text)}</p>"


def gid_numeric(gid: str | None) -> str:
    if not gid:
        return ""
    return gid.rsplit("/", 1)[-1]


class ShopifyClient:
    def __init__(
        self,
        *,
        request_interval_seconds: float = DEFAULT_REQUEST_INTERVAL_SECONDS,
        retry_delay_seconds: float = DEFAULT_RETRY_DELAY_SECONDS,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ) -> None:
        if not ENV_PATH.exists():
            raise SyncError(f"Fichier Shopify introuvable: {ENV_PATH}")
        env = load_env(ENV_PATH)
        self.store = env.get("SHOPIFY_STORE")
        self.token = env.get("SHOPIFY_ACCESS_TOKEN")
        self.client_id = env.get("SHOPIFY_CLIENT_ID")
        self.client_secret = env.get("SHOPIFY_CLIENT_SECRET")
        if not self.store or not self.token:
            raise SyncError("SHOPIFY_STORE ou SHOPIFY_ACCESS_TOKEN manquant dans shopify.env")
        self._brand_meta_map: dict[str, dict] | None = None
        self.request_interval_seconds = max(0.0, request_interval_seconds)
        self.retry_delay_seconds = max(0.0, retry_delay_seconds)
        self.max_retries = max(0, max_retries)
        self._last_request_monotonic = 0.0

    def _refresh_token(self) -> None:
        if not self.client_id or not self.client_secret:
            raise SyncError("Impossible de regenerer le token Shopify: client_id/client_secret manquant")
        self.token = refresh_access_token(self.store, self.client_id, self.client_secret)

    def _sleep_for_rate_limit(self) -> None:
        if self.request_interval_seconds <= 0:
            return
        now = time.monotonic()
        remaining = self.request_interval_seconds - (now - self._last_request_monotonic)
        if remaining > 0:
            time.sleep(remaining)

    @staticmethod
    def _retry_after_seconds(exc: urllib.error.HTTPError) -> float | None:
        header = exc.headers.get("Retry-After") if exc.headers else None
        if not header:
            return None
        try:
            return max(0.0, float(header))
        except ValueError:
            return None

    def _request_json(self, request: urllib.request.Request) -> dict:
        attempt = 0
        last_error: Exception | None = None
        while attempt <= self.max_retries:
            self._sleep_for_rate_limit()
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    self._last_request_monotonic = time.monotonic()
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                self._last_request_monotonic = time.monotonic()
                if exc.code == 401:
                    if attempt >= self.max_retries:
                        raise
                    self._refresh_token()
                    request.headers["X-Shopify-Access-Token"] = self.token
                    attempt += 1
                    continue
                if exc.code == 429:
                    retry_after = self._retry_after_seconds(exc)
                    delay = retry_after if retry_after is not None else self.retry_delay_seconds * (2 ** attempt)
                    if attempt >= self.max_retries:
                        raise SyncError(
                            f"HTTP 429 Too Many Requests apres {attempt + 1} tentatives"
                        ) from exc
                    time.sleep(max(self.retry_delay_seconds, delay))
                    attempt += 1
                    last_error = exc
                    continue
                details = ""
                try:
                    body = exc.read().decode("utf-8").strip()
                except Exception:
                    body = ""
                if body:
                    details = f": {body[:300]}"
                raise SyncError(f"HTTP {exc.code} Shopify{details}") from exc
            except urllib.error.URLError as exc:
                self._last_request_monotonic = time.monotonic()
                if attempt >= self.max_retries:
                    raise SyncError(f"Erreur reseau Shopify: {exc.reason}") from exc
                time.sleep(self.retry_delay_seconds * (2 ** attempt))
                attempt += 1
                last_error = exc
                continue
        if last_error:
            raise SyncError(f"Echec Shopify apres retries: {last_error}") from last_error
        raise SyncError("Echec Shopify: tentative sans reponse")

    def graphql(self, query: str, variables: dict | None = None) -> dict:
        payload = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
        request = urllib.request.Request(
            f"https://{self.store}/admin/api/{API_VER}/graphql.json",
            data=payload,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": self.token,
                "Accept": "application/json",
            },
        )
        data = self._request_json(request)
        if data.get("errors"):
            raise SyncError(f"GraphQL Shopify: {data['errors']}")
        return data["data"]

    def rest(self, method: str, path: str, payload: dict | None = None) -> dict:
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            f"https://{self.store}/admin/api/{API_VER}/{path.lstrip('/')}",
            data=data,
            method=method,
            headers={
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": self.token,
                "Accept": "application/json",
            },
        )
        return self._request_json(request)

    def get_online_store_context(self) -> tuple[str, str]:
        query = """
        query SyncContext {
          locations(first: 20) {
            nodes { id name fulfillsOnlineOrders isActive }
          }
          publications(first: 20) {
            nodes { id name }
          }
        }
        """
        data = self.graphql(query)
        active_locations = [
            node for node in data["locations"]["nodes"] if node.get("isActive") and node.get("fulfillsOnlineOrders")
        ]
        if not active_locations:
            raise SyncError("Aucune location Shopify active pour les commandes online")

        online_store = next(
            (node for node in data["publications"]["nodes"] if node.get("name") == ONLINE_STORE_PUBLICATION_NAME),
            None,
        )
        if not online_store:
            raise SyncError("Publication 'Online Store' introuvable")

        return active_locations[0]["id"], online_store["id"]

    def find_variant_by_sku(self, sku: str) -> dict | None:
        query = """
        query FindVariantBySku($query: String!) {
          productVariants(first: 1, query: $query) {
            nodes {
              id
              sku
              price
              inventoryItem {
                id
                tracked
              }
              product {
                id
                handle
                title
                status
                productType
                vendor
                onlineStoreUrl
              }
            }
          }
        }
        """
        data = self.graphql(query, {"query": f"sku:{sku}"})
        nodes = data["productVariants"]["nodes"]
        return nodes[0] if nodes else None

    def get_variant(self, variant_id: str) -> dict | None:
        numeric_variant_id = gid_numeric(variant_id) or str(variant_id)
        try:
            response = self.rest("GET", f"variants/{numeric_variant_id}.json")
        except SyncError as exc:
            if "HTTP 404 Shopify" in str(exc):
                return None
            raise
        return response.get("variant")

    def get_product(self, product_id: str) -> dict | None:
        numeric_product_id = gid_numeric(product_id) or str(product_id)
        try:
            response = self.rest("GET", f"products/{numeric_product_id}.json")
        except SyncError as exc:
            if "HTTP 404 Shopify" in str(exc):
                return None
            raise
        return response.get("product")

    def create_product(self, row: dict[str, str]) -> dict:
        status = normalize_shopify_status(row["status"])
        volume = parse_volume(row["volume"])
        payload = {
            "product": {
                "title": row["title"].strip(),
                "vendor": row["brand"].strip(),
                "product_type": row["product_type"].strip(),
                "status": status,
                "body_html": build_body_html(row.get("notes", "")),
                "tags": ", ".join(build_tags(row)),
                "options": [{"name": "Volume"}],
                "variants": [
                    {
                        "option1": f"{volume} ml",
                        "price": f"{parse_price(row['price']):.2f}",
                        "sku": row["sku"].strip(),
                        "inventory_management": "shopify",
                        "inventory_policy": "deny",
                    }
                ],
            }
        }
        response = self.rest("POST", "products.json", payload)
        return response["product"]

    def update_product(self, product_id: str, row: dict[str, str]) -> dict:
        status = normalize_shopify_status(row["status"])
        payload = {
            "product": {
                "id": int(product_id),
                "title": row["title"].strip(),
                "vendor": row["brand"].strip(),
                "product_type": row["product_type"].strip(),
                "status": status,
                "body_html": build_body_html(row.get("notes", "")),
                "tags": ", ".join(build_tags(row)),
            }
        }
        response = self.rest("PUT", f"products/{product_id}.json", payload)
        return response["product"]

    def update_variant(self, variant_id: str, row: dict[str, str]) -> dict:
        volume = parse_volume(row["volume"])
        payload = {
            "variant": {
                "id": int(variant_id),
                "sku": row["sku"].strip(),
                "price": f"{parse_price(row['price']):.2f}",
                "option1": f"{volume} ml",
                "inventory_management": "shopify",
                "inventory_policy": "deny",
            }
        }
        response = self.rest("PUT", f"variants/{variant_id}.json", payload)
        return response["variant"]

    def set_inventory(self, inventory_item_id: str, location_id: str, stock: int) -> dict:
        payload = {
            "location_id": int(gid_numeric(location_id)),
            "inventory_item_id": int(inventory_item_id),
            "available": stock,
        }
        return self.rest("POST", "inventory_levels/set.json", payload)

    def list_product_images(self, product_id: str) -> list[dict]:
        response = self.rest("GET", f"products/{product_id}/images.json")
        return response.get("images") or []

    def fetch_brand_meta_map(self) -> dict[str, dict]:
        items = []
        cursor = None
        query = """
        query FetchBrandMetaobjects($cursor: String) {
          metaobjects(type: "brand", first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              handle
              displayName
              fields {
                key
                value
                reference {
                  __typename
                  ... on MediaImage {
                    image { url }
                  }
                  ... on GenericFile {
                    url
                  }
                }
              }
            }
          }
        }
        """
        while True:
            data = self.graphql(query, {"cursor": cursor})
            payload = data["metaobjects"]
            items.extend(payload["nodes"])
            if not payload["pageInfo"]["hasNextPage"]:
                break
            cursor = payload["pageInfo"]["endCursor"]
        return build_brand_meta_map(items)

    def get_brand_image_url(self, brand_name: str) -> str:
        normalized_brand = normalize_brand_key(brand_name)
        if not normalized_brand:
            return ""
        if self._brand_meta_map is None:
            self._brand_meta_map = self.fetch_brand_meta_map()
        brand_meta = self._brand_meta_map.get(normalized_brand) or {}
        return str(brand_meta.get("logo") or brand_meta.get("fallback_image") or "").strip()

    def create_product_image(self, product_id: str, image_url: str, alt_text: str) -> dict:
        payload = {
            "image": {
                "src": image_url,
                "alt": alt_text,
            }
        }
        response = self.rest("POST", f"products/{product_id}/images.json", payload)
        return response["image"]

    def update_product_image(self, product_id: str, image_id: str, *, alt_text: str, position: int = 1) -> dict:
        payload = {
            "image": {
                "id": int(image_id),
                "alt": alt_text,
                "position": position,
            }
        }
        response = self.rest("PUT", f"products/{product_id}/images/{image_id}.json", payload)
        return response["image"]

    def sync_product_image(self, product_id: str, image_url: str, alt_text: str, brand_name: str) -> str:
        normalized_url = normalize_image_url(image_url)
        existing_images = self.list_product_images(product_id)
        if not normalized_url:
            if existing_images:
                return "skipped: image vide, images existantes conservees"
            brand_image_url = self.get_brand_image_url(brand_name)
            normalized_url = normalize_image_url(brand_image_url)
            if not normalized_url:
                return "skipped: image vide, logo marque introuvable"
            alt_text = f"{brand_name.strip()} logo".strip()

        target_key = normalized_url.rstrip("/")
        match = next((image for image in existing_images if str(image.get("src") or "").rstrip("/") == target_key), None)

        if match:
            self.update_product_image(product_id, str(match["id"]), alt_text=alt_text, position=1)
            return "updated"

        created = self.create_product_image(product_id, normalized_url, alt_text)
        self.update_product_image(product_id, str(created["id"]), alt_text=alt_text, position=1)
        return "created"

    def publish_product(self, product_gid: str, publication_gid: str) -> None:
        query = """
        mutation PublishProduct($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) {
            userErrors { field message }
          }
        }
        """
        data = self.graphql(query, {"id": product_gid, "input": [{"publicationId": publication_gid}]})
        errors = data["publishablePublish"]["userErrors"]
        if errors:
            raise SyncError(f"Publication Shopify: {errors}")

    def unpublish_product(self, product_gid: str, publication_gid: str) -> None:
        query = """
        mutation UnpublishProduct($id: ID!, $input: [PublicationInput!]!) {
          publishableUnpublish(id: $id, input: $input) {
            userErrors { field message }
          }
        }
        """
        data = self.graphql(query, {"id": product_gid, "input": [{"publicationId": publication_gid}]})
        errors = data["publishableUnpublish"]["userErrors"]
        if errors:
            raise SyncError(f"Depublication Shopify: {errors}")


def open_worksheet(sheet_id: str, credentials_path: str, sheet_tab: str):
    path = Path(credentials_path)
    if not path.exists():
        raise SyncError(f"Fichier Google credentials introuvable: {credentials_path}")
    creds = Credentials.from_service_account_file(str(path), scopes=SCOPES)
    client = gspread.authorize(creds)
    return client.open_by_key(sheet_id).worksheet(sheet_tab)


def read_sheet_rows(worksheet, limit: int | None = None, only_skus: set[str] | None = None) -> tuple[list[SheetRow], dict[str, int]]:
    raw_rows = worksheet.get_all_values()
    if not raw_rows:
        raise SyncError("Google Sheet vide")

    headers = [normalize_header(value) for value in raw_rows[0]]
    missing = REQUIRED_HEADERS - set(headers)
    if missing:
        raise SyncError(f"Colonnes manquantes dans le sheet: {', '.join(sorted(missing))}")

    header_index = {header: idx for idx, header in enumerate(headers)}
    rows: list[SheetRow] = []
    for row_offset, raw in enumerate(raw_rows[1:], start=2):
        values = {}
        for header, idx in header_index.items():
            values[header] = raw[idx].strip() if idx < len(raw) else ""
        sku = values.get("sku", "").strip()
        if not sku:
            continue
        if only_skus and sku not in only_skus:
            continue
        rows.append(SheetRow(row_number=row_offset, values=values))
        if limit and len(rows) >= limit:
            break
    return rows, header_index


def validate_row(row: dict[str, str]) -> None:
    required = ["sku", "brand", "title", "concentration", "volume", "product_type", "price", "stock", "status"]
    for key in required:
        if not (row.get(key) or "").strip():
            raise SyncError(f"{key} vide")

    parse_price(row["price"])
    parse_stock(row["stock"])
    parse_volume(row["volume"])
    normalize_image_url(row.get("image", ""))


def should_publish(status: str, stock: int) -> bool:
    normalized = normalize_shopify_status(status)
    return normalized == "active"


def normalize_sync_result(value: str) -> str:
    return (value or "").strip().lower()


def last_result_is_synced(value: str) -> bool:
    normalized = normalize_sync_result(value)
    return normalized == "created" or normalized == "updated"


def normalize_shopify_url(url: str) -> str:
    return (url or "").strip().rstrip("/")


def resolve_target(client: ShopifyClient, row: dict[str, str]) -> ResolvedTarget:
    sku = row["sku"].strip()
    explicit_product_id = (row.get("shopify_product_id") or "").strip()
    explicit_variant_id = (row.get("shopify_variant_id") or "").strip()
    explicit_product_numeric = gid_numeric(explicit_product_id) or explicit_product_id
    explicit_variant_numeric = gid_numeric(explicit_variant_id) or explicit_variant_id

    candidates: list[SyncTarget] = []
    warnings: list[str] = []

    if explicit_variant_id:
        variant = client.get_variant(explicit_variant_id)
        if not variant:
            warnings.append(f"shopify_variant_id introuvable: {explicit_variant_id}")
        else:
            product_id = str(variant["product_id"])
            product = client.get_product(product_id)
            if not product:
                warnings.append(f"produit Shopify introuvable pour variant_id={explicit_variant_id}")
            else:
                images = client.list_product_images(product_id)
                candidates.append(
                    SyncTarget(
                        product_id=product_id,
                        variant_id=str(variant["id"]),
                        product_gid=str(product.get("admin_graphql_api_id") or ""),
                        variant_gid=str(variant.get("admin_graphql_api_id") or ""),
                        inventory_item_id=str(variant["inventory_item_id"]),
                        handle=str(product["handle"]),
                        product_url=str(
                            product.get("online_store_url") or f"https://saposparfums.fr/products/{product['handle']}"
                        ),
                        published=bool(product.get("published_at")),
                        image_urls=[str(image.get("src") or "").rstrip("/") for image in images if image.get("src")],
                        source="variant_id",
                    )
                )

    if explicit_product_id:
        product = client.get_product(explicit_product_numeric)
        if not product:
            warnings.append(f"shopify_product_id introuvable: {explicit_product_id}")
        else:
            variants = product.get("variants") or []
            target_variant = None
            if explicit_variant_id:
                target_variant = next((item for item in variants if str(item["id"]) == explicit_variant_numeric), None)
                if not target_variant:
                    warnings.append(
                        f"incoherence ids Shopify: product_id={explicit_product_id}, variant_id={explicit_variant_id}"
                    )
            else:
                sku_match = next((item for item in variants if (item.get("sku") or "").strip() == sku), None)
                target_variant = sku_match or (variants[0] if variants else None)
            if target_variant:
                images = client.list_product_images(explicit_product_numeric)
                candidates.append(
                    SyncTarget(
                        product_id=str(product["id"]),
                        variant_id=str(target_variant["id"]),
                        product_gid=str(product.get("admin_graphql_api_id") or ""),
                        variant_gid=str(target_variant.get("admin_graphql_api_id") or ""),
                        inventory_item_id=str(target_variant["inventory_item_id"]),
                        handle=str(product["handle"]),
                        product_url=str(
                            product.get("online_store_url") or f"https://saposparfums.fr/products/{product['handle']}"
                        ),
                        published=bool(product.get("published_at")),
                        image_urls=[str(image.get("src") or "").rstrip("/") for image in images if image.get("src")],
                        source="product_id",
                    )
                )
            else:
                warnings.append(f"aucune variante exploitable pour product_id={explicit_product_id}")

    variant_by_sku = client.find_variant_by_sku(sku)
    if variant_by_sku:
        product_id = gid_numeric(variant_by_sku["product"]["id"])
        product = client.get_product(product_id)
        if not product:
            raise SyncError(f"Produit Shopify introuvable pour sku={sku}")
        images = client.list_product_images(product_id)
        candidates.append(
            SyncTarget(
                product_id=product_id,
                variant_id=gid_numeric(variant_by_sku["id"]),
                product_gid=str(variant_by_sku["product"]["id"]),
                variant_gid=str(variant_by_sku["id"]),
                inventory_item_id=str(variant_by_sku.get("inventoryItem", {}).get("id", "")).rsplit("/", 1)[-1],
                handle=str(variant_by_sku["product"]["handle"]),
                product_url=str(
                    variant_by_sku["product"].get("onlineStoreUrl")
                    or product.get("online_store_url")
                    or f"https://saposparfums.fr/products/{variant_by_sku['product']['handle']}"
                ),
                published=bool(product.get("published_at")),
                image_urls=[str(image.get("src") or "").rstrip("/") for image in images if image.get("src")],
                source="sku",
            )
        )

    if not candidates:
        return ResolvedTarget(target=None, warnings=warnings)

    product_ids = {candidate.product_id for candidate in candidates}
    variant_ids = {candidate.variant_id for candidate in candidates}
    if len(product_ids) > 1 or len(variant_ids) > 1:
        raise SyncError(
            "Doublon/incoherence detecte entre sku, shopify_product_id et shopify_variant_id"
        )

    return ResolvedTarget(target=candidates[0], warnings=warnings)


def build_sync_plan(client: ShopifyClient, row: dict[str, str], target: SyncTarget | None) -> SyncPlan:
    explicit_product_id = (row.get("shopify_product_id") or "").strip()
    explicit_variant_id = (row.get("shopify_variant_id") or "").strip()
    image_value = normalize_image_url(row.get("image", ""))
    stock = parse_stock(row["stock"])
    desired_publish = should_publish(row["status"], stock)

    if target is None:
        if explicit_product_id or explicit_variant_id:
            return SyncPlan(target=None, action="created", reason="ids Shopify obsoletes, recreation requise")
        return SyncPlan(target=None, action="created", reason="nouveau produit")

    desired_tags = ", ".join(build_tags(row))
    desired_title = row["title"].strip()
    desired_vendor = row["brand"].strip()
    desired_product_type = row["product_type"].strip()
    desired_status = normalize_shopify_status(row["status"])
    desired_body_html = build_body_html(row.get("notes", ""))
    desired_price = f"{parse_price(row['price']):.2f}"
    desired_option1 = f"{parse_volume(row['volume'])} ml"
    target_image = image_value
    if not target_image and not target.image_urls:
        target_image = normalize_image_url(client.get_brand_image_url(row.get("brand", "")))

    product = client.get_product(target.product_id)
    if not product:
        raise SyncError(f"Produit Shopify introuvable pendant le diff: {target.product_id}")
    variant = next((item for item in product.get("variants") or [] if str(item["id"]) == target.variant_id), None)
    if not variant:
        raise SyncError(f"Variante Shopify introuvable pendant le diff: {target.variant_id}")

    changed = any(
        [
            str(product.get("title") or "").strip() != desired_title,
            str(product.get("vendor") or "").strip() != desired_vendor,
            str(product.get("product_type") or "").strip() != desired_product_type,
            str(product.get("status") or "").strip().lower() != desired_status,
            str(product.get("body_html") or "").strip() != desired_body_html,
            str(product.get("tags") or "").strip() != desired_tags,
            f"{float(variant.get('price') or 0):.2f}" != desired_price,
            str(variant.get("sku") or "").strip() != row["sku"].strip(),
            str(variant.get("option1") or "").strip() != desired_option1,
            int(variant.get("inventory_quantity") or 0) != stock,
            bool(product.get("published_at")) != desired_publish,
            bool(target_image) and normalize_shopify_url(target_image) not in set(target.image_urls),
        ]
    )

    if not changed and last_result_is_synced(row.get("last_sync_result", "")):
        return SyncPlan(target=target, action="skipped", reason="ligne inchangee deja synchronisee")

    return SyncPlan(target=target, action="updated", reason="mise a jour requise")


def sync_one_row(
    row: SheetRow,
    client: ShopifyClient,
    location_gid: str,
    publication_gid: str,
    dry_run: bool,
) -> dict[str, str]:
    values = row.values
    sku = values["sku"].strip()
    sync_enabled = as_bool(values.get("sync_enabled", ""))
    if not sync_enabled:
        return {
            "shopify_product_id": values.get("shopify_product_id", ""),
            "shopify_variant_id": values.get("shopify_variant_id", ""),
            "handle": values.get("handle", ""),
            "product_url": values.get("product_url", ""),
            "published_status": values.get("published_status", ""),
            "last_sync_result": "skipped",
        }

    validate_row(values)
    stock = parse_stock(values["stock"])
    resolved = resolve_target(client, values)
    target = resolved.target
    plan = build_sync_plan(client, values, target)

    if dry_run:
        product_id = target.product_id if target else values.get("shopify_product_id", "")
        variant_id = target.variant_id if target else values.get("shopify_variant_id", "")
        handle = target.handle if target else values.get("handle", "")
        product_url = target.product_url if target else values.get("product_url", "")
        return {
            "shopify_product_id": product_id,
            "shopify_variant_id": variant_id,
            "handle": handle,
            "product_url": product_url,
            "published_status": "published" if should_publish(values["status"], stock) else "draft",
            "last_sync_result": (
                f"{plan.action} ({'; '.join(resolved.warnings)})" if resolved.warnings else plan.action
            ),
        }

    if plan.action == "skipped":
        return {
            "shopify_product_id": target.product_id if target else values.get("shopify_product_id", ""),
            "shopify_variant_id": target.variant_id if target else values.get("shopify_variant_id", ""),
            "handle": target.handle if target else values.get("handle", ""),
            "product_url": target.product_url if target else values.get("product_url", ""),
            "published_status": "published" if should_publish(values["status"], stock) else "draft",
            "last_sync_result": (
                f"skipped ({'; '.join(resolved.warnings)})" if resolved.warnings else "skipped"
            ),
        }

    if plan.action == "updated" and target:
        product_gid = target.product_gid
        product_id = target.product_id
        variant_id = target.variant_id
        updated_product = client.update_product(product_id, values)
        updated_variant = client.update_variant(variant_id, values)
        inventory_item_id = str(updated_variant["inventory_item_id"])
        product_gid = updated_product.get("admin_graphql_api_id", product_gid)
        handle = updated_product["handle"]
        product_url = updated_product.get("online_store_url") or (
            target.product_url or f"https://saposparfums.fr/products/{handle}"
        )
    else:
        created_product = client.create_product(values)
        product_id = str(created_product["id"])
        product_gid = created_product["admin_graphql_api_id"]
        created_variant = created_product["variants"][0]
        variant_id = str(created_variant["id"])
        inventory_item_id = str(created_variant["inventory_item_id"])
        handle = created_product["handle"]
        product_url = f"https://saposparfums.fr/products/{handle}"

    client.set_inventory(inventory_item_id, location_gid, stock)
    client.sync_product_image(
        product_id,
        values.get("image", ""),
        values["title"].strip(),
        values.get("brand", ""),
    )

    if should_publish(values["status"], stock):
        client.publish_product(product_gid, publication_gid)
        published_status = "published"
    else:
        client.unpublish_product(product_gid, publication_gid)
        published_status = "unpublished"

    return {
        "shopify_product_id": product_id,
        "shopify_variant_id": variant_id,
        "handle": handle,
        "product_url": product_url,
        "published_status": published_status,
        "last_sync_at": now_iso(),
        "last_sync_result": (
            f"{plan.action} ({'; '.join(resolved.warnings)})" if resolved.warnings else plan.action
        ),
    }


def write_back_results(worksheet, header_index: dict[str, int], row_number: int, result: dict[str, str]) -> None:
    updates = []
    for key, value in result.items():
        if key not in header_index:
            continue
        col = header_index[key] + 1
        updates.append(
            {
                "range": gspread.utils.rowcol_to_a1(row_number, col),
                "values": [[value]],
            }
        )
    if updates:
        worksheet.batch_update(updates, value_input_option="USER_ENTERED")


def main() -> int:
    args = parse_args()
    if not args.sheet_id:
        raise SyncError("GOOGLE_SHEETS_ID manquant")

    only_skus = {sku.strip() for sku in (args.skus or []) if sku.strip()} or None
    worksheet = open_worksheet(args.sheet_id, args.credentials, args.sheet_tab)
    rows, header_index = read_sheet_rows(worksheet, limit=args.limit, only_skus=only_skus)
    if not rows:
        print("Aucune ligne a traiter.")
        return 0

    client = ShopifyClient(
        request_interval_seconds=args.request_interval_seconds,
        retry_delay_seconds=args.retry_delay_seconds,
        max_retries=args.max_retries,
    )
    location_gid, publication_gid = client.get_online_store_context()

    print(
        json.dumps(
            {
                "mode": "apply" if args.apply else "dry-run",
                "rows": len(rows),
                "sheet_tab": args.sheet_tab,
                "location_gid": location_gid,
                "publication_gid": publication_gid,
                "batch_size": args.batch_size,
                "batch_pause_seconds": args.batch_pause_seconds,
                "request_interval_seconds": args.request_interval_seconds,
                "max_retries": args.max_retries,
            },
            ensure_ascii=False,
        )
    )

    has_error = False
    for index, row in enumerate(rows, start=1):
        sku = row.values["sku"].strip()
        try:
            result = sync_one_row(row, client, location_gid, publication_gid, dry_run=not args.apply)
            if args.apply:
                write_back_results(worksheet, header_index, row.row_number, result)
            print(json.dumps({"row": row.row_number, "sku": sku, "result": result}, ensure_ascii=False))
        except Exception as exc:
            has_error = True
            error_result = {
                "last_sync_at": now_iso(),
                "last_sync_result": f"error: {exc}",
            }
            if args.apply:
                write_back_results(worksheet, header_index, row.row_number, error_result)
            print(json.dumps({"row": row.row_number, "sku": sku, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        if index < len(rows) and args.batch_size > 0 and index % args.batch_size == 0:
            time.sleep(max(0.0, args.batch_pause_seconds))

    return 1 if has_error else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"Erreur sync sheet -> Shopify: {exc}", file=sys.stderr)
        sys.exit(1)
