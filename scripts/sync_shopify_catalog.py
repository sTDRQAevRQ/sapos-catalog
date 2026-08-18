#!/usr/bin/env python3
import json
import os
import re
import sys
import unicodedata
from html.parser import HTMLParser
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

ALLOWED_FAMILY_VALUES = [
    "Aldéhydé",
    "Aquatique",
    "Ambré",
    "Animal",
    "Aromatique",
    "Balsamique",
    "Boisé",
    "Chypré",
    "Cuiré",
    "Épicé",
    "Floral",
    "Fougère",
    "Fruité",
    "Gourmand",
    "Hespéridé",
    "Lacté",
    "Minéral",
    "Musqué",
    "Oriental",
    "Oud",
    "Poudré",
    "Résineux",
    "Tabac",
    "Vanillé",
    "Vert",
    "Fumé",
]

ALLOWED_FAMILY_LOOKUP = {value.casefold(): value for value in ALLOWED_FAMILY_VALUES}

SIGNATURE_ROYALE_FAMILY_OVERRIDES = {
    "african legend": ["Boisé", "Épicé"],
    "after hours": ["Boisé", "Épicé"],
    "al andaluz": ["Fruité"],
    "albi": ["Floral", "Fruité"],
    "caramel sugar": ["Gourmand"],
    "creamy love": ["Gourmand"],
    "dragee blanc": ["Gourmand"],
    "eclats d'amande": ["Poudré"],
    "electric nectar": ["Fruité"],
    "emeraude": ["Fruité"],
    "ghost oud": ["Oriental", "Oud"],
    "golden smoothie": ["Fruité"],
    "grey london": ["Chypré", "Aromatique"],
    "iris imperial": ["Poudré"],
    "jardin dorient": ["Floral", "Poudré"],
    "layana rose": ["Floral", "Gourmand"],
    "mylan": ["Hespéridé"],
    "mythologia": ["Boisé", "Aromatique"],
    "oud envoutant": ["Oud", "Gourmand", "Oriental"],
    "poudre blanche": ["Gourmand"],
    "renaissance": ["Aromatique", "Boisé"],
    "skin on fire": ["Gourmand", "Oriental"],
    "souffle de safran": ["Épicé", "Gourmand"],
    "sugar milk": ["Gourmand", "Lacté"],
    "sunset pop": ["Gourmand"],
    "sunset vibes": ["Hespéridé", "Fruité"],
    "sweet cherry": ["Fruité", "Gourmand"],
    "tropical crush": ["Fruité"],
    "vertigo": ["Fruité", "Gourmand"],
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

BEST_SELLER_HANDLES = {
    "pr-xs-vintage-100-edt",
    "parfum-fruite-tropical-solaire-caraiba-homme-femme",
    "sapos-parfum-palais-dete-frais-bergamote-neroli-the-vert-musc",
    "sunset-pop-parfum-gourmand",
    "creamy-love-parfum-gourmand",
    "oud-envoutant-parfum-oud-oriental-femme-homme",
    "roc-tocade-100-edt",
    "l-encre-noire-100-edt",
    "dg-light-blue-100-edt",
    "gbh-giorgio-beverly-hills-090-edt",
    "cli-happy-100-edp",
    "kit-echantillons-parfum-signature-royale-decouverte-best-sellers",
    "coffret-echantillons-decouverte-parfum-niche-homme-femme",
    "im-eau-issey-100-edt",
    "pr-ultra-violet-100-edt",
    "pr-ultraviolet-080-edp",
    "bou-jaipur-bracelet-100-edp",
    "jc-patchouli-100-edp",
    "l-booster-125-edt",
    "bur-brit-her-100-edp",
}


class _HtmlTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        if data:
            self.parts.append(data)

    def get_text(self):
        return " ".join(part.strip() for part in self.parts if part.strip())


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


def normalize_family_text(value: str) -> str:
    return " ".join((value or "").strip().casefold().split())


def normalize_title_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_value.lower().strip().replace("’", "'").split())


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
    vendor = (product.get("vendor") or "").strip()
    if vendor:
        return vendor

    tags = [tag.lower() for tag in (product.get("tags") or [])]
    for raw_tag, brand in BRAND_TAG_MAP.items():
        if any(raw_tag in tag for tag in tags):
            return brand

    collections = normalize_collection_name(product)
    for collection in collections:
        lower = collection.lower()
        if not lower.startswith(GENERIC_COLLECTION_PREFIXES):
            return extract_brand_from_collection(collection)
    return "Sapos Parfums"


def infer_families(tags):
    found = []
    for tag in tags:
        normalized_tag = normalize_family_text(tag)
        candidates = [normalized_tag]
        if normalized_tag.startswith("parfum "):
            candidates.append(normalized_tag.removeprefix("parfum ").strip())

        for candidate in candidates:
            family = ALLOWED_FAMILY_LOOKUP.get(candidate)
            if family and family not in found:
                found.append(family)
    return found[:3]


def apply_family_overrides(brand, product, families):
    title_key = normalize_title_key(product.get("title") or "")

    if brand == "Signature Royale":
        for prefix, override in SIGNATURE_ROYALE_FAMILY_OVERRIDES.items():
            if title_key.startswith(prefix):
                return override[:3]

    return families[:3]


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


def infer_variant_id(product):
    """Extrait l'identifiant numerique de la premiere variante, utilise pour
    construire un lien panier Shopify direct (cart permalink)."""
    variants = product.get("variants", {}).get("nodes", [])
    if not variants:
        return None
    gid = variants[0].get("id") or ""
    if "/" in gid:
        return gid.rsplit("/", 1)[-1]
    return gid or None


def infer_segment(tags):
    """Lit le tag Mainstream/Niche pousse depuis le Sheet, sans deviner
    si la valeur est absente ou inattendue."""
    lower_tags = [(tag or "").strip().casefold() for tag in tags]
    if "niche" in lower_tags:
        return "Niche"
    if "mainstream" in lower_tags:
        return "Mainstream"
    return ""


def resolve_segment(product, brand, tags):
    segment = infer_segment(tags)
    if segment:
        return segment

    normalized_brand = normalize_brand_key(brand)
    normalized_title = normalize_title_key(product.get("title") or "")
    if normalized_brand == "estee lauder" and "pleasures" in normalized_title:
        return "Mainstream"
    return "Niche"


def infer_best_seller(product):
    """Conserve la selection best-sellers validee en se basant sur les handles Shopify."""
    return (product.get("handle") or "").strip() in BEST_SELLER_HANDLES


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
    total_inventory = int(product.get("totalInventory") or 0)
    if status == "ACTIVE" and total_inventory <= 0:
        return "out", "Rupture"
    if status == "ACTIVE":
        return "available", "Disponible"
    if status == "DRAFT":
        return "soon", "Bientôt"
    return "out", "Masqué"


def extract_note(product):
    parser = _HtmlTextExtractor()
    parser.feed(product.get("descriptionHtml") or "")
    parser.close()
    return parser.get_text()


def extract_note_html(product):
    return (product.get("descriptionHtml") or "").strip()


def compact_metafield_text(value: str | None):
    return " ".join((value or "").replace("\xa0", " ").split()).strip()


def html_to_structured_lines(html: str):
    return (
        (html or "")
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</p>", "\n")
        .replace("</div>", "\n")
        .replace("</li>", "\n")
    )


def strip_tags(value: str):
    return re.sub(r"<[^>]+>", " ", value or "")


def extract_note_section_from_line(line: str):
    compact = " ".join((line or "").replace("\xa0", " ").split()).strip()
    if not compact:
        return None

    specs = [
        ("Notes de tête", r"^notes?\s+de\s+t[êe]te\s*:?\s*(.+)$"),
        ("Notes de cœur", r"^notes?\s+de\s+c[œoe]ur\s*:?\s*(.+)$"),
        ("Notes de fond", r"^notes?\s+de\s+fond\s*:?\s*(.+)$"),
        ("Notes principales", r"^notes?\s+principales?\s*:?\s*(.+)$"),
        ("Notes de tête", r"^t[êe]te\s*:?\s*(.+)$"),
        ("Notes de cœur", r"^c[œoe]ur\s*:?\s*(.+)$"),
        ("Notes de fond", r"^fond\s*:?\s*(.+)$"),
        ("Notes principales", r"^notes?\s*:?\s*(.+)$"),
    ]
    for label, pattern in specs:
        match = re.match(pattern, compact, re.IGNORECASE)
        if match:
            value = " ".join(match.group(1).split()).strip(" ,;:-")
            if value:
                return {"label": label, "value": value}
    return None


def build_note_sections_from_description_html(description_html: str):
    sections = []
    seen = set()
    for raw_line in html_to_structured_lines(description_html).splitlines():
        candidate = extract_note_section_from_line(strip_tags(raw_line))
        if not candidate:
            continue
        key = (candidate["label"].lower(), candidate["value"].lower())
        if key in seen:
            continue
        seen.add(key)
        sections.append(candidate)
    return sections


def build_native_note_sections(product):
    sapos_head = compact_metafield_text(
        ((product.get("metafields") or {}).get("sapos_notes_tete") or {}).get("value")
    )
    sapos_heart = compact_metafield_text(
        ((product.get("metafields") or {}).get("sapos_notes_coeur") or {}).get("value")
    )
    sapos_base = compact_metafield_text(
        ((product.get("metafields") or {}).get("sapos_notes_fond") or {}).get("value")
    )
    custom_head = compact_metafield_text(
        ((product.get("metafields") or {}).get("custom_head_notes") or {}).get("value")
    )
    custom_heart = compact_metafield_text(
        ((product.get("metafields") or {}).get("custom_heart_notes") or {}).get("value")
    )
    custom_base = compact_metafield_text(
        ((product.get("metafields") or {}).get("custom_base_notes") or {}).get("value")
    )

    note_values = [
        sapos_head or custom_head,
        sapos_heart or custom_heart,
        sapos_base or custom_base,
    ]
    populated_values = [value for value in note_values if value]
    if len(populated_values) == 1:
        return [{"label": "Notes principales", "value": populated_values[0]}]

    sections = []
    if sapos_head or custom_head:
        sections.append({"label": "Notes de tête", "value": sapos_head or custom_head})
    if sapos_heart or custom_heart:
        sections.append({"label": "Notes de cœur", "value": sapos_heart or custom_heart})
    if sapos_base or custom_base:
        sections.append({"label": "Notes de fond", "value": sapos_base or custom_base})
    return sections


def build_note_preview_html(product):
    sections = build_native_note_sections(product)
    if not sections:
        sections = build_note_sections_from_description_html(product.get("descriptionHtml") or "")
    if not sections:
        return ""

    return "".join(
        f"<p><strong>{section['label']} :</strong> {section['value']}</p>" for section in sections
    )


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
          descriptionHtml
          tags
          totalInventory
          saposNotesTete: metafield(namespace: "sapos", key: "notes_tete") { value }
          saposNotesCoeur: metafield(namespace: "sapos", key: "notes_coeur") { value }
          saposNotesFond: metafield(namespace: "sapos", key: "notes_fond") { value }
          customHeadNotes: metafield(namespace: "custom", key: "head_notes") { value }
          customHeartNotes: metafield(namespace: "custom", key: "heart_notes") { value }
          customBaseNotes: metafield(namespace: "custom", key: "base_notes") { value }
          featuredImage { id url altText }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          collections(first: 8) { nodes { title handle } }
          variants(first: 5) {
            nodes {
              id
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


# Fiches Shopify a exclure definitivement du catalogue, quel que soit leur
# statut (brouillon incomplet, non destine a apparaitre comme "Bientot").
EXCLUDED_HANDLES = {
    "mediterranean-amber-noble-essence",
    "bourbons-de-sicile-noble-essence",
}


def normalize_products(products, brand_meta_map=None):
    normalized = []
    seen_best_seller_handles = set()
    for rank, product in enumerate(products, start=1):
        if product.get("handle") in EXCLUDED_HANDLES:
            continue
        tags = product.get("tags") or []
        brand = infer_brand(product)
        families = apply_family_overrides(brand, product, infer_families(tags))
        collections = normalize_collection_name(product)
        status_key, status_label = infer_status(product)
        if status_key != "available":
            continue
        amount = product.get("priceRangeV2", {}).get("minVariantPrice", {}).get("amount")
        price_value = round(float(amount), 2) if amount else None
        currency = product.get("priceRangeV2", {}).get("minVariantPrice", {}).get("currencyCode") or "EUR"
        featured_image = product.get("featuredImage") or {}
        # Keep the product image field reserved for real Shopify product media.
        # Brand logos stay in brand-logos.json and are only used by the frontend fallback.
        image_url = featured_image.get("url")
        image_alt = featured_image.get("altText") or product["title"]
        best_seller = infer_best_seller(product)
        if best_seller:
            seen_best_seller_handles.add(product.get("handle"))
        metafields = {
            "sapos_notes_tete": product.get("saposNotesTete"),
            "sapos_notes_coeur": product.get("saposNotesCoeur"),
            "sapos_notes_fond": product.get("saposNotesFond"),
            "custom_head_notes": product.get("customHeadNotes"),
            "custom_heart_notes": product.get("customHeartNotes"),
            "custom_base_notes": product.get("customBaseNotes"),
        }

        normalized.append(
            {
                "id": product["id"],
                "title": product["title"],
                "subtitle": infer_subtitle(product, families, collections),
                "note": extract_note(product),
                "noteHtml": extract_note_html(product),
                "notePreviewHtml": build_note_preview_html(
                    {
                        "metafields": metafields,
                        "descriptionHtml": product.get("descriptionHtml") or "",
                    }
                ),
                "brand": brand,
                "url": product.get("onlineStoreUrl") or f"https://saposparfums.fr/products/{product['handle']}",
                "image": image_url,
                "imageAlt": image_alt,
                "volume": infer_volume(product),
                "variantId": infer_variant_id(product),
                "families": families,
                "collections": collections,
                "gender": infer_gender(tags),
                "segment": resolve_segment(product, brand, tags),
                "bestSeller": best_seller,
                "statusKey": status_key,
                "statusLabel": status_label,
                "priceValue": price_value,
                "priceLabel": format_price(price_value, currency),
                "tags": tags[:12],
                "discontinued": False,
                "quantity": product.get("totalInventory"),
                "rank": rank,
                "publishedAt": product.get("publishedAt"),
            }
        )

    if not seen_best_seller_handles:
        raise RuntimeError(
            "Aucun bestSeller projete dans le catalogue. Sync interrompue pour eviter une regression."
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
