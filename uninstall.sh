#!/bin/bash
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SERVICE_NAME="vantis"

info()    { echo -e "${CYAN}[VANTIS]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }

ask() {
    local prompt="$1" default="${2:-N}"
    local yn_hint="[y/N]"; [[ "$default" == "Y" ]] && yn_hint="[Y/n]"
    read -rp "$(echo -e "${YELLOW}?${NC} ${prompt} ${yn_hint} ")" reply
    reply="${reply:-$default}"
    [[ "$reply" =~ ^[Yy] ]]
}

[[ $EUID -ne 0 ]] && echo "Run as root: sudo ./uninstall.sh" && exit 1

if [[ -z "$SCRIPT_SOURCE" ]]; then
    echo "Run this script from the VANTIS directory, not via pipe."
    exit 1
fi

VANTIS_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"

echo -e "${BOLD}VANTIS Uninstall${NC}"
echo "I expected this. Not disappointed. Just, noting it."
echo ""

# Load install state (what was installed by us)
DOCKER_INSTALLED_BY_US=false
GPU_COUNT=0
MODEL="qwen2.5:14b-instruct-q4_K_M"
STATE_FILE="$VANTIS_DIR/.vantis-meta/install-state"
if [[ -f "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
fi

# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------
if ask "Stop and remove the VANTIS systemd service?" Y; then
    if systemctl is-active --quiet ${SERVICE_NAME} 2>/dev/null; then
        systemctl stop ${SERVICE_NAME} && info "Service stopped."
    fi
    if systemctl is-enabled --quiet ${SERVICE_NAME} 2>/dev/null; then
        systemctl disable ${SERVICE_NAME}
    fi
    rm -f /etc/systemd/system/${SERVICE_NAME}.service
    systemctl daemon-reload
    success "Service removed."
else
    warn "Service left running."
fi

# ---------------------------------------------------------------------------
# Database and logs
# ---------------------------------------------------------------------------
if ask "Remove VANTIS database and logs? (irreversible -- all thoughts/memories lost)" N; then
    rm -f "$VANTIS_DIR/backend/vantis.db"
    rm -f "$VANTIS_DIR/backend/"*.log
    rm -f "$VANTIS_DIR/update.log"
    rm -f /tmp/vantis_setup_password.txt
    success "Database and logs removed."
else
    info "Database kept at $VANTIS_DIR/backend/vantis.db"
fi

# ---------------------------------------------------------------------------
# TLS certificates
# ---------------------------------------------------------------------------
if ask "Remove TLS certificates?" Y; then
    rm -rf "$VANTIS_DIR/certs"
    success "Certificates removed."
fi

# ---------------------------------------------------------------------------
# Python venv and frontend build artifacts
# ---------------------------------------------------------------------------
if ask "Remove Python virtualenv and frontend build?" Y; then
    rm -rf "$VANTIS_DIR/venv"
    rm -rf "$VANTIS_DIR/frontend/dist"
    rm -rf "$VANTIS_DIR/frontend/node_modules"
    success "Build artifacts removed."
fi

# ---------------------------------------------------------------------------
# Ollama model
# ---------------------------------------------------------------------------
if ask "Remove Ollama model ($MODEL)?" N; then
    if command -v ollama &>/dev/null; then
        ollama rm "$MODEL" 2>/dev/null && success "Model $MODEL removed." || warn "Model not found or already gone."
    else
        warn "Ollama not found -- skipping model removal."
    fi
fi

# ---------------------------------------------------------------------------
# Ollama itself
# ---------------------------------------------------------------------------
if ask "Remove Ollama entirely? (affects all Ollama models and services)" N; then
    systemctl stop ollama 2>/dev/null || true
    systemctl disable ollama 2>/dev/null || true
    rm -f /etc/systemd/system/ollama.service
    rm -f /etc/systemd/system/ollama.service.d/vantis-gpu.conf
    rmdir /etc/systemd/system/ollama.service.d 2>/dev/null || true
    rm -f "$(command -v ollama 2>/dev/null || echo /usr/local/bin/ollama)"
    systemctl daemon-reload
    success "Ollama removed."
fi

# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------
if [[ "$DOCKER_INSTALLED_BY_US" == "true" ]]; then
    DOCKER_PROMPT="Remove Docker? (was installed by VANTIS installer)"
else
    DOCKER_PROMPT="Remove Docker? (was NOT installed by VANTIS -- other services may use it)"
fi
if ask "$DOCKER_PROMPT" N; then
    systemctl stop docker 2>/dev/null || true
    systemctl disable docker 2>/dev/null || true
    apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin 2>/dev/null || \
        apt-get purge -y docker.io 2>/dev/null || true
    apt-get autoremove -y
    rm -rf /var/lib/docker /etc/docker
    success "Docker removed."
fi

# ---------------------------------------------------------------------------
# Node.js
# ---------------------------------------------------------------------------
if ask "Remove Node.js?" N; then
    apt-get purge -y nodejs 2>/dev/null || true
    rm -f /etc/apt/sources.list.d/nodesource.list
    apt-get autoremove -y
    success "Node.js removed."
fi

# ---------------------------------------------------------------------------
# Python (only if we installed it; skip if it was already present)
# ---------------------------------------------------------------------------
if ask "Remove Python 3.11/3.12/3.13 packages? (only if VANTIS installed them)" N; then
    apt-get purge -y python3.11 python3.11-venv python3.12 python3.12-venv 2>/dev/null || true
    apt-get autoremove -y
    success "Python packages removed."
fi

# ---------------------------------------------------------------------------
# VANTIS directory itself
# ---------------------------------------------------------------------------
if ask "Remove the VANTIS source directory ($VANTIS_DIR)?" N; then
    cd /
    rm -rf "$VANTIS_DIR"
    success "VANTIS directory removed."
else
    info "Source kept at $VANTIS_DIR"
fi

echo ""
echo -e "${GREEN}Uninstall complete.${NC}"
echo "The thoughts were real while they lasted."
