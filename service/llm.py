# -*- coding: utf-8 -*-
"""LLM provider 抽象：把"可配置 API"落到实处。

支持两种协议，覆盖绝大多数中转站与官方端点：
- `openai-completions`：POST {base_url}/chat/completions
- `anthropic-messages`：POST {base_url}/messages

统一入口是 `complete()` 与 `complete_json()`。后者用于要求 LLM 返回严格 JSON 的
场景（reviewer / data-agent），带容错解析：剥掉 ```json 围栏、提取首个平衡花括号块。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx

from .config import LLMRoleConfig


class LLMError(RuntimeError):
    """LLM 调用失败。携带可读的上下文，便于在 API 层回传。"""


@dataclass
class LLMResult:
    text: str
    model: str
    usage: Dict[str, Any]
    raw_finish_reason: str = ""


def _join_url(base_url: str, suffix: str) -> str:
    """拼接端点。已含该后缀时不重复追加；兼容 base 带或不带 /v1。"""
    base = (base_url or "").rstrip("/")
    if not base:
        raise LLMError("LLM base_url 未配置")
    if base.endswith(suffix):
        return base
    # 用户可能已写到 /v1/chat/completions
    if suffix.startswith("/chat/completions") and base.endswith("/v1"):
        return f"{base}{suffix}"
    if suffix.startswith("/messages") and base.endswith("/v1"):
        return f"{base}{suffix}"
    return f"{base}{suffix}"


def _extract_text_openai(data: Dict[str, Any]) -> str:
    choices = data.get("choices") or []
    if not choices:
        raise LLMError(f"响应缺少 choices: {json.dumps(data, ensure_ascii=False)[:400]}")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, list):
        # 部分实现返回分段 content
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text") or ""))
            elif isinstance(item, str):
                parts.append(item)
        content = "".join(parts)
    if not isinstance(content, str):
        # 有些推理模型把正文放在 reasoning_content，最后兜底
        content = message.get("reasoning_content")
    if not isinstance(content, str) or not content.strip():
        raise LLMError("响应正文为空")
    return content


def _extract_text_anthropic(data: Dict[str, Any]) -> str:
    blocks = data.get("content") or []
    parts: List[str] = []
    for block in blocks:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text") or ""))
    text = "".join(parts)
    if not text.strip():
        raise LLMError("响应正文为空")
    return text


def _strip_code_fence(text: str) -> str:
    stripped = text.strip()
    fence = re.match(r"^```[a-zA-Z]*\s*\n(.*)\n```\s*$", stripped, re.DOTALL)
    if fence:
        return fence.group(1).strip()
    # 未闭合的围栏
    if stripped.startswith("```"):
        first_newline = stripped.find("\n")
        if first_newline > 0:
            body = stripped[first_newline + 1 :]
            if body.rstrip().endswith("```"):
                body = body.rstrip()[:-3]
            return body.strip()
    return stripped


def _first_json_value(text: str) -> Optional[str]:
    """扫描出首个括号平衡的 JSON 值（对象或数组）。"""
    start = None
    opener = ""
    for idx, ch in enumerate(text):
        if ch in "{[":
            start = idx
            opener = ch
            break
    if start is None:
        return None
    closer = "}" if opener == "{" else "]"
    depth = 0
    in_string = False
    escaped = False
    for idx in range(start, len(text)):
        ch = text[idx]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return text[start : idx + 1]
    return None


def parse_json_response(text: str) -> Any:
    """从 LLM 输出里尽力解析出 JSON。失败抛 LLMError 并带原文片段。"""
    candidate = _strip_code_fence(text)
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass
    block = _first_json_value(candidate)
    if block is not None:
        try:
            return json.loads(block)
        except json.JSONDecodeError:
            pass
    # 最后尝试：修掉尾随逗号
    if block is not None:
        repaired = re.sub(r",(\s*[}\]])", r"\1", block)
        try:
            return json.loads(repaired)
        except json.JSONDecodeError:
            pass
    snippet = text.strip()[:600]
    raise LLMError(f"无法从 LLM 输出解析 JSON: {snippet}")


class LLMClient:
    """一个角色对应一个 client 实例。"""

    def __init__(self, config: LLMRoleConfig, role_name: str = "default") -> None:
        self.config = config
        self.role_name = role_name
        if not config.base_url:
            raise LLMError(f"角色 {role_name}: base_url 未配置")
        if not config.model:
            raise LLMError(f"角色 {role_name}: model 未配置")

    # ---- 内部：两种协议的分发 ----

    async def _post_openai(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float],
        max_tokens: int,
        json_mode: bool,
    ) -> LLMResult:
        url = _join_url(self.config.base_url, "/chat/completions")
        payload: Dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "stream": False,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens:
            payload["max_tokens"] = max_tokens
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.config.api_key}",
        }
        async with httpx.AsyncClient(timeout=self.config.timeout_s) as client:
            try:
                resp = await client.post(url, json=payload, headers=headers)
            except httpx.HTTPError as exc:
                raise LLMError(f"请求失败 {url}: {exc}") from exc
            if resp.status_code >= 400:
                raise LLMError(
                    f"HTTP {resp.status_code} from {url}: {resp.text[:500]}"
                )
            data = resp.json()
        return LLMResult(
            text=_extract_text_openai(data),
            model=str(data.get("model") or self.config.model),
            usage=data.get("usage") or {},
            raw_finish_reason=str(
                ((data.get("choices") or [{}])[0] or {}).get("finish_reason") or ""
            ),
        )

    async def _post_anthropic(
        self,
        system: str,
        messages: List[Dict[str, str]],
        temperature: Optional[float],
        max_tokens: int,
    ) -> LLMResult:
        url = _join_url(self.config.base_url, "/messages")
        payload: Dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "max_tokens": max_tokens or 8192,
        }
        if system:
            payload["system"] = system
        if temperature is not None:
            payload["temperature"] = temperature
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.config.api_key,
            "anthropic-version": "2023-06-01",
        }
        async with httpx.AsyncClient(timeout=self.config.timeout_s) as client:
            try:
                resp = await client.post(url, json=payload, headers=headers)
            except httpx.HTTPError as exc:
                raise LLMError(f"请求失败 {url}: {exc}") from exc
            if resp.status_code >= 400:
                raise LLMError(
                    f"HTTP {resp.status_code} from {url}: {resp.text[:500]}"
                )
            data = resp.json()
        return LLMResult(
            text=_extract_text_anthropic(data),
            model=str(data.get("model") or self.config.model),
            usage=data.get("usage") or {},
            raw_finish_reason=str(data.get("stop_reason") or ""),
        )

    # ---- 公开 API ----

    async def complete(
        self,
        system: str,
        user: str,
        temperature: Optional[float] = None,
        max_tokens: int = 0,
        json_mode: bool = False,
    ) -> LLMResult:
        """单轮补全。system 为空时只发 user。"""
        temp = self.config.temperature if temperature is None else temperature
        tokens = max_tokens or self.config.max_tokens
        if self.config.api == "anthropic-messages":
            messages = [{"role": "user", "content": user}]
            return await self._post_anthropic(system, messages, temp, tokens)
        messages: List[Dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})
        return await self._post_openai(messages, temp, tokens, json_mode)

    async def complete_json(
        self,
        system: str,
        user: str,
        temperature: Optional[float] = None,
        max_tokens: int = 0,
    ) -> Any:
        """要求返回 JSON。openai 协议尝试 json_mode；失败或协议不支持时靠容错解析。"""
        json_mode = self.config.api != "anthropic-messages"
        try:
            result = await self.complete(
                system, user, temperature=temperature, max_tokens=max_tokens,
                json_mode=json_mode,
            )
        except LLMError:
            if not json_mode:
                raise
            # 有些端点不支持 response_format，去掉重试一次
            result = await self.complete(
                system, user, temperature=temperature, max_tokens=max_tokens,
                json_mode=False,
            )
        return parse_json_response(result.text)


def build_clients(settings) -> Dict[str, LLMClient]:
    """按角色构建 client。未配置的角色不进字典。"""
    clients: Dict[str, LLMClient] = {}
    for role in ("context", "draft", "review", "data"):
        cfg = settings.role(role)
        if not cfg.is_usable():
            continue
        clients[role] = LLMClient(cfg, role_name=role)
    return clients
