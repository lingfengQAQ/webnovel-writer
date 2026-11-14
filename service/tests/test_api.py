# -*- coding: utf-8 -*-
"""API 层测试：路由注册、配置读写、密钥掩码、错误码。

用 FastAPI TestClient 走真实 HTTP 栈（不启服务进程）。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from service.app import create_service_app


@pytest.fixture
def client(tmp_path: Path, monkeypatch) -> TestClient:
    # 隔离运行时配置，避免污染真实 storages/
    monkeypatch.setattr("service.config.RUNTIME_SETTINGS",
                        tmp_path / "runtime-settings.json")
    app = create_service_app(str(tmp_path))
    return TestClient(app)


class TestHealthAndConfig:
    def test_health(self, client: TestClient):
        r = client.get("/service/health")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["upstream_present"] is True

    def test_get_config_masks_key(self, client: TestClient):
        r = client.get("/service/config")
        assert r.status_code == 200
        body = r.json()
        assert "llm" in body and "rag" in body and "paths" in body
        assert "api_key" not in body["llm"]  # 只暴露 api_key_set

    def test_put_config_then_read_back(self, client: TestClient):
        payload = {"llm": {"base_url": "http://rt/v1", "model": "rt-model",
                           "api_key": "super-secret-key"}}
        r = client.put("/service/config", json=payload)
        assert r.status_code == 200
        body = r.json()
        assert body["llm"]["base_url"] == "http://rt/v1"
        assert body["llm"]["model"] == "rt-model"
        assert body["llm"]["api_key_set"] is True
        # 明文绝不出现在任何响应里
        assert "super-secret-key" not in json.dumps(body)

    def test_put_config_empty_key_preserves(self, client: TestClient):
        client.put("/service/config", json={"llm": {"api_key": "keep"}})
        client.put("/service/config", json={"llm": {"api_key": "", "model": "m2"}})
        body = client.get("/service/config").json()
        assert body["llm"]["api_key_set"] is True
        assert body["llm"]["model"] == "m2"

    def test_put_config_roles(self, client: TestClient):
        client.put("/service/config", json={
            "llm": {"base_url": "http://rt/v1", "model": "d"},
            "llm_roles": {"review": {"model": "review-model"}},
        })
        body = client.get("/service/config").json()
        assert body["llm_roles"]["review"]["model"] == "review-model"

    def test_config_test_unknown_role(self, client: TestClient):
        r = client.post("/service/config/test", json={"role": "nonexistent"})
        assert r.status_code == 400

    def test_config_test_unconfigured_returns_error(self, client: TestClient):
        r = client.post("/service/config/test", json={"role": "draft"})
        assert r.status_code == 200
        assert r.json()["ok"] is False


class TestWriteEndpoints:
    def test_write_requires_chapter(self, client: TestClient):
        r = client.post("/service/write", json={})
        assert r.status_code == 400
        assert "chapter" in r.json()["detail"]

    def test_resume_rejects_invalid_stage(self, client: TestClient):
        r = client.post("/service/write/resume",
                        json={"chapter": 1, "from_stage": "nonsense"})
        assert r.status_code == 400
        detail = r.json()["detail"]
        assert "from_stage" in detail
        assert "polish" in detail  # 应提示合法取值

    def test_resume_requires_chapter(self, client: TestClient):
        r = client.post("/service/write/resume", json={"from_stage": "polish"})
        assert r.status_code == 400

    def test_blocking_endpoint_empty_when_none(self, client: TestClient, tmp_path: Path):
        r = client.get("/service/write/blocking")
        assert r.status_code == 200
        assert r.json()["blocking_issues"] == []

    def test_blocking_endpoint_reads_state(self, client: TestClient, tmp_path: Path):
        d = tmp_path / ".webnovel" / "tmp"
        d.mkdir(parents=True, exist_ok=True)
        (d / "blocking_state.json").write_text(json.dumps({
            "chapter": 1,
            "blocking_issues": [{"description": "x", "blocking": True}],
            "resume_options": [{"from_stage": "polish", "accept_blocking": True,
                                "desc": "继续"}],
        }, ensure_ascii=False), encoding="utf-8")
        r = client.get("/service/write/blocking")
        assert r.status_code == 200
        assert len(r.json()["blocking_issues"]) == 1
        assert r.json()["resume_options"][0]["from_stage"] == "polish"


class TestPlanEndpoints:
    def test_outline_404_when_missing(self, client: TestClient):
        r = client.get("/service/plan/outline", params={"chapter": 1})
        assert r.status_code == 404

    def test_outline_returns_master_when_no_params(self, client: TestClient,
                                                   tmp_path: Path):
        d = tmp_path / "大纲"
        d.mkdir(parents=True, exist_ok=True)
        (d / "总纲.md").write_text("# 总纲内容", encoding="utf-8")
        r = client.get("/service/plan/outline")
        assert r.status_code == 200
        assert r.json()["master_outline"] == "# 总纲内容"

    def test_outline_returns_chapter_section(self, client: TestClient, tmp_path: Path):
        d = tmp_path / "大纲"
        d.mkdir(parents=True, exist_ok=True)
        (d / "第1卷-详细大纲.md").write_text(
            "### 第1章：标题\n\n**目标**：目标内容\n", encoding="utf-8")
        r = client.get("/service/plan/outline", params={"chapter": 1})
        assert r.status_code == 200
        assert "目标内容" in r.json()["content"]

    def test_outline_returns_volume(self, client: TestClient, tmp_path: Path):
        d = tmp_path / "大纲"
        d.mkdir(parents=True, exist_ok=True)
        (d / "第1卷-详细大纲.md").write_text("整卷内容", encoding="utf-8")
        r = client.get("/service/plan/outline", params={"volume": 1})
        assert r.status_code == 200
        assert r.json()["content"] == "整卷内容"


class TestProjectEndpoints:
    def test_create_project_requires_fields(self, client: TestClient):
        assert client.post("/service/projects", json={}).status_code == 400
        assert client.post("/service/projects",
                           json={"title": "只有标题"}).status_code == 400

    def test_create_project_rejects_missing_title(self, client: TestClient):
        r = client.post("/service/projects", json={"project_dir": "x"})
        assert r.status_code == 400

    def test_status_with_missing_project_reports_error_not_crash(self, client: TestClient):
        """传入不存在的项目根应给出 4xx/5xx 明确错误，而不是未捕获异常。"""
        r = client.get("/service/projects/status",
                       params={"project_root": str(Path("C:/definitely/missing"))})
        assert r.status_code in (400, 404, 500)
        # 不应是 FastAPI 的未处理异常页面
        assert "Internal Server Error" not in r.text or r.status_code == 500

    def test_status_without_any_project(self, client: TestClient):
        r = client.get("/service/projects/status")
        assert r.status_code in (200, 400, 500)


class TestRouting:
    def test_all_expected_routes_present(self, client: TestClient):
        paths = {getattr(r, "path", "") for r in client.app.routes}
        for expected in (
            "/service/health", "/service/config", "/service/config/test",
            "/service/projects", "/service/projects/status",
            "/service/projects/doctor", "/service/projects/resume",
            "/service/write", "/service/write/stream", "/service/write/resume",
            "/service/write/blocking",
            "/service/plan", "/service/plan/stream", "/service/plan/outline",
            "/service/chapters/{chapter}", "/service/context/{chapter}",
            "/service/events",
        ):
            assert expected in paths, f"缺少路由 {expected}"

    def test_dashboard_mount_is_last(self, client: TestClient):
        """上游 SPA 兜底路由 /{full_path:path} 必须最后挂载，否则吞掉本层路由。"""
        last = client.app.routes[-1]
        assert last.__class__.__name__ == "Mount", \
            f"最后一条不是挂载: {last.__class__.__name__}"

    def test_upstream_readonly_api_reachable(self, client: TestClient):
        r = client.get("/api/story-runtime/health")
        assert r.status_code == 200
