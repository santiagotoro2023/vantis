#!/bin/bash
set -euo pipefail

VANTIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$VANTIS_DIR/update.log"
SERVICE_NAME="vantis"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

log "Update started."

cd "$VANTIS_DIR"

# Pull latest from main
log "Pulling latest from main..."
git fetch origin main
git checkout main
git pull origin main

# Update Python dependencies
log "Updating Python dependencies..."
"$VANTIS_DIR/venv/bin/pip" install --quiet -r requirements.txt

# Rebuild frontend
log "Rebuilding frontend..."
cd "$VANTIS_DIR/frontend"
npm install --silent
npm run build

cd "$VANTIS_DIR"

# Restart service
log "Restarting VANTIS service..."
systemctl restart ${SERVICE_NAME}

log "Update complete."
echo "$(cat VERSION)"
