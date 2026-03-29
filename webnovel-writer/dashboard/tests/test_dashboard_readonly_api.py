from __future__ import annotations

import shutil
import sqlite3
import sys
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from dashboard.app import create_app


def _new_project_root(test_name: str) -> Path:
    base = PACKAGE_ROOT / "dashboard" / "tests" / "_tmp_dashboard_api"
    base.mkdir(parents=True, exist_ok=True)
    project_root = base / f"{test_name}-{uuid4().hex[:8]}"
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=False)
    return project_root


def _create_index_db(project_root: Path, schema_sql: str) -> Path:
    db_path = project_root / ".webnovel" / "index.db"
    with sqlite3.connect(db_path) as conn:
        conn.executescript(schema_sql)
    return db_path


def _app_client(project_root: Path) -> TestClient:
    app = create_app(project_root=str(project_root))
    return TestClient(app)


def _full_readonly_schema_sql() -> str:
    return """
    CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        canonical_name TEXT,
        type TEXT,
        tier TEXT,
        is_archived INTEGER DEFAULT 0,
        is_protagonist INTEGER DEFAULT 0,
        first_appearance INTEGER,
        last_appearance INTEGER
    );

    CREATE TABLE relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_entity TEXT,
        to_entity TEXT,
        type TEXT,
        description TEXT,
        chapter INTEGER
    );

    CREATE TABLE chapters (
        chapter INTEGER PRIMARY KEY,
        title TEXT
    );

    CREATE TABLE chapter_reading_power (
        chapter INTEGER,
        hook_strength TEXT,
        is_transition INTEGER DEFAULT 0,
        debt_balance REAL
    );
    """


def test_dashboard_overview_empty_db_returns_zero_aggregates():
    project_root = _new_project_root("overview-empty")
    try:
        _create_index_db(project_root, _full_readonly_schema_sql())

        with _app_client(project_root) as client:
            response = client.get("/api/dashboard/overview")

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "ok"
        assert payload["counts"] == {
            "entities": 0,
            "relationships": 0,
            "chapters": 0,
            "files": 0,
        }
        assert payload["reading_power"] == {
            "total_rows": 0,
            "latest_chapter": None,
            "transition_chapters": 0,
            "avg_debt_balance": None,
            "hook_strength_distribution": {
                "strong": 0,
                "medium": 0,
                "weak": 0,
                "unknown": 0,
            },
        }
    finally:
        shutil.rmtree(project_root, ignore_errors=True)


def test_graph_empty_db_returns_empty_nodes_and_edges():
    project_root = _new_project_root("graph-empty")
    try:
        _create_index_db(project_root, _full_readonly_schema_sql())

        with _app_client(project_root) as client:
            response = client.get("/api/graph")

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "ok"
        assert payload["nodes"] == []
        assert payload["edges"] == []
        assert payload["meta"] == {
            "node_count": 0,
            "edge_count": 0,
            "include_archived": False,
        }
    finally:
        shutil.rmtree(project_root, ignore_errors=True)


def test_dashboard_overview_returns_structured_error_when_index_db_missing():
    project_root = _new_project_root("overview-missing-db")
    try:
        with _app_client(project_root) as client:
            response = client.get("/api/dashboard/overview")

        assert response.status_code == 404
        payload = response.json()
        assert payload["error_code"] == "index_db_not_found"
        assert payload["details"]["path"].endswith("index.db")
    finally:
        shutil.rmtree(project_root, ignore_errors=True)


def test_dashboard_overview_returns_db_table_missing_when_schema_incomplete():
    project_root = _new_project_root("overview-missing-table")
    try:
        _create_index_db(
            project_root,
            """
            CREATE TABLE entities (
                id TEXT PRIMARY KEY,
                is_archived INTEGER DEFAULT 0
            );
            """,
        )

        with _app_client(project_root) as client:
            response = client.get("/api/dashboard/overview")

        assert response.status_code == 500
        payload = response.json()
        assert payload["error_code"] == "db_table_missing"
        assert payload["details"]["table"] == "relationships"
    finally:
        shutil.rmtree(project_root, ignore_errors=True)


def test_graph_returns_db_table_missing_when_entities_table_absent():
    project_root = _new_project_root("graph-missing-table")
    try:
        _create_index_db(
            project_root,
            """
            CREATE TABLE relationships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_entity TEXT,
                to_entity TEXT,
                type TEXT,
                description TEXT,
                chapter INTEGER
            );
            """,
        )

        with _app_client(project_root) as client:
            response = client.get("/api/graph")

        assert response.status_code == 500
        payload = response.json()
        assert payload["error_code"] == "db_table_missing"
        assert payload["details"]["table"] == "entities"
    finally:
        shutil.rmtree(project_root, ignore_errors=True)


def test_graph_rejects_invalid_limit_parameter():
    project_root = _new_project_root("graph-invalid-limit")
    try:
        _create_index_db(project_root, _full_readonly_schema_sql())

        with _app_client(project_root) as client:
            response = client.get("/api/graph", params={"limit": 0})

        assert response.status_code == 422
        payload = response.json()
        assert "detail" in payload
        assert isinstance(payload["detail"], list)
    finally:
        shutil.rmtree(project_root, ignore_errors=True)
