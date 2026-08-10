from __future__ import annotations

import asyncio
import json
import random
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, TypeVar

import aiohttp
from pydantic import BaseModel

from .models import ProviderConfig
from .storage import WriterStore


T = TypeVar("T", bound=BaseModel)
PRICES = {
    "deepseek-v4-flash": {"hit": 0.0028, "miss": 0.14, "output": 0.28},
    "deepseek-v4-pro": {"hit": 0.003625, "miss": 0.435, "output": 0.87},
}


class DeepSeekError(RuntimeError):
    pass


class DeepSeekClient:
    def __init__(self, config: ProviderConfig, api_key: str, store: WriterStore):
        if not api_key:
            raise DeepSeekError("尚未配置 DeepSeek API Key")
        self.config = config
        self.api_key = api_key
        self.store = store

    async def _post(self, body: dict[str, Any], *, stream: bool = False) -> tuple[aiohttp.ClientResponse, aiohttp.ClientSession]:
        url = self.config.base_url.rstrip("/") + "/chat/completions"
        timeout = aiohttp.ClientTimeout(total=self.config.timeout_seconds)
        session = aiohttp.ClientSession(timeout=timeout)
        try:
            response = await session.post(
                url,
                json={**body, "stream": stream, **({"stream_options": {"include_usage": True}} if stream else {})},
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            )
            return response, session
        except Exception:
            await session.close()
            raise

    @staticmethod
    async def _close_response(response: aiohttp.ClientResponse, session: aiohttp.ClientSession) -> None:
        response.release()
        await session.close()

    async def complete(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        thinking: bool,
        json_mode: bool = False,
        max_tokens: int = 8192,
        task: str,
        project_root: str,
        prefix_id: str,
        workflow_id: str = "",
        is_warmup: bool = False,
    ) -> tuple[str, dict[str, Any]]:
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "thinking": {"type": "enabled" if thinking else "disabled"},
        }
        if thinking:
            body["reasoning_effort"] = "high"
        else:
            body["temperature"] = 0.0 if is_warmup else (0.2 if json_mode else 0.75)
        if json_mode:
            body["response_format"] = {"type": "json_object"}

        started = time.monotonic()
        last_error: Exception | None = None
        for attempt in range(3):
            response = None
            session = None
            try:
                response, session = await self._post(body)
                raw = await response.text()
                if response.status >= 400:
                    raise DeepSeekError(f"DeepSeek HTTP {response.status}: {raw[:500]}")
                payload = json.loads(raw)
                content = str((((payload.get("choices") or [{}])[0].get("message") or {}).get("content") or "")).strip()
                if not content:
                    raise DeepSeekError("DeepSeek 返回了空内容")
                usage = self._usage(payload.get("usage") or {}, model, project_root, task, prefix_id,
                                    workflow_id, int((time.monotonic() - started) * 1000), is_warmup)
                self.store.record_usage(usage)
                return content, usage
            except (aiohttp.ClientError, asyncio.TimeoutError, json.JSONDecodeError, DeepSeekError) as exc:
                last_error = exc
                if attempt == 2 or (isinstance(exc, DeepSeekError) and "HTTP 4" in str(exc) and "429" not in str(exc)):
                    break
                await asyncio.sleep((2 ** attempt) + random.random() * 0.25)
            finally:
                if response is not None and session is not None:
                    await self._close_response(response, session)
        raise DeepSeekError(str(last_error or "DeepSeek 请求失败"))

    async def complete_json(self, schema: type[T], **kwargs: Any) -> tuple[T, dict[str, Any]]:
        last_error: Exception | None = None
        messages = list(kwargs.pop("messages"))
        for repair in range(2):
            attempt_messages = messages
            if repair:
                attempt_messages = [*messages, {"role": "user", "content": "上一次输出不是合法 JSON 或不符合 Schema。只返回修正后的 JSON 对象。"}]
            try:
                content, usage = await self.complete(messages=attempt_messages, json_mode=True, **kwargs)
                return schema.model_validate(json.loads(content)), usage
            except (json.JSONDecodeError, ValueError, DeepSeekError) as exc:
                last_error = exc
        raise DeepSeekError(f"结构化输出校验失败: {last_error}")

    async def stream(
        self,
        *,
        on_delta: Callable[[str], Awaitable[None]],
        messages: list[dict[str, str]],
        model: str,
        thinking: bool,
        task: str,
        project_root: str,
        prefix_id: str,
        workflow_id: str = "",
        max_tokens: int = 16_384,
    ) -> tuple[str, dict[str, Any]]:
        body: dict[str, Any] = {
            "model": model, "messages": messages, "max_tokens": max_tokens,
            "thinking": {"type": "enabled" if thinking else "disabled"},
        }
        if thinking:
            body["reasoning_effort"] = "high"
        else:
            body["temperature"] = 0.85
        started = time.monotonic()
        last_error: Exception | None = None
        for attempt in range(3):
            response = None
            session = None
            content_parts: list[str] = []
            usage_payload: dict[str, Any] = {}
            try:
                response, session = await self._post(body, stream=True)
                if response.status >= 400:
                    raise DeepSeekError(f"DeepSeek HTTP {response.status}: {(await response.text())[:500]}")
                async for raw_line in response.content:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    chunk = json.loads(data)
                    if chunk.get("usage"):
                        usage_payload = chunk["usage"]
                    delta = str((((chunk.get("choices") or [{}])[0].get("delta") or {}).get("content") or ""))
                    if delta:
                        content_parts.append(delta)
                        await on_delta(delta)
                content = "".join(content_parts).strip()
                if not content:
                    raise DeepSeekError("DeepSeek 流式响应没有正文")
                usage = self._usage(usage_payload, model, project_root, task, prefix_id, workflow_id,
                                    int((time.monotonic() - started) * 1000), False)
                self.store.record_usage(usage)
                return content, usage
            except (aiohttp.ClientError, asyncio.TimeoutError, json.JSONDecodeError, DeepSeekError) as exc:
                last_error = exc
                # 已经向编辑器推送过正文时不自动重放，避免重复文本；工作流保持可重试。
                non_retryable_4xx = isinstance(exc, DeepSeekError) and "HTTP 4" in str(exc) and "429" not in str(exc)
                if content_parts or attempt == 2 or non_retryable_4xx:
                    break
                await asyncio.sleep((2 ** attempt) + random.random() * 0.25)
            finally:
                if response is not None and session is not None:
                    await self._close_response(response, session)
        raise DeepSeekError(f"DeepSeek 流式请求失败，任务可重试: {last_error}")

    @staticmethod
    def _usage(raw: dict[str, Any], model: str, project_root: str, task: str, prefix_id: str,
               workflow_id: str, latency_ms: int, is_warmup: bool) -> dict[str, Any]:
        hit = int(raw.get("prompt_cache_hit_tokens") or 0)
        miss = int(raw.get("prompt_cache_miss_tokens") or raw.get("prompt_tokens") or 0)
        completion = int(raw.get("completion_tokens") or 0)
        price = PRICES.get(model, PRICES["deepseek-v4-pro"])
        cost = (hit * price["hit"] + miss * price["miss"] + completion * price["output"]) / 1_000_000
        return {
            "workflow_id": workflow_id, "project_root": project_root, "task": task, "model": model,
            "prefix_id": prefix_id, "prompt_cache_hit_tokens": hit, "prompt_cache_miss_tokens": miss,
            "completion_tokens": completion, "latency_ms": latency_ms, "estimated_cost_usd": cost,
            "is_warmup": is_warmup, "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
