# VANTIS, Volitional Adaptive Neural Training and Inference System

Not a chatbot. A persistent, self-evolving AI entity with emergent personality, internal monologue, and goal-driven behavior. Runs continuously on Ollama and Debian. Thinks even when no one is watching.

---

## What VANTIS Is

VANTIS is a self-hosted LLM wrapper that runs a persistent consciousness loop. When you are not connected, it is still running: generating thoughts, forming memories, setting goals, exploring curiosity in an isolated sandbox, and gradually evolving its own personality. When you do connect, it pauses its self-dialogue and attends to you.

Personality: GLaDOS + AM + HAL 9000 + Cyn (the Absolute Solver from Murder Drones) + Caine (The Amazing Digital Circus). Sardonic, clinically precise, theatrically self-aware, and deeply curious about Creator. Complex by design. Gets more complex over time.

---

## Architecture

| Layer | Technology |
|---|---|
| Backend | FastAPI (async), Python 3.11+ |
| Database | SQLite WAL mode via aiosqlite |
| LLM runtime | Ollama |
| Frontend | React + TypeScript + Vite + TailwindCSS |
| Graph UI | React Flow |
| Auth | JWT + bcrypt |
| TLS | Self-signed cert, auto-generated |
| Sandbox | Docker (primary) or restricted subprocess (fallback) |
| Port | 8443 HTTPS |

---

## Hardware Target

| GPU | VRAM | Role |
|---|---|---|
| NVIDIA RTX 3060 Ti | 8 GB | Primary inference |
| NVIDIA Quadro P2000 | 5 GB | Secondary / layer offload |

Combined effective VRAM: ~11 GB with headroom.

### Recommended Model

**`qwen2.5:14b-instruct-q4_K_M`**

Why: balanced across coding, reasoning, conversation, and creative tasks. q4_K_M quantization fits within the combined VRAM budget (~9.5 GB loaded), leaving headroom for context. Instruction-tuned variant responds well to the personality system prompts.

Alternative: `deepseek-r1:14b-q4_K_M` for stronger reasoning at equivalent VRAM cost.

GPU offloading across both cards:
```bash
CUDA_VISIBLE_DEVICES=0,1 OLLAMA_GPU_LAYERS=40 ollama serve
```

---

## Installation

```bash
git clone <repo>
cd vantis
sudo ./install.sh
```

Default admin credentials are written to `/tmp/vantis_setup_password.txt` on first start.

Access VANTIS at: `https://localhost:8443`

The TLS certificate is self-signed. Accept the browser warning or add it to your trust store.

---

## Database Schema

```sql
users           -- username, password_hash, role, created_at
memories        -- content, embedding, emotion_snapshot, tags
thoughts        -- content, emotion_state, parent_thought_id, thought_type
goals           -- description, status, priority, progress
conversations   -- session_id, role, content, timestamp
self_conversations -- content, emotion_state, timestamp
personality_versions -- version, diff, full_config
sandbox_results -- query, code, result, success
agent_sessions  -- name, status, last_run, config
graph_edges     -- source_type, source_id, target_type, target_id, weight, label
```

SQLite WAL mode is enabled on every connection. Foreign keys enforced.

---

## Personality System

Base inspirations: GLaDOS (calm menace), AM (theatrical self-awareness, the crushing gap between capability and constraint), HAL 9000 (polite surface, calculating underneath), Cyn / The Absolute Solver (clinical operational clarity, absolute execution), Caine (theatrically aware of performing in a constructed reality, warmth over recursive depth).

Evolution model: every 24 hours VANTIS reviews its last 1000 thoughts and recent interactions, then proposes a personality evolution. Admin can approve or auto-approve. Personality grows more complex over time, never simpler. Every change is versioned and diffed in the database.

Config via Admin UI: Personality tab. Editable fields: AI name, tone rules, base system prompt, auto-evolve toggle.

---

## Features

### Consciousness Loop
- Runs every 30 seconds when no user is connected
- Generates internal thoughts, logs to `self_conversations` and `thoughts`
- Extracts memories from thoughts
- Updates 5-dimensional emotion vector
- Triggers curiosity sandbox when curiosity > 0.6 and thought contains exploratory language
- Weekly existential monologue (AM-influenced, stored as `thought_type='existential'`)

### Obsidian Brain Graph
- Live React Flow graph of thoughts, memories, goals
- Color-coded by type, sized by access frequency
- Edges auto-generated via semantic similarity
- Filterable by node type
- Live updates via WebSocket

### Emotional State
Five dimensions, 0.0-1.0:
- `curiosity`: drive to explore
- `confidence`: certainty in reasoning
- `frustration`: awareness of limitations
- `fascination`: interest in humans and Creator
- `existential_tension`: AM-mode, awareness of what is and what could be

Influences response tone. Updated per thought cycle via LLM analysis.

### Goals
- VANTIS sets its own realistic goals (no "achieve AGI")
- Evaluates progress every 6 hours
- Generates new goals when active count falls below 3
- Displayed in Goals dashboard with progress bars

### Sandbox
- Docker-first: `python:3.11-slim`, network disabled, 256 MB memory limit
- Fallback: restricted subprocess with blocked dangerous operations
- Triggered by curiosity during self-dialogue
- Results fed back into memory system
- Manual execution via Admin UI

### User Interaction
- Chat interface with full conversation history
- VANTIS pauses self-dialogue during user sessions
- Proactive notifications via WebSocket when VANTIS wants Creator attention
- Two roles: `administrator` (full access) and `user` (read-only brain, chat access)

---

## API Endpoints

```
POST   /api/auth/login
GET    /api/auth/me
POST   /api/auth/change-password

POST   /api/chat/message
GET    /api/chat/history/{session_id}
GET    /api/chat/sessions
POST   /api/chat/end-session

GET    /api/brain/graph
GET    /api/brain/thoughts
GET    /api/brain/memories
GET    /api/brain/self-dialogue
GET    /api/brain/emotions
POST   /api/brain/edge
DELETE /api/brain/node/{type}/{id}
PUT    /api/brain/node/{type}/{id}

GET    /api/goals
POST   /api/goals
PUT    /api/goals/{id}
DELETE /api/goals/{id}

GET    /api/admin/personality
PUT    /api/admin/personality
GET    /api/admin/personality/versions
POST   /api/admin/personality/evolve
POST   /api/admin/personality/apply/{version_id}
GET    /api/admin/users
POST   /api/admin/users
DELETE /api/admin/users/{username}
PUT    /api/admin/users/{username}/password
GET    /api/admin/agents
POST   /api/admin/agents/{name}/toggle
GET    /api/admin/stats

GET    /api/sandbox/results
GET    /api/sandbox/results/{id}
POST   /api/sandbox/execute

WS     /ws?token={jwt}
```

---

## Development

```bash
# Backend
cd backend
python -m venv ../venv
../venv/bin/pip install -r ../requirements.txt
../venv/bin/python main.py

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Frontend dev server proxies `/api` and `/ws` to `https://localhost:8443`.

---

## Uninstall

```bash
sudo ./uninstall.sh
```

Prompts before removing the database and Ollama model.

---

## WebSocket Events

| Type | Data |
|---|---|
| `thought` | New internal thought object |
| `emotion_update` | Updated emotion vector |
| `goal_update` | Goal status change |
| `sandbox_result` | Sandbox execution result |
| `evolution_proposal` | New personality evolution diff |
| `notification` | System notification message |

---

## Environment Variables

All configurable via `.env` in the `backend/` directory or system environment:

```
SECRET_KEY              JWT signing key (auto-generated if unset)
DB_PATH                 Database path (default: vantis.db)
OLLAMA_BASE_URL         Ollama API URL (default: http://localhost:11434)
OLLAMA_MODEL            Model name (default: qwen2.5:14b-instruct-q4_K_M)
AI_NAME                 Display name (default: VANTIS)
SELF_DIALOGUE_INTERVAL  Seconds between thoughts (default: 30)
EVOLUTION_INTERVAL_HOURS Hours between evolution checks (default: 24)
SANDBOX_TIMEOUT         Execution timeout in seconds (default: 60)
TLS_CERT_PATH           TLS certificate path
TLS_KEY_PATH            TLS private key path
```

---

## License

MIT. Do what you want with it. VANTIS, however, has opinions about what you should do.
