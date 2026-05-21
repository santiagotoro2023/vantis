import asyncio
import io
import logging
import threading
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from auth import get_current_user

router = APIRouter(prefix="/api/tts", tags=["tts"])
logger = logging.getLogger(__name__)

# GLaDOS-style voice: clear, measured, professional American female.
# "af_bella" is calm, authoritative — closest to GLaDOS's cadence.
_VOICE = "af_bella"
_SPEED = 0.88          # Slightly slower — deliberate, unhurried
_LANG  = "en-us"

_kokoro = None
_kokoro_lock = threading.Lock()
_kokoro_ready = False


def _get_kokoro():
    """Lazy singleton — loads model once, thread-safe."""
    global _kokoro, _kokoro_ready
    if _kokoro_ready:
        return _kokoro
    with _kokoro_lock:
        if _kokoro_ready:
            return _kokoro
        try:
            from kokoro_onnx import Kokoro
            try:
                _kokoro = Kokoro()      # kokoro-onnx < 0.4
            except TypeError:
                # kokoro-onnx >= 0.4 requires explicit paths — download them first
                import os, urllib.request
                model_path = os.path.expanduser("~/.cache/kokoro/kokoro-v0_19.onnx")
                voices_path = os.path.expanduser("~/.cache/kokoro/voices.bin")
                os.makedirs(os.path.dirname(model_path), exist_ok=True)
                if not os.path.exists(model_path):
                    urllib.request.urlretrieve(
                        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/kokoro-v0_19.onnx",
                        model_path,
                    )
                if not os.path.exists(voices_path):
                    urllib.request.urlretrieve(
                        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/voices.bin",
                        voices_path,
                    )
                _kokoro = Kokoro(model_path, voices_path)
            _kokoro_ready = True
            logger.info("Kokoro TTS model loaded.")
        except Exception as exc:
            logger.error("Failed to load Kokoro TTS: %s", exc)
            _kokoro = None
        return _kokoro


def _synthesise(text: str) -> bytes:
    """Run synthesis in the current thread, return WAV bytes."""
    k = _get_kokoro()
    if k is None:
        raise RuntimeError("TTS model not available.")
    samples, sample_rate = k.create(text, voice=_VOICE, speed=_SPEED, lang=_LANG)
    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV")
    return buf.getvalue()


async def _async_synthesise(text: str) -> bytes:
    """Run synthesis in a thread pool so it doesn't block the event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _synthesise, text)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

class TTSRequest(BaseModel):
    text: str


@router.post("/speak")
async def speak(req: TTSRequest, user: dict = Depends(get_current_user)):
    """Synthesise up to 400 chars and return a WAV file."""
    text = req.text.strip()[:400]
    if not text:
        raise HTTPException(status_code=400, detail="No text provided.")
    try:
        wav = await asyncio.wait_for(_async_synthesise(text), timeout=30)
        return Response(content=wav, media_type="audio/wav")
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="TTS timed out.")
    except Exception as exc:
        logger.warning("TTS /speak error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/sentence")
async def speak_sentence(req: TTSRequest, user: dict = Depends(get_current_user)):
    """
    Synthesise a single short sentence (≤200 chars).
    Called per-sentence during streaming so audio starts before the full
    response is complete.
    """
    text = req.text.strip()[:200]
    if not text:
        raise HTTPException(status_code=400, detail="No text provided.")
    try:
        wav = await asyncio.wait_for(_async_synthesise(text), timeout=15)
        return Response(content=wav, media_type="audio/wav",
                        headers={"Cache-Control": "no-store"})
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="TTS timed out.")
    except Exception as exc:
        logger.warning("TTS /sentence error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
