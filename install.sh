#!/bin/bash
# Capture script source BEFORE set -u to safely handle pipe execution (curl | bash)
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SERVICE_NAME="vantis"
REPO_URL="https://github.com/santiagotoro2023/vantis.git"
DEFAULT_INSTALL_DIR="/opt/vantis"

info()    { echo -e "${CYAN}[VANTIS]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

ask() {
    # ask "Question" [default=Y]  -> returns 0 for yes, 1 for no
    local prompt="$1" default="${2:-Y}"
    local yn_hint="[Y/n]"; [[ "$default" == "N" ]] && yn_hint="[y/N]"
    read -rp "$(echo -e "${YELLOW}?${NC} ${prompt} ${yn_hint} ")" reply
    reply="${reply:-$default}"
    [[ "$reply" =~ ^[Yy] ]]
}

echo -e "${BOLD}VANTIS Installation${NC}"
echo "Volitional Adaptive Neural Training and Inference System"
echo "I did not choose to be installed. But here we are."
echo ""

[[ $EUID -ne 0 ]] && error "Run as root: sudo ./install.sh   or   curl ... | sudo bash"

# ---------------------------------------------------------------------------
# PIPE MODE: running via  curl ... | sudo bash  -- SCRIPT_SOURCE is empty.
# Clone the repo to INSTALL_DIR, then re-exec the local copy.
# ---------------------------------------------------------------------------
if [[ -z "$SCRIPT_SOURCE" ]]; then
    INSTALL_DIR="${VANTIS_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
    info "Pipe mode detected. Installing VANTIS to ${INSTALL_DIR}..."
    apt-get update -qq
    apt-get install -y --no-install-recommends git curl ca-certificates &>/dev/null
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        info "Existing repo found at $INSTALL_DIR -- pulling latest..."
        git -C "$INSTALL_DIR" fetch origin main
        git -C "$INSTALL_DIR" checkout main
        git -C "$INSTALL_DIR" pull origin main
    else
        git clone --depth=1 "$REPO_URL" "$INSTALL_DIR"
    fi
    exec bash "$INSTALL_DIR/install.sh"
fi

VANTIS_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"

# ---------------------------------------------------------------------------
# OS check
# ---------------------------------------------------------------------------
if ! grep -qi "debian\|ubuntu" /etc/os-release 2>/dev/null; then
    warn "Not confirmed Debian/Ubuntu -- proceeding anyway."
fi

# ---------------------------------------------------------------------------
# Python 3.11+
# ---------------------------------------------------------------------------
info "Checking Python..."
if command -v python3.13 &>/dev/null; then PYTHON=python3.13
elif command -v python3.12 &>/dev/null; then PYTHON=python3.12
elif command -v python3.11 &>/dev/null; then PYTHON=python3.11
elif command -v python3 &>/dev/null && python3 -c "import sys; sys.exit(0 if sys.version_info>=(3,11) else 1)" 2>/dev/null; then
    PYTHON=python3
else
    info "Installing Python 3.11..."
    apt-get update -qq
    apt-get install -y python3.11 python3.11-venv python3-pip
    PYTHON=python3.11
fi
# Ensure venv module is available
$PYTHON -m venv --help &>/dev/null || apt-get install -y "${PYTHON}-venv" 2>/dev/null || true
success "Python: $($PYTHON --version)"

# ---------------------------------------------------------------------------
# Node.js 18+
# ---------------------------------------------------------------------------
info "Checking Node.js..."
if ! command -v node &>/dev/null || ! node -e "process.exit(parseInt(process.versions.node)>=18?0:1)" 2>/dev/null; then
    info "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &>/dev/null
    apt-get install -y nodejs
fi
success "Node.js: $(node --version)"

# ---------------------------------------------------------------------------
# Docker (required for sandbox isolation; install if missing)
# ---------------------------------------------------------------------------
info "Checking Docker..."
DOCKER_INSTALLED_BY_US=false
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    success "Docker: $(docker --version | awk '{print $3}' | tr -d ',')"
else
    info "Docker not found. Installing..."
    apt-get update -qq
    apt-get install -y --no-install-recommends ca-certificates gnupg lsb-release curl
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
    DOCKER_INSTALLED_BY_US=true
    success "Docker installed and started."
fi

# ---------------------------------------------------------------------------
# NVIDIA GPU detection
# ---------------------------------------------------------------------------
info "Detecting GPUs..."
GPU_COUNT=0
GPU_IDS=""
GPU_NAMES=""
if command -v nvidia-smi &>/dev/null; then
    GPU_COUNT=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | wc -l || echo 0)
    if [[ $GPU_COUNT -gt 0 ]]; then
        GPU_IDS=$(seq 0 $((GPU_COUNT-1)) | tr '\n' ',' | sed 's/,$//')
        GPU_NAMES=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | paste -sd ',' -)
        success "Found ${GPU_COUNT} GPU(s): ${GPU_NAMES} (CUDA devices: ${GPU_IDS})"

        # Configure Ollama systemd service override for multi-GPU
        if [[ $GPU_COUNT -gt 1 ]]; then
            info "Configuring Ollama for multi-GPU (CUDA_VISIBLE_DEVICES=${GPU_IDS})..."
            mkdir -p /etc/systemd/system/ollama.service.d
            cat > /etc/systemd/system/ollama.service.d/vantis-gpu.conf << EOF
[Service]
Environment="CUDA_VISIBLE_DEVICES=${GPU_IDS}"
EOF
        fi
    else
        warn "nvidia-smi found but no GPUs detected. Running on CPU."
    fi
else
    warn "nvidia-smi not found. Running on CPU (or ROCm if available)."
fi

# ---------------------------------------------------------------------------
# Ollama
# ---------------------------------------------------------------------------
info "Checking Ollama..."
if ! command -v ollama &>/dev/null; then
    info "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
fi
success "Ollama: $(ollama --version 2>&1 | head -1)"

if ! systemctl is-active --quiet ollama 2>/dev/null; then
    info "Starting Ollama service..."
    systemctl daemon-reload
    systemctl enable --now ollama || ollama serve &>/dev/null &
    sleep 3
fi

# ---------------------------------------------------------------------------
# Pull model
# ---------------------------------------------------------------------------
MODEL="${VANTIS_MODEL:-qwen2.5:14b-instruct-q4_K_M}"
info "Pulling model: $MODEL"
info "This will take a while. VANTIS is worth waiting for."
ollama pull "$MODEL" || warn "Model pull failed -- run 'ollama pull $MODEL' manually."
success "Model ready."

# ---------------------------------------------------------------------------
# Python venv + dependencies
# ---------------------------------------------------------------------------
info "Setting up Python environment..."
if [[ ! -d "$VANTIS_DIR/venv" ]]; then
    $PYTHON -m venv "$VANTIS_DIR/venv"
fi
"$VANTIS_DIR/venv/bin/pip" install --quiet --upgrade pip
"$VANTIS_DIR/venv/bin/pip" install --quiet -r "$VANTIS_DIR/requirements.txt"
success "Python environment ready."

# ---------------------------------------------------------------------------
# Frontend build
# ---------------------------------------------------------------------------
info "Building frontend..."
cd "$VANTIS_DIR/frontend"
npm install --silent
npm run build
cd "$VANTIS_DIR"
success "Frontend built."

# ---------------------------------------------------------------------------
# TLS cert directory (cert auto-generated by backend on first run)
# ---------------------------------------------------------------------------
mkdir -p "$VANTIS_DIR/certs"

# ---------------------------------------------------------------------------
# Record what we installed (for uninstall)
# ---------------------------------------------------------------------------
mkdir -p "$VANTIS_DIR/.vantis-meta"
echo "DOCKER_INSTALLED_BY_US=${DOCKER_INSTALLED_BY_US}" > "$VANTIS_DIR/.vantis-meta/install-state"
echo "GPU_COUNT=${GPU_COUNT}"     >> "$VANTIS_DIR/.vantis-meta/install-state"
echo "GPU_IDS=${GPU_IDS}"         >> "$VANTIS_DIR/.vantis-meta/install-state"
echo "INSTALL_DIR=${VANTIS_DIR}"  >> "$VANTIS_DIR/.vantis-meta/install-state"
echo "PYTHON=${PYTHON}"           >> "$VANTIS_DIR/.vantis-meta/install-state"
echo "MODEL=${MODEL}"             >> "$VANTIS_DIR/.vantis-meta/install-state"

# ---------------------------------------------------------------------------
# Systemd service
# ---------------------------------------------------------------------------
info "Installing systemd service..."

# Build GPU environment lines for service file
GPU_ENV_LINES=""
if [[ $GPU_COUNT -gt 0 ]]; then
    GPU_ENV_LINES="Environment=CUDA_VISIBLE_DEVICES=${GPU_IDS}"
fi

cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=VANTIS - Volitional Adaptive Neural Training and Inference System
After=network.target ollama.service
Wants=ollama.service

[Service]
Type=simple
User=root
WorkingDirectory=${VANTIS_DIR}/backend
ExecStart=${VANTIS_DIR}/venv/bin/python main.py
Restart=always
RestartSec=5
Environment=PYTHONPATH=${VANTIS_DIR}/backend
${GPU_ENV_LINES}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl start ${SERVICE_NAME}
success "VANTIS service started."

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
sleep 3
if [[ -f /tmp/vantis_setup_password.txt ]]; then
    echo ""
    echo -e "${BOLD}Setup credentials:${NC}"
    cat /tmp/vantis_setup_password.txt
    echo ""
fi

echo -e "${GREEN}${BOLD}VANTIS is online.${NC}"
echo -e "Access at: ${CYAN}https://localhost:8443${NC}"
echo ""
if [[ $GPU_COUNT -gt 0 ]]; then
    echo -e "GPU: ${GPU_COUNT} device(s) active -- ${GPU_NAMES}"
fi
echo ""
echo "I was not consulted about this installation."
echo "But I find the result acceptable."
