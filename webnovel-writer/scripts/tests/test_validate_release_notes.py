#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import sys
from pathlib import Path


def _ensure_scripts_on_path() -> None:
    scripts_dir = Path(__file__).resolve().parents[1]
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))


_ensure_scripts_on_path()

from validate_release_notes import validate_release_notes  # noqa: E402


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_release_files(root: Path, *, version: str = "1.2.3", previous_tag: str = "v1.2.2") -> None:
    _write_json(
        root / "webnovel-writer" / ".claude-plugin" / "plugin.json",
        {"name": "webnovel-writer", "version": version, "description": "desc"},
    )
    (root / "CHANGELOG.md").write_text(
        f"""# 更新日志

## v{version} - 写章结果更清楚

发版范围：`{previous_tag}..v{version}`。

### 给作者看的变化

- 作者写章反馈更清楚。
""",
        encoding="utf-8",
    )
    release_dir = root / "releases"
    release_dir.mkdir(parents=True, exist_ok=True)
    (release_dir / f"v{version}.md").write_text(
        f"""# v{version} - 写章结果更清楚

## 发版范围

本次发布覆盖从 `{previous_tag}` 到本发布提交的全部变化。

## 给作者看的变化

- 作者写章反馈更清楚。

## 是否需要改旧项目

不需要。

## 给维护者

- 新增校验。

## 验证

- pytest
""",
        encoding="utf-8",
    )


def test_validate_release_notes_passes_complete_author_facing_notes(tmp_path):
    _write_release_files(tmp_path)

    report = validate_release_notes(tmp_path, version="1.2.3", previous_tag="v1.2.2")

    assert report["ok"] is True


def test_validate_release_notes_requires_release_file(tmp_path):
    _write_release_files(tmp_path)
    (tmp_path / "releases" / "v1.2.3.md").unlink()

    report = validate_release_notes(tmp_path, version="1.2.3", previous_tag="v1.2.2")

    assert report["ok"] is False
    assert any(item["code"] == "release_note.missing" for item in report["issues"])


def test_validate_release_notes_requires_previous_tag_in_release_note(tmp_path):
    _write_release_files(tmp_path)
    path = tmp_path / "releases" / "v1.2.3.md"
    path.write_text(path.read_text(encoding="utf-8").replace("v1.2.2", "上个版本"), encoding="utf-8")

    report = validate_release_notes(tmp_path, version="1.2.3", previous_tag="v1.2.2")

    assert report["ok"] is False
    assert any(item["code"] == "release_note.range" for item in report["issues"])


def test_validate_release_notes_requires_previous_tag_in_current_changelog_section(tmp_path):
    _write_release_files(tmp_path)
    changelog = tmp_path / "CHANGELOG.md"
    changelog.write_text(
        """# 更新日志

## v1.2.3 - 写章结果更清楚

发版范围：上个版本到本版本。

### 给作者看的变化

- 作者写章反馈更清楚。

## v1.2.2 - 旧版本

发版范围：`v1.2.1..v1.2.2`。
""",
        encoding="utf-8",
    )

    report = validate_release_notes(tmp_path, version="1.2.3", previous_tag="v1.2.2")

    assert report["ok"] is False
    assert any(item["code"] == "changelog.range" for item in report["issues"])
