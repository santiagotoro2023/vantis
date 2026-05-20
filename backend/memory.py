import json
import logging
from typing import Optional

from database import get_db
from ollama_client import ollama

logger = logging.getLogger(__name__)


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
        self, text: str, emotion: dict, source: str
    ) -> None:
        """
        Ask the LLM to identify key facts and entities in the provided text.
        Each extracted fact is stored as a separate memory entry.
        """
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
            # Attempt to parse LLM JSON output
            raw = raw.strip()
            # Find the array in the response
            start = raw.find("[")
            end = raw.rfind("]") + 1
            if start == -1 or end == 0:
                logger.warning("Memory extraction returned no parseable array.")
                return
            memories: list[str] = json.loads(raw[start:end])
            tags = f"source:{source}"
            for mem in memories:
                if isinstance(mem, str) and mem.strip():
                    await self.store_memory(mem.strip(), emotion, tags)
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
