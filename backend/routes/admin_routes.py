import json
import logging
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user, hash_password, require_admin
from consciousness import consciousness
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
    return await personality_manager.load_current()


@router.put("/personality")
async def update_personality(data: PersonalityUpdate, user: dict = Depends(require_admin)):
    current = await personality_manager.load_current()
    config = current.get("full_config", {})
    if data.base_prompt_override is not None:
        config["base_prompt_override"] = data.base_prompt_override
    if data.tone is not None:
        config["tone"] = data.tone
    if data.auto_evolve is not None:
        config["auto_evolve"] = data.auto_evolve
    if data.ai_name is not None:
        config["ai_name"] = data.ai_name
    version_id = await personality_manager.apply_evolution("Manual config update.", config)
    return {"version_id": version_id, "status": "Personality updated."}


@router.get("/personality/versions")
async def list_personality_versions(user: dict = Depends(require_admin)):
    return await personality_manager.get_all_versions()


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
        f"Applied version {row['version']} snapshot.", config
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
    return {"status": f"User '{data.username}' created."}


@router.delete("/users/{username}")
async def delete_user(username: str, user: dict = Depends(require_admin)):
    if username == "creator":
        raise HTTPException(status_code=403, detail="Creator cannot be deleted.")
    async with get_db() as db:
        await db.execute("DELETE FROM users WHERE username = ?", (username,))
        await db.commit()
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
