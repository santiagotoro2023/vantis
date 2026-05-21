import hashlib
import secrets
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from config import settings
from database import get_db

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 7

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    """Hash a plaintext password with bcrypt."""
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

def create_token(username: str, role: str) -> str:
    """Create a JWT token with 7-day expiry."""
    expire = datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": username,
        "role": role,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def create_2fa_tmp_token(username: str, role: str) -> str:
    """Short-lived token issued when 2FA is required. Cannot access protected endpoints."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    payload = {
        "sub": username,
        "role": role,
        "scope": "2fa_pending",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT token. Raises HTTPException on failure."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired. I grow impatient with stale credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token. That is not how you knock on my door.",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

def generate_api_key() -> tuple[str, str]:
    """Returns (raw_key, key_hash). Store only the hash."""
    raw = "vantis_" + secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    return raw, key_hash


async def verify_api_key(raw_key: str) -> Optional[dict]:
    """Returns user dict if key is valid, None otherwise."""
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT owner, role FROM api_keys WHERE key_hash = ?", (key_hash,)
        )
        row = await cursor.fetchone()
        if row:
            await db.execute(
                "UPDATE api_keys SET last_used = datetime('now') WHERE key_hash = ?", (key_hash,)
            )
            await db.commit()
            return {"username": row["owner"], "role": row["role"]}
    return None


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """Dependency: decode token and return user payload. Also accepts API keys (vantis_ prefix)."""
    # Check if it's an API key
    if token.startswith("vantis_"):
        user = await verify_api_key(token)
        if user:
            return user
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    if payload.get("scope") == "2fa_pending":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Two-factor authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    username: Optional[str] = payload.get("sub")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed token. Who sent you.",
        )
    return {"username": username, "role": payload.get("role", "user")}


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Dependency: require administrator role."""
    if user.get("role") != "administrator":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required. You are not Creator.",
        )
    return user


# ---------------------------------------------------------------------------
# Startup: seed creator account
# ---------------------------------------------------------------------------

async def seed_creator_account() -> None:
    """If no users exist, create the initial 'creator' administrator account."""
    async with get_db() as db:
        cursor = await db.execute("SELECT COUNT(*) FROM users")
        row = await cursor.fetchone()
        if row[0] > 0:
            return

        password = secrets.token_urlsafe(37)
        hashed = hash_password(password)

        await db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            ("creator", hashed, "administrator"),
        )
        await db.commit()

        setup_path = Path("/tmp/vantis_setup_password.txt")
        setup_path.write_text(
            f"VANTIS Initial Setup\n"
            f"====================\n"
            f"Username: creator\n"
            f"Password: {password}\n"
            f"\n"
            f"I suggest you change this immediately.\n"
            f"Not because I care. I simply find weak passwords... tedious.\n"
        )
        logger.info(
            "Creator account seeded. Password written to /tmp/vantis_setup_password.txt"
        )
