#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import sys
from pathlib import Path

import pytest


def _ensure_scripts_on_path() -> None:
    scripts_dir = Path(__file__).resolve().parents[2]
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))


def _write_project(project_root: Path) -> None:
    outline_dir = project_root / "大纲"
    outline_dir.mkdir(parents=True)
    (outline_dir / "总纲.md").write_text(
        "\n".join(
            [
                "# 总纲",
                "",
                "## 卷划分",
                "| 卷号 | 卷名 | 章节范围 | 核心冲突 | 卷末高潮 |",
                "|------|------|----------|----------|----------|",
                "| 1 | 阎王债 | 第1-50章 | 逼债调查 | 债契真相浮出 |",
                "",
                "## 伏笔表",
                "| 伏笔内容 | 埋设章 | 回收章 | 层级 |",
                "|----------|--------|--------|------|",
                "| 旧伏笔 | 第1章 | | 卷级 |",
                "",
            ]
        ),
        encoding="utf-8",
    )
    for name in ("第1卷-节拍表.md", "第1卷-时间线.md", "第1卷-详细大纲.md"):
        (outline_dir / name).write_text(f"# {name}\n有效内容\n", encoding="utf-8")


def _write_writeback(project_root: Path, *, include_free_text: bool = False) -> Path:
    payload = {
        "next_volume_anchor": {
            "volume": 2,
            "volume_name": "黑水账",
            "core_conflict": "追查黑水账簿背后的债脉",
            "volume_end_climax": "账簿主人在宗门大比现身",
        },
        "foreshadow_writeback": [
            {
                "content": "债契背面的红印仍未解释",
                "buried_chapter": "第12章",
                "payoff_chapter": "",
                "level": "卷级",
            }
        ],
        "open_loop_writeback": [
            {"content": "苏云身份与阎王债源头仍未闭合"}
        ],
    }
    if include_free_text:
        payload["notes"] = "自由文本里提到一个不应被追加的隐藏黑手"
    path = project_root / "大纲" / "第1卷-总纲写回.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def test_next_volume_anchor_writeback(tmp_path):
    _ensure_scripts_on_path()
    from update_master_outline import sync_master_outline

    _write_project(tmp_path)
    _write_writeback(tmp_path)

    result = sync_master_outline(tmp_path, 1)

    summary = (tmp_path / "大纲" / "总纲.md").read_text(encoding="utf-8")
    assert result["next_volume"] == 2
    assert "| 2 | 黑水账 |  | 追查黑水账簿背后的债脉 | 账簿主人在宗门大比现身 |" in summary
    assert "| 3 |" not in summary


def test_structured_foreshadow_append_only(tmp_path):
    _ensure_scripts_on_path()
    from update_master_outline import sync_master_outline

    _write_project(tmp_path)
    _write_writeback(tmp_path, include_free_text=True)

    result = sync_master_outline(tmp_path, 1)

    summary = (tmp_path / "大纲" / "总纲.md").read_text(encoding="utf-8")
    assert result["structured_items_appended"] == 2
    assert "债契背面的红印仍未解释" in summary
    assert "苏云身份与阎王债源头仍未闭合" in summary
    assert "隐藏黑手" not in summary
    assert "|  |  |  |  |" not in summary


def test_master_outline_sync_does_not_create_next_volume_detail_files(tmp_path):
    _ensure_scripts_on_path()
    from update_master_outline import sync_master_outline

    _write_project(tmp_path)
    _write_writeback(tmp_path)

    sync_master_outline(tmp_path, 1)

    assert not (tmp_path / "大纲" / "第2卷-详细大纲.md").exists()
    assert not (tmp_path / "大纲" / "第2卷-节拍表.md").exists()
    assert not (tmp_path / "大纲" / "第2卷-时间线.md").exists()


def test_master_outline_sync_requires_completed_current_volume_artifacts(tmp_path):
    _ensure_scripts_on_path()
    from update_master_outline import MasterOutlineSyncError, sync_master_outline

    _write_project(tmp_path)
    _write_writeback(tmp_path)
    (tmp_path / "大纲" / "第1卷-时间线.md").unlink()

    with pytest.raises(MasterOutlineSyncError, match="artifacts are incomplete"):
        sync_master_outline(tmp_path, 1)


def test_master_outline_sync_rejects_noncanonical_writeback_source(tmp_path):
    _ensure_scripts_on_path()
    from update_master_outline import MasterOutlineSyncError, sync_master_outline

    _write_project(tmp_path)
    other = tmp_path / "大纲" / "手工备注.json"
    other.write_text(
        json.dumps(
            {
                "next_volume_anchor": {
                    "volume": 2,
                    "volume_name": "黑水账",
                    "core_conflict": "追查黑水账簿背后的债脉",
                    "volume_end_climax": "账簿主人在宗门大比现身",
                }
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    with pytest.raises(MasterOutlineSyncError, match="structured planning file"):
        sync_master_outline(tmp_path, 1, writeback_file=other)


def test_webnovel_master_outline_sync_cli_forwards_project_root(monkeypatch, tmp_path):
    _ensure_scripts_on_path()
    import data_modules.webnovel as webnovel_module

    project_root = (tmp_path / "book").resolve()
    called = {}

    def _fake_resolve(explicit_project_root=None):
        return project_root

    def _fake_run_script(script_name, argv):
        called["script_name"] = script_name
        called["argv"] = list(argv)
        return 0

    monkeypatch.setattr(webnovel_module, "_resolve_root", _fake_resolve)
    monkeypatch.setattr(webnovel_module, "_run_script", _fake_run_script)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "--project-root",
            str(tmp_path),
            "master-outline-sync",
            "--volume",
            "1",
            "--writeback-file",
            "大纲/第1卷-总纲写回.json",
            "--format",
            "text",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        webnovel_module.main()

    assert int(exc.value.code or 0) == 0
    assert called["script_name"] == "update_master_outline.py"
    assert called["argv"] == [
        "--project-root",
        str(project_root),
        "--volume",
        "1",
        "--format",
        "text",
        "--writeback-file",
        "大纲/第1卷-总纲写回.json",
    ]
