#!/usr/bin/env python3
"""
Genere data/catalog.json depuis Shopify uniquement.

Le flux Sheet -> Shopify est gere par un Apps Script externe en production.
Ce builder ne relit donc plus le Google Sheet localement et reconstruit
le catalogue a partir de l'etat courant de Shopify.
"""

import json

from build_catalog_from_csv import OUT_PATH, PUBLIC_OUT_PATH, load_shopify_items


def main():
    shopify_items = load_shopify_items()
    payload = json.dumps(shopify_items, ensure_ascii=False, indent=2) + "\n"
    OUT_PATH.write_text(payload, encoding="utf-8")
    PUBLIC_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_OUT_PATH.write_text(payload, encoding="utf-8")
    print(f"{len(shopify_items)} references synchronisees vers {OUT_PATH} (Shopify only)")


if __name__ == "__main__":
    main()
