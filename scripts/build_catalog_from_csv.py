#!/usr/bin/env python3
import csv
import json
from pathlib import Path

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


def main():
    if not SOURCE_PATH.exists():
        raise SystemExit(f"Source CSV introuvable: {SOURCE_PATH}")

    sample = SOURCE_PATH.read_text(encoding="utf-8")[:2048]
    delimiter = detect_delimiter(sample)

    with SOURCE_PATH.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=delimiter)
        items = []

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
                    "rank": int((row.get("rank") or index)),
                    "publishedAt": (row.get("published_at") or "").strip() or None,
                }
            )

    items.sort(key=lambda item: (item.get("rank") or 9999, item["title"].lower()))
    payload = json.dumps(items, ensure_ascii=False, indent=2) + "\n"
    OUT_PATH.write_text(payload, encoding="utf-8")
    PUBLIC_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_OUT_PATH.write_text(payload, encoding="utf-8")
    print(f"{len(items)} references synchronisees vers {OUT_PATH}")


if __name__ == "__main__":
    main()
