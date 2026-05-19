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

async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """Dependency: decode token and return user payload."""
    payload = decode_token(token)
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
