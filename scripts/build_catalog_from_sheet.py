#!/usr/bin/env python3
"""
Genere data/catalog.json a partir d'un Google Sheet, a la place du CSV local.

Variables d'environnement requises :
  GOOGLE_SHEETS_ID           : ID de la feuille (dans l'URL, entre /d/ et /edit)
  GOOGLE_SHEETS_CREDENTIALS  : chemin vers le fichier JSON du compte de service
                                (defaut: scripts/google-credentials.json)
  GOOGLE_SHEETS_TAB          : nom de l'onglet a lire (defaut: "catalogue")

Dependances :
  pip install gspread google-auth

La premiere ligne de l'onglet doit contenir les memes en-tetes que le CSV :
  id, rank, brand, title, volume, price, status, families, gender, note,
  tags, url, image, collections, published_at, best_seller, discontinued,
  quantite
"""
import json
import os
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials

from build_catalog_from_csv import (
    parse_price,
    format_price,
    normalize_status,
    split_values,
    parse_bool,
    parse_quantity,
    load_shopify_items,
    merge_catalog,
    OUT_PATH,
    PUBLIC_OUT_PATH,
)

ROOT = Path(__file__).resolve().parents[1]
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

SPREADSHEET_ID = os.environ.get("GOOGLE_SHEETS_ID")
CREDENTIALS_PATH = os.environ.get(
    "GOOGLE_SHEETS_CREDENTIALS", str(ROOT / "scripts" / "google-credentials.json")
)
SHEET_TAB = os.environ.get("GOOGLE_SHEETS_TAB", "catalogue")


def read_sheet_items():
    if not SPREADSHEET_ID:
        raise SystemExit("GOOGLE_SHEETS_ID manquant (variable d'environnement)")
    if not Path(CREDENTIALS_PATH).exists():
        raise SystemExit(f"Fichier d'identifiants introuvable: {CREDENTIALS_PATH}")

    creds = Credentials.from_service_account_file(CREDENTIALS_PATH, scopes=SCOPES)
    client = gspread.authorize(creds)
    worksheet = client.open_by_key(SPREADSHEET_ID).worksheet(SHEET_TAB)
    rows = worksheet.get_all_records()

    items = []
    for index, row in enumerate(rows, start=1):
        title = str(row.get("title") or "").strip()
        if not title:
            continue

        price_value = parse_price(str(row.get("price") or ""))
        status_key, status_label = normalize_status(str(row.get("status") or ""))
        brand = str(row.get("brand") or "").strip() or "Sans marque"
        families = split_values(str(row.get("families") or ""))
        tags = split_values(str(row.get("tags") or ""))
        collections = split_values(str(row.get("collections") or ""))
        note = str(row.get("note") or "").strip()
        volume = str(row.get("volume") or "").strip()
        gender = str(row.get("gender") or "").strip() or "Mixte"
        best_seller = parse_bool(str(row.get("best_seller") or ""))
        discontinued = parse_bool(str(row.get("discontinued") or ""))
        quantity = parse_quantity(
            str(row.get("quantite") or row.get("quantité") or "")
        )
        rank_raw = row.get("rank")

        items.append(
            {
                "id": str(row.get("id") or f"sheet-{index}").strip(),
                "title": title,
                "subtitle": note,
                "note": note,
                "brand": brand,
                "volume": volume,
                "url": str(row.get("url") or "").strip(),
                "image": str(row.get("image") or "").strip(),
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
                "rank": int(rank_raw) if str(rank_raw or "").strip() else index,
                "publishedAt": str(row.get("published_at") or "").strip() or None,
            }
        )

    return items


def main():
    sheet_items = read_sheet_items()
    shopify_items = load_shopify_items()
    items = merge_catalog(shopify_items, sheet_items)
    payload = json.dumps(items, ensure_ascii=False, indent=2) + "\n"
    OUT_PATH.write_text(payload, encoding="utf-8")
    PUBLIC_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_OUT_PATH.write_text(payload, encoding="utf-8")
    print(
        f"{len(items)} references synchronisees depuis Google Sheets vers {OUT_PATH} "
        f"({len(shopify_items)} Shopify + {len(sheet_items)} Sheet)"
    )


if __name__ == "__main__":
    main()
