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
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials

from sync_shopify_catalog import API_VER, load_env, refresh_access_token

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = ROOT.parent
ENV_PATH = WORKSPACE_ROOT / "shopify.env"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
DEFAULT_CREDENTIALS_PATH = ROOT / "scripts" / "google-credentials.json"
DEFAULT_SHEET_TAB = "products"
ONLINE_STORE_PUBLICATION_NAME = "Online Store"
TRUE_VALUES = {"1", "oui", "yes", "true", "x", "vrai"}
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync Google Sheet products to Shopify")
    parser.add_argument("--apply", action="store_true", help="active les ecritures Shopify et Google Sheet")
    parser.add_argument("--sku", action="append", dest="skus", help="limite la sync a un ou plusieurs SKU")
    parser.add_argument("--limit", type=int, default=None, help="limite le nombre de lignes traitees")
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
    def __init__(self) -> None:
        if not ENV_PATH.exists():
            raise SyncError(f"Fichier Shopify introuvable: {ENV_PATH}")
        env = load_env(ENV_PATH)
        self.store = env.get("SHOPIFY_STORE")
        self.token = env.get("SHOPIFY_ACCESS_TOKEN")
        self.client_id = env.get("SHOPIFY_CLIENT_ID")
        self.client_secret = env.get("SHOPIFY_CLIENT_SECRET")
        if not self.store or not self.token:
            raise SyncError("SHOPIFY_STORE ou SHOPIFY_ACCESS_TOKEN manquant dans shopify.env")

    def _refresh_token(self) -> None:
        if not self.client_id or not self.client_secret:
            raise SyncError("Impossible de regenerer le token Shopify: client_id/client_secret manquant")
        self.token = refresh_access_token(self.store, self.client_id, self.client_secret)

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
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code != 401:
                raise
            self._refresh_token()
            request.headers["X-Shopify-Access-Token"] = self.token
            with urllib.request.urlopen(request, timeout=60) as response:
                data = json.loads(response.read().decode("utf-8"))

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
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code != 401:
                raise
            self._refresh_token()
            request.headers["X-Shopify-Access-Token"] = self.token
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))

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


def should_publish(status: str, stock: int) -> bool:
    normalized = normalize_shopify_status(status)
    return normalized == "active"


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
            "last_sync_at": now_iso(),
            "last_sync_result": "skipped: sync_enabled != oui",
        }

    validate_row(values)
    stock = parse_stock(values["stock"])
    variant = client.find_variant_by_sku(sku)
    action = "updated" if variant else "created"

    if dry_run:
        return {
            "shopify_product_id": values.get("shopify_product_id", gid_numeric(variant["product"]["id"]) if variant else ""),
            "shopify_variant_id": values.get("shopify_variant_id", gid_numeric(variant["id"]) if variant else ""),
            "handle": values.get("handle", variant["product"]["handle"] if variant else ""),
            "product_url": values.get("product_url", variant["product"].get("onlineStoreUrl") if variant else ""),
            "published_status": "published" if should_publish(values["status"], stock) else "draft",
            "last_sync_at": now_iso(),
            "last_sync_result": f"dry-run: {action}",
        }

    if variant:
        product_gid = variant["product"]["id"]
        product_id = gid_numeric(product_gid)
        variant_id = gid_numeric(variant["id"])
        updated_product = client.update_product(product_id, values)
        updated_variant = client.update_variant(variant_id, values)
        inventory_item_id = str(updated_variant["inventory_item_id"])
        product_gid = updated_product.get("admin_graphql_api_id", product_gid)
        handle = updated_product["handle"]
        product_url = updated_product.get("admin_graphql_api_id") and (
            variant["product"].get("onlineStoreUrl") or f"https://saposparfums.fr/products/{handle}"
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
        "last_sync_result": action,
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

    client = ShopifyClient()
    location_gid, publication_gid = client.get_online_store_context()

    print(
        json.dumps(
            {
                "mode": "apply" if args.apply else "dry-run",
                "rows": len(rows),
                "sheet_tab": args.sheet_tab,
                "location_gid": location_gid,
                "publication_gid": publication_gid,
            },
            ensure_ascii=False,
        )
    )

    has_error = False
    for row in rows:
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

    return 1 if has_error else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"Erreur sync sheet -> Shopify: {exc}", file=sys.stderr)
        sys.exit(1)
