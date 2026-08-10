from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
import aiohttp


PLUGIN_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = PLUGIN_ROOT / "scripts"
for path in (PLUGIN_ROOT, SCRIPTS_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from writer.models import ReviewPayload
from writer.prompts import build_common_context, canonical_json, prefix_id, task_messages
from writer.storage import WriterStore
from writer.deepseek import DeepSeekClient
from writer.models import ProviderConfig
from writer.runtime import apply_plan, finalize_draft, initialize_project


def _project(root: Path) -> Path:
    (root / ".webnovel").mkdir(parents=True)
    (root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    story = root / ".story-system"
    for folder in (story / "volumes", story / "chapters", story / "reviews"):
        folder.mkdir(parents=True)
    (story / "MASTER_SETTING.json").write_text('{"z":2,"a":1}', encoding="utf-8")
    (story / "anti_patterns.json").write_text("[]", encoding="utf-8")
    return root


def test_common_prefix_is_canonical_and_dynamic_suffix_isolated(tmp_path):
    root = _project(tmp_path)
    common_a = build_common_context(root, 1)
    common_b = build_common_context(root, 1)
    assert canonical_json(common_a) == canonical_json(common_b)
    assert prefix_id("deepseek-v4-flash", common_a) == prefix_id("deepseek-v4-flash", common_b)
    first = task_messages(common_a, "CACHE_READY", {"chapter": 1, "instruction": "A"})
    second = task_messages(common_a, "CACHE_READY", {"chapter": 2, "instruction": "B"})
    assert first[:3] == second[:3]
    assert first[-1] != second[-1]


def test_prefix_ignores_chapter_contract_but_changes_with_volume_contract(tmp_path):
    root = _project(tmp_path)
    before = prefix_id("deepseek-v4-pro", build_common_context(root, 1))
    (root / ".story-system" / "chapters" / "chapter_001.json").write_text('{"focus":"new"}', encoding="utf-8")
    assert before == prefix_id("deepseek-v4-pro", build_common_context(root, 1))
    (root / ".story-system" / "volumes" / "volume_001.json").write_text('{"goal":"new"}', encoding="utf-8")
    assert before != prefix_id("deepseek-v4-pro", build_common_context(root, 1))


def test_draft_optimistic_lock_and_review_invalidation(tmp_path):
    store = WriterStore(tmp_path / "writer.db")
    draft = store.save_draft("book", 1, "first")
    assert draft["revision"] == 1
    reviewed = store.mark_reviewed("book", 1, {"blocking_count": 0, "issues": [], "summary": "ok"})
    assert reviewed["reviewed_sha256"] == reviewed["sha256"]
    updated = store.save_draft("book", 1, "second", base_revision=1)
    assert updated["reviewed_sha256"] == ""
    with pytest.raises(ValueError, match="revision conflict"):
        store.save_draft("book", 1, "stale", base_revision=1)


def test_usage_summary_excludes_warmup_from_median(tmp_path):
    store = WriterStore(tmp_path / "writer.db")
    for hit, miss, warmup in ((0, 100, True), (60, 40, False), (80, 20, False), (70, 30, False)):
        store.record_usage({
            "project_root": "book", "task": "test", "model": "deepseek-v4-flash", "prefix_id": "p",
            "prompt_cache_hit_tokens": hit, "prompt_cache_miss_tokens": miss, "completion_tokens": 1,
            "is_warmup": warmup,
        })
    summary = store.usage_summary("book")
    assert summary["recent_median_hit_rate"] == pytest.approx(0.7)
    assert summary["target_hit_rate"] == 0.6


def test_review_blocking_count_must_match_issues():
    with pytest.raises(ValueError):
        ReviewPayload.model_validate({"blocking_count": 0, "issues": [{"description": "x", "blocking": True}]})


def test_dashboard_source_remains_get_only():
    source = (PLUGIN_ROOT / "dashboard" / "app.py").read_text(encoding="utf-8")
    assert "@app.post(" not in source
    assert "@app.put(" not in source


def test_writer_app_requires_csrf_for_mutations(tmp_path):
    from fastapi.testclient import TestClient
    from writer.app import create_writer_app

    root = _project(tmp_path / "book")
    app = create_writer_app(root, store=WriterStore(tmp_path / "client.db"))
    body = {
        "base_url": "https://api.deepseek.com",
        "fast_model": "deepseek-v4-flash",
        "deep_model": "deepseek-v4-pro",
        "timeout_seconds": 180,
    }
    with TestClient(app) as client:
        capability = client.get("/api/writer/capabilities")
        assert capability.status_code == 200
        assert capability.json()["writer"] is True
        assert client.put("/api/writer/settings", json=body).status_code == 403
        token = capability.json()["csrf_token"]
        response = client.put("/api/writer/settings", json=body, headers={"X-CSRF-Token": token})
        assert response.status_code == 200
        assert "api_key" not in response.json()


@pytest.mark.asyncio
async def test_deepseek_flash_request_and_usage(monkeypatch, tmp_path):
    captured = {}

    class FakeResponse:
        status = 200
        async def text(self):
            return json.dumps({
                "choices": [{"message": {"content": "正文"}}],
                "usage": {"prompt_cache_hit_tokens": 60, "prompt_cache_miss_tokens": 40, "completion_tokens": 10},
            })
        def release(self):
            pass

    class FakeSession:
        async def close(self):
            pass

    async def fake_post(self, body, *, stream=False):
        captured.update(body)
        return FakeResponse(), FakeSession()

    monkeypatch.setattr(DeepSeekClient, "_post", fake_post)
    store = WriterStore(tmp_path / "writer.db")
    client = DeepSeekClient(ProviderConfig(), "secret", store)
    content, usage = await client.complete(
        messages=[{"role": "user", "content": "写"}], model="deepseek-v4-flash", thinking=False,
        task="write", project_root="book", prefix_id="prefix",
    )
    assert content == "正文"
    assert captured["thinking"] == {"type": "disabled"}
    assert "reasoning_effort" not in captured
    assert usage["prompt_cache_hit_tokens"] == 60
    assert usage["estimated_cost_usd"] > 0


@pytest.mark.asyncio
async def test_deepseek_pro_uses_thinking_mode(monkeypatch, tmp_path):
    captured = {}

    class FakeResponse:
        status = 200
        async def text(self):
            return json.dumps({"choices": [{"message": {"content": "{}"}}], "usage": {}})
        def release(self):
            pass

    class FakeSession:
        async def close(self):
            pass

    async def fake_post(self, body, *, stream=False):
        captured.update(body)
        return FakeResponse(), FakeSession()

    monkeypatch.setattr(DeepSeekClient, "_post", fake_post)
    client = DeepSeekClient(ProviderConfig(), "secret", WriterStore(tmp_path / "writer.db"))
    await client.complete(
        messages=[{"role": "user", "content": "审"}], model="deepseek-v4-pro", thinking=True,
        task="review", project_root="book", prefix_id="prefix",
    )
    assert captured["thinking"] == {"type": "enabled"}
    assert captured["reasoning_effort"] == "high"
    assert "temperature" not in captured


@pytest.mark.asyncio
async def test_deepseek_stream_retries_before_first_delta(monkeypatch, tmp_path):
    attempts = 0
    deltas = []

    class Lines:
        def __aiter__(self):
            self.lines = iter([
                b'data: {"choices":[{"delta":{"content":"hello"}}]}\n',
                b'data: {"choices":[],"usage":{"prompt_cache_hit_tokens":8,"prompt_cache_miss_tokens":2,"completion_tokens":1}}\n',
                b'data: [DONE]\n',
            ])
            return self
        async def __anext__(self):
            try:
                return next(self.lines)
            except StopIteration:
                raise StopAsyncIteration

    class FakeResponse:
        status = 200
        content = Lines()
        def release(self):
            pass

    class FakeSession:
        async def close(self):
            pass

    async def fake_post(self, body, *, stream=False):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise aiohttp.ClientConnectionError("temporary")
        return FakeResponse(), FakeSession()

    async def no_sleep(_):
        return None

    monkeypatch.setattr(DeepSeekClient, "_post", fake_post)
    monkeypatch.setattr("writer.deepseek.asyncio.sleep", no_sleep)
    client = DeepSeekClient(ProviderConfig(), "secret", WriterStore(tmp_path / "writer.db"))
    content, usage = await client.stream(
        on_delta=lambda delta: _append_async(deltas, delta), messages=[{"role": "user", "content": "write"}],
        model="deepseek-v4-flash", thinking=False, task="write", project_root="book", prefix_id="prefix",
    )
    assert attempts == 2
    assert content == "hello"
    assert deltas == ["hello"]
    assert usage["prompt_cache_hit_tokens"] == 8


async def _append_async(target, value):
    target.append(value)


def test_init_plan_finalize_runtime_integration(tmp_path):
    initialized = initialize_project(
        tmp_path,
        {"title": "Book", "genre": "都市", "protagonist_name": "Lin", "target_chapters": 10, "target_words": 30_000},
        {"title": "Book", "one_liner": "都市", "anti_trope": "拒绝无代价升级", "hard_constraints": ["能力有代价"]},
    )
    root = Path(initialized["project_root"])
    outline = """# 第一卷

## 第1章 开端
- 目标：发现异常
- cbn：平静被打破
- cpns：发现线索
- cen：敌人出现
- 必须覆盖节点：发现线索
- 本章禁区：无代价升级
- 章末问题：黑影是谁
"""
    applied = apply_plan(root, {
        "volume": 1, "start_chapter": 1, "end_chapter": 1,
        "volume_outline_markdown": outline, "chapter_queries": {"1": "都市"},
    })
    assert applied["contracts_built"] == [1]
    result = finalize_draft(
        root, chapter=1, content="# 第1章\n\n正文",
        review={"blocking_count": 0, "issues": [], "summary": "通过"},
        artifacts={
            "planned_nodes": [], "covered_nodes": [], "missed_nodes": [], "extra_nodes": [],
            "pending_disambiguation": [],
            "extraction": {"accepted_events": [], "state_deltas": [], "entity_deltas": [], "summary_text": "摘要"},
        },
    )
    assert result["commit_status"] == "accepted"
    assert result["postcommit"]["ok"] is True
    assert (root / ".story-system" / "commits" / "chapter_001.commit.json").is_file()
