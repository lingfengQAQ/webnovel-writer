# -*- coding: utf-8 -*-
"""Engine 子进程调用测试。

不真的跑上游 CLI：只验证命令构造、工作目录选择、错误处理。
覆盖修过的真实 bug：init 时目标目录还不存在，cwd 用了它导致
subprocess 抛 NotADirectoryError（WinError 267）。
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from service.config import Settings
from service.engine import Engine, EngineError
from service.config import UPSTREAM_ROOT


def _engine(project_root=None) -> Engine:
    s = Settings()
    s.llm.base_url = "http://x/v1"
    s.llm.model = "m"
    return Engine(s, project_root=project_root)


class TestCwdResolution:
    """cwd 必须存在，否则 Windows 上会抛 WinError 267。"""

    def test_nonexistent_project_root_raises_readable_error(self, tmp_path: Path):
        missing = tmp_path / "does-not-exist"
        eng = _engine(str(missing))
        with pytest.raises(EngineError, match="不存在或不是目录"):
            eng.run(["project-status"])

    def test_init_uses_plugin_root_as_cwd(self, monkeypatch, tmp_path: Path):
        """init 时目标目录尚未创建，cwd 必须回退到插件根。"""
        captured = {}

        def fake_run(cmd, **kw):
            captured["cwd"] = kw.get("cwd")
            captured["cmd"] = cmd
            return subprocess.CompletedProcess(cmd, 0, "ok", "")

        monkeypatch.setattr("service.engine.subprocess.run", fake_run)
        target = tmp_path / "new-book"          # 故意不存在
        eng = _engine(None)
        eng.init_project(str(target), "书名", "玄幻")

        assert captured["cwd"] == str(UPSTREAM_ROOT)
        assert Path(captured["cwd"]).is_dir()

    def test_normal_command_uses_project_root_as_cwd(self, monkeypatch, tmp_path: Path):
        captured = {}
        monkeypatch.setattr("service.engine.subprocess.run",
                            lambda cmd, **kw: (captured.update(cwd=kw.get("cwd")),
                                               subprocess.CompletedProcess(cmd, 0, "{}", ""))[1])
        eng = _engine(str(tmp_path))
        eng.run(["project-status", "--format", "json"])
        assert captured["cwd"] == str(tmp_path)

    def test_preflight_does_not_need_project_dir(self, monkeypatch, tmp_path: Path):
        """preflight 自己会校验项目根，不该因为项目根不存在而起不来子进程。"""
        captured = {}
        monkeypatch.setattr("service.engine.subprocess.run",
                            lambda cmd, **kw: (captured.update(cwd=kw.get("cwd")),
                                               subprocess.CompletedProcess(cmd, 0, "{}", ""))[1])
        eng = _engine(str(tmp_path / "missing"))
        eng.preflight()
        assert captured["cwd"] == str(UPSTREAM_ROOT)


class TestCommandConstruction:
    def _capture(self, monkeypatch):
        captured = {}

        def fake_run(cmd, **kw):
            captured["cmd"] = cmd
            captured["env"] = kw.get("env") or {}
            return subprocess.CompletedProcess(cmd, 0, "{}", "")

        monkeypatch.setattr("service.engine.subprocess.run", fake_run)
        return captured

    def test_project_root_flag_injected(self, monkeypatch, tmp_path: Path):
        cap = self._capture(monkeypatch)
        eng = _engine(str(tmp_path))
        eng.run(["project-status"])
        cmd = cap["cmd"]
        assert "--project-root" in cmd
        assert str(tmp_path) in cmd

    def test_init_includes_genre_positionally(self, monkeypatch, tmp_path: Path):
        """上游把 genre 定为必填位置参数，缺失会 argparse 报错。"""
        cap = self._capture(monkeypatch)
        eng = _engine(None)
        eng.init_project(str(tmp_path / "b"), "书名", "玄幻")
        cmd = cap["cmd"]
        assert "init" in cmd
        assert "玄幻" in cmd
        # init 不应带 --project-root
        assert "--project-root" not in cmd

    def test_init_defaults_genre_when_empty(self, monkeypatch, tmp_path: Path):
        cap = self._capture(monkeypatch)
        eng = _engine(None)
        eng.init_project(str(tmp_path / "b"), "书名", "")
        assert "玄幻" in cap["cmd"]

    def test_init_skips_empty_options(self, monkeypatch, tmp_path: Path):
        cap = self._capture(monkeypatch)
        eng = _engine(None)
        eng.init_project(str(tmp_path / "b"), "书名", "玄幻",
                         protagonist_name="", target_chapters=0)
        cmd = " ".join(cap["cmd"])
        assert "--protagonist-name" not in cmd
        assert "--target-chapters" not in cmd

    def test_init_passes_non_empty_options(self, monkeypatch, tmp_path: Path):
        cap = self._capture(monkeypatch)
        eng = _engine(None)
        eng.init_project(str(tmp_path / "b"), "书名", "玄幻",
                         protagonist_name="林昭", target_chapters=600)
        cmd = " ".join(cap["cmd"])
        assert "--protagonist-name 林昭" in cmd
        assert "--target-chapters 600" in cmd

    def test_utf8_env_set(self, monkeypatch, tmp_path: Path):
        cap = self._capture(monkeypatch)
        eng = _engine(str(tmp_path))
        eng.run(["project-status"])
        assert cap["env"].get("PYTHONUTF8") == "1"
        assert cap["env"].get("CLAUDE_PLUGIN_ROOT") == str(UPSTREAM_ROOT)


class TestResultParsing:
    def test_json_parse(self):
        from service.engine import CommandResult
        r = CommandResult(0, '{"a": 1}', "")
        assert r.json() == {"a": 1}

    def test_json_on_empty_returns_none(self):
        from service.engine import CommandResult
        assert CommandResult(0, "   ", "").json() is None

    def test_json_on_garbage_raises(self):
        from service.engine import CommandResult
        with pytest.raises(EngineError):
            CommandResult(0, "not json", "").json()

    def test_ok_property(self):
        from service.engine import CommandResult
        assert CommandResult(0, "", "").ok
        assert not CommandResult(1, "", "").ok


class TestTimeout:
    def test_timeout_becomes_engine_error(self, monkeypatch, tmp_path: Path):
        def boom(cmd, **kw):
            raise subprocess.TimeoutExpired(cmd, 1)

        monkeypatch.setattr("service.engine.subprocess.run", boom)
        eng = _engine(str(tmp_path))
        with pytest.raises(EngineError, match="超时"):
            eng.run(["project-status"], timeout=1)
