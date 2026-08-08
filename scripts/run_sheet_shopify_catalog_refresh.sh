#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-$ROOT_DIR/.venv/bin/python}"
SHEET_ID="${GOOGLE_SHEETS_ID:-1e2eRg09cDm-0vUbe1Sysiiovl8WLR1-DlRC2auT2M-U}"
SHEET_TAB="${GOOGLE_SHEETS_TAB:-products}"
CREDENTIALS_PATH="${GOOGLE_SHEETS_CREDENTIALS:-/home/openclaw/.openclaw/workspace/secrets/ga4-sapos-parfums-service-account.json}"

SYNC_ARGS=()

while (($#)); do
  case "$1" in
    --apply-shopify)
      SYNC_ARGS+=(--apply)
      shift
      ;;
    --limit|--sku|--batch-size|--batch-pause-seconds|--request-interval-seconds|--retry-delay-seconds|--max-retries)
      if (($# < 2)); then
        echo "Option $1 incomplete" >&2
        exit 2
      fi
      SYNC_ARGS+=("$1" "$2")
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

export GOOGLE_SHEETS_ID="$SHEET_ID"
export GOOGLE_SHEETS_TAB="$SHEET_TAB"
export GOOGLE_SHEETS_CREDENTIALS="$CREDENTIALS_PATH"

echo "[1/3] Sync Google Sheet -> Shopify"
"$PYTHON_BIN" scripts/sync_shopify_products_from_sheet.py "${SYNC_ARGS[@]}"

echo "[2/3] Rebuild catalog from Google Sheet"
"$PYTHON_BIN" scripts/build_catalog_from_sheet.py

echo "[3/3] Build static catalog"
npm run build

echo "Refresh completed"
