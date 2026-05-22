import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


class EventCreate(BaseModel):
    title: str
    description: str = ""
    event_time: str  # ISO datetime string
    reminder_minutes: int = 15


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    event_time: Optional[str] = None
    reminder_minutes: Optional[int] = None


@router.get("/events")
async def list_events(user: dict = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM calendar_events WHERE owner = ? ORDER BY event_time ASC",
            (user["username"],)
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.post("/events")
async def create_event(data: EventCreate, user: dict = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "INSERT INTO calendar_events (title, description, event_time, reminder_minutes, owner) "
            "VALUES (?, ?, ?, ?, ?)",
            (data.title, data.description, data.event_time, data.reminder_minutes, user["username"])
        )
        await db.commit()
        return {"id": cursor.lastrowid, "status": "Event created."}


@router.put("/events/{event_id}")
async def update_event(event_id: int, data: EventUpdate, user: dict = Depends(get_current_user)):
    async with get_db() as db:
        cur = await db.execute("SELECT owner FROM calendar_events WHERE id = ?", (event_id,))
        row = await cur.fetchone()
        if not row or row["owner"] != user["username"]:
            raise HTTPException(403, "Not your event.")
        updates = {k: v for k, v in data.model_dump().items() if v is not None}
        for col, val in updates.items():
            await db.execute(f"UPDATE calendar_events SET {col} = ? WHERE id = ?", (val, event_id))
        await db.commit()
    return {"status": "Updated."}


@router.delete("/events/{event_id}")
async def delete_event(event_id: int, user: dict = Depends(get_current_user)):
    async with get_db() as db:
        await db.execute("DELETE FROM calendar_events WHERE id = ? AND owner = ?", (event_id, user["username"]))
        await db.commit()
    return {"status": "Event deleted."}


@router.get("/upcoming")
async def get_upcoming(hours: int = 24, user: dict = Depends(get_current_user)):
    """Get events in the next N hours (used for system prompt injection)."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM calendar_events WHERE owner = ? "
            "AND event_time BETWEEN datetime('now') AND datetime('now', ? || ' hours') "
            "ORDER BY event_time ASC",
            (user["username"], f"+{hours}")
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]
