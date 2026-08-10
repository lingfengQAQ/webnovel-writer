from __future__ import annotations

import os


SERVICE_NAME = "webnovel-writer"
ACCOUNT_NAME = "deepseek-api-key"


class SecretStoreError(RuntimeError):
    pass


def get_api_key() -> str:
    env_value = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if env_value:
        return env_value
    try:
        import keyring

        return str(keyring.get_password(SERVICE_NAME, ACCOUNT_NAME) or "").strip()
    except Exception:
        return ""


def set_api_key(value: str) -> None:
    value = value.strip()
    if not value:
        raise SecretStoreError("DeepSeek API Key 不能为空")
    try:
        import keyring

        keyring.set_password(SERVICE_NAME, ACCOUNT_NAME, value)
    except Exception as exc:
        raise SecretStoreError(f"系统凭据库不可用: {exc}") from exc
