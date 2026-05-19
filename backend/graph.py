import logging
from database import get_db
from memory import memory_manager

logger = logging.getLogger(__name__)

NODE_COLORS = {
    "thought": "#6366f1",
    "memory": "#10b981",
    "goal": "#f59e0b",
    "skill": "#a855f7",
    "system": "#ec4899",
    "conversation": "#3b82f6",
    "agent": "#ec4899",
    "self_conversation": "#8b5cf6",
}

GOAL_SHAPES = {
    "active": "roundedRectangle",
    "achieved": "diamond",
    "abandoned": "triangle",
}


class GraphManager:

    async def add_edge(
        self,
        source_type: str,
        source_id: int,
        target_type: str,
        target_id: int,
        weight: float = 1.0,
        label: str = "",
    ) -> int:
        async with get_db() as db:
            cursor = await db.execute(
                "INSERT INTO graph_edges "
                "(source_type, source_id, target_type, target_id, weight, label) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (source_type, source_id, target_type, target_id, weight, label),
            )
            await db.commit()
            return cursor.lastrowid

    async def get_graph_data(self) -> dict:
        nodes = []
        edges = []

        async with get_db() as db:
            # Thoughts
            cursor = await db.execute(
                "SELECT id, content, emotion_state, created_at, thought_type "
                "FROM thoughts ORDER BY created_at DESC LIMIT 100"
            )
            for r in await cursor.fetchall():
                nodes.append({
                    "id": f"thought_{r['id']}",
                    "type": "thoughtNode",
                    "data": {
                        "nodeType": "thought",
                        "dbId": r["id"],
                        "label": r["content"][:60] + ("..." if len(r["content"]) > 60 else ""),
                        "content": r["content"],
                        "emotion_state": r["emotion_state"],
                        "thought_type": r["thought_type"],
                        "created_at": r["created_at"],
                        "color": NODE_COLORS["thought"],
                    },
                    "position": {"x": 0, "y": 0},
                })

            # Memories
            cursor = await db.execute(
                "SELECT id, content, tags, created_at, last_accessed "
                "FROM memories ORDER BY last_accessed DESC LIMIT 80"
            )
            for r in await cursor.fetchall():
                nodes.append({
                    "id": f"memory_{r['id']}",
                    "type": "memoryNode",
                    "data": {
                        "nodeType": "memory",
                        "dbId": r["id"],
                        "label": r["content"][:60] + ("..." if len(r["content"]) > 60 else ""),
                        "content": r["content"],
                        "tags": r["tags"],
                        "created_at": r["created_at"],
                        "last_accessed": r["last_accessed"],
                        "color": NODE_COLORS["memory"],
                    },
                    "position": {"x": 0, "y": 0},
                })

            # Goals
            cursor = await db.execute("SELECT * FROM goals ORDER BY updated_at DESC")
            for r in await cursor.fetchall():
                nodes.append({
                    "id": f"goal_{r['id']}",
                    "type": "goalNode",
                    "data": {
                        "nodeType": "goal",
                        "dbId": r["id"],
                        "label": r["description"][:60] + ("..." if len(r["description"]) > 60 else ""),
                        "content": r["description"],
                        "status": r["status"],
                        "priority": r["priority"],
                        "progress": r["progress"],
                        "created_at": r["created_at"],
                        "color": NODE_COLORS["goal"],
                        "shape": GOAL_SHAPES.get(r["status"], "roundedRectangle"),
                    },
                    "position": {"x": 0, "y": 0},
                })

            # Skills (if table exists)
            try:
                cursor = await db.execute(
                    "SELECT id, name, description, is_builtin, enabled, use_count, last_used "
                    "FROM skills ORDER BY use_count DESC LIMIT 50"
                )
                for r in await cursor.fetchall():
                    nodes.append({
                        "id": f"skill_{r['id']}",
                        "type": "skillNode",
                        "data": {
                            "nodeType": "skill",
                            "dbId": r["id"],
                            "label": r["name"],
                            "content": r["description"],
                            "is_builtin": bool(r["is_builtin"]),
                            "enabled": bool(r["enabled"]),
                            "use_count": r["use_count"],
                            "last_used": r["last_used"],
                            "color": NODE_COLORS["skill"],
                        },
                        "position": {"x": 0, "y": 0},
                    })
            except Exception:
                pass

            # System nodes: personality, emotion, running agents
            try:
                cursor = await db.execute(
                    "SELECT id, version, created_at FROM personality_versions ORDER BY version DESC LIMIT 1"
                )
                pv = await cursor.fetchone()
                if pv:
                    nodes.append({
                        "id": "system_personality",
                        "type": "systemNode",
                        "data": {
                            "nodeType": "system",
                            "dbId": pv["id"],
                            "label": f"Personality v{pv['version']}",
                            "content": f"Active personality version {pv['version']}",
                            "sub_type": "personality",
                            "color": NODE_COLORS["system"],
                        },
                        "position": {"x": 0, "y": 0},
                    })
            except Exception:
                pass

            # Graph edges
            cursor = await db.execute("SELECT * FROM graph_edges")
            for r in await cursor.fetchall():
                edges.append({
                    "id": f"edge_{r['id']}",
                    "source": f"{r['source_type']}_{r['source_id']}",
                    "target": f"{r['target_type']}_{r['target_id']}",
                    "data": {
                        "weight": r["weight"],
                        "label": r["label"] or "",
                    },
                    "animated": r["weight"] > 0.7,
                })

        return {"nodes": nodes, "edges": edges}

    async def auto_link_thought(self, thought_id: int, thought_content: str) -> None:
        related = await memory_manager.search_memories(
            thought_content[:100], limit=3
        )
        for mem in related:
            try:
                await self.add_edge(
                    "thought", thought_id,
                    "memory", mem["id"],
                    weight=0.6,
                    label="recalls",
                )
            except Exception as exc:
                logger.debug("Auto-link failed: %s", exc)

    async def delete_node(self, node_type: str, node_id: int) -> None:
        async with get_db() as db:
            await db.execute(
                "DELETE FROM graph_edges WHERE "
                "(source_type = ? AND source_id = ?) OR "
                "(target_type = ? AND target_id = ?)",
                (node_type, node_id, node_type, node_id),
            )
            table_map = {
                "thought": "thoughts",
                "memory": "memories",
                "goal": "goals",
            }
            if node_type in table_map:
                await db.execute(
                    f"DELETE FROM {table_map[node_type]} WHERE id = ?", (node_id,)
                )
            await db.commit()

    async def get_node_connections(self, node_type: str, node_id: int) -> list[dict]:
        async with get_db() as db:
            cursor = await db.execute(
                "SELECT * FROM graph_edges WHERE "
                "(source_type = ? AND source_id = ?) OR "
                "(target_type = ? AND target_id = ?)",
                (node_type, node_id, node_type, node_id),
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]


graph_manager = GraphManager()
