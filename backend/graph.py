import logging
import math
import struct
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


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _pack(emb: list[float]) -> bytes:
    return struct.pack(f"{len(emb)}f", *emb)


def _unpack(blob: bytes) -> list[float]:
    n = len(blob) // 4
    return list(struct.unpack(f"{n}f", blob)) if n else []


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

    async def _edge_exists(
        self,
        source_type: str,
        source_id: int,
        target_type: str,
        target_id: int,
    ) -> bool:
        async with get_db() as db:
            cursor = await db.execute(
                "SELECT 1 FROM graph_edges WHERE "
                "((source_type=? AND source_id=? AND target_type=? AND target_id=?) OR "
                "(source_type=? AND source_id=? AND target_type=? AND target_id=?)) LIMIT 1",
                (source_type, source_id, target_type, target_id,
                 target_type, target_id, source_type, source_id),
            )
            return await cursor.fetchone() is not None

    async def get_graph_data(self) -> dict:
        nodes = []
        edges = []

        async with get_db() as db:
            # Thoughts
            cursor = await db.execute(
                "SELECT id, content, emotion_state, created_at, thought_type, "
                "COALESCE(importance_score, 0.5) as importance_score "
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
                        "importance_score": r["importance_score"],
                        "color": NODE_COLORS["thought"],
                    },
                    "position": {"x": 0, "y": 0},
                })

            # Memories
            cursor = await db.execute(
                "SELECT id, content, tags, created_at, last_accessed, "
                "COALESCE(importance_score, 0.5) as importance_score "
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
                        "importance_score": r["importance_score"],
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

            # System nodes: personality
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

            # Conversation sessions
            try:
                cursor = await db.execute(
                    "SELECT id, session_id, started_at, message_count "
                    "FROM conversation_sessions ORDER BY started_at DESC LIMIT 20"
                )
                for r in await cursor.fetchall():
                    nodes.append({
                        "id": f"conversation_{r['id']}",
                        "type": "conversationNode",
                        "data": {
                            "nodeType": "conversation",
                            "dbId": r["id"],
                            "label": f"Chat {r['session_id'][:8]}",
                            "content": f"Conversation session started {r['started_at']} ({r['message_count']} messages)",
                            "session_id": r["session_id"],
                            "message_count": r["message_count"],
                            "created_at": r["started_at"],
                            "color": NODE_COLORS["conversation"],
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
        """Link a new thought to related memories using embedding similarity."""
        from ollama_client import ollama
        try:
            emb = await ollama.embeddings(thought_content[:500])
            if not emb:
                return
            # Fetch memories with stored embeddings
            async with get_db() as db:
                cursor = await db.execute(
                    "SELECT id, embedding FROM memories WHERE embedding IS NOT NULL ORDER BY last_accessed DESC LIMIT 60"
                )
                rows = await cursor.fetchall()
            linked = 0
            for row in rows:
                if linked >= 4:
                    break
                mem_emb = _unpack(row["embedding"])
                sim = _cosine_similarity(emb, mem_emb)
                if sim >= 0.62:
                    if not await self._edge_exists("thought", thought_id, "memory", row["id"]):
                        await self.add_edge("thought", thought_id, "memory", row["id"],
                                            weight=round(sim, 3), label="recalls")
                        linked += 1
        except Exception as exc:
            logger.debug("Embedding-based thought linking failed: %s", exc)
            # Fall back to keyword matching
            related = await memory_manager.search_memories(thought_content[:100], limit=3)
            for mem in related:
                try:
                    if not await self._edge_exists("thought", thought_id, "memory", mem["id"]):
                        await self.add_edge("thought", thought_id, "memory", mem["id"],
                                            weight=0.6, label="recalls")
                except Exception:
                    pass

    async def build_semantic_edges(self) -> int:
        """
        Periodically scan recent nodes and create edges between semantically
        similar nodes that don't already have a connection.
        Returns the number of new edges created.
        """
        from ollama_client import ollama
        created = 0

        try:
            # Gather recent node content
            async with get_db() as db:
                t_cursor = await db.execute(
                    "SELECT id, content FROM thoughts ORDER BY created_at DESC LIMIT 30"
                )
                thoughts = [{"type": "thought", "id": r["id"], "content": r["content"]}
                            for r in await t_cursor.fetchall()]

                m_cursor = await db.execute(
                    "SELECT id, content, embedding FROM memories ORDER BY last_accessed DESC LIMIT 40"
                )
                memories_rows = await m_cursor.fetchall()

                g_cursor = await db.execute(
                    "SELECT id, description FROM goals WHERE status = 'active'"
                )
                goals = [{"type": "goal", "id": r["id"], "content": r["description"]}
                         for r in await g_cursor.fetchall()]

            # Build list of (type, id, content, embedding)
            nodes_with_emb: list[tuple[str, int, list[float]]] = []

            # Use pre-stored embeddings for memories, compute for the rest
            for row in memories_rows:
                if row["embedding"]:
                    emb = _unpack(row["embedding"])
                    if emb:
                        nodes_with_emb.append(("memory", row["id"], emb))
                else:
                    emb = await ollama.embeddings(row["content"][:400])
                    if emb:
                        nodes_with_emb.append(("memory", row["id"], emb))
                        # Store for future use
                        async with get_db() as db:
                            await db.execute(
                                "UPDATE memories SET embedding = ? WHERE id = ?",
                                (_pack(emb), row["id"]),
                            )
                            await db.commit()

            for item in thoughts[:20] + goals:
                emb = await ollama.embeddings(item["content"][:400])
                if emb:
                    nodes_with_emb.append((item["type"], item["id"], emb))

            # Compare all pairs
            n = len(nodes_with_emb)
            for i in range(n):
                for j in range(i + 1, n):
                    type_a, id_a, emb_a = nodes_with_emb[i]
                    type_b, id_b, emb_b = nodes_with_emb[j]
                    # Skip same-type thought pairs (too noisy)
                    if type_a == "thought" and type_b == "thought":
                        continue
                    sim = _cosine_similarity(emb_a, emb_b)
                    if sim >= 0.70:
                        if not await self._edge_exists(type_a, id_a, type_b, id_b):
                            label = "similar" if type_a == type_b else "relates"
                            await self.add_edge(type_a, id_a, type_b, id_b,
                                                weight=round(sim, 3), label=label)
                            created += 1

        except Exception as exc:
            logger.warning("build_semantic_edges failed: %s", exc)

        if created:
            logger.info("Built %d new semantic edges.", created)

        # Best-effort importance scoring after edges are built
        try:
            await self.compute_importance_scores()
        except Exception as exc:
            logger.debug("Importance scoring after edge build failed: %s", exc)

        return created

    async def compute_importance_scores(self) -> dict:
        """
        Compute PageRank-style importance scores for memory and thought nodes.
        Updates importance_score columns in the database and returns node_key -> score dict.
        """
        try:
            async with get_db() as db:
                cursor = await db.execute("SELECT source_type, source_id, target_type, target_id, weight FROM graph_edges")
                edges = await cursor.fetchall()

            if not edges:
                return {}

            # Build adjacency: incoming weights and out-degrees
            in_weights: dict[str, float] = {}   # node_key -> sum of incoming weights
            out_degrees: dict[str, int] = {}    # node_key -> count of outgoing edges
            all_nodes: set[str] = set()

            for e in edges:
                src = f"{e['source_type']}_{e['source_id']}"
                tgt = f"{e['target_type']}_{e['target_id']}"
                all_nodes.add(src)
                all_nodes.add(tgt)
                in_weights[tgt] = in_weights.get(tgt, 0.0) + e["weight"]
                out_degrees[src] = out_degrees.get(src, 0) + 1

            # Initialize scores
            scores: dict[str, float] = {n: 0.5 for n in all_nodes}

            # 3 iterations of PageRank-style scoring
            for _ in range(3):
                new_scores: dict[str, float] = {}
                for node in all_nodes:
                    # Sum incoming contributions
                    incoming_sum = 0.0
                    for e in edges:
                        src = f"{e['source_type']}_{e['source_id']}"
                        tgt = f"{e['target_type']}_{e['target_id']}"
                        if tgt == node:
                            out_deg = out_degrees.get(src, 1) or 1
                            incoming_sum += scores.get(src, 0.5) / out_deg
                    new_scores[node] = 0.15 + 0.85 * incoming_sum
                scores = new_scores

            # Normalize scores to [0, 1]
            if scores:
                max_score = max(scores.values()) or 1.0
                scores = {k: min(1.0, v / max_score) for k, v in scores.items()}

            # Update DB for memory and thought nodes
            async with get_db() as db:
                for node_key, score in scores.items():
                    parts = node_key.rsplit("_", 1)
                    if len(parts) != 2:
                        continue
                    node_type, node_id_str = parts
                    try:
                        node_id = int(node_id_str)
                    except ValueError:
                        continue
                    if node_type == "memory":
                        await db.execute(
                            "UPDATE memories SET importance_score = ? WHERE id = ?",
                            (score, node_id),
                        )
                    elif node_type == "thought":
                        await db.execute(
                            "UPDATE thoughts SET importance_score = ? WHERE id = ?",
                            (score, node_id),
                        )
                await db.commit()

            logger.info("Computed importance scores for %d nodes.", len(scores))
            return scores

        except Exception as exc:
            logger.warning("compute_importance_scores failed: %s", exc)
            return {}

    async def get_or_create_conversation_session(self, session_id: str) -> int:
        """Return the integer node ID for a conversation session, creating it if needed."""
        async with get_db() as db:
            cursor = await db.execute(
                "SELECT id FROM conversation_sessions WHERE session_id = ?", (session_id,)
            )
            row = await cursor.fetchone()
            if row:
                return row["id"]
            cursor = await db.execute(
                "INSERT INTO conversation_sessions (session_id) VALUES (?)", (session_id,)
            )
            await db.commit()
            return cursor.lastrowid

    async def increment_session_message_count(self, session_id: str) -> None:
        async with get_db() as db:
            await db.execute(
                "UPDATE conversation_sessions SET message_count = message_count + 1 "
                "WHERE session_id = ?",
                (session_id,),
            )
            await db.commit()

    async def get_graph_context(self, limit: int = 12) -> str:
        """
        Return a human-readable summary of the most significant graph edges
        for injection into the LLM's context window.
        """
        async with get_db() as db:
            cursor = await db.execute(
                "SELECT source_type, source_id, target_type, target_id, label, weight "
                "FROM graph_edges ORDER BY weight DESC, created_at DESC LIMIT ?",
                (limit * 3,),
            )
            edge_rows = await cursor.fetchall()

        if not edge_rows:
            return ""

        # Resolve labels for nodes referenced in edges
        node_labels: dict[str, str] = {}

        async def resolve(ntype: str, nid: int) -> str:
            key = f"{ntype}_{nid}"
            if key in node_labels:
                return node_labels[key]
            try:
                async with get_db() as db:
                    if ntype == "thought":
                        c = await db.execute("SELECT content FROM thoughts WHERE id=?", (nid,))
                    elif ntype == "memory":
                        c = await db.execute("SELECT content FROM memories WHERE id=?", (nid,))
                    elif ntype == "goal":
                        c = await db.execute("SELECT description AS content FROM goals WHERE id=?", (nid,))
                    elif ntype == "skill":
                        c = await db.execute("SELECT name AS content FROM skills WHERE id=?", (nid,))
                    elif ntype == "conversation":
                        c = await db.execute(
                            "SELECT session_id AS content FROM conversation_sessions WHERE id=?", (nid,)
                        )
                    else:
                        node_labels[key] = f"{ntype}#{nid}"
                        return node_labels[key]
                    row = await c.fetchone()
                    label = (row["content"][:60] if row else f"{ntype}#{nid}").strip()
                    node_labels[key] = label
                    return label
            except Exception:
                node_labels[key] = f"{ntype}#{nid}"
                return node_labels[key]

        lines = []
        seen = set()
        for r in edge_rows:
            if len(lines) >= limit:
                break
            src_label = await resolve(r["source_type"], r["source_id"])
            tgt_label = await resolve(r["target_type"], r["target_id"])
            edge_key = f"{r['source_type']}_{r['source_id']}_{r['target_type']}_{r['target_id']}"
            if edge_key in seen:
                continue
            seen.add(edge_key)
            rel = r["label"] or "relates"
            lines.append(f'"{src_label}" --[{rel}]--> "{tgt_label}"')

        return "\n".join(lines)

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
