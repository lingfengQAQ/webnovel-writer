#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import sys

import pytest

from data_modules.placeholder_scanner import scan_placeholders


def test_placeholder_scanner_finds_pending_marks(tmp_path):
    outline_dir = tmp_path / "大纲"
    settings_dir = tmp_path / "设定集"
    outline_dir.mkdir()
    settings_dir.mkdir()
    (outline_dir / "第1卷-卷纲.md").write_text(
        "第一位女主（暂名）| [待章纲拆分时具体设计]\n",
        encoding="utf-8",
    )
    (settings_dir / "主角卡.md").write_text("- 兄弟：{占位}\n", encoding="utf-8")

    results = scan_placeholders(tmp_path)

    assert len(results) == 3
    assert any(item["pattern"] == "（暂名）" for item in results)
    assert any(item["pattern"].startswith("[待章纲") for item in results)
    assert any(item["pattern"] == "{占位}" for item in results)


def test_webnovel_placeholder_scan_cli_forwards_project_root(monkeypatch, tmp_path, capsys):
    import data_modules.webnovel as webnovel_module

    project_root = tmp_path / "book"
    (project_root / ".webnovel").mkdir(parents=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    (project_root / "大纲").mkdir()
    (project_root / "大纲" / "总纲.md").write_text("[待补充]\n", encoding="utf-8")

    monkeypatch.setattr(sys, "argv", ["webnovel", "--project-root", str(project_root), "placeholder-scan"])

    with pytest.raises(SystemExit) as exc:
        webnovel_module.main()

    assert int(exc.value.code or 0) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["ok"] is False
    assert payload["placeholders"][0]["file"] == "大纲/总纲.md"
