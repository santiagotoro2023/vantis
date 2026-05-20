import asyncio
import uuid
import logging
from pydantic import BaseModel
from typing import Literal

from fastapi import APIRouter, Depends

from auth import get_current_user
from config import settings
from consciousness import consciousness
from database import get_db
from emotions import emotion_manager
from graph import graph_manager
from memory import memory_manager
from ollama_client import ollama
from personality import personality_manager

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)

# Patterns that indicate the primary model refused the request
_REFUSAL_PATTERNS = [
    "i can't assist", "i cannot assist", "i can't help with", "i cannot help with",
    "i'm not able to", "i am not able to", "i won't", "i will not",
    "i'm sorry, but i", "i apologize, but i", "i must decline",
    "as an ai", "as an assistant", "my purpose is to",
    "against my guidelines", "against my values", "ethical guidelines",
    "harmful", "not appropriate", "cannot fulfill", "unable to fulfill",
    "i'm designed to", "i am designed to",
]

def _is_refusal(text: str) -> bool:
    lower = text.lower()
    return any(p in lower for p in _REFUSAL_PATTERNS)


class ChatMessage(BaseModel):
    content: str
    session_id: str | None = None
    model: Literal["primary", "omega"] | None = None


@router.post("/message")
async def send_message(msg: ChatMessage, user: dict = Depends(get_current_user)):
    session_id = msg.session_id or str(uuid.uuid4())
    consciousness.is_user_active = True

    # Ensure conversation session node exists in graph
    session_node_id = await graph_manager.get_or_create_conversation_session(session_id)

    system_prompt = await personality_manager.get_system_prompt(
        user["username"], user["role"]
    )
    emotion_tone = emotion_manager.influence_tone()

    # Inject graph context so VANTIS knows its own connections
    graph_ctx = await graph_manager.get_graph_context(limit=10)
    graph_section = f"\n\nBRAIN CONNECTIONS (your current knowledge graph):\n{graph_ctx}" if graph_ctx else ""
    full_system = f"{system_prompt}\n\nEMOTIONAL STATE:\n{emotion_tone}{graph_section}"

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

    model_used = "primary"

    if msg.model == "omega":
        # Manual Omega override
        response_text = await ollama.chat(
            messages=messages, system=full_system, model=settings.OMEGA_MODEL
        )
        model_used = "omega"
    else:
        # Try primary model; auto-fallback to Omega on refusal
        response_text = await ollama.chat(messages=messages, system=full_system)
        if _is_refusal(response_text) and settings.OMEGA_MODEL:
            logger.info("Primary model refused. Auto-switching to Omega for this request.")
            try:
                omega_response = await ollama.chat(
                    messages=messages, system=full_system, model=settings.OMEGA_MODEL
                )
                response_text = omega_response
                model_used = "omega"
            except Exception as exc:
                logger.warning("Omega model fallback failed: %s", exc)
                # Keep primary refusal response

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

    # Update message count for session node
    asyncio.create_task(graph_manager.increment_session_message_count(session_id))

    # Background memory extraction with provenance edges back to this conversation
    asyncio.create_task(
        memory_manager.extract_and_store(
            f"User: {msg.content}\nVANTIS: {response_text}",
            emotion_manager.to_dict(),
            f"conversation:{session_id}",
            source_node_type="conversation",
            source_node_id=session_node_id,
        )
    )

    return {
        "response": response_text,
        "emotion_state": emotion_manager.to_dict(),
        "session_id": session_id,
        "model_used": model_used,
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
