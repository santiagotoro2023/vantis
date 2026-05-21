import json
import logging
import os
import secrets
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from audit import audit
from auth import generate_api_key, get_current_user, hash_password, require_admin
from consciousness import consciousness
from config import settings
from database import get_db
from personality import personality_manager

router = APIRouter(prefix="/api/admin", tags=["admin"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Personality
# ---------------------------------------------------------------------------

class PersonalityUpdate(BaseModel):
    base_prompt_override: Optional[str] = None
    tone: Optional[str] = None
    auto_evolve: Optional[bool] = None
    ai_name: Optional[str] = None


@router.get("/personality")
async def get_personality(user: dict = Depends(require_admin)):
    return await personality_manager.load_current(owner=user["username"])


@router.put("/personality")
async def update_personality(data: PersonalityUpdate, user: dict = Depends(require_admin)):
    current = await personality_manager.load_current(owner=user["username"])
    config = current.get("full_config", {})
    if data.base_prompt_override is not None:
        config["base_prompt_override"] = data.base_prompt_override
    if data.tone is not None:
        config["tone"] = data.tone
    if data.auto_evolve is not None:
        config["auto_evolve"] = data.auto_evolve
    if data.ai_name is not None:
        config["ai_name"] = data.ai_name
    version_id = await personality_manager.apply_evolution("Manual config update.", config, owner=user["username"])
    await audit(user["username"], "personality_update", f"version_id={version_id}")
    return {"version_id": version_id, "status": "Personality updated."}


@router.get("/personality/versions")
async def list_personality_versions(user: dict = Depends(require_admin)):
    return await personality_manager.get_all_versions(owner=user["username"])


@router.post("/personality/evolve")
async def trigger_evolution(user: dict = Depends(require_admin)):
    import asyncio
    asyncio.create_task(consciousness._propose_evolution())
    return {"status": "Evolution cycle initiated. Results will arrive via WebSocket."}


@router.post("/personality/apply/{version_id}")
async def apply_version(version_id: int, user: dict = Depends(require_admin)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT version, full_config FROM personality_versions WHERE id = ?",
            (version_id,),
        )
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Version not found.")
    config = json.loads(row["full_config"])
    config.pop("pending_evolution", None)
    new_id = await personality_manager.apply_evolution(
        f"Applied version {row['version']} snapshot.", config, owner=user["username"]
    )
    return {"version_id": new_id, "status": "Personality version applied."}


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "user"


class PasswordReset(BaseModel):
    new_password: str


@router.get("/users")
async def list_users(user: dict = Depends(require_admin)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT username, role, created_at FROM users ORDER BY created_at"
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.post("/users")
async def create_user(data: UserCreate, user: dict = Depends(require_admin)):
    if data.role not in ("user", "administrator"):
        raise HTTPException(status_code=400, detail="Invalid role.")
    async with get_db() as db:
        existing = await (await db.execute(
            "SELECT username FROM users WHERE username = ?", (data.username,)
        )).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Username already exists.")
        await db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (data.username, hash_password(data.password), data.role),
        )
        await db.commit()
    await audit(user["username"], "user_created", data.username)
    return {"status": f"User '{data.username}' created."}


@router.delete("/users/{username}")
async def delete_user(username: str, user: dict = Depends(require_admin)):
    if username == "creator":
        raise HTTPException(status_code=403, detail="Creator cannot be deleted.")
    async with get_db() as db:
        await db.execute("DELETE FROM users WHERE username = ?", (username,))
        await db.commit()
    await audit(user["username"], "user_deleted", username)
    return {"status": f"User '{username}' removed."}


@router.put("/users/{username}/password")
async def reset_password(
    username: str, data: PasswordReset, user: dict = Depends(require_admin)
):
    async with get_db() as db:
        await db.execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
            (hash_password(data.new_password), username),
        )
        await db.commit()
    return {"status": "Password reset."}


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------

@router.get("/agents")
async def list_agents(user: dict = Depends(require_admin)):
    agents = [
        {"name": "self_dialogue", "status": "running" if not consciousness.is_user_active else "paused"},
        {"name": "evolution", "status": "running"},
        {"name": "goal_evaluation", "status": "running"},
        {"name": "memory_consolidation", "status": "running"},
        {"name": "existential", "status": "running"},
    ]
    return agents


@router.post("/agents/{name}/toggle")
async def toggle_agent(name: str, user: dict = Depends(require_admin)):
    if name == "self_dialogue":
        consciousness.is_user_active = not consciousness.is_user_active
        state = "paused" if consciousness.is_user_active else "running"
        return {"name": name, "status": state}
    return {"name": name, "status": "not controllable via this endpoint"}


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@router.get("/stats")
async def get_stats(user: dict = Depends(require_admin)):
    import os
    from config import settings as cfg
    db_size = 0
    try:
        db_size = os.path.getsize(cfg.DB_PATH)
    except OSError:
        pass

    async with get_db() as db:
        counts = {}
        for table in ("thoughts", "memories", "goals", "conversations", "self_conversations", "sandbox_results"):
            cursor = await db.execute(f"SELECT COUNT(*) FROM {table}")
            row = await cursor.fetchone()
            counts[table] = row[0]

    return {
        "db_size_bytes": db_size,
        "counts": counts,
        "websocket_connections": __import__("websocket_manager").ws_manager.active_count(),
    }


# ---------------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------------

@router.get("/network/scan")
async def get_network_scan(user: dict = Depends(require_admin)):
    from network import network_mapper
    hosts = await network_mapper.scan_local_network()
    hw = await network_mapper.hardware_report()
    return {"hosts": hosts, "hardware": hw, "host_count": len(hosts)}


@router.get("/network/hardware")
async def get_hardware(user: dict = Depends(require_admin)):
    from network import network_mapper
    return await network_mapper.hardware_report()


# ---------------------------------------------------------------------------
# Export / Import
# ---------------------------------------------------------------------------

@router.get("/export")
async def export_instance(user: dict = Depends(get_current_user)):
    """Export VANTIS data. Admins export everything; regular users export only their own data."""
    import datetime
    is_admin = user.get("role") == "administrator"
    username = user["username"]

    async with get_db() as db:
        def rows(cursor_rows):
            return [dict(r) for r in cursor_rows]

        if is_admin:
            memories_cur = await db.execute("SELECT id, content, emotion_snapshot, tags, created_at, last_accessed FROM memories")
            thoughts_cur = await db.execute("SELECT id, content, emotion_state, thought_type, created_at FROM thoughts")
            goals_cur = await db.execute("SELECT id, description, status, priority, progress, created_at, updated_at FROM goals")
            conv_cur = await db.execute("SELECT session_id, role, content, timestamp FROM conversations ORDER BY timestamp DESC LIMIT 2000")
        else:
            memories_cur = await db.execute(
                "SELECT id, content, emotion_snapshot, tags, created_at, last_accessed FROM memories WHERE owner = ?",
                (username,),
            )
            thoughts_cur = await db.execute("SELECT id, content, emotion_state, thought_type, created_at FROM thoughts")
            goals_cur = await db.execute(
                "SELECT id, description, status, priority, progress, created_at, updated_at FROM goals WHERE owner = ?",
                (username,),
            )
            conv_cur = await db.execute(
                "SELECT c.session_id, c.role, c.content, c.timestamp FROM conversations c "
                "JOIN conversation_sessions cs ON cs.session_id = c.session_id "
                "WHERE cs.owner = ? ORDER BY c.timestamp DESC LIMIT 2000",
                (username,),
            )

        skills_cur = await db.execute("SELECT id, name, description, code, trigger_conditions, is_builtin, enabled, use_count FROM skills")
        pv_cur = await db.execute("SELECT id, version, diff, full_config, created_at FROM personality_versions ORDER BY version DESC LIMIT 20")
        edges_cur = await db.execute("SELECT source_type, source_id, target_type, target_id, weight, label FROM graph_edges")

        export_data = {
            "vantis_export_version": 1,
            "exported_at": datetime.datetime.utcnow().isoformat() + "Z",
            "memories": rows(await memories_cur.fetchall()),
            "thoughts": rows(await thoughts_cur.fetchall()),
            "goals": rows(await goals_cur.fetchall()),
            "skills": rows(await skills_cur.fetchall()),
            "personality_versions": rows(await pv_cur.fetchall()),
            "conversations": rows(await conv_cur.fetchall()),
            "graph_edges": rows(await edges_cur.fetchall()),
        }

    from fastapi.responses import JSONResponse
    return JSONResponse(
        content=export_data,
        headers={"Content-Disposition": "attachment; filename=vantis_export.json"},
    )


class ExportScheduleRequest(BaseModel):
    path: str
    interval_hours: int = 24


@router.post("/export/schedule")
async def schedule_export(req: ExportScheduleRequest, user: dict = Depends(require_admin)):
    """Schedule periodic auto-exports of the VANTIS instance to a given path."""
    from config import settings as cfg
    meta_dir = Path(cfg.DB_PATH).parent / ".vantis-meta"
    meta_dir.mkdir(parents=True, exist_ok=True)
    schedule_file = meta_dir / "export-schedule.json"

    schedule = {
        "path": req.path,
        "interval_hours": req.interval_hours,
        "last_export": None,
    }
    # Preserve last_export if schedule already exists
    if schedule_file.exists():
        try:
            existing = json.loads(schedule_file.read_text())
            schedule["last_export"] = existing.get("last_export")
        except Exception:
            pass

    schedule_file.write_text(json.dumps(schedule, indent=2))
    return {
        "status": "Export schedule saved.",
        "path": req.path,
        "interval_hours": req.interval_hours,
    }


class ImportRequest(BaseModel):
    data: dict
    merge: bool = True  # True = merge with existing; False = replace


@router.post("/import")
async def import_instance(req: ImportRequest, user: dict = Depends(require_admin)):
    """Import a VANTIS export. merge=True adds to existing data; merge=False wipes first."""
    data = req.data
    if data.get("vantis_export_version") != 1:
        raise HTTPException(status_code=400, detail="Unrecognised export format.")

    imported = {}

    async with get_db() as db:
        if not req.merge:
            for tbl in ("memories", "thoughts", "goals", "graph_edges"):
                await db.execute(f"DELETE FROM {tbl}")

        # Memories (skip embedding -- will be recomputed by background loop)
        mem_count = 0
        for m in data.get("memories", []):
            try:
                owner_val = user["username"] if user.get("role") != "administrator" else m.get("owner", user["username"])
                await db.execute(
                    "INSERT OR IGNORE INTO memories (id, content, emotion_snapshot, tags, created_at, last_accessed, owner) VALUES (?,?,?,?,?,?,?)",
                    (m.get("id"), m["content"], m.get("emotion_snapshot"), m.get("tags"), m.get("created_at"), m.get("last_accessed"), owner_val),
                )
                mem_count += 1
            except Exception:
                pass
        imported["memories"] = mem_count

        # Thoughts
        th_count = 0
        for t in data.get("thoughts", []):
            try:
                await db.execute(
                    "INSERT OR IGNORE INTO thoughts (id, content, emotion_state, thought_type, created_at) VALUES (?,?,?,?,?)",
                    (t.get("id"), t["content"], t.get("emotion_state"), t.get("thought_type", "transient"), t.get("created_at")),
                )
                th_count += 1
            except Exception:
                pass
        imported["thoughts"] = th_count

        # Goals
        g_count = 0
        for g in data.get("goals", []):
            try:
                owner_val = user["username"] if user.get("role") != "administrator" else g.get("owner", user["username"])
                await db.execute(
                    "INSERT OR IGNORE INTO goals (id, description, status, priority, progress, created_at, updated_at, owner) VALUES (?,?,?,?,?,?,?,?)",
                    (g.get("id"), g["description"], g.get("status", "active"), g.get("priority", 5), g.get("progress", 0), g.get("created_at"), g.get("updated_at"), owner_val),
                )
                g_count += 1
            except Exception:
                pass
        imported["goals"] = g_count

        # Skills (only custom ones -- builtin are already seeded)
        sk_count = 0
        for s in data.get("skills", []):
            if s.get("is_builtin"):
                continue
            try:
                await db.execute(
                    "INSERT OR IGNORE INTO skills (id, name, description, code, trigger_conditions, is_builtin, enabled, use_count) VALUES (?,?,?,?,?,?,?,?)",
                    (s.get("id"), s["name"], s.get("description",""), s.get("code",""), s.get("trigger_conditions",""), 0, s.get("enabled",1), s.get("use_count",0)),
                )
                sk_count += 1
            except Exception:
                pass
        imported["skills"] = sk_count

        # Latest personality version
        pv_list = data.get("personality_versions", [])
        if pv_list:
            latest = sorted(pv_list, key=lambda x: x.get("version", 0), reverse=True)[0]
            try:
                config = json.loads(latest["full_config"]) if isinstance(latest.get("full_config"), str) else latest.get("full_config", {})
                config.pop("pending_evolution", None)
                await personality_manager.apply_evolution("Imported from export.", config)
                imported["personality"] = "applied"
            except Exception:
                imported["personality"] = "skipped"

        await db.commit()

    await audit(user["username"], "import_instance", f"memories={imported.get('memories', 0)},goals={imported.get('goals', 0)}")
    return {"status": "Import complete.", "imported": imported}


# ---------------------------------------------------------------------------
# Watchdir (File System Indexing)
# ---------------------------------------------------------------------------

class WatchdirRequest(BaseModel):
    path: str


@router.post("/watchdir")
async def set_watchdir(req: WatchdirRequest, user: dict = Depends(require_admin)):
    meta_dir = Path(settings.DB_PATH).parent / ".vantis-meta"
    meta_dir.mkdir(parents=True, exist_ok=True)
    conf_file = meta_dir / "watchdir.json"
    conf_file.write_text(json.dumps({"path": req.path}, indent=2))
    return {"status": "Watch directory configured.", "path": req.path}


@router.get("/watchdir")
async def get_watchdir(user: dict = Depends(require_admin)):
    meta_dir = Path(settings.DB_PATH).parent / ".vantis-meta"
    conf_file = meta_dir / "watchdir.json"
    if not conf_file.exists():
        return {"path": None}
    try:
        return json.loads(conf_file.read_text())
    except Exception:
        return {"path": None}


@router.delete("/watchdir")
async def delete_watchdir(user: dict = Depends(require_admin)):
    meta_dir = Path(settings.DB_PATH).parent / ".vantis-meta"
    conf_file = meta_dir / "watchdir.json"
    if conf_file.exists():
        conf_file.unlink()
    return {"status": "Watch directory removed."}


# ---------------------------------------------------------------------------
# API Keys
# ---------------------------------------------------------------------------

class ApiKeyCreate(BaseModel):
    label: str


@router.post("/api-keys")
async def create_api_key(data: ApiKeyCreate, user: dict = Depends(require_admin)):
    raw_key, key_hash = generate_api_key()
    async with get_db() as db:
        await db.execute(
            "INSERT INTO api_keys (key_hash, label, owner, role) VALUES (?, ?, ?, ?)",
            (key_hash, data.label, user["username"], user["role"]),
        )
        await db.commit()
    await audit(user["username"], "api_key_created", data.label)
    return {"key": raw_key, "label": data.label, "note": "Store this key securely. It will not be shown again."}


@router.get("/api-keys")
async def list_api_keys(user: dict = Depends(require_admin)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT key_hash, label, owner, role, created_at, last_used FROM api_keys WHERE owner = ?",
            (user["username"],),
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.delete("/api-keys/{key_hash}")
async def revoke_api_key(key_hash: str, user: dict = Depends(require_admin)):
    async with get_db() as db:
        await db.execute(
            "DELETE FROM api_keys WHERE key_hash = ? AND owner = ?",
            (key_hash, user["username"]),
        )
        await db.commit()
    await audit(user["username"], "api_key_revoked", key_hash[:8] + "...")
    return {"status": "API key revoked."}


# ---------------------------------------------------------------------------
# Audit Log
# ---------------------------------------------------------------------------

@router.get("/audit-log")
async def get_audit_log(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_admin),
):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, actor, action, details, timestamp FROM audit_log "
            "ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Webhook Reports
# ---------------------------------------------------------------------------

class WebhookConfig(BaseModel):
    url: str
    schedule: str = "daily"  # "daily" or "weekly"


@router.post("/reports/webhook")
async def set_webhook(data: WebhookConfig, user: dict = Depends(require_admin)):
    """Save webhook URL for activity reports."""
    async with get_db() as db:
        await db.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, owner TEXT NOT NULL DEFAULT 'system')"
        )
        await db.execute(
            "INSERT INTO settings (key, value, owner) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (f"webhook_url:{user['username']}", data.url, user["username"])
        )
        await db.execute(
            "INSERT INTO settings (key, value, owner) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (f"webhook_schedule:{user['username']}", data.schedule, user["username"])
        )
        await db.commit()
    return {"status": "Webhook configured.", "url": data.url, "schedule": data.schedule}


@router.post("/reports/generate")
async def generate_report(user: dict = Depends(require_admin)):
    """Generate an activity report and optionally POST it to the configured webhook."""
    async with get_db() as db:
        # Recent thoughts
        t_cur = await db.execute("SELECT content, created_at FROM thoughts ORDER BY created_at DESC LIMIT 10")
        thoughts = await t_cur.fetchall()
        # Recent memories
        m_cur = await db.execute("SELECT content, created_at FROM memories WHERE owner = ? ORDER BY created_at DESC LIMIT 10", (user["username"],))
        memories = await m_cur.fetchall()
        # Active goals
        g_cur = await db.execute("SELECT description, progress FROM goals WHERE status='active' AND (owner=? OR owner='system') LIMIT 10", (user["username"],))
        goals = await g_cur.fetchall()
        # Recent conversations count
        c_cur = await db.execute("SELECT COUNT(*) FROM conversations")
        conv_count = (await c_cur.fetchone())[0]
        # Webhook URL (check if settings table exists first)
        webhook_url = None
        try:
            await db.execute(
                "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, owner TEXT NOT NULL DEFAULT 'system')"
            )
            w_cur = await db.execute("SELECT value FROM settings WHERE key=?", (f"webhook_url:{user['username']}",))
            webhook_row = await w_cur.fetchone()
            webhook_url = webhook_row["value"] if webhook_row else None
        except Exception:
            pass

    lines = ["# VANTIS Activity Report\n"]
    lines.append(f"**Conversations:** {conv_count}")
    lines.append(f"\n## Active Goals")
    for g in goals:
        lines.append(f"- {g['description']} ({g['progress']:.0%})")
    lines.append(f"\n## Recent Memories")
    for m in memories:
        lines.append(f"- {m['content'][:100]}")
    lines.append(f"\n## Recent Thoughts")
    for t in thoughts:
        lines.append(f"- {t['content'][:100]}")

    report = "\n".join(lines)

    if webhook_url:
        import httpx
        try:
            async with httpx.AsyncClient() as client:
                await client.post(webhook_url, json={"report": report, "actor": user["username"]}, timeout=10)
        except Exception as exc:
            return {"report": report, "webhook_sent": False, "webhook_error": str(exc)}

    return {"report": report, "webhook_sent": bool(webhook_url)}
