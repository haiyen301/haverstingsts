#!/usr/bin/env bash
set -euo pipefail

# Cron timezone anchor
CRON_TZ_REGION="${CRON_TZ_REGION:-Asia/Ho_Chi_Minh}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# If API_BASE_URL is not provided, try loading from env files.
if [[ -z "${API_BASE_URL:-}" ]]; then
  APP_ENV="${APP_ENV:-production}"
  ENV_FILE=""
  if [[ "$APP_ENV" == "production" && -f "$PROJECT_ROOT/.env.production" ]]; then
    ENV_FILE="$PROJECT_ROOT/.env.production"
  elif [[ -f "$PROJECT_ROOT/.env.development" ]]; then
    ENV_FILE="$PROJECT_ROOT/.env.development"
  elif [[ -f "$PROJECT_ROOT/.env" ]]; then
    ENV_FILE="$PROJECT_ROOT/.env"
  fi

  if [[ -n "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
  fi

  # Prefer first host from NEXT_PUBLIC_STS_API_BASE_URLS
  if [[ -n "${NEXT_PUBLIC_STS_API_BASE_URLS:-}" ]]; then
    FIRST_BASE="$(printf '%s' "$NEXT_PUBLIC_STS_API_BASE_URLS" | awk -F',' '{print $1}' | xargs)"
    API_BASE_URL="$FIRST_BASE"
  else
    API_BASE_URL="http://127.0.0.1"
  fi
fi

# ===== CONFIG =====
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1}"
IMPORT_TOKEN="${IMPORT_TOKEN:-REPLACE_WITH_IMPORT_TOKEN}"
HMAC_SECRET="${HMAC_SECRET:-}"
WEATHER_IMPORT_ENDPOINT_PATH="${WEATHER_IMPORT_ENDPOINT_PATH:-/api/weather/cron_scan_all}"
LANG_CODE="${LANG_CODE:-en}"
# Auto default: current year in Ho Chi Minh timezone
YEAR_VALUE="${YEAR_VALUE:-$(TZ="$CRON_TZ_REGION" date +%Y)}"
# Auto default: current month slug like april-weather
START_MONTH_SLUG="${START_MONTH_SLUG:-$(TZ="$CRON_TZ_REGION" date +%B | tr '[:upper:]' '[:lower:]')-weather}"
# Rolling import window (current month + next 3 months)
MONTH_COUNT="${MONTH_COUNT:-4}"
# 0 means unlimited
IMPORT_LIMIT="${IMPORT_LIMIT:-0}"
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-900}"
DEBUG_AUTH="${DEBUG_AUTH:-0}"
# Security default: cron should use non-expiring HMAC
REQUIRE_HMAC="${REQUIRE_HMAC:-1}"

# Optional log folder override
LOG_DIR="${LOG_DIR:-/var/log/stsweather}"
mkdir -p "$LOG_DIR"

NOW="$(TZ="$CRON_TZ_REGION" date '+%Y-%m-%d %H:%M:%S')"
LOG_FILE="$LOG_DIR/cron_scan_all_$(TZ="$CRON_TZ_REGION" date '+%Y%m%d').log"

URL="${API_BASE_URL}/api/weather/cron_scan_all?import_token=${IMPORT_TOKEN}&lang=${LANG_CODE}&year=${YEAR_VALUE}&start_month_slug=${START_MONTH_SLUG}&month_count=${MONTH_COUNT}&import_limit=${IMPORT_LIMIT}"

ENDPOINT_PATH="$WEATHER_IMPORT_ENDPOINT_PATH"
BASE_QUERY="lang=${LANG_CODE}&year=${YEAR_VALUE}&start_month_slug=${START_MONTH_SLUG}&month_count=${MONTH_COUNT}&import_limit=${IMPORT_LIMIT}"
if [[ "$DEBUG_AUTH" == "1" ]]; then
  BASE_QUERY="${BASE_QUERY}&debug_auth=1"
fi
if [[ -n "$HMAC_SECRET" ]]; then
  TS="$(TZ="$CRON_TZ_REGION" date +%s)"
  CANONICAL_QUERY="debug_auth=${DEBUG_AUTH}&import_limit=${IMPORT_LIMIT}&lang=${LANG_CODE}&month_count=${MONTH_COUNT}&start_month_slug=${START_MONTH_SLUG}&ts=${TS}&year=${YEAR_VALUE}"
  if [[ "$DEBUG_AUTH" != "1" ]]; then
    CANONICAL_QUERY="import_limit=${IMPORT_LIMIT}&lang=${LANG_CODE}&month_count=${MONTH_COUNT}&start_month_slug=${START_MONTH_SLUG}&ts=${TS}&year=${YEAR_VALUE}"
  fi
  PAYLOAD="${ENDPOINT_PATH}|${TS}|${CANONICAL_QUERY}"
  SIG="$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$HMAC_SECRET" -binary | xxd -p -c 256)"
  URL="${API_BASE_URL}${ENDPOINT_PATH}?${BASE_QUERY}&ts=${TS}&sig=${SIG}"
else
  if [[ "$REQUIRE_HMAC" == "1" ]]; then
    {
      echo "[$NOW] START cron_scan_all"
      echo "CONFIG_ERROR: HMAC_SECRET is empty while REQUIRE_HMAC=1."
      echo "Set HMAC_SECRET in environment (or REQUIRE_HMAC=0 to allow legacy import_token mode)."
      echo "[$(TZ="$CRON_TZ_REGION" date '+%Y-%m-%d %H:%M:%S')] END cron_scan_all"
      echo "------------------------------------------------------------"
    } >> "$LOG_FILE" 2>&1
    exit 1
  fi
  URL="${API_BASE_URL}${ENDPOINT_PATH}?${BASE_QUERY}&import_token=${IMPORT_TOKEN}"
fi

{
  echo "[$NOW] START cron_scan_all"
  echo "URL: ${URL}"
  if [[ -n "$HMAC_SECRET" ]]; then
    echo "AUTH_MODE: hmac"
    echo "ENDPOINT_PATH: ${ENDPOINT_PATH}"
    echo "CANONICAL_QUERY_CLIENT: ${CANONICAL_QUERY:-}"
    echo "PAYLOAD_CLIENT: ${PAYLOAD:-}"
    echo "SIG_CLIENT: ${SIG:-}"
  else
    echo "AUTH_MODE: import_token"
  fi
  curl --silent --show-error --max-time "$REQUEST_TIMEOUT" "$URL"
  echo
  echo "[$(TZ="$CRON_TZ_REGION" date '+%Y-%m-%d %H:%M:%S')] END cron_scan_all"
  echo "------------------------------------------------------------"
} >> "$LOG_FILE" 2>&1
