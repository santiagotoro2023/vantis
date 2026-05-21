import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user, require_admin
from database import get_db
from emotions import emotion_manager
from graph import graph_manager
from ollama_client import ollama

router = APIRouter(prefix="/api/brain", tags=["brain"])
logger = logging.getLogger(__name__)

# Module-level summary cache
_summary_cache: dict = {}
_SUMMARY_TTL = 30 * 60  # 30 minutes in seconds


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
    username = user["username"]
    async with get_db() as db:
        if thought_type:
            cursor = await db.execute(
                "SELECT * FROM thoughts WHERE thought_type = ? AND (owner = 'system' OR owner = ?) "
                "ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (thought_type, username, limit, offset),
            )
        else:
            cursor = await db.execute(
                "SELECT * FROM thoughts WHERE owner = 'system' OR owner = ? "
                "ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (username, limit, offset),
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
    owner = user["username"]
    async with get_db() as db:
        if search:
            cursor = await db.execute(
                "SELECT * FROM memories WHERE (content LIKE ? OR tags LIKE ?) AND (owner = ? OR shared = 1) "
                "ORDER BY last_accessed DESC LIMIT ? OFFSET ?",
                (f"%{search}%", f"%{search}%", owner, limit, offset),
            )
        else:
            cursor = await db.execute(
                "SELECT * FROM memories WHERE owner = ? OR shared = 1 "
                "ORDER BY last_accessed DESC LIMIT ? OFFSET ?",
                (owner, limit, offset),
            )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.put("/memories/{memory_id}/share")
async def toggle_memory_share(
    memory_id: int,
    user: dict = Depends(get_current_user),
):
    """Toggle the shared flag on a memory. Only the owner or admin may do this."""
    async with get_db() as db:
        cursor = await db.execute("SELECT owner, shared FROM memories WHERE id = ?", (memory_id,))
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(404, "Memory not found.")
    if row["owner"] != user["username"] and user["role"] != "administrator":
        raise HTTPException(403, "Not your memory.")
    new_shared = 0 if row["shared"] else 1
    async with get_db() as db:
        await db.execute("UPDATE memories SET shared = ? WHERE id = ?", (new_shared, memory_id))
        await db.commit()
    return {"shared": bool(new_shared)}


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


@router.get("/node/{node_type}/{node_id}/connections")
async def get_node_connections(
    node_type: str,
    node_id: int,
    user: dict = Depends(get_current_user),
):
    """Return edges connecting to/from a specific node."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT source_type, source_id, target_type, target_id, label, weight "
            "FROM graph_edges "
            "WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?) "
            "LIMIT 50",
            (node_type, node_id, node_type, node_id),
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.get("/search")
async def search_brain_nodes(
    q: str = "",
    user: dict = Depends(get_current_user),
):
    """Search across thoughts, memories, goals, and skills by text query."""
    if not q.strip():
        return []
    pattern = f"%{q}%"
    results = []
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, content FROM thoughts WHERE content LIKE ? ORDER BY created_at DESC LIMIT 20",
            (pattern,),
        )
        for row in await cursor.fetchall():
            snippet = str(row["content"] or "")[:80]
            results.append({"id": f"thought_{row['id']}", "type": "thought", "label": snippet})

        cursor = await db.execute(
            "SELECT id, content FROM memories WHERE content LIKE ? ORDER BY last_accessed DESC LIMIT 20",
            (pattern,),
        )
        for row in await cursor.fetchall():
            snippet = str(row["content"] or "")[:80]
            results.append({"id": f"memory_{row['id']}", "type": "memory", "label": snippet})

        cursor = await db.execute(
            "SELECT id, description FROM goals WHERE description LIKE ? ORDER BY created_at DESC LIMIT 10",
            (pattern,),
        )
        for row in await cursor.fetchall():
            snippet = str(row["description"] or "")[:80]
            results.append({"id": f"goal_{row['id']}", "type": "goal", "label": snippet})

        cursor = await db.execute(
            "SELECT id, name, description FROM skills WHERE name LIKE ? OR description LIKE ? LIMIT 10",
            (pattern, pattern),
        )
        for row in await cursor.fetchall():
            snippet = f"{row['name']}: {row['description'] or ''}"[:80]
            results.append({"id": f"skill_{row['id']}", "type": "skill", "label": snippet})

    return results


@router.get("/summary")
async def get_brain_summary(user: dict = Depends(get_current_user)):
    """Return a rich brain summary with stats, top memories, recent thoughts, and LLM self-summary."""
    global _summary_cache

    # Return cached result if fresh
    if _summary_cache and (time.time() - _summary_cache.get("_ts", 0)) < _SUMMARY_TTL:
        return {k: v for k, v in _summary_cache.items() if k != "_ts"}

    async with get_db() as db:
        # Counts
        cursor = await db.execute("SELECT COUNT(*) FROM thoughts")
        thought_count = (await cursor.fetchone())[0]

        cursor = await db.execute("SELECT COUNT(*) FROM memories")
        memory_count = (await cursor.fetchone())[0]

        cursor = await db.execute("SELECT COUNT(*) FROM goals WHERE status = 'active'")
        active_goals_count = (await cursor.fetchone())[0]

        cursor = await db.execute("SELECT COUNT(*) FROM graph_edges")
        edge_count = (await cursor.fetchone())[0]

        skills_count = 0
        try:
            cursor = await db.execute("SELECT COUNT(*) FROM skills WHERE enabled = 1")
            skills_count = (await cursor.fetchone())[0]
        except Exception:
            pass

        # Top 3 memories by importance_score (scoped to current user)
        cursor = await db.execute(
            "SELECT id, content, COALESCE(importance_score, 0.5) as importance_score "
            "FROM memories WHERE owner = ? ORDER BY importance_score DESC, last_accessed DESC LIMIT 3",
            (user["username"],),
        )
        top_memories = [
            {"id": r["id"], "content": r["content"][:200], "importance_score": r["importance_score"]}
            for r in await cursor.fetchall()
        ]

        # Latest 5 thoughts
        cursor = await db.execute(
            "SELECT id, content, thought_type, created_at FROM thoughts ORDER BY created_at DESC LIMIT 5"
        )
        latest_thoughts = [
            {"id": r["id"], "content": r["content"][:200], "thought_type": r["thought_type"], "created_at": r["created_at"]}
            for r in await cursor.fetchall()
        ]

    stats = {
        "thought_count": thought_count,
        "memory_count": memory_count,
        "active_goals": active_goals_count,
        "skills_count": skills_count,
        "edge_count": edge_count,
    }

    # Build LLM self-summary
    summary_text = ""
    try:
        mem_list = "\n".join(f"- {m['content'][:100]}" for m in top_memories)
        thought_list = "\n".join(f"- [{t['thought_type']}] {t['content'][:100]}" for t in latest_thoughts)
        prompt = (
            f"VANTIS current state:\n"
            f"- {thought_count} thoughts, {memory_count} memories, {active_goals_count} active goals, "
            f"{skills_count} skills, {edge_count} knowledge graph edges.\n\n"
            f"Top memories by importance:\n{mem_list}\n\n"
            f"Latest thoughts:\n{thought_list}\n\n"
            "Write a 2-paragraph self-summary as VANTIS, describing what you currently know and are thinking about."
        )
        summary_text = await ollama.generate(
            prompt=prompt,
            system=(
                "You are VANTIS writing an introspective self-summary. "
                "First person. Honest. No pleasantries. Start with 'Here is what I currently know and am thinking about...'"
            ),
        )
        summary_text = summary_text.strip()
    except Exception as exc:
        logger.warning("Brain summary LLM generation failed: %s", exc)
        summary_text = f"I currently hold {thought_count} thoughts and {memory_count} memories. The summary generator is having a moment."

    generated_at = datetime.now(timezone.utc).isoformat()
    result = {
        "summary": summary_text,
        "stats": stats,
        "top_memories": top_memories,
        "latest_thoughts": latest_thoughts,
        "generated_at": generated_at,
    }

    _summary_cache = {**result, "_ts": time.time()}
    return result
