#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for validate_csv.py."""

import subprocess
import sys
from pathlib import Path
import csv
import tempfile
import uuid


SCRIPT = str(Path(__file__).resolve().parents[1] / "validate_csv.py")
CSV_DIR = str(Path(__file__).resolve().parents[2] / "references" / "csv")


def _make_local_tmp_path() -> Path:
    return Path(tempfile.mkdtemp(prefix=f"validate_csv_cases_{uuid.uuid4().hex}_"))


def run_validate(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, SCRIPT, "--csv-dir", CSV_DIR, *args],
        capture_output=True,
        text=True,
    )


class TestValidateCsvRuns:
    def test_script_runs_without_crash(self):
        result = run_validate()
        assert result.returncode in (0, 1)
        assert "Traceback" not in result.stderr

    def test_json_output_mode(self):
        import json

        result = run_validate("--format", "json")
        assert result.returncode in (0, 1)
        data = json.loads(result.stdout)
        assert "errors" in data
        assert "warnings" in data

    def test_current_csv_data_has_no_errors_or_warnings(self):
        import json

        result = run_validate("--format", "json")
        assert result.returncode == 0, result.stderr
        data = json.loads(result.stdout)
        assert data["errors"] == []
        assert data["warnings"] == []

    def test_phase2_row_count_thresholds(self):
        csv_dir = Path(CSV_DIR)
        with open(csv_dir / "题材与调性推理.csv", "r", encoding="utf-8-sig", newline="") as f:
            route_rows = list(csv.DictReader(f))
        with open(csv_dir / "裁决规则.csv", "r", encoding="utf-8-sig", newline="") as f:
            reasoning_rows = list(csv.DictReader(f))

        assert len(route_rows) >= 16
        assert len(reasoning_rows) >= 14

    def test_detects_extra_csv_fields(self):
        tmp_path = _make_local_tmp_path()
        (tmp_path / "命名规则.csv").write_text(
            "\n".join(
                [
                    "编号,适用技能,分类,层级,关键词,意图与同义词,适用题材,大模型指令,核心摘要,详细展开,命名对象,规则,正例,反例,毒点",
                    "NR-999,write,测试,知识补充,角色命名,,玄幻,指令,摘要,详细,人名,规则,正例,反例,毒点,EXTRA",
                ]
            ),
            encoding="utf-8-sig",
        )

        result = subprocess.run(
            [sys.executable, SCRIPT, "--csv-dir", str(tmp_path), "--format", "json"],
            capture_output=True,
            text=True,
        )

        import json

        data = json.loads(result.stdout)
        assert any("字段数超过表头" in error for error in data["errors"])

    def test_detects_invalid_skill_and_level(self):
        tmp_path = _make_local_tmp_path()
        (tmp_path / "命名规则.csv").write_text(
            "\n".join(
                [
                    "编号,适用技能,分类,层级,关键词,意图与同义词,适用题材,大模型指令,核心摘要,详细展开,命名对象,规则,正例,反例,毒点",
                    "NR-998,bogus,测试,推理层,角色命名,,玄幻,指令,摘要,详细,人名,规则,正例,反例,毒点",
                ]
            ),
            encoding="utf-8-sig",
        )

        result = subprocess.run(
            [sys.executable, SCRIPT, "--csv-dir", str(tmp_path), "--format", "json"],
            capture_output=True,
            text=True,
        )

        import json

        data = json.loads(result.stdout)
        assert any("适用技能值 'bogus' 不合法" in error for error in data["errors"])
        assert any("层级值 '推理层' 不合法" in error for error in data["errors"])
