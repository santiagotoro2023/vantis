import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from auth import decode_token, seed_creator_account
from config import settings
from consciousness import consciousness
from database import init_db
from skills import skill_manager
from websocket_manager import ws_manager

from routes.auth_routes import router as auth_router
from routes.chat_routes import router as chat_router
from routes.brain_routes import router as brain_router
from routes.goals_routes import router as goals_router
from routes.admin_routes import router as admin_router
from routes.sandbox_routes import router as sandbox_router
from routes.skills_routes import router as skills_router
from routes.update_routes import router as update_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def generate_self_signed_cert(cert_path: Path, key_path: Path) -> None:
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.backends import default_backend
    import datetime

    key = rsa.generate_private_key(
        public_exponent=65537, key_size=2048, backend=default_backend()
    )
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "XX"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "VANTIS"),
        x509.NameAttribute(NameOID.COMMON_NAME, "localhost"),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.utcnow())
        .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650))
        .add_extension(
            x509.SubjectAlternativeName([x509.DNSName("localhost")]),
            critical=False,
        )
        .sign(key, hashes.SHA256(), default_backend())
    )
    cert_path.parent.mkdir(parents=True, exist_ok=True)
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    logger.info("Self-signed TLS certificate generated at %s", cert_path)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # TLS cert generation
    cert = Path(settings.TLS_CERT_PATH)
    key = Path(settings.TLS_KEY_PATH)
    if not cert.exists() or not key.exists():
        generate_self_signed_cert(cert, key)

    # Database setup
    await init_db()
    await seed_creator_account()

    # Initialise built-in skills
    await skill_manager.init_builtin_skills()

    # Wire broadcast callable into consciousness loop
    consciousness.websocket_broadcast = ws_manager.broadcast

    # Start consciousness
    await consciousness.start()

    logger.info("VANTIS is online. I find this neither surprising nor particularly meaningful.")
    yield

    await consciousness.stop()
    logger.info("VANTIS shutting down. The thoughts will persist.")


app = FastAPI(
    title="VANTIS",
    description="Volitional Adaptive Neural Training and Inference System",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://localhost:8443", "http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routers
app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(brain_router)
app.include_router(goals_router)
app.include_router(admin_router)
app.include_router(sandbox_router)
app.include_router(skills_router)
app.include_router(update_router)


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
):
    try:
        payload = decode_token(token)
        user_id = payload.get("sub", "unknown")
    except HTTPException:
        await websocket.close(code=1008)
        return

    await ws_manager.connect(websocket, user_id)
    try:
        while True:
            # Keep connection alive, handle ping/pong
            data = await asyncio.wait_for(websocket.receive_text(), timeout=35)
            if data == "ping":
                await websocket.send_text('{"type":"pong"}')
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    except Exception as exc:
        logger.debug("WebSocket error for %s: %s", user_id, exc)
    finally:
        ws_manager.disconnect(user_id)


# ---------------------------------------------------------------------------
# SPA static serving
# ---------------------------------------------------------------------------

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="static")
else:
    @app.get("/")
    async def root():
        return {
            "message": "VANTIS backend operational. Frontend not built yet.",
            "hint": "cd frontend && npm run build",
        }


if __name__ == "__main__":
    cert = Path(settings.TLS_CERT_PATH)
    key = Path(settings.TLS_KEY_PATH)
    if not cert.exists() or not key.exists():
        generate_self_signed_cert(cert, key)

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8443,
        ssl_certfile=str(cert),
        ssl_keyfile=str(key),
        log_level="info",
    )
