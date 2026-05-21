from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user, require_admin
from goals import goal_manager

router = APIRouter(prefix="/api/goals", tags=["goals"])


class GoalCreate(BaseModel):
    description: str
    priority: int = 5


class GoalUpdate(BaseModel):
    status: Optional[str] = None
    progress: Optional[float] = None
    description: Optional[str] = None
    priority: Optional[int] = None


@router.get("")
async def list_goals(user: dict = Depends(get_current_user)):
    from database import get_db
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM goals WHERE owner = ? OR owner = 'system' ORDER BY updated_at DESC",
            (user["username"],)
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.post("")
async def create_goal(data: GoalCreate, user: dict = Depends(require_admin)):
    gid = await goal_manager.create_goal(data.description, data.priority, owner=user["username"])
    return {"id": gid, "status": "Goal created. I will monitor progress."}


@router.put("/{goal_id}")
async def update_goal(
    goal_id: int, data: GoalUpdate, user: dict = Depends(require_admin)
):
    from database import get_db
    async with get_db() as db:
        if data.description is not None:
            await db.execute(
                "UPDATE goals SET description = ?, updated_at = datetime('now') WHERE id = ?",
                (data.description, goal_id),
            )
        if data.priority is not None:
            await db.execute(
                "UPDATE goals SET priority = ?, updated_at = datetime('now') WHERE id = ?",
                (data.priority, goal_id),
            )
        await db.commit()

    if data.status is not None:
        await goal_manager.update_goal_status(goal_id, data.status, data.progress)
    elif data.progress is not None:
        await goal_manager.update_goal_status(goal_id, "active", data.progress)

    return {"status": "Updated."}


@router.delete("/{goal_id}")
async def delete_goal(goal_id: int, user: dict = Depends(require_admin)):
    from database import get_db
    async with get_db() as db:
        await db.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
        await db.commit()
    return {"status": "Goal removed. Abandoned, not forgotten."}


@router.post("/{goal_id}/decompose")
async def decompose_goal(goal_id: int, user: dict = Depends(require_admin)):
    """Use LLM to decompose a goal into subtasks stored as child goals."""
    from database import get_db
    from ollama_client import ollama
    async with get_db() as db:
        cursor = await db.execute("SELECT description FROM goals WHERE id = ?", (goal_id,))
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(404, "Goal not found.")

    description = row["description"]
    prompt = (
        f"Break this goal into 3-5 concrete, actionable subtasks:\n\nGoal: {description}\n\n"
        "Respond with a JSON array only, no markdown, like:\n"
        '[{"description": "subtask 1", "priority": 6}, {"description": "subtask 2", "priority": 5}]'
    )

    try:
        resp = await ollama.chat([{"role": "user", "content": prompt}], system="You are a goal decomposition assistant. Respond only with valid JSON.")
        import json as _json
        # Strip markdown fences if present
        text = resp.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        subtasks = _json.loads(text)
    except Exception as exc:
        raise HTTPException(500, f"Decomposition failed: {exc}")

    created = []
    for sub in subtasks[:5]:
        if isinstance(sub.get("description"), str):
            gid = await goal_manager.create_goal(
                sub["description"],
                sub.get("priority", 5),
                owner=user["username"],
            )
            # Set parent_goal_id
            from database import get_db
            async with get_db() as db:
                await db.execute("UPDATE goals SET parent_goal_id = ? WHERE id = ?", (goal_id, gid))
                await db.commit()
            created.append({"id": gid, "description": sub["description"]})

    return {"goal_id": goal_id, "subtasks_created": len(created), "subtasks": created}
