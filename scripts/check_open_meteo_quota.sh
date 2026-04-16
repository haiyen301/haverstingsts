#!/usr/bin/env bash
set -euo pipefail

CRON_TZ_REGION="${CRON_TZ_REGION:-Asia/Ho_Chi_Minh}"
LOG_DIR="${LOG_DIR:-/var/log/stsweather}"
LOG_PREFIX="${LOG_PREFIX:-cron_open_meteo_}"

# Default assumes each run calls 5 locations.
LOCATION_COUNT_PER_RUN="${LOCATION_COUNT_PER_RUN:-5}"

DAILY_LIMIT="${DAILY_LIMIT:-10000}"
HOURLY_LIMIT="${HOURLY_LIMIT:-5000}"
MINUTE_LIMIT="${MINUTE_LIMIT:-600}"
MONTHLY_LIMIT="${MONTHLY_LIMIT:-300000}"

TODAY="$(TZ="$CRON_TZ_REGION" date +%Y%m%d)"
CURRENT_MONTH="$(TZ="$CRON_TZ_REGION" date +%Y%m)"
CURRENT_HOUR_PREFIX="$(TZ="$CRON_TZ_REGION" date '+%Y-%m-%d %H:')"
CURRENT_MINUTE_PREFIX="$(TZ="$CRON_TZ_REGION" date '+%Y-%m-%d %H:%M:')"
TODAY_LOG_FILE="$LOG_DIR/${LOG_PREFIX}${TODAY}.log"

count_runs_in_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo 0
    return
  fi
  awk '/START cron_open_meteo/ {count++} END {print count+0}' "$file"
}

count_runs_with_prefix_in_file() {
  local file="$1"
  local prefix="$2"
  if [[ ! -f "$file" ]]; then
    echo 0
    return
  fi
  awk -v p="$prefix" '/START cron_open_meteo/ { if (index($0, p) > 0) count++ } END {print count+0}' "$file"
}

TODAY_RUNS="$(count_runs_in_file "$TODAY_LOG_FILE")"
TODAY_CALLS=$((TODAY_RUNS * LOCATION_COUNT_PER_RUN))

HOUR_RUNS="$(count_runs_with_prefix_in_file "$TODAY_LOG_FILE" "$CURRENT_HOUR_PREFIX")"
HOUR_CALLS=$((HOUR_RUNS * LOCATION_COUNT_PER_RUN))

MINUTE_RUNS="$(count_runs_with_prefix_in_file "$TODAY_LOG_FILE" "$CURRENT_MINUTE_PREFIX")"
MINUTE_CALLS=$((MINUTE_RUNS * LOCATION_COUNT_PER_RUN))

MONTH_RUNS="$(awk '/START cron_open_meteo/ {count++} END {print count+0}' "$LOG_DIR/${LOG_PREFIX}${CURRENT_MONTH}"*.log 2>/dev/null || true)"
if [[ -z "$MONTH_RUNS" ]]; then
  MONTH_RUNS=0
fi
MONTH_CALLS=$((MONTH_RUNS * LOCATION_COUNT_PER_RUN))

DAILY_LEFT=$((DAILY_LIMIT - TODAY_CALLS))
HOURLY_LEFT=$((HOURLY_LIMIT - HOUR_CALLS))
MINUTE_LEFT=$((MINUTE_LIMIT - MINUTE_CALLS))
MONTHLY_LEFT=$((MONTHLY_LIMIT - MONTH_CALLS))

if (( DAILY_LEFT < 0 )); then DAILY_LEFT=0; fi
if (( HOURLY_LEFT < 0 )); then HOURLY_LEFT=0; fi
if (( MINUTE_LEFT < 0 )); then MINUTE_LEFT=0; fi
if (( MONTHLY_LEFT < 0 )); then MONTHLY_LEFT=0; fi

echo "=== Open-Meteo Quota Check ==="
echo "Timezone: $CRON_TZ_REGION"
echo "Log file today: $TODAY_LOG_FILE"
echo "Assumed calls per run: $LOCATION_COUNT_PER_RUN"
echo
echo "[Today]"
echo "Runs: $TODAY_RUNS"
echo "Calls used: $TODAY_CALLS / $DAILY_LIMIT"
echo "Calls left: $DAILY_LEFT"
echo
echo "[Current Hour]"
echo "Runs: $HOUR_RUNS"
echo "Calls used: $HOUR_CALLS / $HOURLY_LIMIT"
echo "Calls left: $HOURLY_LEFT"
echo
echo "[Current Minute]"
echo "Runs: $MINUTE_RUNS"
echo "Calls used: $MINUTE_CALLS / $MINUTE_LIMIT"
echo "Calls left: $MINUTE_LEFT"
echo
echo "[Current Month]"
echo "Runs: $MONTH_RUNS"
echo "Calls used: $MONTH_CALLS / $MONTHLY_LIMIT"
echo "Calls left: $MONTHLY_LEFT"
