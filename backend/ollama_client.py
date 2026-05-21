import json
import logging
from typing import AsyncGenerator, Optional, AsyncIterator

import httpx

from config import settings

logger = logging.getLogger(__name__)

GENERATE_TIMEOUT = 120.0
EMBED_TIMEOUT = 60.0
CHAT_TIMEOUT = 120.0


class OllamaClient:
    """Async HTTP client wrapping the Ollama API."""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=settings.OLLAMA_BASE_URL,
            timeout=httpx.Timeout(GENERATE_TIMEOUT),
        )
        self.model = settings.OLLAMA_MODEL

    # ------------------------------------------------------------------
    # Core methods
    # ------------------------------------------------------------------

    async def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        stream: bool = False,
    ) -> "str | AsyncGenerator[str, None]":
        """
        Call the Ollama /api/generate endpoint.
        Returns full string when stream=False, async generator when stream=True.
        """
        payload: dict = {
            "model": self.model,
            "prompt": prompt,
            "stream": stream,
            "keep_alive": "24h",
        }
        if system:
            payload["system"] = system

        if not stream:
            response = await self._client.post(
                "/api/generate",
                json=payload,
                timeout=GENERATE_TIMEOUT,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("response", "")

        # Streaming path -- return async generator
        async def _stream_gen() -> AsyncGenerator[str, None]:
            async with self._client.stream(
                "POST", "/api/generate", json=payload, timeout=GENERATE_TIMEOUT
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk = json.loads(line)
                        token = chunk.get("response", "")
                        if token:
                            yield token
                        if chunk.get("done", False):
                            break
                    except json.JSONDecodeError:
                        continue

        return _stream_gen()

    async def chat(
        self,
        messages: list[dict],
        system: Optional[str] = None,
        model: Optional[str] = None,
    ) -> str:
        """
        Call the Ollama /api/chat endpoint with a messages list.
        Optionally injects a system message at the front.
        Pass model to override the default.
        """
        full_messages = []
        if system:
            full_messages.append({"role": "system", "content": system})
        full_messages.extend(messages)

        payload = {
            "model": model or self.model,
            "messages": full_messages,
            "stream": False,
            "keep_alive": "24h",
        }

        response = await self._client.post(
            "/api/chat",
            json=payload,
            timeout=CHAT_TIMEOUT,
        )
        response.raise_for_status()
        data = response.json()
        return data.get("message", {}).get("content", "")

    async def chat_stream(
        self,
        messages: list[dict],
        system: Optional[str] = None,
        model: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """Streaming version of chat(). Yields text chunks as they arrive."""
        full_messages = []
        if system:
            full_messages.append({"role": "system", "content": system})
        full_messages.extend(messages)
        payload = {
            "model": model or self.model,
            "messages": full_messages,
            "stream": True,
            "keep_alive": "24h",
        }
        async with self._client.stream("POST", "/api/chat", json=payload, timeout=CHAT_TIMEOUT) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                try:
                    chunk = json.loads(line)
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        yield token
                    if chunk.get("done", False):
                        break
                except json.JSONDecodeError:
                    continue

    async def embeddings(self, text: str) -> list[float]:
        """
        Call the Ollama /api/embeddings endpoint.
        Returns a list of floats, or empty list on failure.
        """
        payload = {
            "model": self.model,
            "prompt": text,
            "keep_alive": "24h",
        }
        try:
            response = await self._client.post(
                "/api/embeddings",
                json=payload,
                timeout=EMBED_TIMEOUT,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("embedding", [])
        except Exception as exc:
            logger.warning("Embedding request failed: %s", exc)
            return []

    async def health_check(self) -> bool:
        """Return True if the Ollama API is reachable."""
        try:
            response = await self._client.get("/", timeout=5.0)
            return response.status_code < 500
        except Exception:
            return False

    async def close(self) -> None:
        await self._client.aclose()


# Module-level singleton
ollama = OllamaClient()
