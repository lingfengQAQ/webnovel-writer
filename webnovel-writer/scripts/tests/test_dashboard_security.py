from __future__ import annotations

import importlib
import sys
from pathlib import Path

from fastapi.testclient import TestClient


def _create_dashboard_client(monkeypatch, project_root: Path) -> TestClient:
    plugin_root = Path(__file__).resolve().parents[2]
    if str(plugin_root) not in sys.path:
        monkeypatch.syspath_prepend(str(plugin_root))

    for name in list(sys.modules):
        if name == "dashboard.app":
            sys.modules.pop(name, None)

    module = importlib.import_module("dashboard.app")
    return TestClient(module.create_app(project_root))


def test_dashboard_cors_allows_localhost_origin(monkeypatch, tmp_path):
    (tmp_path / ".webnovel").mkdir(parents=True)
    (tmp_path / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    client = _create_dashboard_client(monkeypatch, tmp_path)

    response = client.options(
        "/api/project/info",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_dashboard_cors_rejects_untrusted_origin(monkeypatch, tmp_path):
    (tmp_path / ".webnovel").mkdir(parents=True)
    (tmp_path / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    client = _create_dashboard_client(monkeypatch, tmp_path)

    response = client.options(
        "/api/project/info",
        headers={
            "Origin": "https://example.com",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert "access-control-allow-origin" not in response.headers


def test_dashboard_file_read_rejects_large_files(monkeypatch, tmp_path):
    (tmp_path / ".webnovel").mkdir(parents=True)
    (tmp_path / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    prose_dir = tmp_path / "正文"
    prose_dir.mkdir()
    large_file = prose_dir / "huge.md"
    large_file.write_bytes(b"x" * (2 * 1024 * 1024 + 1))
    client = _create_dashboard_client(monkeypatch, tmp_path)

    response = client.get("/api/files/read", params={"path": "正文/huge.md"})

    assert response.status_code == 413
