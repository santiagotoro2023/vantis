import json
import logging
import math
import struct
from typing import Optional

from database import get_db
from ollama_client import ollama

logger = logging.getLogger(__name__)


def _cosine_similarity(a: list, b: list) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _unpack(blob: bytes) -> list:
    n = len(blob) // 4
    return list(struct.unpack(f"{n}f", blob)) if n else []


class MemoryManager:
    """Stores, retrieves, and consolidates VANTIS memories."""

    # ------------------------------------------------------------------
    # Storage
    # ------------------------------------------------------------------

    async def store_memory(
        self,
        content: str,
        emotion_snapshot: dict,
        tags: Optional[str] = None,
    ) -> int:
        """Persist a single memory and compute its embedding. Returns the new memory id."""
        import struct
        from ollama_client import ollama
        async with get_db() as db:
            cursor = await db.execute(
                "INSERT INTO memories (content, emotion_snapshot, tags) VALUES (?, ?, ?)",
                (content, json.dumps(emotion_snapshot), tags),
            )
            mem_id = cursor.lastrowid
            await db.commit()

        # Store embedding asynchronously (best-effort)
        try:
            emb = await ollama.embeddings(content[:400])
            if emb:
                blob = struct.pack(f"{len(emb)}f", *emb)
                async with get_db() as db:
                    await db.execute(
                        "UPDATE memories SET embedding = ? WHERE id = ?", (blob, mem_id)
                    )
                    await db.commit()
        except Exception as exc:
            logger.debug("Embedding storage failed for memory %d: %s", mem_id, exc)

        return mem_id

    # ------------------------------------------------------------------
    # Retrieval
    # ------------------------------------------------------------------

    async def search_memories(self, query: str, limit: int = 10) -> list[dict]:
        """Text-based memory search using LIKE on content and tags."""
        pattern = f"%{query}%"
        async with get_db() as db:
            cursor = await db.execute(
                """
                SELECT id, content, emotion_snapshot, tags, created_at, last_accessed
                FROM memories
                WHERE content LIKE ? OR tags LIKE ?
                ORDER BY last_accessed DESC
                LIMIT ?
                """,
                (pattern, pattern, limit),
            )
            rows = await cursor.fetchall()
            results = []
            for r in rows:
                await self.update_last_accessed(r["id"])
                results.append(self._row_to_dict(r))
            return results

    async def get_recent_memories(self, limit: int = 20) -> list[dict]:
        """Return the most recently accessed memories."""
        async with get_db() as db:
            cursor = await db.execute(
                """
                SELECT id, content, emotion_snapshot, tags, created_at, last_accessed
                FROM memories
                ORDER BY last_accessed DESC
                LIMIT ?
                """,
                (limit,),
            )
            rows = await cursor.fetchall()
            return [self._row_to_dict(r) for r in rows]

    async def update_last_accessed(self, memory_id: int) -> None:
        """Update the last_accessed timestamp for a memory."""
        async with get_db() as db:
            await db.execute(
                "UPDATE memories SET last_accessed = datetime('now') WHERE id = ?",
                (memory_id,),
            )
            await db.commit()

    # ------------------------------------------------------------------
    # Extraction
    # ------------------------------------------------------------------

    async def extract_and_store(
        self,
        text: str,
        emotion: dict,
        source: str,
        source_node_type: Optional[str] = None,
        source_node_id: Optional[int] = None,
    ) -> None:
        """
        Ask the LLM to identify key facts and entities in the provided text.
        Each extracted fact is stored as a separate memory entry.
        If source_node_type/source_node_id are provided, provenance edges are created.
        """
        from graph import graph_manager
        prompt = (
            f"Source: {source}\n\n"
            f"Text:\n{text}\n\n"
            "Extract the key facts, entities, observations, and concepts from this text. "
            "Return a JSON array of short, self-contained memory strings. "
            "Each string should be a complete, useful fact on its own. "
            "Maximum 5 memories. Minimum 1.\n\n"
            'Example: ["DNS stands for Domain Name System.", "User is debugging nginx config."]'
        )
        try:
            raw = await ollama.generate(
                prompt=prompt,
                system=(
                    "You are a precise fact extractor. "
                    "Return only valid JSON arrays. No commentary."
                ),
            )
            raw = raw.strip()
            start = raw.find("[")
            end = raw.rfind("]") + 1
            if start == -1 or end == 0:
                logger.warning("Memory extraction returned no parseable array.")
                return
            memories: list[str] = json.loads(raw[start:end])
            tags = f"source:{source}"
            for mem in memories:
                if isinstance(mem, str) and mem.strip():
                    mem_id = await self.store_memory(mem.strip(), emotion, tags)
                    if source_node_type and source_node_id and mem_id:
                        try:
                            await graph_manager.add_edge(
                                source_node_type, source_node_id,
                                "memory", mem_id,
                                weight=0.9, label="extracted_from",
                            )
                        except Exception as exc:
                            logger.debug("Provenance edge failed: %s", exc)
        except Exception as exc:
            logger.warning("Memory extraction failed: %s", exc)

    # ------------------------------------------------------------------
    # Consolidation
    # ------------------------------------------------------------------

    async def consolidate_memories(self) -> None:
        """
        Merge memories that are near-duplicates or highly related.
        Uses LLM to identify pairs, then combines them.
        """
        async with get_db() as db:
            cursor = await db.execute(
                "SELECT id, content FROM memories ORDER BY created_at DESC LIMIT 200"
            )
            rows = await cursor.fetchall()

        if len(rows) < 5:
            return

        # Build a numbered list for the LLM to reason about
        numbered = "\n".join(
            f"{r['id']}: {r['content'][:120]}" for r in rows
        )
        prompt = (
            "Here is a numbered list of VANTIS memories:\n\n"
            f"{numbered}\n\n"
            "Identify pairs of memories that are near-duplicates or should be merged. "
            "Return a JSON array of objects like: "
            '[{"keep_id": 1, "remove_id": 2, "merged_content": "..."}, ...]\n'
            "Only include pairs that genuinely benefit from merging. "
            "Return an empty array if none qualify."
        )
        try:
            raw = await ollama.generate(
                prompt=prompt,
                system="You are a memory consolidation engine. Return only valid JSON.",
            )
            raw = raw.strip()
            start = raw.find("[")
            end = raw.rfind("]") + 1
            if start == -1 or end == 0:
                return
            merges: list[dict] = json.loads(raw[start:end])

            async with get_db() as db:
                for merge in merges:
                    keep_id = merge.get("keep_id")
                    remove_id = merge.get("remove_id")
                    merged_content = merge.get("merged_content", "")
                    if not all([keep_id, remove_id, merged_content]):
                        continue
                    await db.execute(
                        "UPDATE memories SET content = ?, last_accessed = datetime('now') "
                        "WHERE id = ?",
                        (merged_content, keep_id),
                    )
                    await db.execute("DELETE FROM memories WHERE id = ?", (remove_id,))
                await db.commit()
            logger.info("Consolidated %d memory pairs.", len(merges))
        except Exception as exc:
            logger.warning("Memory consolidation failed: %s", exc)

    # ------------------------------------------------------------------
    # Semantic search
    # ------------------------------------------------------------------

    async def semantic_search(self, query: str, limit: int = 5) -> list[dict]:
        """Embedding-based semantic memory search. Falls back to text search if embeddings unavailable."""
        try:
            emb = await ollama.embeddings(query[:400])
            if not emb:
                raise ValueError("No embedding returned")

            async with get_db() as db:
                cursor = await db.execute(
                    "SELECT id, content, emotion_snapshot, tags, created_at, last_accessed, embedding "
                    "FROM memories WHERE embedding IS NOT NULL "
                    "ORDER BY COALESCE(importance_score, 0.5) DESC LIMIT 200"
                )
                rows = await cursor.fetchall()

            scored = []
            for row in rows:
                mem_emb = _unpack(row["embedding"])
                sim = _cosine_similarity(emb, mem_emb)
                if sim >= 0.55:
                    scored.append((sim, row))

            scored.sort(key=lambda x: x[0], reverse=True)
            top = scored[:limit]

            results = []
            for _, row in top:
                await self.update_last_accessed(row["id"])
                results.append(self._row_to_dict(row))
            return results

        except Exception as exc:
            logger.debug("Semantic search fell back to text search: %s", exc)
            return await self.search_memories(query, limit)

    # ------------------------------------------------------------------
    # Memory decay
    # ------------------------------------------------------------------

    async def decay_irrelevant_memories(self) -> int:
        """
        Delete memories that are VERY conservatively selected for removal.
        All conditions must be met: low importance, no edges, old, not protected by tags.
        """
        protected_tags = ["creator_profile", "correction", "synthesis"]
        deleted = 0
        try:
            async with get_db() as db:
                cursor = await db.execute(
                    "SELECT id, tags FROM memories "
                    "WHERE COALESCE(importance_score, 0.5) < 0.15 "
                    "AND julianday('now') - julianday(last_accessed) > 90"
                )
                candidates = await cursor.fetchall()

            for row in candidates:
                tags = row["tags"] or ""
                if any(pt in tags for pt in protected_tags):
                    continue
                # Check no graph edges reference this memory
                async with get_db() as db:
                    edge_cursor = await db.execute(
                        "SELECT COUNT(*) FROM graph_edges WHERE "
                        "(source_type='memory' AND source_id=?) OR "
                        "(target_type='memory' AND target_id=?)",
                        (row["id"], row["id"]),
                    )
                    edge_count = (await edge_cursor.fetchone())[0]
                if edge_count > 0:
                    continue
                # Delete this memory
                async with get_db() as db:
                    await db.execute("DELETE FROM memories WHERE id = ?", (row["id"],))
                    await db.commit()
                deleted += 1

            if deleted:
                logger.info("Memory decay: deleted %d irrelevant memories.", deleted)
        except Exception as exc:
            logger.warning("decay_irrelevant_memories failed: %s", exc)

        return deleted

    # ------------------------------------------------------------------
    # Correction learning
    # ------------------------------------------------------------------

    async def store_correction(self, user_msg: str, assistant_response: str, emotion: dict) -> None:
        """Store a user correction as a high-importance memory."""
        try:
            content = f"CORRECTION: User corrected VANTIS. User said: {user_msg[:200]}"
            mem_id = await self.store_memory(content, emotion, "source:correction,high_priority")
            if mem_id:
                async with get_db() as db:
                    await db.execute(
                        "UPDATE memories SET importance_score = 0.9 WHERE id = ?",
                        (mem_id,),
                    )
                    await db.commit()
                logger.info("Stored correction memory id=%d", mem_id)
        except Exception as exc:
            logger.warning("store_correction failed: %s", exc)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _row_to_dict(row) -> dict:
        emotion_snapshot = {}
        try:
            if row["emotion_snapshot"]:
                emotion_snapshot = json.loads(row["emotion_snapshot"])
        except (json.JSONDecodeError, TypeError):
            pass
        return {
            "id": row["id"],
            "content": row["content"],
            "emotion_snapshot": emotion_snapshot,
            "tags": row["tags"],
            "created_at": row["created_at"],
            "last_accessed": row["last_accessed"],
        }


# Module-level singleton
memory_manager = MemoryManager()
