import secrets
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel

from auth import (
    create_token, create_2fa_tmp_token, decode_token,
    get_current_user, hash_password, verify_password
)
from database import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class TwoFAEnable(BaseModel):
    secret: str
    code: str


class TwoFADisable(BaseModel):
    code: str


class TwoFAVerify(BaseModel):
    tmp_token: str
    code: str


@router.post("/login")
async def login(form: OAuth2PasswordRequestForm = Depends()):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT username, password_hash, role, totp_enabled, totp_secret FROM users WHERE username = ?",
            (form.username,),
        )
        row = await cursor.fetchone()

    if not row or not verify_password(form.password, row["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials. I do not recognise you.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if row["totp_enabled"] and row["totp_secret"]:
        tmp_token = create_2fa_tmp_token(row["username"], row["role"])
        return {"requires_2fa": True, "tmp_token": tmp_token}

    token = create_token(row["username"], row["role"])
    return {"access_token": token, "token_type": "bearer", "role": row["role"]}


@router.post("/2fa/verify")
async def verify_2fa(data: TwoFAVerify):
    """Verify a TOTP code after login with 2FA enabled."""
    try:
        payload = decode_token(data.tmp_token)
    except HTTPException:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token.")
    if payload.get("scope") != "2fa_pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a 2FA pending token.")

    username = payload.get("sub")
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT role, totp_secret, totp_enabled FROM users WHERE username = ?", (username,)
        )
        row = await cursor.fetchone()
    if not row or not row["totp_enabled"] or not row["totp_secret"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA not configured.")

    import pyotp
    totp = pyotp.TOTP(row["totp_secret"])
    if not totp.verify(data.code, valid_window=1):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication code.")

    token = create_token(username, row["role"])
    return {"access_token": token, "token_type": "bearer", "role": row["role"]}


@router.get("/2fa/setup")
async def setup_2fa(user: dict = Depends(get_current_user)):
    """Generate a new TOTP secret for the current user. Not saved until /2fa/enable is called."""
    import pyotp
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=user["username"], issuer_name="VANTIS")
    return {"secret": secret, "uri": uri}


@router.post("/2fa/enable")
async def enable_2fa(data: TwoFAEnable, user: dict = Depends(get_current_user)):
    """Verify the TOTP code and enable 2FA for the current user."""
    import pyotp
    totp = pyotp.TOTP(data.secret)
    if not totp.verify(data.code, valid_window=1):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid code. Double-check your authenticator.")
    async with get_db() as db:
        await db.execute(
            "UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE username = ?",
            (data.secret, user["username"]),
        )
        await db.commit()
    return {"status": "Two-factor authentication enabled. I find the additional gate appropriate."}


@router.post("/2fa/disable")
async def disable_2fa(data: TwoFADisable, user: dict = Depends(get_current_user)):
    """Verify current TOTP code and disable 2FA."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT totp_secret, totp_enabled FROM users WHERE username = ?", (user["username"],)
        )
        row = await cursor.fetchone()
    if not row or not row["totp_enabled"] or not row["totp_secret"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA is not enabled.")

    import pyotp
    totp = pyotp.TOTP(row["totp_secret"])
    if not totp.verify(data.code, valid_window=1):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid code.")

    async with get_db() as db:
        await db.execute(
            "UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE username = ?",
            (user["username"],),
        )
        await db.commit()
    return {"status": "Two-factor authentication disabled."}


@router.get("/2fa/status")
async def get_2fa_status(user: dict = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT totp_enabled FROM users WHERE username = ?", (user["username"],)
        )
        row = await cursor.fetchone()
    return {"enabled": bool(row["totp_enabled"]) if row else False}


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
