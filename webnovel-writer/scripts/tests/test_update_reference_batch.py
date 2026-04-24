#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tests for update_reference_batch.py.
"""

import csv
import shutil
import uuid
from pathlib import Path

import pytest

from scripts.update_reference_batch import LEGACY_DISABLED_MESSAGE, append_unique_rows, apply_batch


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def make_temp_dir() -> Path:
    temp_dir = Path.home() / ".codex" / "memories" / f"reference_batch_{uuid.uuid4().hex}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    return temp_dir


def test_append_unique_rows_appends_only_missing_ids():
    temp_dir = make_temp_dir()
    csv_path = temp_dir / "测试.csv"
    fieldnames = ["编号", "名称", "说明"]
    try:
        write_csv(
            csv_path,
            fieldnames,
            [{"编号": "TS-001", "名称": "已有条目", "说明": "旧内容"}],
        )

        added, skipped = append_unique_rows(
            csv_path,
            [
                {"编号": "TS-001", "名称": "重复条目", "说明": "不应重复写入"},
                {"编号": "TS-002", "名称": "新增条目", "说明": "新内容"},
            ],
        )

        assert added == 1
        assert skipped == 1
        rows = read_csv(csv_path)
        assert rows == [
            {"编号": "TS-001", "名称": "已有条目", "说明": "旧内容"},
            {"编号": "TS-002", "名称": "新增条目", "说明": "新内容"},
        ]
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_append_unique_rows_rejects_unknown_columns():
    temp_dir = make_temp_dir()
    csv_path = temp_dir / "测试.csv"
    fieldnames = ["编号", "名称"]
    try:
        write_csv(csv_path, fieldnames, [])

        with pytest.raises(ValueError, match="UNKNOWN_COLUMNS"):
            append_unique_rows(
                csv_path,
                [{"编号": "TS-003", "名称": "新增", "说明": "多余列"}],
            )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_apply_batch_refuses_non_dry_run():
    with pytest.raises(RuntimeError, match="legacy"):
        apply_batch(Path("."), dry_run=False)


def test_apply_batch_error_message_points_to_manual_flow():
    assert "Edit CSV rows manually" in LEGACY_DISABLED_MESSAGE
