#!/usr/bin/env python3
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT.parent / "shopify.env"
OUT_PATH = ROOT / "public" / "data" / "catalog.json"
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


def load_env(path: Path):
    env = {}
    for line in path.read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


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


def normalize_collection_name(product):
    collections = [node["title"] for node in product.get("collections", {}).get("nodes", []) if node.get("title")]
    if collections:
        return collections

    title = product.get("title", "")
    match = re.match(r"([^–-]+)", title)
    return [match.group(1).strip()] if match else []


def infer_brand(product):
    tags = [tag.lower() for tag in (product.get("tags") or [])]
    for raw_tag, brand in BRAND_TAG_MAP.items():
        if any(raw_tag in tag for tag in tags):
            return brand

    collections = normalize_collection_name(product)
    for collection in collections:
        lower = collection.lower()
        if not lower.startswith(GENERIC_COLLECTION_PREFIXES):
            return collection
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


def normalize_products(products):
    normalized = []
    for rank, product in enumerate(products, start=1):
        tags = product.get("tags") or []
        families = infer_families(tags)
        collections = normalize_collection_name(product)
        status_key, status_label = infer_status(product)
        amount = product.get("priceRangeV2", {}).get("minVariantPrice", {}).get("amount")
        price_value = round(float(amount), 2) if amount else None
        currency = product.get("priceRangeV2", {}).get("minVariantPrice", {}).get("currencyCode") or "EUR"

        normalized.append(
            {
                "id": product["id"],
                "title": product["title"],
                "subtitle": infer_subtitle(product, families, collections),
                "brand": infer_brand(product),
                "url": product.get("onlineStoreUrl") or f"https://saposparfums.fr/products/{product['handle']}",
                "image": (product.get("featuredImage") or {}).get("url"),
                "imageAlt": (product.get("featuredImage") or {}).get("altText") or product["title"],
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
    normalized = normalize_products(products)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n")
    print(f"{len(normalized)} produits synchronisés vers {OUT_PATH}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Erreur sync Shopify: {exc}", file=sys.stderr)
        sys.exit(1)
