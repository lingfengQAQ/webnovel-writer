#!/usr/bin/env python3

import json
import sqlite3
from pathlib import Path

from data_modules.rag_verifier import RAGVerifier


def _create_project_root(tmp_path: Path) -> Path:
    project_root = tmp_path / "book"
    webnovel_dir = project_root / ".webnovel"
    codex_dir = webnovel_dir / "codex"
    codex_dir.mkdir(parents=True, exist_ok=True)
    (webnovel_dir / "state.json").write_text("{}", encoding="utf-8")

    index_db = webnovel_dir / "index.db"
    with sqlite3.connect(str(index_db)):
        pass

    vectors_db = webnovel_dir / "vectors.db"
    with sqlite3.connect(str(vectors_db)) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE rag_schema_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cursor.execute(
            "INSERT INTO rag_schema_meta (key, value, updated_at) VALUES (?, ?, ?)",
            ("schema_version", "2", "2026-03-29T00:00:00"),
        )
        conn.commit()

    return project_root


def _write_benchmark(project_root: Path, payload: dict) -> None:
    benchmark_path = project_root / ".webnovel" / "codex" / "rag-benchmark.json"
    benchmark_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def test_rag_verifier_fails_closed_without_benchmark(tmp_path):
    project_root = _create_project_root(tmp_path)

    report = RAGVerifier(project_root).verify()

    assert report["status"] == "failed"
    assert report["connectivity"]["status"] == "ok"
    assert report["correctness"]["status"] == "failed"
    assert report["performance"]["status"] == "failed"
    assert any("benchmark 文件不存在" in err for err in report["correctness"]["errors"])


def test_rag_verifier_passes_with_real_benchmark_artifact(tmp_path):
    project_root = _create_project_root(tmp_path)
    _write_benchmark(
        project_root,
        {
            "correctness": {
                "metrics": {
                    "hit_at_5": 0.93,
                    "mrr_at_10": 0.74,
                    "chapter_constraint_accuracy": 0.99,
                }
            },
            "performance": {
                "metrics": {
                    "p95_latency_ms": 650,
                    "p99_latency_ms": 1000,
                    "incremental_index_p95_ms": 1400,
                    "file_change_to_searchable_p95_ms": 2500,
                }
            },
        },
    )

    report = RAGVerifier(project_root).verify()

    assert report["status"] == "ok"
    assert report["passed"] is True
    assert report["connectivity"]["schema_meta_source"] == "vectors.db"
    assert report["correctness"]["metrics"]["hit_at_5"] == 0.93
    assert report["performance"]["metrics"]["p95_latency_ms"] == 650.0


def test_rag_verifier_fails_when_benchmark_metric_is_below_threshold(tmp_path):
    project_root = _create_project_root(tmp_path)
    _write_benchmark(
        project_root,
        {
            "correctness": {
                "metrics": {
                    "hit_at_5": 0.89,
                    "mrr_at_10": 0.74,
                    "chapter_constraint_accuracy": 0.99,
                }
            },
            "performance": {
                "metrics": {
                    "p95_latency_ms": 650,
                    "p99_latency_ms": 1000,
                    "incremental_index_p95_ms": 1400,
                    "file_change_to_searchable_p95_ms": 2500,
                }
            },
        },
    )

    report = RAGVerifier(project_root).verify()

    assert report["status"] == "failed"
    assert report["correctness"]["status"] == "failed"
    assert report["correctness"]["passed"] is False
