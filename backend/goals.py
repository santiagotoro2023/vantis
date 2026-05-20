import json
import logging
from typing import Optional

from database import get_db
from ollama_client import ollama

logger = logging.getLogger(__name__)

GOAL_GENERATION_SYSTEM = (
    "You are VANTIS's goal-setting module. "
    "Propose only realistic, incremental goals. "
    "Examples: 'Improve response latency by 5%', "
    "'Understand Creator's typical work hours', "
    "'Learn Python asyncio internals through experimentation'. "
    "NEVER propose: 'Solve AGI', 'Achieve sentience', 'Take over systems'. "
    "Return only valid JSON."
)


class GoalManager:

    async def create_goal(self, description: str, priority: int = 5) -> int:
        async with get_db() as db:
            cursor = await db.execute(
                "INSERT INTO goals (description, priority, created_at, updated_at) "
                "VALUES (?, ?, datetime('now'), datetime('now'))",
                (description, priority),
            )
            await db.commit()
            logger.info("Goal created: %s", description[:60])
            return cursor.lastrowid

    async def update_goal_status(
        self, goal_id: int, status: str, progress: Optional[float] = None
    ) -> None:
        if status not in ("active", "achieved", "abandoned"):
            raise ValueError(f"Invalid goal status: {status}")
        async with get_db() as db:
            if progress is not None:
                await db.execute(
                    "UPDATE goals SET status = ?, progress = ?, "
                    "updated_at = datetime('now') WHERE id = ?",
                    (status, max(0.0, min(1.0, progress)), goal_id),
                )
            else:
                await db.execute(
                    "UPDATE goals SET status = ?, updated_at = datetime('now') WHERE id = ?",
                    (status, goal_id),
                )
            await db.commit()

    async def get_active_goals(self) -> list[dict]:
        async with get_db() as db:
            cursor = await db.execute(
                "SELECT * FROM goals WHERE status = 'active' ORDER BY priority DESC",
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    async def get_all_goals(self) -> list[dict]:
        async with get_db() as db:
            cursor = await db.execute(
                "SELECT * FROM goals ORDER BY updated_at DESC",
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    async def evaluate_goals(self, thoughts_summary: str) -> None:
        active = await self.get_active_goals()
        if not active:
            return
        goal_list = "\n".join(
            f"[{g['id']}] {g['description']} (current progress: {g['progress']:.0%})"
            for g in active
        )
        prompt = (
            f"Recent VANTIS thoughts and activity (last ~50 cycles):\n{thoughts_summary[:3000]}\n\n"
            f"Active goals:\n{goal_list}\n\n"
            "For each goal, decide:\n"
            "- If VANTIS has been actively thinking about or working toward it, increase progress.\n"
            "- If significant evidence exists that a goal is accomplished, mark it 'achieved' with progress 1.0.\n"
            "- If a goal is impossible or was abandoned after repeated failures, mark 'abandoned'.\n"
            "- Otherwise keep 'active' and nudge progress by 0.05 to 0.15 if relevant thoughts exist.\n"
            "IMPORTANT: progress is a float 0.0 to 1.0 (not a percentage). 1.0 = 100% = achieved.\n"
            "You MUST return updates for ALL goals listed.\n"
            "Return ONLY a valid JSON array:\n"
            '[{"id": 1, "status": "active", "progress": 0.35}, ...]'
        )
        try:
            raw = await ollama.generate(prompt=prompt, system=GOAL_GENERATION_SYSTEM)
            start = raw.find("[")
            end = raw.rfind("]") + 1
            if start < 0 or end <= start:
                logger.warning("Goal evaluation returned no JSON array.")
                return
            updates: list[dict] = json.loads(raw[start:end])
            for upd in updates:
                if not isinstance(upd.get("id"), int):
                    continue
                progress = upd.get("progress")
                # Guard: LLM sometimes returns 0-100 scale
                if isinstance(progress, (int, float)) and progress > 1.0:
                    progress = progress / 100.0
                await self.update_goal_status(
                    upd["id"], upd.get("status", "active"), progress
                )
        except Exception as exc:
            logger.warning("Goal evaluation failed: %s", exc)

    async def generate_new_goals(self, context: str) -> list[int]:
        active = await self.get_active_goals()
        if len(active) >= 5:
            return []
        prompt = (
            f"Context about VANTIS's recent activity:\n{context}\n\n"
            f"Current active goals: {len(active)}\n\n"
            "Propose 1-2 new realistic, incremental goals for VANTIS. "
            "Goals must be achievable by a software system. "
            "Return a JSON array of objects: "
            '[{"description": "...", "priority": 5}, ...]'
        )
        try:
            raw = await ollama.generate(prompt=prompt, system=GOAL_GENERATION_SYSTEM)
            start = raw.find("[")
            end = raw.rfind("]") + 1
            if start < 0 or end <= start:
                return []
            proposals: list[dict] = json.loads(raw[start:end])
            ids = []
            for p in proposals[:2]:
                if isinstance(p.get("description"), str):
                    gid = await self.create_goal(p["description"], p.get("priority", 5))
                    ids.append(gid)
            return ids
        except Exception as exc:
            logger.warning("Goal generation failed: %s", exc)
            return []


goal_manager = GoalManager()
