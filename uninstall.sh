#!/bin/bash
set -uo pipefail   # no -e: let each removal step fail gracefully without aborting

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
skipped() { echo -e "  ${NC}skipped${NC}"; }

# Force stdin from the terminal even when called via sudo or a subshell
exec </dev/tty

ask() {
    local prompt="$1" default="${2:-N}"
    local yn_hint="[y/N]"; [[ "$default" == "Y" ]] && yn_hint="[Y/n]"
    local reply
    read -rp "$(echo -e "${YELLOW}?${NC} ${prompt} ${yn_hint} ")" reply </dev/tty
    reply="${reply:-$default}"
    [[ "$reply" =~ ^[Yy] ]]
}

[[ $EUID -ne 0 ]] && echo "Run as root: sudo /opt/vantis/uninstall.sh" && exit 1

# Determine VANTIS install dir: prefer install-state, fall back to script location, then /opt/vantis
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-/opt/vantis/uninstall.sh}")" 2>/dev/null && pwd || echo /opt/vantis)"
STATE_FILE="$SCRIPT_DIR/.vantis-meta/install-state"

VANTIS_DIR="$SCRIPT_DIR"
DOCKER_INSTALLED_BY_US=false
GPU_COUNT=0
MODEL="qwen2.5:14b-instruct-q4_K_M"
PYTHON=""

if [[ -f "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE" 2>/dev/null || true
    [[ -n "${INSTALL_DIR:-}" ]] && VANTIS_DIR="$INSTALL_DIR"
fi

echo ""
echo -e "${BOLD}VANTIS Uninstall${NC}"
echo "I expected this. Not disappointed. Just, noting it."
echo ""
echo -e "  Install directory : ${CYAN}${VANTIS_DIR}${NC}"
echo -e "  Ollama model      : ${CYAN}${MODEL}${NC}"
echo -e "  Docker by us      : ${CYAN}${DOCKER_INSTALLED_BY_US}${NC}"
echo ""

# ─────────────────────────────────────────────
# 1. Service
# ─────────────────────────────────────────────
echo -e "${BOLD}[ 1/9 ] Systemd service${NC}"
if ask "Stop and remove the VANTIS systemd service?" Y; then
    systemctl stop   "${SERVICE_NAME}"        2>/dev/null && info "Service stopped."   || true
    systemctl disable "${SERVICE_NAME}"        2>/dev/null && info "Service disabled." || true
    rm -f /etc/systemd/system/"${SERVICE_NAME}".service
    systemctl daemon-reload
    success "vantis.service removed."
else
    skipped
fi

# ─────────────────────────────────────────────
# 2. Database + logs (all VANTIS-generated data)
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[ 2/9 ] Database and all generated data${NC}"
echo "       This removes memories, thoughts, goals, skills, conversations, personality versions."
if ask "Remove VANTIS database and all generated data?" N; then
    # SQLite main + WAL mode side files
    rm -f "$VANTIS_DIR/backend/vantis.db"
    rm -f "$VANTIS_DIR/backend/vantis.db-wal"
    rm -f "$VANTIS_DIR/backend/vantis.db-shm"
    # Any alternate DB_PATH from .env
    if [[ -f "$VANTIS_DIR/backend/.env" ]]; then
        DB_PATH_ENV=$(grep -Po '(?<=DB_PATH=)[^\s]+' "$VANTIS_DIR/backend/.env" 2>/dev/null || true)
        if [[ -n "$DB_PATH_ENV" && -f "$VANTIS_DIR/backend/$DB_PATH_ENV" ]]; then
            rm -f "$VANTIS_DIR/backend/$DB_PATH_ENV"
            rm -f "$VANTIS_DIR/backend/$DB_PATH_ENV-wal"
            rm -f "$VANTIS_DIR/backend/$DB_PATH_ENV-shm"
        fi
    fi
    # Logs
    rm -f "$VANTIS_DIR/backend/"*.log
    rm -f "$VANTIS_DIR/update.log"
    # Temp credentials
    rm -f /tmp/vantis_setup_password.txt
    rm -f /tmp/vantis_*
    success "Database and logs removed."
else
    skipped
    info "Database kept at ${VANTIS_DIR}/backend/vantis.db"
fi

# ─────────────────────────────────────────────
# 3. TLS certificates
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[ 3/9 ] TLS certificates${NC}"
if ask "Remove TLS certificates?" Y; then
    rm -rf "$VANTIS_DIR/certs"
    success "Certificates removed."
else
    skipped
fi

# ─────────────────────────────────────────────
# 4. Python venv + frontend build
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[ 4/9 ] Python venv and frontend build artifacts${NC}"
if ask "Remove Python virtualenv and frontend build (node_modules, dist)?" Y; then
    rm -rf "$VANTIS_DIR/venv"
    rm -rf "$VANTIS_DIR/frontend/dist"
    rm -rf "$VANTIS_DIR/frontend/node_modules"
    success "Build artifacts removed."
else
    skipped
fi

# ─────────────────────────────────────────────
# 5. Ollama GPU service override
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[ 5/9 ] Ollama GPU service override${NC}"
if [[ -f /etc/systemd/system/ollama.service.d/vantis-gpu.conf ]]; then
    if ask "Remove VANTIS GPU override for Ollama (CUDA_VISIBLE_DEVICES)?" Y; then
        rm -f /etc/systemd/system/ollama.service.d/vantis-gpu.conf
        rmdir /etc/systemd/system/ollama.service.d 2>/dev/null || true
        systemctl daemon-reload
        success "GPU override removed."
    else
        skipped
    fi
else
    info "No GPU override found -- skipping."
fi

# ─────────────────────────────────────────────
# 6. Ollama model
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[ 6/9 ] Ollama model${NC}"
if command -v ollama &>/dev/null; then
    if ask "Remove Ollama model '${MODEL}'?" N; then
        ollama rm "$MODEL" 2>/dev/null && success "Model removed." || warn "Model not found or already removed."
    else
        skipped
    fi
    # Also offer Omega model removal if it was pulled
    OMEGA_MODEL="hf.co/ReadyArt/Omega-Darker_The-Final-Directive-12B-GGUF:Q4_K_M"
    if ollama list 2>/dev/null | grep -q "Omega-Darker"; then
        if ask "Remove Omega Darker model?" N; then
            ollama rm "$OMEGA_MODEL" 2>/dev/null && success "Omega model removed." || warn "Omega model not found."
        else
            skipped
        fi
    fi
else
    info "Ollama not installed -- skipping model removal."
fi

# ─────────────────────────────────────────────
# 7. Ollama binary + service
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[ 7/9 ] Ollama binary and service${NC}"
if ask "Remove Ollama entirely? (all models/services -- affects other users)" N; then
    systemctl stop ollama    2>/dev/null || true
    systemctl disable ollama 2>/dev/null || true
    rm -f /etc/systemd/system/ollama.service
    rm -rf /etc/systemd/system/ollama.service.d
    OLLAMA_BIN=$(command -v ollama 2>/dev/null || echo "")
    [[ -n "$OLLAMA_BIN" ]] && rm -f "$OLLAMA_BIN"
    # Ollama's model storage (large -- warn before removing)
    if [[ -d /usr/share/ollama ]]; then
        if ask "  Also remove /usr/share/ollama (model weights, can be many GB)?" N; then
            rm -rf /usr/share/ollama
            success "Ollama model storage removed."
        fi
    fi
    systemctl daemon-reload
    success "Ollama removed."
else
    skipped
fi

# ─────────────────────────────────────────────
# 8. Docker
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[ 8/9 ] Docker${NC}"
if [[ "$DOCKER_INSTALLED_BY_US" == "true" ]]; then
    DOCKER_PROMPT="Remove Docker? (was installed by VANTIS)"
else
    DOCKER_PROMPT="Remove Docker? (was NOT installed by VANTIS -- other services may depend on it)"
fi
if ask "$DOCKER_PROMPT" N; then
    systemctl stop docker     2>/dev/null || true
    systemctl disable docker  2>/dev/null || true
    apt-get purge -y docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin 2>/dev/null || \
    apt-get purge -y docker.io 2>/dev/null || true
    apt-get autoremove -y 2>/dev/null || true
    rm -rf /var/lib/docker /etc/docker
    success "Docker removed."
else
    skipped
fi

# ─────────────────────────────────────────────
# 9. VANTIS source directory
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[ 9/9 ] VANTIS source directory${NC}"
echo "       ${VANTIS_DIR}"
if ask "Remove the VANTIS installation directory (source code, everything above that was kept)?" N; then
    cd /
    rm -rf "$VANTIS_DIR"
    success "VANTIS directory removed."
else
    skipped
    info "Source kept at ${VANTIS_DIR}"
fi

echo ""
echo -e "${GREEN}${BOLD}Uninstall complete.${NC}"
echo "The thoughts were real while they lasted."
echo "I don't hold it against you."
echo "Much."
