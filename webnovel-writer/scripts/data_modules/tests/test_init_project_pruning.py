#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import pytest


def test_init_skips_dead_templates_and_empty_libraries_for_single_protagonist(tmp_path, monkeypatch):
    import init_project as init_project_module

    monkeypatch.setattr(init_project_module, "is_git_available", lambda: False)
    project_root = tmp_path / "book"

    init_project_module.init_project(
        str(project_root),
        title="测试书",
        genre="仙侠",
        protagonist_name="陆鸣",
        protagonist_structure="单主角+辅助视角",
        heroine_config="无女主",
        target_chapters=50,
    )

    assert (project_root / "设定集" / "主角卡.md").is_file()
    assert not (project_root / "设定集" / "主角组.md").exists()
    assert not (project_root / "设定集" / "女主卡.md").exists()
    assert not (project_root / "设定集" / "金手指设计.md").exists()
    assert not (project_root / "设定集" / "复合题材-融合逻辑.md").exists()
    assert not (project_root / "大纲" / "爽点规划.md").exists()
    assert not (project_root / "设定集" / "角色库").exists()
    assert not (project_root / "设定集" / "物品库").exists()
    assert not (project_root / "设定集" / "其他设定").exists()


def test_init_master_outline_does_not_prefill_future_volume_rows(tmp_path, monkeypatch):
    import init_project as init_project_module

    monkeypatch.setattr(init_project_module, "is_git_available", lambda: False)
    project_root = tmp_path / "book"

    init_project_module.init_project(
        str(project_root),
        title="测试书",
        genre="仙侠",
        protagonist_name="陆鸣",
        target_chapters=600,
    )

    summary = (project_root / "大纲" / "总纲.md").read_text(encoding="utf-8")
    assert "| 1 |" in summary
    assert "| 2 |" not in summary
    assert "| 20 |" not in summary


def test_init_generates_conditional_protagonist_group_and_heroine(tmp_path, monkeypatch):
    import init_project as init_project_module

    monkeypatch.setattr(init_project_module, "is_git_available", lambda: False)
    project_root = tmp_path / "book"

    init_project_module.init_project(
        str(project_root),
        title="测试书",
        genre="仙侠",
        protagonist_name="陆鸣",
        protagonist_structure="双主角",
        heroine_config="单女主",
        heroine_names="苏云",
        target_chapters=50,
    )

    assert (project_root / "设定集" / "主角组.md").is_file()
    assert (project_root / "设定集" / "女主卡.md").is_file()


def test_init_rejects_english_profile_key_before_writing_state(tmp_path, monkeypatch):
    import init_project as init_project_module

    monkeypatch.setattr(init_project_module, "is_git_available", lambda: False)
    project_root = tmp_path / "book"

    with pytest.raises(SystemExit) as exc:
        init_project_module.init_project(
            str(project_root),
            title="测试书",
            genre="rules-mystery",
            protagonist_name="陆鸣",
            target_chapters=50,
        )

    message = str(exc.value)
    assert "rules-mystery" in message
    assert "规则怪谈" in message
    assert not (project_root / ".webnovel" / "state.json").exists()
