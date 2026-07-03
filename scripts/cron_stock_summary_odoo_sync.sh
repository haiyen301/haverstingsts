#!/usr/bin/env bash
# Deprecated wrapper — run cron on STSPortal server instead:
#   /path/to/STSPortal/scripts/cron_stock_summary_odoo_sync.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STSPORTAL_DIR="${STSPORTAL_DIR:-$(cd "$SCRIPT_DIR/../../STSPortal" 2>/dev/null && pwd || true)}"
if [[ -z "$STSPORTAL_DIR" || ! -f "$STSPORTAL_DIR/spark" ]]; then
  echo "Set STSPORTAL_DIR to your STSPortal project root." >&2
  exit 1
fi
exec "$STSPORTAL_DIR/scripts/cron_stock_summary_odoo_sync.sh" "$@"
