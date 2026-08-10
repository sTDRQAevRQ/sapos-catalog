#!/usr/bin/env python3
import csv
import json
from pathlib import Path

from sync_shopify_catalog import (
    fetch_all_products,
    fetch_brand_metaobjects,
    build_brand_meta_map,
    load_shopify_config,
    normalize_products,
    refresh_access_token,
    write_brand_logo_files,
    ENV_PATH,
)

ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "data" / "catalog-source.csv"
OUT_PATH = ROOT / "data" / "catalog.json"
PUBLIC_OUT_PATH = ROOT / "public" / "data" / "catalog.json"

STATUS_MAP = {
    "disponible": ("available", "Disponible"),
    "en stock": ("available", "Disponible"),
    "bientot": ("soon", "Bientot"),
    "bientôt": ("soon", "Bientot"),
    "arrivage": ("soon", "Arrivage"),
    "rupture": ("out", "Rupture"),
    "indisponible": ("out", "Indisponible"),
    "masque": ("out", "Masque"),
    "masqué": ("out", "Masque"),
}

TRUE_VALUES = {"1", "oui", "yes", "true", "x", "vrai"}


def detect_delimiter(sample: str) -> str:
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,")
        return dialect.delimiter
    except csv.Error:
        return ";"


def split_values(raw: str):
    if not raw:
        return []
    return [part.strip() for part in raw.split("|") if part.strip()]


def parse_price(raw: str):
    if not raw:
        return None
    cleaned = raw.replace("€", "").replace(" ", "").replace(",", ".").strip()
    if not cleaned:
        return None
    return round(float(cleaned), 2)


def format_price(price_value):
    if price_value is None:
        return ""
    return f"{price_value:.2f}".replace(".", ",") + " €"


def normalize_status(raw: str):
    key = (raw or "").strip().lower()
    return STATUS_MAP.get(key, ("available", raw.strip() if raw else "Disponible"))


def parse_bool(raw: str) -> bool:
    return (raw or "").strip().lower() in TRUE_VALUES


def parse_quantity(raw: str):
    cleaned = (raw or "").strip().replace(",", ".")
    if not cleaned:
        return None
    try:
        return int(float(cleaned))
    except ValueError:
        return None


def read_csv_items():
    if not SOURCE_PATH.exists():
        raise SystemExit(f"Source CSV introuvable: {SOURCE_PATH}")

    sample = SOURCE_PATH.read_text(encoding="utf-8")[:2048]
    delimiter = detect_delimiter(sample)
    items = []

    with SOURCE_PATH.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=delimiter)

        for index, row in enumerate(reader, start=1):
            title = (row.get("title") or "").strip()
            if not title:
                continue

            price_value = parse_price(row.get("price") or "")
            status_key, status_label = normalize_status(row.get("status") or "")
            brand = (row.get("brand") or "").strip() or "Sans marque"
            families = split_values(row.get("families") or "")
            tags = split_values(row.get("tags") or "")
            collections = split_values(row.get("collections") or "")
            note = (row.get("note") or "").strip()
            volume = (row.get("volume") or "").strip()
            gender = (row.get("gender") or "").strip() or "Mixte"
            best_seller = parse_bool(row.get("best_seller") or "")
            discontinued = parse_bool(row.get("discontinued") or "")
            quantity = parse_quantity(row.get("quantite") or row.get("quantité") or "")

            items.append(
                {
                    "id": (row.get("id") or f"csv-{index}").strip(),
                    "title": title,
                    "subtitle": note,
                    "note": note,
                    "brand": brand,
                    "volume": volume,
                    "url": (row.get("url") or "").strip(),
                    "image": (row.get("image") or "").strip(),
                    "imageAlt": title,
                    "families": families,
                    "collections": collections,
                    "gender": gender,
                    "statusKey": status_key,
                    "statusLabel": status_label,
                    "priceValue": price_value,
                    "priceLabel": format_price(price_value),
                    "tags": tags,
                    "bestSeller": best_seller,
                    "discontinued": discontinued,
                    "quantity": quantity,
                    "rank": int((row.get("rank") or index)),
                    "publishedAt": (row.get("published_at") or "").strip() or None,
                }
            )

    return items


def load_shopify_items():
    env = load_shopify_config(ENV_PATH)
    store = env.get("SHOPIFY_STORE")
    token = env.get("SHOPIFY_ACCESS_TOKEN")
    client_id = env.get("SHOPIFY_CLIENT_ID")
    client_secret = env.get("SHOPIFY_CLIENT_SECRET")
    if not store or not token:
        return []

    try:
        products = fetch_all_products(store, token)
    except Exception as exc:
        if "401" not in str(exc) or not client_id or not client_secret:
            raise
        token = refresh_access_token(store, client_id, client_secret)
        products = fetch_all_products(store, token)
    brand_meta_map = build_brand_meta_map(fetch_brand_metaobjects(store, token))
    write_brand_logo_files(brand_meta_map)
    return normalize_products(products, brand_meta_map=brand_meta_map)


def slugify(value: str):
    return " ".join((value or "").strip().lower().split())


def build_match_keys(item):
    keys = set()
    if item.get("id"):
        keys.add(f"id:{item['id']}")
    if item.get("url"):
        keys.add(f"url:{item['url'].rstrip('/')}")
    title = slugify(item.get("title") or "")
    brand = slugify(item.get("brand") or "")
    volume = slugify(item.get("volume") or "")
    if title and brand:
        keys.add(f"brand_title:{brand}::{title}")
    if title and brand and volume:
        keys.add(f"brand_title_volume:{brand}::{title}::{volume}")
    return keys


def merge_item(base_item, override_item):
    merged = dict(base_item)
    for key, value in override_item.items():
        if key == "id":
            continue
        if value in ("", [], None):
            continue
        merged[key] = value
    return merged


def merge_catalog(shopify_items, csv_items):
    merged = []
    matched_csv_ids = set()
    csv_by_key = {}

    for item in csv_items:
        for key in build_match_keys(item):
            csv_by_key.setdefault(key, []).append(item)

    for item in shopify_items:
        override = None
        for key in build_match_keys(item):
            matches = csv_by_key.get(key) or []
            if matches:
                override = matches[0]
                matched_csv_ids.add(override["id"])
                break

        merged.append(merge_item(item, override) if override else item)

    for item in csv_items:
        if item["id"] not in matched_csv_ids:
            merged.append(item)

    merged.sort(key=lambda item: (item.get("rank") or 9999, (item.get("title") or "").lower()))
    return merged


def main():
    csv_items = read_csv_items()
    shopify_items = load_shopify_items()
    items = merge_catalog(shopify_items, csv_items)
    payload = json.dumps(items, ensure_ascii=False, indent=2) + "\n"
    OUT_PATH.write_text(payload, encoding="utf-8")
    PUBLIC_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_OUT_PATH.write_text(payload, encoding="utf-8")
    print(
        f"{len(items)} references synchronisees vers {OUT_PATH} "
        f"({len(shopify_items)} Shopify + {len(csv_items)} CSV)"
    )


if __name__ == "__main__":
    main()
