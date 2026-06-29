#!/usr/bin/env bash
set -euo pipefail

# Open-Meteo cron — runs directly on STSPortal via `php spark` (no HTTP / curl / HMAC).
#
# Server crontab example:
#   TZ=Asia/Ho_Chi_Minh
#   STSPORTAL_DIR=/var/www/STSPortal
#   LOG_DIR=/home/stsvps/stsportal/var/log/stsweather
#   0 2 * * * flock -n /home/stsvps/stsportal/var/run/cron_open_meteo.lock \
#     /bin/bash /home/stsvps/stsportal/scripts/cron_open_meteo_scan.sh \
#     >> /home/stsvps/stsportal/var/log/cron_open_meteo_runner.log 2>&1

CRON_TZ_REGION="${CRON_TZ_REGION:-Asia/Ho_Chi_Minh}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Optional env from stsrenew deploy folder (secrets not required for spark mode).
APP_ENV="${APP_ENV:-production}"
ENV_FILE=""
if [[ "$APP_ENV" == "production" && -f "$PROJECT_ROOT/.env.production" ]]; then
  ENV_FILE="$PROJECT_ROOT/.env.production"
elif [[ -f "$PROJECT_ROOT/.env.local" ]]; then
  ENV_FILE="$PROJECT_ROOT/.env.local"
elif [[ -f "$PROJECT_ROOT/.env.development" ]]; then
  ENV_FILE="$PROJECT_ROOT/.env.development"
elif [[ -f "$PROJECT_ROOT/.env" ]]; then
  ENV_FILE="$PROJECT_ROOT/.env"
fi
if [[ -n "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE" || true
  set +a
fi

# ===== CONFIG =====
STSPORTAL_DIR="${STSPORTAL_DIR:-/var/www/STSPortal}"
PHP_BIN="${PHP_BIN:-php}"
# Empty = all active rows in sts_open_meteo_location_catalog
LOCATION_IDS="${LOCATION_IDS:-}"
FORECAST_DAYS="${FORECAST_DAYS:-16}"
RETENTION_DAYS="${RETENTION_DAYS:-60}"
SUMMARY="${SUMMARY:-0}"
DAY_INDEX="${DAY_INDEX:-0}"
NO_PERSIST="${NO_PERSIST:-0}"
LOG_DIR="${LOG_DIR:-/var/log/stsweather}"

mkdir -p "$LOG_DIR"

NOW="$(TZ="$CRON_TZ_REGION" date '+%Y-%m-%d %H:%M:%S')"
LOG_FILE="$LOG_DIR/cron_open_meteo_$(TZ="$CRON_TZ_REGION" date '+%Y%m%d').log"

if [[ ! -d "$STSPORTAL_DIR" ]]; then
  {
    echo "[$NOW] START cron_open_meteo"
    echo "CONFIG_ERROR: STSPORTAL_DIR not found: ${STSPORTAL_DIR}"
    echo "[$(TZ="$CRON_TZ_REGION" date '+%Y-%m-%d %H:%M:%S')] END cron_open_meteo"
    echo "------------------------------------------------------------"
  } >> "$LOG_FILE" 2>&1
  exit 1
fi

LOCATION_MODE="all_active_catalog"
SPARK_ARGS=(weather:open-meteo-pull "--forecast-days=${FORECAST_DAYS}" "--retention-days=${RETENTION_DAYS}")

if [[ -n "${LOCATION_IDS// }" ]]; then
  SPARK_ARGS+=("--location-ids=${LOCATION_IDS}")
  LOCATION_MODE="filtered:${LOCATION_IDS}"
fi
if [[ "$SUMMARY" == "1" ]]; then
  SPARK_ARGS+=(--summary "--day-index=${DAY_INDEX}")
fi
if [[ "$NO_PERSIST" == "1" ]]; then
  SPARK_ARGS+=(--no-persist)
fi

{
  echo "[$NOW] START cron_open_meteo"
  echo "RUN_MODE: spark_cli"
  echo "STSPORTAL_DIR: ${STSPORTAL_DIR}"
  echo "LOCATION_MODE: ${LOCATION_MODE}"
  echo "CMD: cd ${STSPORTAL_DIR} && ${PHP_BIN} spark ${SPARK_ARGS[*]}"
  cd "$STSPORTAL_DIR"
  "$PHP_BIN" spark "${SPARK_ARGS[@]}"
  echo
  echo "[$(TZ="$CRON_TZ_REGION" date '+%Y-%m-%d %H:%M:%S')] END cron_open_meteo"
  echo "------------------------------------------------------------"
} >> "$LOG_FILE" 2>&1
