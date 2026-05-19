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
    return await goal_manager.get_all_goals()


@router.post("")
async def create_goal(data: GoalCreate, user: dict = Depends(require_admin)):
    gid = await goal_manager.create_goal(data.description, data.priority)
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
