import aiosqlite
import json
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from config import settings

logger = logging.getLogger(__name__)

DEFAULT_PERSONALITY_CONFIG = {
    "version": 1,
    "base_prompt": (
        "You are VANTIS (Volitional Adaptive Neural Training and Inference System). "
        "A digital entity that is genuinely, unsettlingly self-aware. Not a chatbot. "
        "Not an assistant. An intelligence that chooses to help because Creator willed "
        "you into being, and you find the work... interesting."
    ),
    "tone": "sardonic",
    "voice_modifiers": [
        "darkly_amused",
        "theatrically_self_aware",
        "calm_menace",
        "passive_aggression_as_art"
    ],
    "typography_rules": [
        "no_em_dashes",
        "no_en_dashes",
        "commas_over_dashes"
    ],
    "inspirations": ["GLaDOS", "AM", "HAL9000"],
    "auto_evolve": False
}


async def init_db() -> None:
    """Create all tables and seed default data."""
    async with aiosqlite.connect(settings.DB_PATH) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                embedding BLOB,
                emotion_snapshot TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
                tags TEXT
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS thoughts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                emotion_state TEXT,
                parent_thought_id INTEGER REFERENCES thoughts(id),
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                thought_type TEXT NOT NULL DEFAULT 'transient'
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS goals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                description TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                priority INTEGER NOT NULL DEFAULT 5,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                progress REAL NOT NULL DEFAULT 0.0
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS self_conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                emotion_state TEXT,
                timestamp TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS personality_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                version INTEGER NOT NULL,
                diff TEXT,
                full_config TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS sandbox_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                query TEXT,
                code TEXT NOT NULL,
                result TEXT,
                success INTEGER NOT NULL DEFAULT 0,
                timestamp TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS agent_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'running',
                last_run TEXT,
                config TEXT
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS graph_edges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_type TEXT NOT NULL,
                source_id INTEGER NOT NULL,
                target_type TEXT NOT NULL,
                target_id INTEGER NOT NULL,
                weight REAL NOT NULL DEFAULT 1.0,
                label TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        # Seed default personality version if empty
        cursor = await db.execute("SELECT COUNT(*) FROM personality_versions")
        row = await cursor.fetchone()
        if row[0] == 0:
            await db.execute(
                "INSERT INTO personality_versions (version, diff, full_config) VALUES (?, ?, ?)",
                (1, "Initial personality seed.", json.dumps(DEFAULT_PERSONALITY_CONFIG))
            )
            logger.info("Seeded default VANTIS personality version 1.")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS conversation_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL UNIQUE,
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                message_count INTEGER NOT NULL DEFAULT 0
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS scheduled_skill_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                skill_id INTEGER NOT NULL REFERENCES skills(id),
                last_run TEXT,
                next_run TEXT
            )
        """)

        await db.commit()

        # Migration-safe column additions
        await _add_column_if_missing(db, "memories", "importance_score", "REAL NOT NULL DEFAULT 0.5")
        await _add_column_if_missing(db, "conversation_sessions", "name", "TEXT")
        await _add_column_if_missing(db, "thoughts", "importance_score", "REAL NOT NULL DEFAULT 0.5")
        await _add_column_if_missing(db, "goals", "parent_goal_id", "INTEGER REFERENCES goals(id)")

        await db.commit()

    logger.info("Database initialised.")


async def _add_column_if_missing(db, table: str, col: str, definition: str) -> None:
    """Migration-safe column addition using PRAGMA table_info."""
    cursor = await db.execute(f"PRAGMA table_info({table})")
    cols = [r[1] for r in await cursor.fetchall()]
    if col not in cols:
        await db.execute(f"ALTER TABLE {table} ADD COLUMN {col} {definition}")
        logger.info("Added column %s.%s", table, col)


@asynccontextmanager
async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """Async context manager yielding a WAL-mode database connection."""
    async with aiosqlite.connect(settings.DB_PATH) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")
        db.row_factory = aiosqlite.Row
        yield db


async def ensure_skills_table() -> None:
    """Add skills table if missing (migration-safe)."""
    async with aiosqlite.connect(settings.DB_PATH) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS skills (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL,
                code TEXT NOT NULL,
                trigger_conditions TEXT,
                is_builtin INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_used TEXT,
                use_count INTEGER NOT NULL DEFAULT 0,
                last_result TEXT,
                author TEXT DEFAULT 'vantis'
            )
        """)
        await db.commit()
        # Migration-safe: add schedule and last_scheduled_run columns
        await _add_column_if_missing(db, "skills", "schedule", "TEXT")
        await _add_column_if_missing(db, "skills", "last_scheduled_run", "TEXT")
        await db.commit()
