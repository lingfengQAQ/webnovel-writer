# -*- coding: utf-8 -*-
"""服务层配置：LLM API、路径、运行时选项。

配置来源优先级（后者覆盖前者）：
1. 代码默认值
2. `.env` 文件（服务根目录或书项目根目录）
3. 环境变量
4. 运行时通过 `/api/config` 写入的 JSON（存在 storages/settings.json）

所有 API 相关字段都可配置：base_url / api_key / model。
按角色（role）可分别指定模型，未指定则回退到 default。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, Optional

SERVICE_ROOT = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_ROOT.parent
UPSTREAM_ROOT = REPO_ROOT / "webnovel-writer"

# 运行时可变配置的落盘位置（不进 git）
RUNTIME_SETTINGS = SERVICE_ROOT / "storages" / "settings.json"


def _load_env_file(path: Path) -> Dict[str, str]:
    """极简 .env 解析：KEY=VALUE，忽略注释与空行，不覆盖已存在的环境变量。"""
    out: Dict[str, str] = {}
    if not path.is_file():
        return out
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return out
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            out[key] = value
    return out


def _runtime_settings() -> Dict[str, Any]:
    if not RUNTIME_SETTINGS.is_file():
        return {}
    try:
        data = json.loads(RUNTIME_SETTINGS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


@dataclass
class LLMRoleConfig:
    """单个角色的模型配置。空值表示回退到 default。"""

    base_url: str = ""
    api_key: str = ""
    model: str = ""
    api: str = "openai-completions"  # openai-completions | anthropic-messages
    temperature: Optional[float] = None
    max_tokens: int = 0
    timeout_s: int = 300

    def resolved(self, default: "LLMRoleConfig") -> "LLMRoleConfig":
        """用 default 补齐空字段，返回生效配置。"""
        return LLMRoleConfig(
            base_url=self.base_url or default.base_url,
            api_key=self.api_key or default.api_key,
            model=self.model or default.model,
            api=self.api or default.api,
            temperature=(
                self.temperature if self.temperature is not None else default.temperature
            ),
            max_tokens=self.max_tokens or default.max_tokens,
            timeout_s=self.timeout_s or default.timeout_s,
        )

    def is_usable(self) -> bool:
        return bool(self.base_url and self.model)


# 四个 Agent 角色 + 两个检索角色
ROLES = ("context", "draft", "review", "data", "embed", "rerank")


@dataclass
class Settings:
    # ---- LLM ----
    llm: LLMRoleConfig = field(default_factory=LLMRoleConfig)
    llm_roles: Dict[str, LLMRoleConfig] = field(default_factory=dict)

    # ---- 检索（上游 RAG 用，走环境变量传给子进程）----
    embed_base_url: str = ""
    embed_model: str = ""
    embed_api_key: str = ""
    rerank_base_url: str = ""
    rerank_model: str = ""
    rerank_api_key: str = ""

    # ---- 路径 ----
    workspace_root: str = ""
    project_root: str = ""

    # ---- 运行时 ----
    request_timeout_s: int = 600
    max_draft_retries: int = 1

    def role(self, name: str) -> LLMRoleConfig:
        """取某角色生效配置，回退到 default。"""
        cfg = self.llm_roles.get(name)
        if cfg is None:
            return self.llm
        return cfg.resolved(self.llm)

    def to_public_dict(self) -> Dict[str, Any]:
        """给 API 返回的视图：api_key 只报是否已设置，绝不回显。"""

        def mask(role_cfg: LLMRoleConfig) -> Dict[str, Any]:
            return {
                "base_url": role_cfg.base_url,
                "model": role_cfg.model,
                "api": role_cfg.api,
                "api_key_set": bool(role_cfg.api_key),
                "api_key_hint": (
                    f"****{role_cfg.api_key[-4:]}" if len(role_cfg.api_key) >= 4 else ""
                ),
                "temperature": role_cfg.temperature,
                "max_tokens": role_cfg.max_tokens,
            }

        return {
            "llm": mask(self.llm),
            "llm_roles": {name: mask(cfg) for name, cfg in self.llm_roles.items()},
            "rag": {
                "embed_base_url": self.embed_base_url,
                "embed_model": self.embed_model,
                "embed_api_key_set": bool(self.embed_api_key),
                "rerank_base_url": self.rerank_base_url,
                "rerank_model": self.rerank_model,
                "rerank_api_key_set": bool(self.rerank_api_key),
            },
            "paths": {
                "workspace_root": self.workspace_root,
                "project_root": self.project_root,
                "upstream_root": str(UPSTREAM_ROOT),
            },
            "runtime": {
                "request_timeout_s": self.request_timeout_s,
                "max_draft_retries": self.max_draft_retries,
            },
        }


def _role_from_mapping(data: Dict[str, Any]) -> LLMRoleConfig:
    if not isinstance(data, dict):
        return LLMRoleConfig()
    temperature = data.get("temperature")
    try:
        temperature = float(temperature) if temperature is not None else None
    except (TypeError, ValueError):
        temperature = None
    try:
        max_tokens = int(data.get("max_tokens") or 0)
    except (TypeError, ValueError):
        max_tokens = 0
    try:
        timeout_s = int(data.get("timeout_s") or 300)
    except (TypeError, ValueError):
        timeout_s = 300
    return LLMRoleConfig(
        base_url=str(data.get("base_url") or ""),
        api_key=str(data.get("api_key") or ""),
        model=str(data.get("model") or ""),
        api=str(data.get("api") or "openai-completions"),
        temperature=temperature,
        max_tokens=max_tokens,
        timeout_s=timeout_s,
    )


def load_settings(project_root: Optional[str] = None) -> Settings:
    """组装生效配置：默认 <- .env(服务根) <- .env(书项目根) <- 环境变量 <- 运行时 JSON。"""
    env: Dict[str, str] = {}
    env.update(_load_env_file(SERVICE_ROOT / ".env"))
    if project_root:
        env.update(_load_env_file(Path(project_root) / ".env"))
    # 真实环境变量优先级最高
    for key, value in os.environ.items():
        env[key] = value

    runtime = _runtime_settings()

    def pick(*keys: str, default: str = "") -> str:
        for key in keys:
            if key in env and env[key]:
                return env[key]
        return default

    settings = Settings()

    # default provider
    settings.llm = LLMRoleConfig(
        base_url=pick("LLM_BASE_URL", "OPENAI_BASE_URL", "DEEPSEEK_BASE_URL"),
        api_key=pick("LLM_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY"),
        model=pick("LLM_MODEL", "OPENAI_MODEL", "DEEPSEEK_MODEL"),
        api=pick("LLM_API", default="openai-completions"),
    )

    # RAG
    settings.embed_base_url = pick("EMBED_BASE_URL")
    settings.embed_model = pick("EMBED_MODEL")
    settings.embed_api_key = pick("EMBED_API_KEY")
    settings.rerank_base_url = pick("RERANK_BASE_URL")
    settings.rerank_model = pick("RERANK_MODEL")
    settings.rerank_api_key = pick("RERANK_API_KEY")

    settings.workspace_root = pick("WORKSPACE_ROOT", default=str(Path.cwd()))
    settings.project_root = project_root or pick("PROJECT_ROOT")

    # 运行时 JSON 覆盖（来自 /api/config）
    rt_llm = runtime.get("llm")
    if isinstance(rt_llm, dict):
        settings.llm = _role_from_mapping({**asdict(settings.llm), **rt_llm})
    rt_roles = runtime.get("llm_roles")
    if isinstance(rt_roles, dict):
        for name, data in rt_roles.items():
            settings.llm_roles[name] = _role_from_mapping(data)
    for name in ("embed_base_url", "embed_model", "embed_api_key",
                 "rerank_base_url", "rerank_model", "rerank_api_key"):
        value = runtime.get(name)
        if isinstance(value, str) and value:
            setattr(settings, name, value)
    rt_runtime = runtime.get("runtime")
    if isinstance(rt_runtime, dict):
        for key in ("request_timeout_s", "max_draft_retries"):
            try:
                if rt_runtime.get(key) is not None:
                    setattr(settings, key, int(rt_runtime[key]))
            except (TypeError, ValueError):
                pass

    return settings


def save_runtime_settings(patch: Dict[str, Any]) -> Dict[str, Any]:
    """把配置写入运行时 JSON（合并语义）。api_key 为空字符串时不覆盖已有值。"""
    current = _runtime_settings()
    for section in ("llm", "llm_roles"):
        incoming = patch.get(section)
        if not isinstance(incoming, dict):
            continue
        if section == "llm_roles":
            bucket = current.setdefault("llm_roles", {})
            if not isinstance(bucket, dict):
                bucket = {}
                current["llm_roles"] = bucket
            for role_name, role_data in incoming.items():
                if not isinstance(role_data, dict):
                    continue
                existing = bucket.get(role_name)
                existing = existing if isinstance(existing, dict) else {}
                merged = {**existing}
                for key, value in role_data.items():
                    if key == "api_key" and value == "":
                        continue  # 空表示不改
                    merged[key] = value
                bucket[role_name] = merged
        else:
            existing = current.get("llm")
            existing = existing if isinstance(existing, dict) else {}
            merged = {**existing}
            for key, value in incoming.items():
                if key == "api_key" and value == "":
                    continue
                merged[key] = value
            current["llm"] = merged

    for key in ("embed_base_url", "embed_model", "embed_api_key",
                "rerank_base_url", "rerank_model", "rerank_api_key"):
        value = patch.get(key)
        if isinstance(value, str) and value:
            current[key] = value

    runtime_patch = patch.get("runtime")
    if isinstance(runtime_patch, dict):
        existing = current.get("runtime")
        existing = existing if isinstance(existing, dict) else {}
        current["runtime"] = {**existing, **runtime_patch}

    RUNTIME_SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    tmp = RUNTIME_SETTINGS.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(RUNTIME_SETTINGS)
    return current


def rag_env(settings: Settings) -> Dict[str, str]:
    """给上游子进程注入的 RAG 环境变量。"""
    env: Dict[str, str] = {}
    if settings.embed_base_url:
        env["EMBED_BASE_URL"] = settings.embed_base_url
    if settings.embed_model:
        env["EMBED_MODEL"] = settings.embed_model
    if settings.embed_api_key:
        env["EMBED_API_KEY"] = settings.embed_api_key
    if settings.rerank_base_url:
        env["RERANK_BASE_URL"] = settings.rerank_base_url
    if settings.rerank_model:
        env["RERANK_MODEL"] = settings.rerank_model
    if settings.rerank_api_key:
        env["RERANK_API_KEY"] = settings.rerank_api_key
    return env
