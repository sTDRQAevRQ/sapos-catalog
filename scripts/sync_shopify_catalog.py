#!/usr/bin/env python3
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT.parent / "shopify.env"
OUT_PATH = ROOT / "public" / "data" / "catalog.json"
LEGACY_OUT_PATH = ROOT / "data" / "catalog.json"
BRAND_LOGOS_OUT_PATH = ROOT / "public" / "data" / "brand-logos.json"
BRAND_LOGOS_LEGACY_OUT_PATH = ROOT / "data" / "brand-logos.json"
API_VER = "2025-04"

TAG_FAMILY_MAP = {
    "agrumes": "Frais",
    "parfum frais": "Frais",
    "parfum fruité": "Fruité",
    "parfum floral": "Floral",
    "parfum gourmand": "Gourmand",
    "parfum boisé": "Boisé",
    "parfum oriental": "Oriental",
    "parfum épicé": "Épicé",
    "parfum ambré": "Ambré",
    "oud": "Oud",
}

TAG_GENDER_MAP = {
    "parfum femme": "Femme",
    "parfum homme": "Homme",
    "parfum unisexe": "Mixte",
    "parfum mixte": "Mixte",
}

BRAND_TAG_MAP = {
    "signature royale": "Signature Royale",
    "noble essence": "Noble Essence",
    "atelier d'orient": "Atelier d'Orient",
    "maison lazaar paris": "Maison Lazaar Paris",
}

GENERIC_COLLECTION_PREFIXES = (
    "avada",
    "tous nos parfums",
    "les incontournables",
    "nos best-sellers",
    "parfums ",
    "collection ",
    "sapos parfums",
)

COLLECTION_BRAND_DELIMITERS = (" — ", " – ", " - ")

VOLUME_PATTERN = re.compile(r"\d+[\.,]?\d*\s?(?:ml|cl|l)\b", re.IGNORECASE)


def load_env(path: Path):
    env = {}
    for line in path.read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def normalize_brand_key(value: str) -> str:
    return " ".join(
        (value or "")
        .strip()
        .replace("’", "'")
        .replace("`", "'")
        .lower()
        .split()
    )


def slugify_brand(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")
    return slug or "brand"


def graphql(store: str, token: str, query: str, variables=None):
    payload = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    request = urllib.request.Request(
        f"https://{store}/admin/api/{API_VER}/graphql.json",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.loads(response.read().decode("utf-8"))
    if data.get("errors"):
        raise RuntimeError(data["errors"])
    return data["data"]


def refresh_access_token(store: str, client_id: str, client_secret: str):
    payload = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "client_credentials",
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"https://{store}/admin/oauth/access_token",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.loads(response.read().decode("utf-8"))
    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"Réponse Shopify sans access_token: {data}")
    return token


def extract_file_url(reference: dict | None):
    if not reference:
        return None
    typename = reference.get("__typename")
    if typename == "MediaImage":
        image = reference.get("image") or {}
        return image.get("url")
    if typename == "GenericFile":
        return reference.get("url")
    return None


def fetch_brand_metaobjects(store: str, token: str):
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
        data = graphql(store, token, query, {"cursor": cursor})
        payload = data["metaobjects"]
        items.extend(payload["nodes"])
        if not payload["pageInfo"]["hasNextPage"]:
            return items
        cursor = payload["pageInfo"]["endCursor"]


def build_brand_meta_map(metaobjects):
    meta_map = {}
    for item in metaobjects:
        fields = {field["key"]: field for field in item.get("fields") or []}
        display_name = (item.get("displayName") or "").strip()
        name = (fields.get("name", {}).get("value") or display_name).strip()
        if not name:
            continue
        logo_url = extract_file_url(fields.get("logo", {}).get("reference"))
        fallback_url = extract_file_url(fields.get("fallback_image", {}).get("reference"))
        key = normalize_brand_key(name)
        meta_map[key] = {
            "name": name,
            "slug": (fields.get("slug", {}).get("value") or item.get("handle") or slugify_brand(name)).strip(),
            "logo": logo_url,
            "fallback_image": fallback_url,
            "description": (fields.get("description", {}).get("value") or "").strip(),
        }
    return meta_map


def write_brand_logo_files(brand_meta_map):
    payload = {}
    for item in brand_meta_map.values():
        name = item.get("name")
        logo_url = item.get("logo") or item.get("fallback_image")
        if not name or not logo_url:
            continue
        payload[name] = logo_url

    serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    BRAND_LOGOS_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    BRAND_LOGOS_OUT_PATH.write_text(serialized, encoding="utf-8")
    BRAND_LOGOS_LEGACY_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    BRAND_LOGOS_LEGACY_OUT_PATH.write_text(serialized, encoding="utf-8")


def normalize_collection_name(product):
    collections = [node["title"] for node in product.get("collections", {}).get("nodes", []) if node.get("title")]
    if collections:
        return collections

    title = product.get("title", "")
    match = re.match(r"([^–-]+)", title)
    return [match.group(1).strip()] if match else []


def extract_brand_from_collection(collection_title: str) -> str:
    """Une collection Shopify est souvent nommee 'Marque — description'.
    On ne garde jamais le titre complet comme marque, seulement le segment
    avant le premier delimiteur connu."""
    for delimiter in COLLECTION_BRAND_DELIMITERS:
        if delimiter in collection_title:
            return collection_title.split(delimiter, 1)[0].strip()
    return collection_title.strip()


def infer_brand(product):
    tags = [tag.lower() for tag in (product.get("tags") or [])]
    for raw_tag, brand in BRAND_TAG_MAP.items():
        if any(raw_tag in tag for tag in tags):
            return brand

    collections = normalize_collection_name(product)
    for collection in collections:
        lower = collection.lower()
        if not lower.startswith(GENERIC_COLLECTION_PREFIXES):
            return extract_brand_from_collection(collection)
    return product.get("vendor") or "Sapos Parfums"


def infer_families(tags):
    found = []
    lower_tags = [tag.lower() for tag in tags]
    for raw_tag, family in TAG_FAMILY_MAP.items():
        if raw_tag in lower_tags and family not in found:
            found.append(family)
    return found[:3]


def infer_gender(tags):
    lower_tags = [tag.lower() for tag in tags]
    if any("parfum unisexe" in tag or "parfum mixte" in tag for tag in lower_tags):
        return "Mixte"
    if any("parfum femme" in tag for tag in lower_tags) and any("parfum homme" in tag for tag in lower_tags):
        return "Mixte"
    for raw_tag, gender in TAG_GENDER_MAP.items():
        if any(raw_tag in tag for tag in lower_tags):
            return gender
    return "Mixte"


def infer_volume(product):
    """Cherche la contenance dans les options de variante (ex: 'Contenance: 50 ml'),
    puis dans le titre de la variante, puis dans le titre du produit."""
    for variant in product.get("variants", {}).get("nodes", []):
        for opt in variant.get("selectedOptions") or []:
            value = opt.get("value") or ""
            if VOLUME_PATTERN.search(value):
                return value.strip()
        title = variant.get("title") or ""
        if title and title != "Default Title" and VOLUME_PATTERN.search(title):
            return title.strip()

    match = VOLUME_PATTERN.search(product.get("title") or "")
    if match:
        return match.group(0).strip()

    return ""


def infer_subtitle(product, families, collections):
    parts = []
    if families:
        parts.append(" · ".join(families[:2]))
    if collections:
        parts.append(collections[0])
    if product.get("status") == "DRAFT":
        parts.append("En préparation")
    return " — ".join(parts) or "Fiche prête pour recommandation client."


def infer_status(product):
    status = (product.get("status") or "").upper()
    if status == "ACTIVE":
        return "available", "Disponible"
    if status == "DRAFT":
        return "soon", "Bientôt"
    return "out", "Masqué"


def fetch_all_products(store: str, token: str):
    items = []
    cursor = None
    query = """
    query FetchProducts($cursor: String) {
      products(first: 100, after: $cursor, sortKey: TITLE) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          title
          handle
          vendor
          productType
          onlineStoreUrl
          publishedAt
          status
          tags
          totalInventory
          featuredImage { url altText }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          collections(first: 8) { nodes { title handle } }
          variants(first: 5) {
            nodes {
              title
              selectedOptions { name value }
            }
          }
        }
      }
    }
    """
    while True:
        data = graphql(store, token, query, {"cursor": cursor})
        payload = data["products"]
        items.extend(payload["nodes"])
        if not payload["pageInfo"]["hasNextPage"]:
            return items
        cursor = payload["pageInfo"]["endCursor"]


def normalize_products(products, brand_meta_map=None):
    normalized = []
    for rank, product in enumerate(products, start=1):
        tags = product.get("tags") or []
        families = infer_families(tags)
        collections = normalize_collection_name(product)
        status_key, status_label = infer_status(product)
        amount = product.get("priceRangeV2", {}).get("minVariantPrice", {}).get("amount")
        price_value = round(float(amount), 2) if amount else None
        currency = product.get("priceRangeV2", {}).get("minVariantPrice", {}).get("currencyCode") or "EUR"
        brand = infer_brand(product)
        brand_meta = (brand_meta_map or {}).get(normalize_brand_key(brand), {})
        featured_image = product.get("featuredImage") or {}
        image_url = featured_image.get("url") or brand_meta.get("fallback_image")
        image_alt = featured_image.get("altText") or product["title"]

        normalized.append(
            {
                "id": product["id"],
                "title": product["title"],
                "subtitle": infer_subtitle(product, families, collections),
                "brand": brand,
                "url": product.get("onlineStoreUrl") or f"https://saposparfums.fr/products/{product['handle']}",
                "image": image_url,
                "imageAlt": image_alt,
                "volume": infer_volume(product),
                "families": families,
                "collections": collections,
                "gender": infer_gender(tags),
                "statusKey": status_key,
                "statusLabel": status_label,
                "priceValue": price_value,
                "priceLabel": format_price(price_value, currency),
                "tags": tags[:12],
                "rank": rank,
                "publishedAt": product.get("publishedAt"),
            }
        )

    return normalized


def format_price(price_value, currency):
    if price_value is None:
        return ""
    if currency == "EUR":
        return f"{price_value:.2f}".replace(".", ",") + " €"
    return f"{price_value:.2f} {currency}"


def main():
    if not ENV_PATH.exists():
        raise SystemExit(f"Fichier d'accès Shopify introuvable: {ENV_PATH}")

    env = load_env(ENV_PATH)
    store = env.get("SHOPIFY_STORE")
    token = env.get("SHOPIFY_ACCESS_TOKEN")
    client_id = env.get("SHOPIFY_CLIENT_ID")
    client_secret = env.get("SHOPIFY_CLIENT_SECRET")
    if not store or not token:
        raise SystemExit("SHOPIFY_STORE ou SHOPIFY_ACCESS_TOKEN manquant dans shopify.env")

    try:
        products = fetch_all_products(store, token)
    except Exception as exc:
        if "401" not in str(exc) or not client_id or not client_secret:
            raise
        token = refresh_access_token(store, client_id, client_secret)
    products = fetch_all_products(store, token)
    brand_metaobjects = fetch_brand_metaobjects(store, token)
    brand_meta_map = build_brand_meta_map(brand_metaobjects)
    normalized = normalize_products(products, brand_meta_map=brand_meta_map)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n")
    LEGACY_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    LEGACY_OUT_PATH.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n")
    write_brand_logo_files(brand_meta_map)
    print(f"{len(normalized)} produits synchronisés vers {OUT_PATH}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Erreur sync Shopify: {exc}", file=sys.stderr)
        sys.exit(1)
