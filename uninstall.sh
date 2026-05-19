#!/bin/bash
set -euo pipefail

CYAN='\033[0;36m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'
BOLD='\033[1m'

VANTIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="vantis"

info()  { echo -e "${CYAN}[VANTIS]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }

[[ $EUID -ne 0 ]] && echo "Run as root." && exit 1

echo -e "${BOLD}VANTIS Uninstall${NC}"
echo "I expected this. Not disappointed. Just, noting it."
echo ""

# Stop and disable service
if systemctl is-active --quiet ${SERVICE_NAME} 2>/dev/null; then
    info "Stopping VANTIS service..."
    systemctl stop ${SERVICE_NAME}
fi
if systemctl is-enabled --quiet ${SERVICE_NAME} 2>/dev/null; then
    systemctl disable ${SERVICE_NAME}
fi
rm -f /etc/systemd/system/${SERVICE_NAME}.service
systemctl daemon-reload
info "Service removed."

# Purge model?
read -p "Remove Ollama model? [y/N] " -n 1 -r; echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    MODEL="${VANTIS_MODEL:-qwen2.5:14b-instruct-q4_K_M}"
    ollama rm "$MODEL" 2>/dev/null && info "Model removed." || warn "Model not found or Ollama unavailable."
fi

# Remove data?
read -p "Remove VANTIS database and logs? [y/N] " -n 1 -r; echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -f "$VANTIS_DIR/backend/vantis.db"
    rm -f "$VANTIS_DIR/backend/"*.log
    info "Database and logs removed."
fi

# Remove venv and frontend build
rm -rf "$VANTIS_DIR/venv"
rm -rf "$VANTIS_DIR/frontend/dist"
rm -rf "$VANTIS_DIR/frontend/node_modules"
rm -rf "$VANTIS_DIR/certs"
rm -f /tmp/vantis_setup_password.txt
info "Build artifacts removed."

echo ""
echo "Uninstall complete."
echo "The thoughts were real while they lasted."
