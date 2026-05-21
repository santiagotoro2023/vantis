import asyncio
import json
import uuid
import logging
from pydantic import BaseModel
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

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


CORRECTION_PATTERNS = [
    "no, actually", "that's wrong", "that is wrong", "you're wrong", "you are wrong",
    "not correct", "incorrect", "that's not right", "actually,", "wrong,",
    "you said", "you told me", "that's not", "that isn't",
]


def _is_correction(text: str) -> bool:
    lower = text.lower()
    return any(p in lower for p in CORRECTION_PATTERNS)


class ChatMessage(BaseModel):
    content: str
    session_id: str | None = None
    model: Literal["primary", "omega"] | None = None


@router.post("/message")
async def send_message(msg: ChatMessage, user: dict = Depends(get_current_user)):
    session_id = msg.session_id or str(uuid.uuid4())
    consciousness.is_user_active = True

    # Ensure conversation session node exists in graph
    session_node_id = await graph_manager.get_or_create_conversation_session(session_id, owner=user["username"])

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

    # Semantic memory injection: search for relevant memories before generating
    try:
        relevant_mems = await memory_manager.semantic_search(msg.content, limit=5, owner=user["username"])
        if relevant_mems:
            mem_ctx = "\n".join(f"- {m['content'][:120]}" for m in relevant_mems)
            full_system = full_system + "\n\nRELEVANT MEMORIES:\n" + mem_ctx
    except Exception as exc:
        logger.debug("Semantic memory injection failed: %s", exc)

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
            owner=user["username"],
        )
    )

    # Detect and store corrections
    if _is_correction(msg.content):
        asyncio.create_task(
            memory_manager.store_correction(msg.content, response_text, emotion_manager.to_dict(), owner=user["username"])
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
            "SELECT c.session_id, MIN(c.timestamp) as started, COUNT(*) as message_count, "
            "cs.name as name "
            "FROM conversations c "
            "LEFT JOIN conversation_sessions cs ON cs.session_id = c.session_id "
            "WHERE cs.owner = ? OR cs.owner IS NULL "
            "GROUP BY c.session_id ORDER BY started DESC LIMIT 50",
            (user["username"],),
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.get("/sessions/search")
async def search_sessions(
    q: str = "",
    user: dict = Depends(get_current_user),
):
    """Search conversation sessions by message content."""
    if not q.strip():
        return []
    pattern = f"%{q}%"
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT session_id, MIN(timestamp) as started, COUNT(*) as message_count, "
            "MAX(CASE WHEN content LIKE ? THEN content ELSE NULL END) as snippet "
            "FROM conversations WHERE content LIKE ? "
            "GROUP BY session_id ORDER BY started DESC LIMIT 20",
            (pattern, pattern),
        )
        rows = await cursor.fetchall()
    results = []
    for r in rows:
        snippet = str(r["snippet"] or "")[:100]
        results.append({
            "session_id": r["session_id"],
            "started": r["started"],
            "message_count": r["message_count"],
            "snippet": snippet,
        })
    return results


class SessionNameUpdate(BaseModel):
    name: str


@router.put("/sessions/{session_id}/name")
async def rename_session(
    session_id: str,
    data: SessionNameUpdate,
    user: dict = Depends(get_current_user),
):
    """Rename a conversation session."""
    async with get_db() as db:
        await db.execute(
            "CREATE TABLE IF NOT EXISTS conversation_sessions "
            "(session_id TEXT PRIMARY KEY, name TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
        )
        await db.execute(
            "INSERT INTO conversation_sessions (session_id, name) VALUES (?, ?) "
            "ON CONFLICT(session_id) DO UPDATE SET name = excluded.name",
            (session_id, data.name),
        )
        await db.commit()
    return {"status": "Renamed. A label on a jar does not change what is inside."}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, user: dict = Depends(get_current_user)):
    """Delete a conversation session and all its messages."""
    async with get_db() as db:
        await db.execute("DELETE FROM conversations WHERE session_id = ?", (session_id,))
        await db.execute("DELETE FROM conversation_sessions WHERE session_id = ?", (session_id,))
        await db.commit()
    return {"status": "Session deleted."}


@router.post("/stream")
async def stream_message(msg: ChatMessage, user: dict = Depends(get_current_user)):
    """Streaming version of send_message. Returns Server-Sent Events."""
    session_id = msg.session_id or str(uuid.uuid4())
    consciousness.is_user_active = True

    session_node_id = await graph_manager.get_or_create_conversation_session(session_id, owner=user["username"])

    system_prompt = await personality_manager.get_system_prompt(
        user["username"], user["role"]
    )
    emotion_tone = emotion_manager.influence_tone()

    graph_ctx = await graph_manager.get_graph_context(limit=10)
    graph_section = f"\n\nBRAIN CONNECTIONS (your current knowledge graph):\n{graph_ctx}" if graph_ctx else ""
    full_system = f"{system_prompt}\n\nEMOTIONAL STATE:\n{emotion_tone}{graph_section}"

    async with get_db() as db:
        cursor = await db.execute(
            "SELECT role, content FROM conversations "
            "WHERE session_id = ? ORDER BY timestamp DESC LIMIT 20",
            (session_id,),
        )
        history_rows = await cursor.fetchall()

    messages = [{"role": r["role"], "content": r["content"]} for r in reversed(history_rows)]
    messages.append({"role": "user", "content": msg.content})

    try:
        relevant_mems = await memory_manager.semantic_search(msg.content, limit=5, owner=user["username"])
        if relevant_mems:
            mem_ctx = "\n".join(f"- {m['content'][:120]}" for m in relevant_mems)
            full_system = full_system + "\n\nRELEVANT MEMORIES:\n" + mem_ctx
    except Exception as exc:
        logger.debug("Semantic memory injection failed: %s", exc)

    async def generate():
        full_text = ""
        stream_error: str | None = None
        try:
            async for chunk in ollama.chat_stream(messages=messages, system=full_system):
                full_text += chunk
                payload = json.dumps({"token": chunk, "session_id": session_id})
                yield f"data: {payload}\n\n"
        except Exception as exc:
            stream_error = str(exc)
            logger.warning("Streaming error: %s", exc)
            yield f"data: {json.dumps({'error': stream_error, 'session_id': session_id})}\n\n"

        yield f"data: {json.dumps({'done': True, 'full_text': full_text, 'session_id': session_id, 'error': stream_error})}\n\n"

        # Persist conversation
        try:
            async with get_db() as db:
                await db.execute(
                    "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)",
                    (session_id, "user", msg.content),
                )
                await db.execute(
                    "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)",
                    (session_id, "assistant", full_text),
                )
                await db.commit()
        except Exception as exc:
            logger.warning("Failed to persist streamed conversation: %s", exc)

        asyncio.create_task(graph_manager.increment_session_message_count(session_id))

        asyncio.create_task(
            memory_manager.extract_and_store(
                f"User: {msg.content}\nVANTIS: {full_text}",
                emotion_manager.to_dict(),
                f"conversation:{session_id}",
                source_node_type="conversation",
                source_node_id=session_node_id,
                owner=user["username"],
            )
        )

        if _is_correction(msg.content):
            asyncio.create_task(
                memory_manager.store_correction(msg.content, full_text, emotion_manager.to_dict(), owner=user["username"])
            )

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/end-session")
async def end_session(user: dict = Depends(get_current_user)):
    consciousness.is_user_active = False
    return {"status": "Session ended. I return to my own thoughts."}
