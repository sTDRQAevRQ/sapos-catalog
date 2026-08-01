#!/usr/bin/env python3
"""
Initialise la couche marques Shopify via metaobjects.

Ce script :
- verifie / cree la definition metaobject `brand`
- lit les marques presentes dans Shopify
- cree les entrees de marque manquantes (name + slug)

Les logos / fallback_image sont ensuite a renseigner dans l'admin Shopify.
"""

from __future__ import annotations

import json
import sys

from sync_shopify_catalog import (
    ENV_PATH,
    build_brand_meta_map,
    fetch_all_products,
    fetch_brand_metaobjects,
    graphql,
    infer_brand,
    load_env,
    normalize_brand_key,
    refresh_access_token,
    slugify_brand,
)


BRAND_DEFINITION_TYPE = "brand"


def ensure_brand_definition(store: str, token: str) -> dict:
    query = """
    query BrandDefinitions {
      metaobjectDefinitions(first: 100) {
        nodes {
          id
          type
          name
          fieldDefinitions { key name }
        }
      }
    }
    """
    data = graphql(store, token, query)
    existing = next(
        (node for node in data["metaobjectDefinitions"]["nodes"] if node.get("type") == BRAND_DEFINITION_TYPE),
        None,
    )
    if existing:
        return existing

    mutation = """
    mutation CreateBrandDefinition($definition: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $definition) {
        metaobjectDefinition {
          id
          type
          name
          fieldDefinitions { key name }
        }
        userErrors { field message code }
      }
    }
    """
    variables = {
        "definition": {
            "name": "Brand",
            "type": BRAND_DEFINITION_TYPE,
            "displayNameKey": "name",
            "fieldDefinitions": [
                {"name": "Name", "key": "name", "type": "single_line_text_field", "required": True},
                {"name": "Slug", "key": "slug", "type": "single_line_text_field"},
                {"name": "Logo", "key": "logo", "type": "file_reference"},
                {"name": "Fallback image", "key": "fallback_image", "type": "file_reference"},
                {"name": "Description", "key": "description", "type": "multi_line_text_field"},
            ],
            "capabilities": {"publishable": {"enabled": True}},
        }
    }
    created = graphql(store, token, mutation, variables)["metaobjectDefinitionCreate"]
    errors = created.get("userErrors") or []
    if errors:
        raise RuntimeError(f"Erreur creation definition brand: {errors}")
    return created["metaobjectDefinition"]


def create_brand_entry(store: str, token: str, name: str) -> dict:
    mutation = """
    mutation CreateBrand($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          id
          handle
          displayName
        }
        userErrors { field message code }
      }
    }
    """
    slug = slugify_brand(name)
    variables = {
        "metaobject": {
            "type": BRAND_DEFINITION_TYPE,
            "handle": slug,
            "fields": [
                {"key": "name", "value": name},
                {"key": "slug", "value": slug},
                {"key": "description", "value": ""},
            ],
        }
    }
    result = graphql(store, token, mutation, variables)["metaobjectCreate"]
    errors = result.get("userErrors") or []
    if errors:
        raise RuntimeError(f"Erreur creation marque {name}: {errors}")
    return result["metaobject"]


def canonical_brands_from_products(products: list[dict]) -> list[str]:
    labels = {}
    for product in products:
        brand = (infer_brand(product) or "").strip()
        if not brand:
            continue
        labels.setdefault(normalize_brand_key(brand), brand)
    return [labels[key] for key in sorted(labels)]


def main() -> int:
    if not ENV_PATH.exists():
        raise SystemExit(f"Fichier d'accès Shopify introuvable: {ENV_PATH}")

    env = load_env(ENV_PATH)
    store = env.get("SHOPIFY_STORE")
    client_id = env.get("SHOPIFY_CLIENT_ID")
    client_secret = env.get("SHOPIFY_CLIENT_SECRET")
    if not store or not client_id or not client_secret:
        raise SystemExit("SHOPIFY_STORE / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET manquants")

    token = refresh_access_token(store, client_id, client_secret)
    definition = ensure_brand_definition(store, token)
    products = fetch_all_products(store, token)
    product_brands = canonical_brands_from_products(products)
    existing_meta = build_brand_meta_map(fetch_brand_metaobjects(store, token))

    created = []
    for brand in product_brands:
        if normalize_brand_key(brand) in existing_meta:
            continue
        created_metaobject = create_brand_entry(store, token, brand)
        created.append({"brand": brand, "id": created_metaobject["id"], "handle": created_metaobject["handle"]})

    print(
        json.dumps(
            {
                "definition_id": definition["id"],
                "definition_type": definition["type"],
                "brands_detected": len(product_brands),
                "brands_created": created,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Erreur setup brand metaobjects: {exc}", file=sys.stderr)
        raise
