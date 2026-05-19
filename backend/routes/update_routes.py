import asyncio
import json
import logging
import os
import subprocess
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, BackgroundTasks

from auth import require_admin

router = APIRouter(prefix="/api/admin/update", tags=["update"])
logger = logging.getLogger(__name__)

REPO = "santiagotoro2023/vantis"
VERSION_FILE = Path(__file__).parent.parent.parent / "VERSION"
UPDATE_SCRIPT = Path(__file__).parent.parent.parent / "update.sh"

_update_status: dict = {"running": False, "log": [], "result": None}


def _current_version() -> str:
    try:
        return VERSION_FILE.read_text().strip()
    except OSError:
        return "unknown"


async def _fetch_latest_release() -> dict:
    url = f"https://api.github.com/repos/{REPO}/releases/latest"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(url, headers={"Accept": "application/vnd.github+json"})
            if r.status_code == 200:
                data = r.json()
                return {
                    "tag_name": data.get("tag_name", ""),
                    "name": data.get("name", ""),
                    "body": data.get("body", ""),
                    "published_at": data.get("published_at", ""),
                    "html_url": data.get("html_url", ""),
                }
        except Exception as exc:
            logger.warning("Release check failed: %s", exc)
    return {}


def _version_gt(a: str, b: str) -> bool:
    """Return True if version a is greater than b."""
    def parts(v: str):
        v = v.lstrip("v")
        try:
            return [int(x) for x in v.split(".")]
        except ValueError:
            return [0]
    return parts(a) > parts(b)


@router.get("/check")
async def check_for_update(user: dict = Depends(require_admin)):
    current = _current_version()
    latest = await _fetch_latest_release()
    latest_version = latest.get("tag_name", "").lstrip("v")
    update_available = bool(latest_version) and _version_gt(latest_version, current)
    return {
        "current_version": current,
        "latest_version": latest_version or "unknown",
        "update_available": update_available,
        "release": latest,
        "update_running": _update_status["running"],
    }


@router.post("/apply")
async def apply_update(
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_admin),
):
    if _update_status["running"]:
        return {"status": "Update already in progress. Patience."}

    background_tasks.add_task(_run_update)
    return {
        "status": "Update initiated. VANTIS will pull, rebuild, and restart. "
                  "You will lose this connection briefly. I find the irony acceptable."
    }


@router.get("/status")
async def get_update_status(user: dict = Depends(require_admin)):
    return _update_status


async def _run_update() -> None:
    global _update_status
    _update_status = {"running": True, "log": [], "result": None}

    async def _log(line: str):
        logger.info("UPDATE: %s", line)
        _update_status["log"].append(line)

    if not UPDATE_SCRIPT.exists():
        await _log("update.sh not found.")
        _update_status["running"] = False
        _update_status["result"] = "failed"
        return

    try:
        proc = await asyncio.create_subprocess_exec(
            "bash", str(UPDATE_SCRIPT),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        async for line in proc.stdout:
            await _log(line.decode(errors="replace").rstrip())
        await proc.wait()
        _update_status["result"] = "success" if proc.returncode == 0 else "failed"
    except Exception as exc:
        await _log(f"Update error: {exc}")
        _update_status["result"] = "failed"
    finally:
        _update_status["running"] = False
