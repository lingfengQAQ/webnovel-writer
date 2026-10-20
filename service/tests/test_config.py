# -*- coding: utf-8 -*-
"""配置层测试：可配置 API、角色回退、密钥掩码、运行时覆盖。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from service.config import (
    LLMRoleConfig,
    RUNTIME_SETTINGS,
    Settings,
    _load_env_file,
    load_settings,
    rag_env,
    save_runtime_settings,
)


class TestRoleFallback:
    def test_empty_role_inherits_default(self):
        default = LLMRoleConfig(base_url="http://d/v1", api_key="dk", model="dm")
        role = LLMRoleConfig()
        merged = role.resolved(default)
        assert merged.base_url == "http://d/v1"
        assert merged.api_key == "dk"
        assert merged.model == "dm"

    def test_role_override_wins(self):
        default = LLMRoleConfig(base_url="http://d/v1", api_key="dk", model="dm")
        role = LLMRoleConfig(model="override-model")
        merged = role.resolved(default)
        assert merged.model == "override-model"
        assert merged.base_url == "http://d/v1"  # 未覆盖的仍回退

    def test_temperature_none_inherits(self):
        default = LLMRoleConfig(base_url="x", model="m", temperature=0.7)
        assert LLMRoleConfig().resolved(default).temperature == 0.7
        assert LLMRoleConfig(temperature=0.0).resolved(default).temperature == 0.0

    def test_is_usable_requires_url_and_model(self):
        assert not LLMRoleConfig().is_usable()
        assert not LLMRoleConfig(base_url="x").is_usable()
        assert not LLMRoleConfig(model="m").is_usable()
        assert LLMRoleConfig(base_url="x", model="m").is_usable()


class TestPublicDict:
    def test_api_key_never_exposed(self):
        s = Settings()
        s.llm = LLMRoleConfig(base_url="http://x/v1", api_key="sk-super-secret", model="m")
        pub = s.to_public_dict()
        blob = json.dumps(pub, ensure_ascii=False)
        assert "sk-super-secret" not in blob
        assert pub["llm"]["api_key_set"] is True
        assert pub["llm"]["api_key_hint"] == "****cret"

    def test_short_key_has_no_hint(self):
        s = Settings()
        s.llm = LLMRoleConfig(base_url="x", api_key="abc", model="m")
        assert s.to_public_dict()["llm"]["api_key_hint"] == ""

    def test_rag_keys_masked(self):
        s = Settings()
        s.embed_api_key = "embed-secret"
        pub = s.to_public_dict()
        assert "embed-secret" not in json.dumps(pub)
        assert pub["rag"]["embed_api_key_set"] is True


class TestEnvFile:
    def test_parses_key_value(self, tmp_path: Path):
        f = tmp_path / ".env"
        f.write_text(
            "# comment\nLLM_MODEL=my-model\n\nLLM_API_KEY='quoted'\n"
            'LLM_BASE_URL="http://x/v1"\n',
            encoding="utf-8",
        )
        got = _load_env_file(f)
        assert got["LLM_MODEL"] == "my-model"
        assert got["LLM_API_KEY"] == "quoted"
        assert got["LLM_BASE_URL"] == "http://x/v1"

    def test_missing_file_returns_empty(self, tmp_path: Path):
        assert _load_env_file(tmp_path / "nope.env") == {}

    def test_ignores_malformed_lines(self, tmp_path: Path):
        f = tmp_path / ".env"
        f.write_text("NOEQUALS\n=novalue\nGOOD=1\n", encoding="utf-8")
        got = _load_env_file(f)
        assert got.get("GOOD") == "1"
        assert "NOEQUALS" not in got


class TestLoadSettings:
    def test_env_vars_take_effect(self, monkeypatch):
        monkeypatch.setenv("LLM_BASE_URL", "http://env/v1")
        monkeypatch.setenv("LLM_MODEL", "env-model")
        monkeypatch.setenv("LLM_API_KEY", "env-key")
        s = load_settings()
        assert s.llm.base_url == "http://env/v1"
        assert s.llm.model == "env-model"
        assert s.llm.api_key == "env-key"

    def test_rag_env_vars(self, monkeypatch):
        monkeypatch.setenv("EMBED_BASE_URL", "http://e/v1")
        monkeypatch.setenv("EMBED_MODEL", "em")
        monkeypatch.setenv("EMBED_API_KEY", "ek")
        s = load_settings()
        env = rag_env(s)
        assert env["EMBED_BASE_URL"] == "http://e/v1"
        assert env["EMBED_MODEL"] == "em"
        assert env["EMBED_API_KEY"] == "ek"

    def test_role_method_falls_back(self, monkeypatch):
        monkeypatch.setenv("LLM_BASE_URL", "http://d/v1")
        monkeypatch.setenv("LLM_MODEL", "default-model")
        s = load_settings()
        assert s.role("review").model == "default-model"


class TestRuntimeSettings:
    """运行时配置落盘与合并（/service/config 的底层）。"""

    def test_roundtrip(self, tmp_path: Path, monkeypatch):
        target = tmp_path / "settings.json"
        monkeypatch.setattr("service.config.RUNTIME_SETTINGS", target)

        save_runtime_settings({
            "llm": {"base_url": "http://rt/v1", "model": "rt-model",
                    "api_key": "rt-key"},
        })
        assert target.is_file()
        s = load_settings()
        assert s.llm.base_url == "http://rt/v1"
        assert s.llm.model == "rt-model"
        assert s.llm.api_key == "rt-key"

    def test_empty_api_key_does_not_overwrite(self, tmp_path: Path, monkeypatch):
        """传空字符串表示"不改"，避免前端把已存的 key 抹掉。"""
        target = tmp_path / "settings.json"
        monkeypatch.setattr("service.config.RUNTIME_SETTINGS", target)

        save_runtime_settings({"llm": {"base_url": "http://rt/v1",
                                       "model": "m", "api_key": "keep-me"}})
        save_runtime_settings({"llm": {"model": "m2", "api_key": ""}})

        s = load_settings()
        assert s.llm.api_key == "keep-me"
        assert s.llm.model == "m2"

    def test_role_merge_preserves_other_roles(self, tmp_path: Path, monkeypatch):
        target = tmp_path / "settings.json"
        monkeypatch.setattr("service.config.RUNTIME_SETTINGS", target)

        save_runtime_settings({"llm_roles": {"review": {"model": "r1"}}})
        save_runtime_settings({"llm_roles": {"draft": {"model": "d1"}}})

        s = load_settings()
        assert s.role("review").model == "r1"
        assert s.role("draft").model == "d1"

    def test_corrupt_file_does_not_crash(self, tmp_path: Path, monkeypatch):
        target = tmp_path / "settings.json"
        target.write_text("{ this is not json", encoding="utf-8")
        monkeypatch.setattr("service.config.RUNTIME_SETTINGS", target)
        s = load_settings()  # 不应抛异常
        assert isinstance(s, Settings)
