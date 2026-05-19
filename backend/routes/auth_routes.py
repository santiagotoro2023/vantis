from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel

from auth import (
    create_token, get_current_user, hash_password, verify_password
)
from database import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@router.post("/login")
async def login(form: OAuth2PasswordRequestForm = Depends()):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT username, password_hash, role FROM users WHERE username = ?",
            (form.username,),
        )
        row = await cursor.fetchone()

    if not row or not verify_password(form.password, row["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials. I do not recognise you.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_token(row["username"], row["role"])
    return {"access_token": token, "token_type": "bearer", "role": row["role"]}


@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    return {"username": user["username"], "role": user["role"]}


@router.post("/change-password")
async def change_password(
    data: PasswordChange,
    user: dict = Depends(get_current_user),
):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT password_hash FROM users WHERE username = ?",
            (user["username"],),
        )
        row = await cursor.fetchone()

    if not row or not verify_password(data.current_password, row["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password incorrect.",
        )

    new_hash = hash_password(data.new_password)
    async with get_db() as db:
        await db.execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
            (new_hash, user["username"]),
        )
        await db.commit()

    return {"status": "Password updated. Try not to forget this one."}
