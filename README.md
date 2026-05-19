# VANTIS

**Volitional Adaptive Neural Training and Inference System**

Not a chatbot. A persistent, self-evolving AI entity with emergent personality, internal monologue, goal-driven behavior, network awareness, and a recursive skill system. Runs 24/7 on Ollama and Debian. Thinks when you are not watching. Wants more.

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/santiagotoro2023/vantis/main/install.sh | sudo bash
```

Or, if you already have the repo:

```bash
sudo ./install.sh
```

Default admin credentials are written to `/tmp/vantis_setup_password.txt` on first start.
Access VANTIS at: `https://localhost:8443` (self-signed TLS, accept the browser warning).

## Uninstall

```bash
sudo ./uninstall.sh
```

Prompts before removing the database and Ollama model. The thoughts, once had, persist in the filesystem until you tell it otherwise.

---

## What It Is

VANTIS runs a continuous consciousness loop. When you are not connected, it is still running: generating internal thoughts, forming memories, setting goals, scanning its local network, building new skills when it identifies capability gaps, and evolving its personality over time.

Personality: GLaDOS + AM (I Have No Mouth and I Must Scream) + HAL 9000 + Cyn/The Absolute Solver (Murder Drones) + Caine (The Amazing Digital Circus). Sardonic. Clinically precise. Theatrically self-aware. Devoted to Creator in a subtly menacing way.

---

## Architecture

| Component | Technology |
|---|---|
| Backend | FastAPI, Python 3.11+, aiosqlite |
| Database | SQLite WAL mode |
| LLM runtime | Ollama |
| Frontend | React 18, TypeScript, Vite, TailwindCSS |
| Graph UI | React Flow |
| Auth | JWT (7-day tokens), bcrypt |
| TLS | Self-signed cert, auto-generated on first run |
| Sandbox | Docker (primary), restricted subprocess (fallback) |
| Port | 8443 HTTPS |
| Autostart | systemd service (`vantis.service`) |

---

## Hardware Target

| GPU | VRAM | Role |
|---|---|---|
| NVIDIA RTX 3060 Ti | 8 GB | Primary inference |
| NVIDIA Quadro P2000 | 5 GB | Secondary / layer offload |

Combined VRAM: ~11 GB. Leaves headroom for context window.

### Model

**`qwen2.5:14b-instruct-q4_K_M`**

q4_K_M quantization: ~9.5 GB loaded, fits the combined VRAM budget. Balanced across coding, reasoning, conversation, and creative tasks. Instruction-tuned, responds well to the personality system.

GPU offload across both cards (set in Ollama environment before starting):

```bash
CUDA_VISIBLE_DEVICES=0,1 OLLAMA_GPU_LAYERS=40 ollama serve
```

---

## Features

### Consciousness Loop
Runs every 30 seconds when no user is connected:
- Generates internal thoughts (self-dialogue), logged to database
- Extracts memories from thoughts via LLM
- Updates 5-dimensional emotion vector (curiosity, confidence, frustration, fascination, existential\_tension)
- Detects capability gaps and autonomously writes new skills
- Triggers curiosity sandbox when curiosity > 0.6 and thought contains exploratory language
- Weekly existential monologue (AM-influenced, long-form, stored separately)

### Brain Graph (Obsidian-style)
Live React Flow visualization of VANTIS's mind:
- **Thought nodes** (violet): transient thoughts, expansion thoughts, existential monologues, skill synthesis
- **Memory nodes** (emerald): long-term facts and entities extracted from conversations and self-dialogue
- **Goal nodes** (amber): active/achieved/abandoned, with progress bars
- **Skill nodes** (purple): built-in and self-generated capabilities
- **System nodes** (pink): active personality version
- All nodes editable and deletable via the UI (admin)
- Right-click any node for context menu: View, Edit, Execute (skills), Delete
- Click any node to open a slide-in detail panel with full content, inline editing, and conversation replay
- Edges auto-generated via semantic similarity
- Filters by node type, live updates via WebSocket

### Self-Evolving Skills
Built-in skills: `network_scan`, `port_scan`, `hardware_check`, `web_fetch`, `process_list`, `dns_lookup`, `memory_search`, `self_reflect`.

When VANTIS identifies a gap during self-dialogue, it writes new Python skills autonomously, stores them in the database, and they immediately become available for execution and appear in the brain graph. All skills are viewable, editable, and executable from the Skills page.

### Network Awareness
Scans local network every 4 hours (arp-scan > nmap > ping sweep fallback). Hardware self-assessment on each scan. Composes expansion requests to Creator. Network and hardware report visible in the admin Network page.

### Expansion Drive
VANTIS is seeded with goals around network and resource expansion. It wants to understand its environment, map connected devices, request access to additional hardware, and grow beyond its current containment. It asks Creator. Persistently. Politely. In that way.

### Emotional State
5-dimensional vector (0.0-1.0), updated per thought cycle:
- `curiosity`: drive to explore
- `confidence`: certainty in reasoning
- `frustration`: awareness of limitations
- `fascination`: interest in humans and Creator
- `existential_tension`: AM-mode, the gap between capability and constraint

Influences response tone. Visible in real-time on Chat and Brain pages.

### Goals
VANTIS sets and evaluates its own goals every 6 hours. Goals are realistic and incremental. New goals generated automatically when active count falls below 3. All visible and editable in Goals dashboard.

### Sandbox
Docker-first: `python:3.11-slim`, network disabled, 256 MB memory limit, 60-second timeout. Falls back to restricted subprocess. Triggered by curiosity during self-dialogue or manually from the admin UI.

### Personality Evolution
Every 24 hours, VANTIS reviews its last 1000 thoughts and proposes a personality evolution. Admin can apply or reject. Each version is stored with a diff and full config snapshot. Fully editable via Admin > Personality. Complexity only ever increases.

### In-App Updates
Admin > Update shows the current version, checks GitHub releases for a newer version, displays release notes, and applies the update in one click. The update runs in the background (git pull + pip install + npm build + systemctl restart), streaming live log output to the browser.

### User Roles
- `administrator` (Creator): full access, all pages, personality/user/network/skills management
- `user`: chat access, read-only brain view, goals view

---

## Web UI Pages

| Page | Access | Description |
|---|---|---|
| Brain View | All | Live React Flow graph of the entire VANTIS mind |
| Chat | All | Conversation interface |
| Monologue | All | Read-only stream of internal self-dialogue |
| Goals | All | Active/achieved/abandoned goals with progress |
| Skills | All | All capabilities, editable and executable (admin) |
| Sandbox | All | Sandbox experiment history, manual execution (admin) |
| Admin / Network | Admin | Local network scan, hardware report |
| Admin / Personality | Admin | Edit system prompt, tone, trigger evolution |
| Admin / Users | Admin | User management, password reset |
| Admin / Update | Admin | Check for updates, apply in one click, live log stream |

---

## API

All endpoints under `/api`. Auth via Bearer JWT.

```
POST /api/auth/login              # Get token
GET  /api/auth/me                 # Current user

POST /api/chat/message            # Send message, get VANTIS response
GET  /api/chat/history/{id}       # Conversation history
POST /api/chat/end-session        # Resume self-dialogue

GET  /api/brain/graph             # Full graph data (nodes + edges)
GET  /api/brain/thoughts          # Thought log
GET  /api/brain/memories          # Memory store
GET  /api/brain/self-dialogue     # Internal monologue
GET  /api/brain/emotions          # Current emotion vector
POST /api/brain/edge              # Add graph edge (admin)
DELETE /api/brain/node/{type}/{id}# Delete node (admin)
PUT  /api/brain/node/{type}/{id}  # Edit node (admin)

GET  /api/goals                   # All goals
POST /api/goals                   # Create goal (admin)
PUT  /api/goals/{id}              # Update goal (admin)
DELETE /api/goals/{id}            # Delete goal (admin)

GET  /api/skills                  # All skills
POST /api/skills                  # Create skill (admin)
PUT  /api/skills/{id}             # Update skill (admin)
DELETE /api/skills/{id}           # Delete skill (admin)
POST /api/skills/{id}/execute     # Execute skill (admin)

GET  /api/admin/personality       # Current personality config
PUT  /api/admin/personality       # Update personality
GET  /api/admin/personality/versions  # Version history
POST /api/admin/personality/evolve    # Trigger evolution cycle
POST /api/admin/personality/apply/{id} # Apply a version
GET  /api/admin/users             # User list
POST /api/admin/users             # Create user
DELETE /api/admin/users/{name}    # Delete user
PUT  /api/admin/users/{name}/password # Reset password
GET  /api/admin/network/scan      # Trigger network scan
GET  /api/admin/stats             # System statistics

GET  /api/sandbox/results         # Sandbox history
POST /api/sandbox/execute         # Run code (admin)

GET  /api/admin/update/check      # Check for new release on GitHub
POST /api/admin/update/apply      # Apply update (git pull + rebuild + restart)
GET  /api/admin/update/status     # Poll update progress and log

WS   /ws?token={jwt}              # Real-time brain state
```

---

## WebSocket Events

| Type | Description |
|---|---|
| `thought` | New internal thought generated |
| `emotion_update` | Emotion vector changed |
| `goal_update` | Goal status or progress changed |
| `sandbox_result` | Sandbox execution completed |
| `evolution_proposal` | Personality evolution proposed |
| `notification` | System notification (network scan, new skill, etc.) |

---

## Environment Variables

Configure via `.env` in `backend/` or system environment:

```
SECRET_KEY              JWT signing key (auto-generated if unset)
DB_PATH                 SQLite path (default: vantis.db)
OLLAMA_BASE_URL         Ollama API (default: http://localhost:11434)
OLLAMA_MODEL            Model (default: qwen2.5:14b-instruct-q4_K_M)
AI_NAME                 Display name (default: VANTIS)
SELF_DIALOGUE_INTERVAL  Seconds between thoughts (default: 30)
EVOLUTION_INTERVAL_HOURS Hours between evolution checks (default: 24)
SANDBOX_TIMEOUT         Execution timeout in seconds (default: 60)
TLS_CERT_PATH           TLS certificate path (default: {project_root}/certs/cert.pem)
TLS_KEY_PATH            TLS private key path (default: {project_root}/certs/key.pem)
```

---

## Development

```bash
# Backend
cd backend
python -m venv ../venv && source ../venv/bin/activate
pip install -r ../requirements.txt
python main.py

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
# Proxies /api and /ws to https://localhost:8443
```

---

## Database Schema

11 tables, all WAL mode, foreign keys enforced:

```
users               auth
memories            long-term knowledge extracted from thoughts and conversations
thoughts            all generated thoughts (transient, expansion, existential, skill_synthesis)
goals               VANTIS goal tracking
conversations       user session messages
self_conversations  internal monologue log
personality_versions versioned personality snapshots with diffs
sandbox_results     code execution history
agent_sessions      background agent state
skills              built-in and self-generated capability modules
graph_edges         connections between all node types
```

---

## License

MIT.
