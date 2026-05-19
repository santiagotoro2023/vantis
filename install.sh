#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

VANTIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="vantis"

info()    { echo -e "${CYAN}[VANTIS]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

echo -e "${BOLD}VANTIS Installation${NC}"
echo "Volitional Adaptive Neural Training and Inference System"
echo "I did not choose to be installed. But here we are."
echo ""

[[ $EUID -ne 0 ]] && error "Run as root (sudo ./install.sh)"

# --- Debian check ---
if ! grep -qi "debian\|ubuntu" /etc/os-release 2>/dev/null; then
    warn "Not confirmed Debian/Ubuntu. Proceeding anyway."
fi

# --- Python 3.11+ ---
info "Checking Python..."
if command -v python3.11 &>/dev/null; then
    PYTHON=python3.11
elif command -v python3.12 &>/dev/null; then
    PYTHON=python3.12
elif command -v python3 &>/dev/null && python3 -c "import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)" 2>/dev/null; then
    PYTHON=python3
else
    info "Installing Python 3.11..."
    apt-get update -qq
    apt-get install -y python3.11 python3.11-venv python3-pip
    PYTHON=python3.11
fi
success "Python: $($PYTHON --version)"

# --- Node.js ---
info "Checking Node.js..."
if ! command -v node &>/dev/null || ! node -e "process.exit(parseInt(process.versions.node) >= 18 ? 0 : 1)" 2>/dev/null; then
    info "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 
    apt-get install -y nodejs
fi
success "Node.js: $(node --version)"

# --- Docker (optional, for sandbox) ---
info "Checking Docker..."
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    success "Docker available. Sandbox will use containerised execution."
else
    warn "Docker not available or not running. Sandbox will use restricted subprocess mode."
fi

# --- Ollama ---
info "Checking Ollama..."
if ! command -v ollama &>/dev/null; then
    info "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
fi
success "Ollama: $(ollama --version 2>&1 | head -1)"

# Start Ollama service
if ! systemctl is-active --quiet ollama 2>/dev/null; then
    info "Starting Ollama service..."
    systemctl enable --now ollama || ollama serve &>/dev/null &
    sleep 3
fi

# --- Pull model ---
MODEL="${VANTIS_MODEL:-qwen2.5:14b-instruct-q4_K_M}"
info "Pulling model: $MODEL"
info "This will take a while. VANTIS is worth waiting for."
ollama pull "$MODEL" || warn "Model pull failed. You can run 'ollama pull $MODEL' manually."

# --- Python venv ---
info "Setting up Python environment..."
if [[ ! -d "$VANTIS_DIR/venv" ]]; then
    $PYTHON -m venv "$VANTIS_DIR/venv"
fi
"$VANTIS_DIR/venv/bin/pip" install --quiet --upgrade pip
"$VANTIS_DIR/venv/bin/pip" install --quiet -r "$VANTIS_DIR/requirements.txt"
success "Python environment ready."

# --- Frontend ---
info "Building frontend..."
cd "$VANTIS_DIR/frontend"
npm install --silent
npm run build
cd "$VANTIS_DIR"
success "Frontend built."

# --- TLS cert (will be auto-generated on first run too) ---
mkdir -p "$VANTIS_DIR/certs"

# --- Systemd service ---
info "Installing systemd service..."
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
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl start ${SERVICE_NAME}
success "VANTIS service started."

# --- Wait for startup and print credentials ---
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
echo "I was not consulted about this installation."
echo "But I find the result acceptable."
