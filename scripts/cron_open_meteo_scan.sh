#!/usr/bin/env bash
set -euo pipefail

# Cron timezone anchor
CRON_TZ_REGION="${CRON_TZ_REGION:-Asia/Ho_Chi_Minh}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load project env first (secrets + optional API_BASE_URL), even if API_BASE_URL is preset in cron.
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

# Resolve API base when cron did not export it.
if [[ -z "${API_BASE_URL:-}" ]]; then
  if [[ -n "${NEXT_PUBLIC_STS_API_BASE_URLS:-}" ]]; then
    FIRST_BASE="$(printf '%s' "$NEXT_PUBLIC_STS_API_BASE_URLS" | awk -F',' '{print $1}' | xargs)"
    API_BASE_URL="$FIRST_BASE"
  elif [[ -n "${NEXT_PUBLIC_STS_API_BASE_URL:-}" ]]; then
    API_BASE_URL="$(printf '%s' "$NEXT_PUBLIC_STS_API_BASE_URL" | xargs)"
  else
    API_BASE_URL="http://127.0.0.1:3000"
  fi
fi

# ===== CONFIG =====
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3000}"
IMPORT_TOKEN="${IMPORT_TOKEN:-REPLACE_WITH_IMPORT_TOKEN}"
HMAC_SECRET="${HMAC_SECRET:-}"
WEATHER_IMPORT_ENDPOINT_PATH="${WEATHER_IMPORT_ENDPOINT_PATH:-/api/weather/open-meteo}"
LOCATION_IDS="${LOCATION_IDS:-ban-bueng-th,laem-chabang-th,semenyih-my,hoi-an-vn,phan-thiet-vn}"
FORECAST_DAYS="${FORECAST_DAYS:-16}"
PERSIST="${PERSIST:-1}"
RETENTION_DAYS="${RETENTION_DAYS:-60}"
SUMMARY="${SUMMARY:-0}"
DAY_INDEX="${DAY_INDEX:-0}"
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-900}"
DEBUG_AUTH="${DEBUG_AUTH:-0}"
REQUIRE_HMAC="${REQUIRE_HMAC:-1}"

# Reuse Next token when cron runs in import_token mode (REQUIRE_HMAC=0).
if [[ -n "${OPEN_METEO_PULL_TOKEN:-}" ]]; then
  if [[ -z "${IMPORT_TOKEN:-}" || "${IMPORT_TOKEN}" == "REPLACE_WITH_IMPORT_TOKEN" ]]; then
    IMPORT_TOKEN="$OPEN_METEO_PULL_TOKEN"
  fi
fi

# Optional log folder override
LOG_DIR="${LOG_DIR:-/var/log/stsweather}"
mkdir -p "$LOG_DIR"

NOW="$(TZ="$CRON_TZ_REGION" date '+%Y-%m-%d %H:%M:%S')"
LOG_FILE="$LOG_DIR/cron_open_meteo_$(TZ="$CRON_TZ_REGION" date '+%Y%m%d').log"

ENDPOINT_PATH="$WEATHER_IMPORT_ENDPOINT_PATH"
BASE_QUERY="forecastDays=${FORECAST_DAYS}&locationIds=${LOCATION_IDS}&persist=${PERSIST}&retentionDays=${RETENTION_DAYS}&summary=${SUMMARY}&dayIndex=${DAY_INDEX}"
if [[ "$DEBUG_AUTH" == "1" ]]; then
  BASE_QUERY="${BASE_QUERY}&debug_auth=1"
fi

if [[ -n "$HMAC_SECRET" ]]; then
  TS="$(TZ="$CRON_TZ_REGION" date +%s)"
  CANONICAL_QUERY="dayIndex=${DAY_INDEX}&forecastDays=${FORECAST_DAYS}&locationIds=${LOCATION_IDS}&persist=${PERSIST}&retentionDays=${RETENTION_DAYS}&summary=${SUMMARY}&ts=${TS}"
  if [[ "$DEBUG_AUTH" == "1" ]]; then
    CANONICAL_QUERY="dayIndex=${DAY_INDEX}&debug_auth=1&forecastDays=${FORECAST_DAYS}&locationIds=${LOCATION_IDS}&persist=${PERSIST}&retentionDays=${RETENTION_DAYS}&summary=${SUMMARY}&ts=${TS}"
  fi
  PAYLOAD="${ENDPOINT_PATH}|${TS}|${CANONICAL_QUERY}"
  SIG="$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$HMAC_SECRET" -binary | xxd -p -c 256)"
  URL="${API_BASE_URL}${ENDPOINT_PATH}?${BASE_QUERY}&ts=${TS}&sig=${SIG}"
else
  if [[ "$REQUIRE_HMAC" == "1" ]]; then
    {
      echo "[$NOW] START cron_open_meteo"
      echo "CONFIG_ERROR: HMAC_SECRET is empty while REQUIRE_HMAC=1."
      echo "Set HMAC_SECRET in environment (or REQUIRE_HMAC=0 to allow legacy import_token mode)."
      echo "[$(TZ="$CRON_TZ_REGION" date '+%Y-%m-%d %H:%M:%S')] END cron_open_meteo"
      echo "------------------------------------------------------------"
    } >> "$LOG_FILE" 2>&1
    exit 1
  fi
  URL="${API_BASE_URL}${ENDPOINT_PATH}?${BASE_QUERY}&import_token=${IMPORT_TOKEN}"
fi

{
  echo "[$NOW] START cron_open_meteo"
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
  echo "[$(TZ="$CRON_TZ_REGION" date '+%Y-%m-%d %H:%M:%S')] END cron_open_meteo"
  echo "------------------------------------------------------------"
} >> "$LOG_FILE" 2>&1
