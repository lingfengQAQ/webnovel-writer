"""
P1-E 测试：/health 端点、CORS 拦截、SSE 连接数限制、_walk_tree 截断
"""

import asyncio
import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def app_with_root(tmp_path_factory):
    """\u521b\u5efa\u4e00\u4e2a\u6700\u5c0f\u53ef\u7528\u7684 project_root \u5e76\u8fd4\u56de\u5e94\u7528\u5b9e\u4f8b\u3002"""
    root = tmp_path_factory.mktemp("project")
    webnovel = root / ".webnovel"
    webnovel.mkdir()
    (webnovel / "state.json").write_text('{"version": "test"}', encoding="utf-8")
    (webnovel / "index.db").write_bytes(b"")

    from dashboard.app import create_app
    app = create_app(
        project_root=root,
        allowed_origins=["http://localhost:8765"],
    )
    return app, root


@pytest.fixture(scope="module")
def client(app_with_root):
    app, _ = app_with_root
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


# ---------------------------------------------------------------------------
# P1-F: /health \u7aef\u70b9
# ---------------------------------------------------------------------------

def test_health_always_200(client):
    """/health \u59cb\u7ec8\u8fd4\u56de 200\uff0c\u4e0e\u9879\u76ee\u6839\u76ee\u5f55\u65e0\u5173\u3002"""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "version" in data


def test_health_no_project_root():
    """\u5373\u4f7f\u6ca1\u6709\u9879\u76ee\u6839\u76ee\u5f55\uff0c/health \u4e5f\u5e94\u8fd4\u56de 200\u3002"""
    from dashboard.app import create_app
    app = create_app(project_root=None)
    with TestClient(app) as c:
        resp = c.get("/health")
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# P0-A CORS \u62e6\u622a\u9a8c\u8bc1
# ---------------------------------------------------------------------------

def test_cors_allowed_origin(client):
    """\u5141\u8bb8\u7684\u6765\u6e90\u5e94\u5f97\u5230 CORS \u5934\u3002"""
    resp = client.get(
        "/health",
        headers={"Origin": "http://localhost:8765"},
    )
    assert resp.status_code == 200
    assert "access-control-allow-origin" in resp.headers


def test_cors_forbidden_origin(client):
    """\u672a\u5141\u8bb8\u7684\u6765\u6e90\u4e0d\u5e94\u5f97\u5230 CORS \u5934\u3002"""
    resp = client.get(
        "/health",
        headers={"Origin": "http://evil.example.com"},
    )
    assert resp.status_code == 200
    # \u672a\u5c55\u5f00 CORS \u5934\uff0c\u6216\u5185\u5bb9\u4e3a\u8bf7\u6c42\u6765\u6e90\uff08\u4e0d\u5e94\u5305\u542b evil.example.com\uff09
    origin_header = resp.headers.get("access-control-allow-origin", "")
    assert "evil.example.com" not in origin_header


# ---------------------------------------------------------------------------
# P0-C / P1-E _walk_tree \u622a\u65ad\u6d4b\u8bd5
# ---------------------------------------------------------------------------

def test_walk_tree_depth_truncation(tmp_path):
    """_walk_tree \u8d85\u8fc7 max_depth \u65f6\u5e94\u622a\u65ad\u5e76\u6807\u8bb0 truncated=True\u3002"""
    from dashboard.app import _walk_tree
    # \u521b\u5efa 5 \u5c42\u6df1\u7684\u76ee\u5f55
    deep = tmp_path
    for _ in range(5):
        deep = deep / "sub"
        deep.mkdir()
    (deep / "leaf.txt").write_text("leaf")

    # max_depth=2\uff1a\u7b2c 3 \u5c42\u5e94\u88ab\u622a\u65ad
    result = _walk_tree(tmp_path, tmp_path, max_depth=2)
    assert len(result) == 1
    child = result[0]
    # \u7b2c\u4e00\u5c42
    assert child["name"] == "sub"
    # \u7b2c\u4e8c\u5c42
    grandchild = child["children"][0]
    assert grandchild["name"] == "sub"
    # \u7b2c\u4e09\u5c42\u5e94\u88ab\u622a\u65ad
    great_grandchild = grandchild["children"][0]
    assert great_grandchild.get("truncated") is True
    assert great_grandchild["children"] == []


def test_walk_tree_no_truncation_within_depth(tmp_path):
    """_walk_tree \u5728 max_depth \u5185\u4e0d\u5e94\u622a\u65ad\u3002"""
    from dashboard.app import _walk_tree
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "file.txt").write_text("content")

    result = _walk_tree(tmp_path, tmp_path, max_depth=5)
    assert len(result) == 1
    assert result[0]["name"] == "sub"
    assert not result[0].get("truncated")
    assert len(result[0]["children"]) == 1


# ---------------------------------------------------------------------------
# P1-C SSE \u8fde\u63a5\u6570\u9650\u5236
# ---------------------------------------------------------------------------

def test_sse_max_clients():
    """SSE \u8fde\u63a5\u6570\u8fbe\u4e0a\u9650\u65f6\u5e94\u8fd4\u56de 503\u3002"""
    from dashboard.watcher import FileWatcher
    watcher = FileWatcher()

    # \u6a21\u62df\u8fbe\u5230\u4e0a\u9650
    max_clients = 3
    queues = []
    for _ in range(max_clients):
        q = watcher.subscribe(max_clients=max_clients)
        assert q is not None
        queues.append(q)

    # \u7b2c max_clients+1 \u6b21\u5e94\u8fd4\u56de None
    overflow = watcher.subscribe(max_clients=max_clients)
    assert overflow is None

    # \u53d6\u6d88\u4e00\u4e2a\u8ba2\u9605\u540e\u53ef\u518d\u6b21\u8ba2\u9605
    watcher.unsubscribe(queues[0])
    new_q = watcher.subscribe(max_clients=max_clients)
    assert new_q is not None


def test_sse_subscriber_count():
    """subscriber_count \u5e94\u6b63\u786e\u8fd4\u56de\u5f53\u524d\u8ba2\u9605\u6570\u3002"""
    from dashboard.watcher import FileWatcher
    watcher = FileWatcher()
    assert watcher.subscriber_count == 0
    q1 = watcher.subscribe()
    assert watcher.subscriber_count == 1
    q2 = watcher.subscribe()
    assert watcher.subscriber_count == 2
    watcher.unsubscribe(q1)
    assert watcher.subscriber_count == 1
