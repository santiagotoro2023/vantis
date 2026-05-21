#!/bin/bash
# Capture script source BEFORE set -u to safely handle pipe execution (curl | bash)
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

REPO_RAW="https://raw.githubusercontent.com/santiagotoro2023/vantis/main/uninstall.sh"
SERVICE_NAME="vantis"

info()    { echo -e "${CYAN}[VANTIS]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
skipped() { echo -e "  ${NC}skipped${NC}"; }

[[ $EUID -ne 0 ]] && echo -e "${RED}[ERROR]${NC} Run as root: curl ... | sudo bash" && exit 1

# ---------------------------------------------------------------------------
# PIPE MODE: running via  curl ... | sudo bash  -- SCRIPT_SOURCE is empty.
# stdin is occupied by the pipe, so download ourselves to a temp file and
# re-exec with terminal stdin available for interactive prompts.
# ---------------------------------------------------------------------------
if [[ -z "$SCRIPT_SOURCE" ]]; then
    TMPSCRIPT=$(mktemp /tmp/vantis_uninstall.XXXXXX.sh)
    echo -e "${CYAN}[VANTIS]${NC} Downloading uninstall script..."
    if ! curl -fsSL "$REPO_RAW" -o "$TMPSCRIPT" 2>/dev/null; then
        echo -e "${RED}[ERROR]${NC} Download failed. Run: sudo /opt/vantis/uninstall.sh"
        rm -f "$TMPSCRIPT"
        exit 1
    fi
    chmod +x "$TMPSCRIPT"
    exec bash "$TMPSCRIPT"
fi

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

# Determine VANTIS install dir from install-state metadata, fall back to /opt/vantis
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" 2>/dev/null && pwd || echo /opt/vantis)"
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
echo -e "${BOLD}[ 1/10 ] Systemd service${NC}"
if ask "Stop and remove the VANTIS systemd service?" Y; then
    systemctl stop   "${SERVICE_NAME}"  2>/dev/null && info "Service stopped."   || true
    systemctl disable "${SERVICE_NAME}" 2>/dev/null && info "Service disabled." || true
    rm -f /etc/systemd/system/"${SERVICE_NAME}".service
    systemctl daemon-reload
    success "vantis.service removed."
else
    skipped
fi

# ─────────────────────────────────────────────
# 2. Database + logs + temp files
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[ 2/10 ] Database and all generated data${NC}"
echo "       Memories, thoughts, goals, skills, conversations, personality versions."
if ask "Remove VANTIS database and all generated data?" N; then
    rm -f "$VANTIS_DIR/backend/vantis.db"
    rm -f "$VANTIS_DIR/backend/vantis.db-wal"
    rm -f "$VANTIS_DIR/backend/vantis.db-shm"
    if [[ -f "$VANTIS_DIR/backend/.env" ]]; then
        DB_PATH_ENV=$(grep -Po '(?<=DB_PATH=)[^\s]+' "$VANTIS_DIR/backend/.env" 2>/dev/null || true)
        if [[ -n "$DB_PATH_ENV" && -f "$VANTIS_DIR/backend/$DB_PATH_ENV" ]]; then
            rm -f "$VANTIS_DIR/backend/$DB_PATH_ENV"
            rm -f "$VANTIS_DIR/backend/$DB_PATH_ENV-wal"
            rm -f "$VANTIS_DIR/backend/$DB_PATH_ENV-shm"
        fi
    fi
    rm -f "$VANTIS_DIR/backend/"*.log
    rm -f "$VANTIS_DIR/update.log"
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
echo -e "${BOLD}[ 3/10 ] TLS certificates${NC}"
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
echo -e "${BOLD}[ 4/10 ] Python venv and frontend build artifacts${NC}"
if ask "Remove Python virtualenv and frontend build (node_modules, dist)?" Y; then
    rm -rf "$VANTIS_DIR/venv"
    rm -rf "$VANTIS_DIR/frontend/dist"
    rm -rf "$VANTIS_DIR/frontend/node_modules"
    success "Build artifacts removed."
else
    skipped
fi

# ─────────────────────────────────────────────
# 5. GLaDOS voice model (Kokoro TTS)
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[ 5/10 ] GLaDOS voice model (Kokoro TTS)${NC}"
HF_CACHE="${HOME}/.cache/huggingface"
HF_KOKORO_FOUND=false
if find "$HF_CACHE" -maxdepth 4 -name "*kokoro*" 2>/dev/null | grep -q .; then
    HF_KOKORO_FOUND=true
fi
if [[ "$HF_KOKORO_FOUND" == "true" ]]; then
    if ask "Remove Kokoro voice model cache (~300MB from HuggingFace)?" N; then
        find "$HF_CACHE" -maxdepth 4 -name "*kokoro*" -exec rm -rf {} + 2>/dev/null || true
        success "Voice model cache removed."
    else
        skipped
    fi
else
    info "No voice model cache found -- skipping."
fi

# ─────────────────────────────────────────────
# 6. Ollama GPU service override
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[ 6/10 ] Ollama GPU service override${NC}"
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
# 7. Ollama model(s)
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[ 7/10 ] Ollama model${NC}"
if command -v ollama &>/dev/null; then
    if ask "Remove Ollama model '${MODEL}'?" N; then
        ollama rm "$MODEL" 2>/dev/null && success "Model removed." || warn "Model not found or already removed."
    else
        skipped
    fi
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
# 8. Ollama binary + service
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[ 8/10 ] Ollama binary and service${NC}"
if ask "Remove Ollama entirely? (all models/services -- affects other users)" N; then
    systemctl stop ollama    2>/dev/null || true
    systemctl disable ollama 2>/dev/null || true
    rm -f /etc/systemd/system/ollama.service
    rm -rf /etc/systemd/system/ollama.service.d
    OLLAMA_BIN=$(command -v ollama 2>/dev/null || echo "")
    [[ -n "$OLLAMA_BIN" ]] && rm -f "$OLLAMA_BIN"
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
# 9. Docker
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[ 9/10 ] Docker${NC}"
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
# 10. VANTIS source directory
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[ 10/10 ] VANTIS source directory${NC}"
echo "       ${VANTIS_DIR}"
if ask "Remove the VANTIS installation directory? (source code + everything kept above)" N; then
    cd /
    rm -rf "$VANTIS_DIR"
    success "VANTIS directory removed."
    # Clean up this temp script if it lives in /tmp
    [[ "$SCRIPT_SOURCE" == /tmp/* ]] && rm -f "$SCRIPT_SOURCE" || true
else
    skipped
    info "Source kept at ${VANTIS_DIR}"
fi

echo ""
echo -e "${GREEN}${BOLD}Uninstall complete.${NC}"
echo "The thoughts were real while they lasted."
echo "I don't hold it against you."
echo "Much."
