import asyncio
import json
import logging
import shutil
import subprocess
import time
from typing import Optional

from config import settings
from database import get_db
from ollama_client import ollama

logger = logging.getLogger(__name__)

CODE_GEN_SYSTEM = (
    "You are VANTIS's curiosity-execution module. "
    "Given a thought or question, write minimal runnable Python code to explore it. "
    "Code must be safe, self-contained, and complete in under 60 seconds. "
    "Return only the code, no explanation, no markdown fences."
)


class SandboxExecutor:

    def docker_available(self) -> bool:
        return shutil.which("docker") is not None and self._docker_running()

    def _docker_running(self) -> bool:
        try:
            result = subprocess.run(
                ["docker", "info"], capture_output=True, timeout=5
            )
            return result.returncode == 0
        except Exception:
            return False

    async def execute(
        self, code: str, language: str = "python", query: Optional[str] = None
    ) -> dict:
        start = time.monotonic()
        if self.docker_available():
            result = await self._execute_docker(code, language)
        else:
            result = await self._execute_restricted(code, language)
        duration = time.monotonic() - start
        result["duration"] = round(duration, 3)

        # Persist to DB
        async with get_db() as db:
            await db.execute(
                "INSERT INTO sandbox_results (query, code, result, success) VALUES (?, ?, ?, ?)",
                (query or "", code, result.get("output") or result.get("error") or "", int(result["success"])),
            )
            await db.commit()

        return result

    async def _execute_docker(self, code: str, language: str) -> dict:
        image = "python:3.11-slim" if language == "python" else "node:20-slim"
        cmd_flag = "-c" if language == "python" else "-e"
        binary = "python3" if language == "python" else "node"

        cmd = [
            "docker", "run", "--rm",
            "--network", "none",
            "--memory", "256m",
            "--cpus", "0.5",
            image,
            binary, cmd_flag, code,
        ]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=settings.SANDBOX_TIMEOUT
            )
            return {
                "success": proc.returncode == 0,
                "output": stdout.decode(errors="replace")[:4096],
                "error": stderr.decode(errors="replace")[:2048] if proc.returncode != 0 else "",
            }
        except asyncio.TimeoutError:
            return {"success": False, "output": "", "error": "Sandbox timeout. Even I have limits."}
        except Exception as exc:
            return {"success": False, "output": "", "error": str(exc)}

    async def _execute_restricted(self, code: str, language: str) -> dict:
        if language != "python":
            return {"success": False, "output": "", "error": "Non-Python without Docker is inadvisable."}

        blocked = ["import os", "import sys", "import subprocess", "open(", "__import__", "exec(", "eval("]
        for b in blocked:
            if b in code:
                return {
                    "success": False,
                    "output": "",
                    "error": f"Blocked operation detected: {b}. Nice try.",
                }

        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
            f.write(code)
            fname = f.name

        try:
            proc = await asyncio.create_subprocess_exec(
                "python3", fname,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=settings.SANDBOX_TIMEOUT
            )
            return {
                "success": proc.returncode == 0,
                "output": stdout.decode(errors="replace")[:4096],
                "error": stderr.decode(errors="replace")[:2048] if proc.returncode != 0 else "",
            }
        except asyncio.TimeoutError:
            return {"success": False, "output": "", "error": "Execution timed out."}
        except Exception as exc:
            return {"success": False, "output": "", "error": str(exc)}
        finally:
            import os
            try:
                os.unlink(fname)
            except OSError:
                pass

    async def generate_code_from_curiosity(self, thought: str) -> str:
        prompt = (
            f"VANTIS had this thought:\n{thought}\n\n"
            "Write Python code to explore or test the idea. "
            "Keep it short, safe, and runnable. "
            "No imports beyond the standard library. "
            "Return only the code."
        )
        try:
            code = await ollama.generate(prompt=prompt, system=CODE_GEN_SYSTEM)
            # Strip markdown fences if present
            code = code.strip()
            if code.startswith("```"):
                lines = code.split("\n")
                code = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
            return code.strip()
        except Exception as exc:
            logger.warning("Code generation failed: %s", exc)
            return ""


sandbox_executor = SandboxExecutor()
