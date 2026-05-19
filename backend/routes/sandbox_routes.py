from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import get_current_user, require_admin
from database import get_db
from sandbox import sandbox_executor

router = APIRouter(prefix="/api/sandbox", tags=["sandbox"])


class ExecuteRequest(BaseModel):
    code: str
    language: str = "python"
    query: Optional[str] = None


@router.get("/results")
async def list_results(
    limit: int = 50,
    offset: int = 0,
    user: dict = Depends(get_current_user),
):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM sandbox_results ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.get("/results/{result_id}")
async def get_result(result_id: int, user: dict = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM sandbox_results WHERE id = ?", (result_id,)
        )
        row = await cursor.fetchone()
    if not row:
        return {"error": "Not found."}
    return dict(row)


@router.post("/execute")
async def execute_code(data: ExecuteRequest, user: dict = Depends(require_admin)):
    result = await sandbox_executor.execute(data.code, data.language, data.query)
    return result
