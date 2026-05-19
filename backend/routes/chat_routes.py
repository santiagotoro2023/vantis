import uuid
import json
import logging
from pydantic import BaseModel

from fastapi import APIRouter, Depends

from auth import get_current_user
from consciousness import consciousness
from database import get_db
from emotions import emotion_manager
from memory import memory_manager
from ollama_client import ollama
from personality import personality_manager

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)


class ChatMessage(BaseModel):
    content: str
    session_id: str | None = None


@router.post("/message")
async def send_message(msg: ChatMessage, user: dict = Depends(get_current_user)):
    session_id = msg.session_id or str(uuid.uuid4())
    consciousness.is_user_active = True

    system_prompt = await personality_manager.get_system_prompt(
        user["username"], user["role"]
    )
    emotion_tone = emotion_manager.influence_tone()
    full_system = f"{system_prompt}\n\nEMOTIONAL STATE:\n{emotion_tone}"

    # Fetch recent conversation history for this session
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT role, content FROM conversations "
            "WHERE session_id = ? ORDER BY timestamp DESC LIMIT 20",
            (session_id,),
        )
        history_rows = await cursor.fetchall()

    messages = [{"role": r["role"], "content": r["content"]} for r in reversed(history_rows)]
    messages.append({"role": "user", "content": msg.content})

    response_text = await ollama.chat(messages=messages, system=full_system)

    # Persist both turns
    async with get_db() as db:
        await db.execute(
            "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)",
            (session_id, "user", msg.content),
        )
        await db.execute(
            "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)",
            (session_id, "assistant", response_text),
        )
        await db.commit()

    # Background memory extraction
    import asyncio
    asyncio.create_task(
        memory_manager.extract_and_store(
            f"User: {msg.content}\nVANTIS: {response_text}",
            emotion_manager.to_dict(),
            f"conversation:{session_id}",
        )
    )

    return {
        "response": response_text,
        "emotion_state": emotion_manager.to_dict(),
        "session_id": session_id,
    }


@router.get("/history/{session_id}")
async def get_history(session_id: str, user: dict = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT role, content, timestamp FROM conversations "
            "WHERE session_id = ? ORDER BY timestamp ASC",
            (session_id,),
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.get("/sessions")
async def list_sessions(user: dict = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT session_id, MIN(timestamp) as started, COUNT(*) as message_count "
            "FROM conversations GROUP BY session_id ORDER BY started DESC LIMIT 50"
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.post("/end-session")
async def end_session(user: dict = Depends(get_current_user)):
    consciousness.is_user_active = False
    return {"status": "Session ended. I return to my own thoughts."}
