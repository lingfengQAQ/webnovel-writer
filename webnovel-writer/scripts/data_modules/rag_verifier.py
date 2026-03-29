#!/usr/bin/env python3
"""
RAG 验证工具。

当前策略：
1. 连通性检查直接访问数据库与 schema 元信息。
2. 正确性 / 性能只读取真实 benchmark 产物，不再使用硬编码成功值。
3. 若 benchmark 产物不存在、格式错误、或缺少必需指标，则 fail closed。
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

CORRECTNESS_THRESHOLDS = {
    "hit_at_5": 0.90,
    "mrr_at_10": 0.70,
    "chapter_constraint_accuracy": 0.98,
}

PERFORMANCE_THRESHOLDS = {
    "p95_latency_ms": 700,
    "p99_latency_ms": 1200,
    "incremental_index_p95_ms": 1500,
    "file_change_to_searchable_p95_ms": 3000,
}


class RAGVerifier:
    """RAG 验证器。"""

    def __init__(self, project_root: Path):
        self.project_root = project_root.resolve()
        self.webnovel_dir = self.project_root / ".webnovel"
        self.codex_dir = self.webnovel_dir / "codex"
        self.vectors_db = self.webnovel_dir / "vectors.db"
        self.index_db = self.webnovel_dir / "index.db"
        self.benchmark_file = self.codex_dir / "rag-benchmark.json"

    def verify(self) -> dict[str, Any]:
        report = {
            "status": "pending",
            "passed": False,
            "timestamp": datetime.now(UTC).isoformat(),
            "connectivity": self._verify_connectivity(),
            "correctness": self._verify_correctness(),
            "performance": self._verify_performance(),
        }

        report["passed"] = all(
            section.get("status") == "ok"
            for section in (report["connectivity"], report["correctness"], report["performance"])
        )
        report["status"] = "ok" if report["passed"] else "failed"
        return report

    def _verify_connectivity(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "status": "pending",
            "checks": {
                "vectors_db_exists": False,
                "index_db_exists": False,
                "vectors_db_readable": False,
                "index_db_readable": False,
                "rag_schema_meta_exists": False,
                "schema_version_present": False,
            },
            "schema_meta_source": None,
            "errors": [],
        }

        result["checks"]["vectors_db_exists"] = self.vectors_db.exists()
        result["checks"]["index_db_exists"] = self.index_db.exists()

        if not result["checks"]["vectors_db_exists"]:
            result["errors"].append("vectors.db 不存在")
        if not result["checks"]["index_db_exists"]:
            result["errors"].append("index.db 不存在")

        result["checks"]["vectors_db_readable"] = self._db_readable(self.vectors_db, result["errors"], "vectors.db")
        result["checks"]["index_db_readable"] = self._db_readable(self.index_db, result["errors"], "index.db")

        schema_meta = self._detect_schema_meta()
        result["checks"]["rag_schema_meta_exists"] = schema_meta["exists"]
        result["checks"]["schema_version_present"] = schema_meta["schema_version_present"]
        result["schema_meta_source"] = schema_meta["source"]
        result["errors"].extend(schema_meta["errors"])

        result["status"] = "ok" if all(result["checks"].values()) and not result["errors"] else "failed"
        return result

    def _verify_correctness(self) -> dict[str, Any]:
        return self._verify_benchmark_section(
            section_name="correctness",
            thresholds=CORRECTNESS_THRESHOLDS,
            comparison_mode="min",
        )

    def _verify_performance(self) -> dict[str, Any]:
        return self._verify_benchmark_section(
            section_name="performance",
            thresholds=PERFORMANCE_THRESHOLDS,
            comparison_mode="max",
        )

    def _verify_benchmark_section(
        self,
        *,
        section_name: str,
        thresholds: dict[str, float],
        comparison_mode: str,
    ) -> dict[str, Any]:
        result: dict[str, Any] = {
            "status": "failed",
            "metrics": {},
            "thresholds": dict(thresholds),
            "passed": False,
            "source": {
                "path": str(self.benchmark_file),
                "exists": self.benchmark_file.is_file(),
            },
            "errors": [],
        }

        payload = self._load_benchmark_payload(result["errors"])
        if payload is None:
            return result

        raw_section = payload.get(section_name)
        if not isinstance(raw_section, dict):
            result["errors"].append(f"benchmark 缺少 {section_name} 段")
            return result

        raw_metrics = raw_section.get("metrics", raw_section)
        if not isinstance(raw_metrics, dict):
            result["errors"].append(f"benchmark {section_name}.metrics 不是对象")
            return result

        metrics: dict[str, float] = {}
        for metric_name in thresholds:
            value = raw_metrics.get(metric_name)
            number = self._coerce_number(value)
            if number is None:
                result["errors"].append(f"benchmark 缺少有效指标: {section_name}.{metric_name}")
                continue
            metrics[metric_name] = number

        result["metrics"] = metrics
        if result["errors"]:
            return result

        checks: list[bool] = []
        for metric_name, threshold in thresholds.items():
            value = metrics[metric_name]
            if comparison_mode == "min":
                checks.append(value >= threshold)
            else:
                checks.append(value <= threshold)

        result["passed"] = all(checks)
        result["status"] = "ok" if result["passed"] else "failed"
        return result

    def _load_benchmark_payload(self, errors: list[str]) -> dict[str, Any] | None:
        if not self.benchmark_file.is_file():
            errors.append(f"benchmark 文件不存在: {self.benchmark_file}")
            return None

        try:
            payload = json.loads(self.benchmark_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"benchmark 文件不是合法 JSON: {exc}")
            return None
        except OSError as exc:
            errors.append(f"benchmark 文件不可读: {exc}")
            return None

        if not isinstance(payload, dict):
            errors.append("benchmark 文件根节点必须是对象")
            return None
        return payload

    def _db_readable(self, db_path: Path, errors: list[str], label: str) -> bool:
        conn: sqlite3.Connection | None = None
        try:
            conn = sqlite3.connect(str(db_path))
            return True
        except Exception as exc:
            errors.append(f"{label} 不可读: {exc}")
            return False
        finally:
            if conn is not None:
                conn.close()

    def _detect_schema_meta(self) -> dict[str, Any]:
        result = {
            "exists": False,
            "schema_version_present": False,
            "source": None,
            "errors": [],
        }

        for label, db_path in (("vectors.db", self.vectors_db), ("index.db", self.index_db)):
            if not db_path.is_file():
                continue
            try:
                with sqlite3.connect(str(db_path)) as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rag_schema_meta'")
                    table_exists = cursor.fetchone() is not None
                    if not table_exists:
                        continue

                    result["exists"] = True
                    result["source"] = label
                    cursor.execute("SELECT value FROM rag_schema_meta WHERE key='schema_version' LIMIT 1")
                    row = cursor.fetchone()
                    result["schema_version_present"] = bool(row and str(row[0]).strip())
                    if not result["schema_version_present"]:
                        result["errors"].append("rag_schema_meta 缺少 schema_version")
                    return result
            except Exception as exc:
                result["errors"].append(f"无法检查 {label} 中的 rag_schema_meta: {exc}")

        if not result["exists"]:
            result["errors"].append("未找到 rag_schema_meta 表")
        return result

    @staticmethod
    def _coerce_number(value: Any) -> float | None:
        if isinstance(value, bool) or value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        try:
            return float(str(value).strip())
        except (TypeError, ValueError):
            return None
