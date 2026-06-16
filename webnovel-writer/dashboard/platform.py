"""Multi-user online platform support for the dashboard.

The original dashboard is a local, read-only view over one project root. This
module adds the small amount of state needed to run it as a hosted app:
accounts, sessions, per-user project roots, and SubRouter-compatible model
access.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import string
import time
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException, Request, Response


SESSION_COOKIE = "ww_session"
DEFAULT_SUBROUTER_BASE_URL = "http://subrouter.railway.internal:8080"
DEFAULT_PUBLIC_SUBROUTER_BASE_URL = "https://api.subrouter.com"
SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
AUTO_KEY_PREFIX = "webnovel-writer-auto"

request_user_id: ContextVar[str | None] = ContextVar("request_user_id", default=None)
request_project_root: ContextVar[Path | None] = ContextVar("request_project_root", default=None)


def platform_enabled() -> bool:
    value = os.environ.get("WEBNOVEL_PLATFORM_ENABLED")
    if value is not None:
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("WEBNOVEL_DATA_DIR"))


def platform_data_dir() -> Path:
    configured = os.environ.get("WEBNOVEL_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    if os.environ.get("RAILWAY_ENVIRONMENT"):
        return Path("/data")
    return (Path.home() / ".webnovel-writer-platform").resolve()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _hash_secret(secret: str, *, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def _verify_secret(secret: str, encoded: str) -> bool:
    try:
        scheme, salt, expected = encoded.split("$", 2)
    except ValueError:
        return False
    if scheme != "pbkdf2_sha256":
        return False
    actual = _hash_secret(secret, salt=salt)
    return hmac.compare_digest(actual, encoded)


def _slugify(value: str, fallback: str) -> str:
    allowed = string.ascii_letters + string.digits + "-"
    text = re.sub(r"\s+", "-", value.strip().lower())
    text = "".join(ch if ch in allowed else "-" for ch in text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or fallback


def _normalize_base_url(value: str | None) -> str:
    raw = (value or default_subrouter_base_url()).strip().rstrip("/")
    if not raw:
        return DEFAULT_SUBROUTER_BASE_URL
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw
    if raw.endswith("/v1"):
        raw = raw[:-3]
    return raw


def default_subrouter_base_url() -> str:
    return (
        os.environ.get("SUBROUTER_BASE_URL")
        or os.environ.get("SUBROUTERAI_BASE_URL")
        or os.environ.get("TOONFLOW_SUBROUTER_BASE_URL")
        or DEFAULT_SUBROUTER_BASE_URL
    )


def _gateway_base_url(base_url: str) -> str:
    normalized = _normalize_base_url(base_url)
    return normalized if normalized.endswith("/v1") else f"{normalized}/v1"


def _parse_base_url_candidates(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in re.split(r"[,\n;]", value) if part.strip()]


def default_login_base_url_candidates() -> list[str]:
    candidates = [
        os.environ.get("SUBROUTER_BASE_URL"),
        os.environ.get("SUBROUTERAI_BASE_URL"),
        os.environ.get("TOONFLOW_SUBROUTER_BASE_URL"),
        *_parse_base_url_candidates(os.environ.get("SUBROUTER_BASE_URL_CANDIDATES")),
        *_parse_base_url_candidates(os.environ.get("TOONFLOW_SUBROUTER_BASE_URL_CANDIDATES")),
        DEFAULT_SUBROUTER_BASE_URL,
        DEFAULT_PUBLIC_SUBROUTER_BASE_URL,
    ]
    result = []
    seen = set()
    for candidate in candidates:
        if not candidate:
            continue
        normalized = _normalize_base_url(candidate)
        if normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def _token_preview(token: str) -> str:
    token = token.strip()
    if len(token) <= 12:
        return "configured"
    return f"{token[:6]}...{token[-4:]}"


def _extract_items(payload: Any) -> list[Any]:
    candidates = []
    if isinstance(payload, dict):
        data = payload.get("data")
        candidates.extend(
            [
                data.get("items") if isinstance(data, dict) else None,
                data.get("data") if isinstance(data, dict) else None,
                data,
                payload.get("items"),
            ]
        )
    candidates.append(payload)
    for item in candidates:
        if isinstance(item, list):
            return item
    return []


def _extract_user(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    data = payload.get("data")
    if isinstance(data, dict):
        nested = data.get("user")
        if isinstance(nested, dict):
            return nested
        return data
    user = payload.get("user")
    return user if isinstance(user, dict) else {}


def _extract_distributor(payload: Any) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    body = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    raw = body.get("distributor") if isinstance(body.get("distributor"), dict) else {}
    dist_id = body.get("distributor_id") or body.get("distributorId") or raw.get("id")
    belongs = body.get("belongs_to_distributor")
    if belongs is None:
        belongs = body.get("belongsToDistributor")
    if belongs is None:
        belongs = bool(dist_id)
    if not belongs:
        return None
    slug = str(raw.get("slug") or body.get("distributor_slug") or body.get("distributorSlug") or "").strip()
    if not dist_id or not slug:
        raise HTTPException(400, "用户属于分站，但 SubRouter 未返回分站 slug")
    return {
        "id": str(dist_id),
        "slug": slug,
        "name": str(raw.get("name") or body.get("distributor_name") or body.get("distributorName") or ""),
    }


def _extract_key(payload: Any) -> tuple[str, str]:
    body = payload.get("data") if isinstance(payload, dict) else payload
    if isinstance(body, dict):
        nested = (
            body.get("token")
            or body.get("key_info")
            or body.get("keyInfo")
            or body.get("apiKey")
            or body.get("api_key")
        )
        if isinstance(nested, dict):
            key = str(nested.get("key") or nested.get("api_key") or nested.get("apiKey") or nested.get("token") or "")
            key_id = str(nested.get("id") or "")
            return _normalize_api_key(key), key_id
        key = str(body.get("key") or body.get("api_key") or body.get("apiKey") or body.get("token") or "")
        key_id = str(body.get("id") or "")
        return _normalize_api_key(key), key_id
    return "", ""


def _normalize_api_key(key: str) -> str:
    key = str(key or "").strip()
    if not key:
        return ""
    return f"sk-{key.removeprefix('sk-')}"


def _build_cookie(headers: httpx.Headers) -> str:
    cookies = headers.get_list("set-cookie")
    return "; ".join(cookie.split(";", 1)[0] for cookie in cookies if cookie)


def _bearer(api_key: str) -> str:
    return f"Bearer {api_key.removeprefix('Bearer ').removeprefix('bearer ')}"


def _subrouter_auth_headers(account: dict[str, Any]) -> dict[str, str]:
    headers: dict[str, str] = {}
    cookie = str(account.get("subrouter_session_cookie") or "")
    external_id = str(account.get("subrouter_external_user_id") or "")
    if cookie:
        headers["Cookie"] = cookie
    if external_id:
        headers["New-Api-User"] = external_id
    return headers


def _find_reusable_key(items: list[Any], exact_name: str | None = None) -> tuple[str, str] | None:
    for item in items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "")
        if exact_name is not None and name != exact_name:
            continue
        if exact_name is None and not name.startswith(AUTO_KEY_PREFIX):
            continue
        key = _normalize_api_key(str(item.get("key") or item.get("api_key") or item.get("apiKey") or item.get("token") or ""))
        if key:
            return key, str(item.get("id") or "")
    return None


def _infer_model_type(model_id: str) -> str:
    text = model_id.lower()
    if re.search(r"video|seedance|wan|kling|veo|sora|runway|hailuo|luma|pixverse", text):
        return "video"
    if re.search(r"image|img|seedream|nano|gpt-image|flux|dalle|dall-e|midjourney|ideogram", text):
        return "image"
    return "text"


def _pick_default_model(models: list[dict[str, Any]]) -> str:
    text_models = [item["id"] for item in models if item.get("type") == "text" and item.get("id")]
    if not text_models:
        return models[0]["id"] if models else ""
    preferences = [
        r"claude.*sonnet|sonnet",
        r"gpt-5|gpt-4\.?1|gpt-4o|gpt-4|o3|o4",
        r"deepseek.*(v3|chat|pro)",
        r"qwen.*(max|plus|72b|32b|coder)|qwen3",
        r"glm.*(5|4\.5|4-5)|kimi|moonshot",
    ]
    for pattern in preferences:
        for model_id in text_models:
            if re.search(pattern, model_id, re.I):
                return model_id
    return text_models[0]


class PlatformStore:
    def __init__(self, data_dir: Path | None = None):
        self.data_dir = data_dir or platform_data_dir()
        self.db_path = self.data_dir / "platform.sqlite3"
        self.projects_dir = self.data_dir / "projects"
        self.templates_dir = Path(__file__).resolve().parents[1] / "templates"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self._migrate()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _migrate(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT,
                    email TEXT NOT NULL DEFAULT '',
                    subrouter_provider TEXT NOT NULL DEFAULT 'subrouterai',
                    subrouter_api_key TEXT NOT NULL DEFAULT '',
                    subrouter_base_url TEXT NOT NULL DEFAULT 'http://subrouter.railway.internal:8080',
                    subrouter_external_user_id TEXT NOT NULL DEFAULT '',
                    subrouter_session_cookie TEXT NOT NULL DEFAULT '',
                    subrouter_api_key_id TEXT NOT NULL DEFAULT '',
                    subrouter_distributor_id TEXT NOT NULL DEFAULT '',
                    subrouter_distributor_slug TEXT NOT NULL DEFAULT '',
                    subrouter_distributor_name TEXT NOT NULL DEFAULT '',
                    default_model TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    slug TEXT NOT NULL,
                    path TEXT NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(user_id, slug)
                );
                """
            )
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
            migrations = {
                "subrouter_provider": "ALTER TABLE users ADD COLUMN subrouter_provider TEXT NOT NULL DEFAULT 'subrouterai'",
                "subrouter_external_user_id": "ALTER TABLE users ADD COLUMN subrouter_external_user_id TEXT NOT NULL DEFAULT ''",
                "subrouter_session_cookie": "ALTER TABLE users ADD COLUMN subrouter_session_cookie TEXT NOT NULL DEFAULT ''",
                "subrouter_api_key_id": "ALTER TABLE users ADD COLUMN subrouter_api_key_id TEXT NOT NULL DEFAULT ''",
                "subrouter_distributor_id": "ALTER TABLE users ADD COLUMN subrouter_distributor_id TEXT NOT NULL DEFAULT ''",
                "subrouter_distributor_slug": "ALTER TABLE users ADD COLUMN subrouter_distributor_slug TEXT NOT NULL DEFAULT ''",
                "subrouter_distributor_name": "ALTER TABLE users ADD COLUMN subrouter_distributor_name TEXT NOT NULL DEFAULT ''",
            }
            for column, sql in migrations.items():
                if column not in columns:
                    conn.execute(sql)

    def health(self) -> dict[str, Any]:
        return {
            "ok": True,
            "platform": platform_enabled(),
            "data_dir": str(self.data_dir),
            "db_path": str(self.db_path),
        }

    def register(
        self,
        *,
        username: str,
        password: str,
        email: str = "",
        subrouter_api_key: str = "",
        subrouter_base_url: str | None = None,
    ) -> dict[str, Any]:
        username = username.strip()
        password = password.strip()
        if not username or not password:
            raise HTTPException(400, "用户名和密码不能为空")
        if len(password) < 6:
            raise HTTPException(400, "密码至少 6 位")
        now = _utc_now()
        user_id = secrets.token_hex(12)
        try:
            with self.connect() as conn:
                conn.execute(
                    """
                    INSERT INTO users (
                        id, username, password_hash, email, subrouter_api_key,
                        subrouter_base_url, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        username,
                        _hash_secret(password),
                        email.strip(),
                        subrouter_api_key.strip(),
                        _normalize_base_url(subrouter_base_url),
                        now,
                        now,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "用户名已存在") from exc
        self.ensure_default_project(user_id, display_name=username)
        return self.get_user(user_id)

    def subrouter_login(self, *, api_key: str, base_url: str | None = None, display_name: str = "") -> dict[str, Any]:
        api_key = api_key.strip()
        if not api_key:
            raise HTTPException(400, "SubRouter API Key 不能为空")
        fingerprint = hashlib.sha256(api_key.encode("utf-8")).hexdigest()
        user_id = "sr_" + fingerprint[:24]
        username = _slugify(display_name, f"subrouter-{fingerprint[:8]}")
        now = _utc_now()
        with self.connect() as conn:
            existing = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE users
                    SET subrouter_api_key = ?, subrouter_base_url = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (api_key, _normalize_base_url(base_url), now, user_id),
                )
            else:
                suffix = 0
                candidate = username
                while conn.execute("SELECT 1 FROM users WHERE username = ?", (candidate,)).fetchone():
                    suffix += 1
                    candidate = f"{username}-{suffix}"
                conn.execute(
                    """
                    INSERT INTO users (
                        id, username, password_hash, email, subrouter_api_key,
                        subrouter_base_url, created_at, updated_at
                    )
                    VALUES (?, ?, '', '', ?, ?, ?, ?)
                    """,
                    (user_id, candidate, api_key, _normalize_base_url(base_url), now, now),
                )
        self.ensure_default_project(user_id, display_name=username)
        return self.get_user(user_id)

    async def subrouter_password_login(
        self,
        *,
        username: str,
        password: str,
        base_url: str | None = None,
    ) -> dict[str, Any]:
        username = username.strip()
        password = password.strip()
        if not username or not password:
            raise HTTPException(400, "SubRouter 用户名和密码不能为空")

        candidates = []
        if base_url and base_url.strip():
            candidates.append(_normalize_base_url(base_url))
        candidates.extend(default_login_base_url_candidates())

        seen = set()
        last_error = "SubRouter 登录失败"
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            for candidate in candidates:
                if candidate in seen:
                    continue
                seen.add(candidate)
                try:
                    login = await self._login_subrouterai(client, candidate, username, password)
                    return await self._prepare_subrouterai_account(client, login, fallback_username=username)
                except HTTPException as exc:
                    last_error = str(exc.detail)
                except Exception as exc:
                    last_error = str(exc)
        raise HTTPException(401, last_error or "SubRouter 用户名或密码错误")

    async def _login_subrouterai(
        self,
        client: httpx.AsyncClient,
        base_url: str,
        username: str,
        password: str,
    ) -> dict[str, Any]:
        response = await client.post(
            f"{_normalize_base_url(base_url)}/api/user/login",
            json={"username": username, "password": password},
        )
        if response.status_code >= 400:
            raise HTTPException(response.status_code, _upstream_error(response, "SubRouter 登录失败"))
        payload = response.json()
        if isinstance(payload, dict) and payload.get("success") is False:
            raise HTTPException(401, str(payload.get("message") or "SubRouter 用户名或密码错误"))
        cookie = _build_cookie(response.headers)
        if not cookie:
            raise HTTPException(502, "SubRouter 登录成功但未返回会话 Cookie")
        user = _extract_user(payload)
        external_id = str(user.get("id") or "").strip()
        distributor = _extract_distributor(payload)
        return {
            "provider": "subrouterai",
            "base_url": _normalize_base_url(base_url),
            "external_user_id": external_id,
            "username": str(user.get("username") or username),
            "email": str(user.get("email") or ""),
            "display_name": str(user.get("display_name") or user.get("displayName") or user.get("username") or username),
            "session_cookie": cookie,
            "distributor": distributor,
        }

    async def _prepare_subrouterai_account(
        self,
        client: httpx.AsyncClient,
        login: dict[str, Any],
        *,
        fallback_username: str,
    ) -> dict[str, Any]:
        account_seed = login.get("external_user_id") or login.get("email") or login.get("username") or fallback_username
        user_id = "sr_" + hashlib.sha256(f"subrouterai:{account_seed}".encode("utf-8")).hexdigest()[:24]
        api_key, api_key_id = await self._ensure_subrouterai_key(client, login)
        default_model = ""
        try:
            models = await self._fetch_gateway_models(api_key, login["base_url"])
            default_model = _pick_default_model(models)
        except Exception:
            default_model = ""

        now = _utc_now()
        username = f"subrouter:{login.get('username') or fallback_username}"
        display_name = login.get("display_name") or login.get("username") or fallback_username
        dist = login.get("distributor") or {}
        with self.connect() as conn:
            existing = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE users
                    SET email = ?, subrouter_provider = ?, subrouter_api_key = ?,
                        subrouter_base_url = ?, subrouter_external_user_id = ?,
                        subrouter_session_cookie = ?, subrouter_api_key_id = ?,
                        subrouter_distributor_id = ?, subrouter_distributor_slug = ?,
                        subrouter_distributor_name = ?,
                        default_model = COALESCE(NULLIF(default_model, ''), ?),
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        login.get("email") or "",
                        "subrouterai",
                        api_key,
                        login["base_url"],
                        login.get("external_user_id") or "",
                        login.get("session_cookie") or "",
                        api_key_id,
                        dist.get("id") or "",
                        dist.get("slug") or "",
                        dist.get("name") or "",
                        default_model,
                        now,
                        user_id,
                    ),
                )
            else:
                unique_username = _slugify(username, f"subrouter-{user_id[-8:]}")
                suffix = 0
                candidate = unique_username
                while conn.execute("SELECT 1 FROM users WHERE username = ?", (candidate,)).fetchone():
                    suffix += 1
                    candidate = f"{unique_username}-{suffix}"
                conn.execute(
                    """
                    INSERT INTO users (
                        id, username, password_hash, email, subrouter_provider,
                        subrouter_api_key, subrouter_base_url,
                        subrouter_external_user_id, subrouter_session_cookie,
                        subrouter_api_key_id, subrouter_distributor_id,
                        subrouter_distributor_slug, subrouter_distributor_name,
                        default_model, created_at, updated_at
                    )
                    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        candidate,
                        login.get("email") or "",
                        "subrouterai",
                        api_key,
                        login["base_url"],
                        login.get("external_user_id") or "",
                        login.get("session_cookie") or "",
                        api_key_id,
                        dist.get("id") or "",
                        dist.get("slug") or "",
                        dist.get("name") or "",
                        default_model,
                        now,
                        now,
                    ),
                )
        self.ensure_default_project(user_id, display_name=display_name)
        return self.get_user(user_id)

    async def _ensure_subrouterai_key(
        self,
        client: httpx.AsyncClient,
        login: dict[str, Any],
    ) -> tuple[str, str]:
        existing = _find_reusable_key(await self._list_subrouterai_keys(client, login))
        if existing:
            return existing

        headers = _subrouter_auth_headers(
            {
                "subrouter_session_cookie": login.get("session_cookie"),
                "subrouter_external_user_id": login.get("external_user_id"),
            }
        )
        name = f"{AUTO_KEY_PREFIX}-{int(time.time())}"
        if login.get("distributor"):
            path = "/api/user/self/distributor/token/create"
            body = {"name": name, "key_group_id": 0}
        else:
            path = "/api/token/"
            body = {
                "name": name,
                "group": "subrouter",
                "expired_time": -1,
                "remain_quota": 0,
                "unlimited_quota": True,
                "model_limits_enabled": False,
            }
        response = await client.post(f"{login['base_url']}{path}", headers=headers, json=body)
        if response.status_code >= 400:
            raise HTTPException(response.status_code, _upstream_error(response, "创建 SubRouter 访问密钥失败"))
        payload = response.json()
        if isinstance(payload, dict) and payload.get("success") is False:
            raise HTTPException(400, str(payload.get("message") or "创建 SubRouter 访问密钥失败"))
        key = _extract_key(payload)
        if key[0]:
            return key

        created = _find_reusable_key(await self._list_subrouterai_keys(client, login), exact_name=name)
        if not created:
            raise HTTPException(502, "SubRouter 密钥已创建但未能从列表读取")
        return created

    async def _list_subrouterai_keys(
        self,
        client: httpx.AsyncClient,
        login: dict[str, Any],
    ) -> list[Any]:
        headers = _subrouter_auth_headers(
            {
                "subrouter_session_cookie": login.get("session_cookie"),
                "subrouter_external_user_id": login.get("external_user_id"),
            }
        )
        if login.get("distributor"):
            response = await client.get(
                f"{login['base_url']}/api/user/self/distributor/token/list",
                headers=headers,
                params={"page": 1, "page_size": 100},
            )
        else:
            response = await client.get(f"{login['base_url']}/api/token/", headers=headers)
        if response.status_code >= 400:
            raise HTTPException(response.status_code, _upstream_error(response, "获取 SubRouter 密钥列表失败"))
        payload = response.json()
        if isinstance(payload, dict) and payload.get("success") is False:
            raise HTTPException(400, str(payload.get("message") or "获取 SubRouter 密钥列表失败"))
        return _extract_items(payload)

    def login(self, *, username: str, password: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ?", (username.strip(),)).fetchone()
        if not row or not row["password_hash"] or not _verify_secret(password.strip(), row["password_hash"]):
            raise HTTPException(401, "用户名或密码错误")
        return self._public_user(dict(row))

    def get_user(self, user_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(401, "登录已过期")
        return self._public_user(dict(row))

    def _public_user(self, row: dict[str, Any]) -> dict[str, Any]:
        api_key = row.get("subrouter_api_key") or ""
        return {
            "id": row["id"],
            "username": row["username"],
            "email": row.get("email") or "",
            "subrouter": {
                "configured": bool(api_key.strip()),
                "key_preview": _token_preview(api_key) if api_key else "",
                "provider": row.get("subrouter_provider") or "subrouterai",
                "base_url": row.get("subrouter_base_url") or default_subrouter_base_url(),
                "gateway_base_url": _gateway_base_url(row.get("subrouter_base_url") or default_subrouter_base_url()),
                "default_model": row.get("default_model") or "",
                "external_user_id": row.get("subrouter_external_user_id") or "",
                "distributor_id": row.get("subrouter_distributor_id") or "",
                "distributor_slug": row.get("subrouter_distributor_slug") or "",
                "distributor_name": row.get("subrouter_distributor_name") or "",
                "account_type": "dist" if row.get("subrouter_distributor_id") else "main",
            },
            "created_at": row.get("created_at") or "",
            "updated_at": row.get("updated_at") or "",
        }

    def create_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(40)
        expires_at = int(time.time()) + SESSION_TTL_SECONDS
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
                (_hash_token(token), user_id, expires_at, _utc_now()),
            )
        return token

    def resolve_session(self, token: str | None) -> str | None:
        if not token:
            return None
        now = int(time.time())
        with self.connect() as conn:
            row = conn.execute(
                "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
                (_hash_token(token),),
            ).fetchone()
            if not row:
                return None
            if int(row["expires_at"]) <= now:
                conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash_token(token),))
                return None
            return str(row["user_id"])

    def delete_session(self, token: str | None) -> None:
        if not token:
            return
        with self.connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash_token(token),))

    def set_session_cookie(self, response: Response, token: str) -> None:
        secure = os.environ.get("WEBNOVEL_COOKIE_SECURE", "").strip().lower() in {"1", "true", "yes", "on"}
        response.set_cookie(
            SESSION_COOKIE,
            token,
            max_age=SESSION_TTL_SECONDS,
            httponly=True,
            secure=secure,
            samesite="lax",
        )

    def clear_session_cookie(self, response: Response) -> None:
        response.delete_cookie(SESSION_COOKIE)

    def update_subrouter_settings(
        self,
        user_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        default_model: str | None = None,
    ) -> dict[str, Any]:
        fields: list[str] = []
        params: list[Any] = []
        if api_key is not None:
            fields.append("subrouter_api_key = ?")
            params.append(api_key.strip())
        if base_url is not None:
            fields.append("subrouter_base_url = ?")
            params.append(_normalize_base_url(base_url))
        if default_model is not None:
            fields.append("default_model = ?")
            params.append(default_model.strip())
        if not fields:
            return self.get_user(user_id)
        fields.append("updated_at = ?")
        params.append(_utc_now())
        params.append(user_id)
        with self.connect() as conn:
            conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", params)
        return self.get_user(user_id)

    def subrouter_credentials(self, user_id: str) -> tuple[str, str, str]:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT subrouter_api_key, subrouter_base_url, default_model FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        if not row:
            raise HTTPException(401, "登录已过期")
        api_key = str(row["subrouter_api_key"] or "").strip()
        if not api_key:
            raise HTTPException(400, "请先使用 SubRouter 账号密码登录，或配置 SubRouter API Key")
        return api_key, _gateway_base_url(row["subrouter_base_url"]), str(row["default_model"] or "")

    def list_projects(self, user_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM projects WHERE user_id = ? ORDER BY is_active DESC, updated_at DESC",
                (user_id,),
            ).fetchall()
        return [self._public_project(dict(row)) for row in rows]

    def current_project(self, user_id: str) -> dict[str, Any]:
        project = self._current_project_row(user_id)
        if project is None:
            return self.ensure_default_project(user_id)
        return self._public_project(project)

    def current_project_root(self, user_id: str) -> Path:
        project = self._current_project_row(user_id)
        if project is None:
            project = self.ensure_default_project(user_id)
        path = Path(project["path"]).resolve()
        path.mkdir(parents=True, exist_ok=True)
        self._ensure_minimal_project(path, project["name"])
        return path

    def create_project(self, user_id: str, *, name: str, genre: str = "") -> dict[str, Any]:
        name = name.strip() or "新书项目"
        fallback = secrets.token_hex(4)
        base_slug = _slugify(name, fallback)
        now = _utc_now()
        with self.connect() as conn:
            slug = base_slug
            suffix = 0
            while conn.execute(
                "SELECT 1 FROM projects WHERE user_id = ? AND slug = ?",
                (user_id, slug),
            ).fetchone():
                suffix += 1
                slug = f"{base_slug}-{suffix}"
            project_id = secrets.token_hex(12)
            path = (self.projects_dir / user_id / slug).resolve()
            conn.execute("UPDATE projects SET is_active = 0 WHERE user_id = ?", (user_id,))
            conn.execute(
                """
                INSERT INTO projects (id, user_id, name, slug, path, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (project_id, user_id, name, slug, str(path), now, now),
            )
        self._ensure_minimal_project(path, name, genre=genre)
        return self.current_project(user_id)

    def activate_project(self, user_id: str, project_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM projects WHERE id = ? AND user_id = ?",
                (project_id, user_id),
            ).fetchone()
            if not row:
                raise HTTPException(404, "项目不存在")
            conn.execute("UPDATE projects SET is_active = 0 WHERE user_id = ?", (user_id,))
            conn.execute(
                "UPDATE projects SET is_active = 1, updated_at = ? WHERE id = ? AND user_id = ?",
                (_utc_now(), project_id, user_id),
            )
        return self.current_project(user_id)

    def ensure_default_project(self, user_id: str, display_name: str = "") -> dict[str, Any]:
        with self.connect() as conn:
            existing = conn.execute("SELECT * FROM projects WHERE user_id = ? LIMIT 1", (user_id,)).fetchone()
        if existing:
            return dict(existing)
        name = f"{display_name or '默认'}的网文项目"
        return self.create_project(user_id, name=name)

    def _current_project_row(self, user_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM projects WHERE user_id = ? ORDER BY is_active DESC, updated_at DESC LIMIT 1",
                (user_id,),
            ).fetchone()
        return dict(row) if row else None

    def _public_project(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "name": row["name"],
            "slug": row["slug"],
            "path": row["path"],
            "is_active": bool(row["is_active"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def _ensure_minimal_project(self, path: Path, title: str, genre: str = "") -> None:
        path.mkdir(parents=True, exist_ok=True)
        for folder in ("正文", "大纲", "设定集", "审查报告"):
            (path / folder).mkdir(parents=True, exist_ok=True)
        webnovel = path / ".webnovel"
        story = path / ".story-system"
        for folder in (
            webnovel,
            webnovel / "summaries",
            webnovel / "logs",
            story / "contracts",
            story / "commits",
            story / "events",
        ):
            folder.mkdir(parents=True, exist_ok=True)
        state_path = webnovel / "state.json"
        if not state_path.exists():
            state_path.write_text(
                json.dumps(
                    {
                        "project_info": {
                            "title": title,
                            "genre": genre,
                            "created_by": "webnovel-writer-platform",
                        },
                        "progress": {
                            "current_chapter": 0,
                            "total_words": 0,
                            "current_volume": 1,
                            "volumes_completed": [],
                            "volumes_planned": [],
                            "last_updated": _utc_now(),
                        },
                        "protagonist_state": {
                            "name": "",
                            "power": {"realm": "", "layer": 1, "bottleneck": ""},
                            "location": {"current": "", "last_chapter": 0},
                            "golden_finger": {"name": "", "level": 1, "cooldown": 0, "skills": []},
                            "attributes": {},
                        },
                        "relationships": {},
                        "world_settings": {"power_system": [], "factions": [], "locations": []},
                        "plot_threads": {"active_threads": [], "foreshadowing": []},
                        "review_checkpoints": [],
                        "chapter_meta": {},
                        "strand_tracker": {
                            "last_quest_chapter": 0,
                            "last_fire_chapter": 0,
                            "last_constellation_chapter": 0,
                            "current_dominant": "quest",
                            "chapters_since_switch": 0,
                            "history": [],
                        },
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
        outline = path / "大纲" / "总纲.md"
        if not outline.exists():
            outline.write_text(f"# {title}\n\n## 核心卖点\n\n## 卷结构\n", encoding="utf-8")
        setting = path / "设定集" / "世界观.md"
        if not setting.exists():
            setting.write_text("# 世界观\n\n", encoding="utf-8")

    async def fetch_models(self, user_id: str) -> dict[str, Any]:
        api_key, base_url, default_model = self.subrouter_credentials(user_id)
        models = await self._fetch_gateway_models(api_key, base_url)
        if not default_model:
            default_model = _pick_default_model(models)
        return {"models": models, "default_model": default_model, "base_url": base_url}

    async def _fetch_gateway_models(self, api_key: str, base_url: str) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{_gateway_base_url(base_url)}/models",
                headers={"Authorization": _bearer(api_key)},
            )
        if response.status_code >= 400:
            raise HTTPException(response.status_code, _upstream_error(response, "读取模型列表失败"))
        payload = response.json()
        models = []
        for item in _extract_items(payload):
            if isinstance(item, dict):
                model_id = str(item.get("id") or item.get("model") or item.get("name") or "").strip()
                category = str(item.get("category") or item.get("type") or "")
            else:
                model_id = str(item or "").strip()
                category = ""
            if model_id:
                models.append(
                    {
                        "id": model_id,
                        "type": _infer_model_type(f"{model_id} {category}"),
                        "owned_by": str(item.get("owned_by") or "") if isinstance(item, dict) else "",
                        "created": item.get("created") if isinstance(item, dict) else None,
                    }
                )
        models.sort(key=lambda item: item["id"])
        return models

    async def chat_completion(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        api_key, base_url, default_model = self.subrouter_credentials(user_id)
        if not isinstance(payload, dict):
            raise HTTPException(400, "请求体格式错误")
        model = str(payload.get("model") or default_model or "").strip()
        if not model:
            raise HTTPException(400, "请先选择模型")
        payload = dict(payload)
        payload["model"] = model
        payload["stream"] = False
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": _bearer(api_key),
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if response.status_code >= 400:
            raise HTTPException(response.status_code, _upstream_error(response, "模型调用失败"))
        return response.json()

    def copy_project_from_upload(self, user_id: str, source: Path, name: str) -> dict[str, Any]:
        project = self.create_project(user_id, name=name)
        target = Path(project["path"])
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source, target)
        self._ensure_minimal_project(target, name)
        return project


def _upstream_error(response: httpx.Response, fallback: str) -> str:
    text = response.text[:1000]
    try:
        payload = response.json()
    except ValueError:
        return text or fallback
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            return str(error.get("message") or error.get("type") or fallback)
        if isinstance(error, str):
            return error
        if payload.get("message"):
            return str(payload["message"])
    return text or fallback


_store: PlatformStore | None = None


def get_store() -> PlatformStore:
    global _store
    if _store is None:
        _store = PlatformStore()
    return _store


def require_user_id() -> str:
    user_id = request_user_id.get()
    if not user_id:
        raise HTTPException(401, "请先登录")
    return user_id


async def attach_platform_context(request: Request) -> None:
    if not platform_enabled():
        return
    token = request.cookies.get(SESSION_COOKIE)
    user_id = get_store().resolve_session(token)
    request_user_id.set(user_id)
    if user_id:
        request_project_root.set(get_store().current_project_root(user_id))
    else:
        request_project_root.set(None)
