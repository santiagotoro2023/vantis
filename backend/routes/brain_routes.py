import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user, require_admin
from database import get_db
from emotions import emotion_manager
from graph import graph_manager

router = APIRouter(prefix="/api/brain", tags=["brain"])
logger = logging.getLogger(__name__)


@router.get("/graph")
async def get_graph(user: dict = Depends(get_current_user)):
    return await graph_manager.get_graph_data()


@router.get("/thoughts")
async def get_thoughts(
    limit: int = 50,
    offset: int = 0,
    thought_type: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    async with get_db() as db:
        if thought_type:
            cursor = await db.execute(
                "SELECT * FROM thoughts WHERE thought_type = ? "
                "ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (thought_type, limit, offset),
            )
        else:
            cursor = await db.execute(
                "SELECT * FROM thoughts ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.get("/memories")
async def get_memories(
    limit: int = 50,
    offset: int = 0,
    search: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    async with get_db() as db:
        if search:
            cursor = await db.execute(
                "SELECT * FROM memories WHERE content LIKE ? OR tags LIKE ? "
                "ORDER BY last_accessed DESC LIMIT ? OFFSET ?",
                (f"%{search}%", f"%{search}%", limit, offset),
            )
        else:
            cursor = await db.execute(
                "SELECT * FROM memories ORDER BY last_accessed DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.get("/self-dialogue")
async def get_self_dialogue(
    limit: int = 50,
    offset: int = 0,
    user: dict = Depends(get_current_user),
):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM self_conversations ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.get("/emotions")
async def get_emotions(user: dict = Depends(get_current_user)):
    return emotion_manager.to_dict()


class EdgeCreate(BaseModel):
    source_type: str
    source_id: int
    target_type: str
    target_id: int
    weight: float = 1.0
    label: str = ""


@router.post("/edge")
async def create_edge(data: EdgeCreate, user: dict = Depends(require_admin)):
    edge_id = await graph_manager.add_edge(
        data.source_type, data.source_id,
        data.target_type, data.target_id,
        data.weight, data.label,
    )
    return {"id": edge_id}


@router.delete("/node/{node_type}/{node_id}")
async def delete_node(
    node_type: str, node_id: int, user: dict = Depends(require_admin)
):
    await graph_manager.delete_node(node_type, node_id)
    return {"status": f"{node_type}:{node_id} deleted. Gone, as if it never existed."}


class NodeUpdate(BaseModel):
    content: str


@router.put("/node/{node_type}/{node_id}")
async def update_node(
    node_type: str,
    node_id: int,
    data: NodeUpdate,
    user: dict = Depends(require_admin),
):
    table_map = {
        "thought": ("thoughts", "content"),
        "memory": ("memories", "content"),
        "goal": ("goals", "description"),
    }
    if node_type not in table_map:
        raise HTTPException(status_code=400, detail=f"Unknown node type: {node_type}")
    table, col = table_map[node_type]
    async with get_db() as db:
        await db.execute(
            f"UPDATE {table} SET {col} = ? WHERE id = ?", (data.content, node_id)
        )
        await db.commit()
    return {"status": "Updated."}
