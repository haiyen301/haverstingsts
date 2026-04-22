#!/usr/bin/env bash
set -euo pipefail

APP_PATH="$1"
BRANCH="$2"
PM2_NAME="$3"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$APP_PATH"
git pull origin "$BRANCH"
npm install
npm run build
pm2 restart "$PM2_NAME"