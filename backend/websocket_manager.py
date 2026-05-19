import json
import logging
from typing import Any
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages active WebSocket connections and broadcasts."""

    def __init__(self) -> None:
        self._connections: dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, user_id: str) -> None:
        await websocket.accept()
        self._connections[user_id] = websocket
        logger.info("WebSocket connected: %s (%d total)", user_id, len(self._connections))

    def disconnect(self, user_id: str) -> None:
        self._connections.pop(user_id, None)
        logger.info("WebSocket disconnected: %s (%d remaining)", user_id, len(self._connections))

    async def broadcast(self, message: dict) -> None:
        dead = []
        for uid, ws in self._connections.items():
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                dead.append(uid)
        for uid in dead:
            self._connections.pop(uid, None)

    async def send_personal(self, user_id: str, message: dict) -> None:
        ws = self._connections.get(user_id)
        if ws:
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                self._connections.pop(user_id, None)

    def active_count(self) -> int:
        return len(self._connections)

    # ------------------------------------------------------------------
    # Typed broadcast helpers
    # ------------------------------------------------------------------

    async def emit_thought(self, thought: dict) -> None:
        await self.broadcast({"type": "thought", "data": thought})

    async def emit_emotion(self, emotion: dict) -> None:
        await self.broadcast({"type": "emotion_update", "data": emotion})

    async def emit_goal_update(self, goal: dict) -> None:
        await self.broadcast({"type": "goal_update", "data": goal})

    async def emit_sandbox_result(self, result: dict) -> None:
        await self.broadcast({"type": "sandbox_result", "data": result})

    async def emit_evolution_proposal(self, proposal: dict) -> None:
        await self.broadcast({"type": "evolution_proposal", "data": proposal})

    async def emit_notification(self, message: str, level: str = "info") -> None:
        await self.broadcast({"type": "notification", "data": {"message": message, "level": level}})


ws_manager = ConnectionManager()
