# -*- coding: utf-8 -*-
"""服务层测试的公共 fixture。

设计原则：
- 测试必须**确定性**，不依赖网络与真实 LLM。
- 但也不要 mock 掉被测逻辑：`FakeEngine` 会真的往 tmp 目录写文件，
  这样 `_step_commit` 读 commit 文件、`_record_blocking_adjudication`
  改 review artifact 这些真实文件路径都会被走到。
- 真实 LLM 的端到端验证放在 test_integration_real.py，默认 skip。
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
# 让测试模块可以直接 `from conftest import ...`（pytest 会把 tests/ 加入 sys.path）
_TESTS_DIR = Path(__file__).resolve().parent
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from service.config import LLMRoleConfig, Settings  # noqa: E402
from service.engine import CommandResult  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────────
# Fake LLM
# ─────────────────────────────────────────────────────────────────────────────


class FakeLLM:
    """按角色返回预设响应。记录调用以便断言。"""

    def __init__(
        self,
        role: str = "draft",
        *,
        text: str = "默认正文。" * 200,
        json_value: Any = None,
        fail: bool = False,
    ) -> None:
        self.role_name = role
        self._text = text
        self._json = json_value
        self._fail = fail
        self.calls: List[Dict[str, Any]] = []

    async def complete(self, system: str, user: str, temperature=None,
                       max_tokens: int = 0, json_mode: bool = False):
        self.calls.append({"kind": "complete", "system": system, "user": user})
        if self._fail:
            from service.llm import LLMError
            raise LLMError(f"{self.role_name} 故意失败")
        return _Result(self._text)

    async def complete_json(self, system: str, user: str, temperature=None,
                            max_tokens: int = 0):
        self.calls.append({"kind": "complete_json", "system": system, "user": user})
        if self._fail:
            from service.llm import LLMError
            raise LLMError(f"{self.role_name} 故意失败")
        return self._json


@dataclass
class _Result:
    text: str
    model: str = "fake-model"
    usage: Dict[str, Any] = field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# Fake Engine —— 真写文件，只替换子进程调用
# ─────────────────────────────────────────────────────────────────────────────


class FakeEngine:
    """替代 Engine：子进程调用返回预设值，文件与解析逻辑走真实实现。

    关键设计：**只读逻辑一律委托给真实 Engine 实例**（`self._real`）。
    这样 fake 不会与生产行为漂移 —— 例如章纲路径解析、卷号推断、
    题材解析这些正是要验证的逻辑，绝不能用简化的假实现替代。
    """

    def __init__(self, project_root: Path, *, preflight_ok: bool = True,
                 placeholders: bool = False, genre: str = "玄幻",
                 outline: Optional[str] = None, commit_status: str = "accepted",
                 projection: Optional[Dict[str, str]] = None,
                 commit_writes_file: bool = True,
                 write_gate_ok: bool = True,
                 review_pipeline_ok: bool = True) -> None:
        from service.config import Settings
        from service.engine import Engine as RealEngine

        self.project_root = str(project_root)
        self._root = Path(project_root)
        self.preflight_ok = preflight_ok
        self.placeholders = placeholders
        self.genre = genre
        self.outline = outline
        self.commit_status = commit_status
        self.projection = projection or {
            "state": "done", "index": "done", "summary": "done",
            "memory": "done", "vector": "done",
        }
        self.commit_writes_file = commit_writes_file
        self.write_gate_ok = write_gate_ok
        self.review_pipeline_ok = review_pipeline_ok
        self.calls: List[str] = []
        self._chapter_text: Dict[int, str] = {}
        (self._root / ".webnovel" / "tmp").mkdir(parents=True, exist_ok=True)
        (self._root / "正文").mkdir(parents=True, exist_ok=True)
        (self._root / "大纲").mkdir(parents=True, exist_ok=True)
        (self._root / ".story-system" / "commits").mkdir(parents=True, exist_ok=True)

        # 真实 Engine，仅用于只读/解析逻辑（不触发子进程）
        _s = Settings()
        _s.llm.base_url = "http://fake/v1"
        _s.llm.model = "fake"
        self._real = RealEngine(_s, project_root=str(project_root))

    # --- 记录 ---
    def _rec(self, name: str) -> None:
        self.calls.append(name)

    # --- 生命周期 ---
    def preflight(self):
        self._rec("preflight")
        checks = [{"name": "project_root", "ok": self.preflight_ok}]
        return {"ok": self.preflight_ok, "checks": checks,
                "project_root_error": "" if self.preflight_ok else "no project"}

    def placeholder_scan(self):
        self._rec("placeholder_scan")
        return {"has_placeholders": self.placeholders}

    def resolve_genre(self) -> str:
        self._rec("resolve_genre")
        return self.genre

    def volume_for_chapter(self, chapter: int) -> int:
        return self._real.volume_for_chapter(chapter)

    def state_payload(self):
        return {}

    def chapter_outline(self, chapter: int, max_chars=None):
        """委托真实 Engine：先单章文件，再卷大纲分节。"""
        self._rec("chapter_outline")
        if self.outline is not None:
            return self.outline
        return self._real.chapter_outline(chapter, max_chars)

    def read_outline(self, relative: str):
        p = self._root / relative
        return p.read_text(encoding="utf-8") if p.is_file() else None

    def save_outline(self, relative: str, content: str) -> Path:
        p = self._root / relative
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return p

    def master_outline(self):
        return "# 总纲\n\n第一卷：崛起\n"

    def settings_digest(self):
        return {"世界观.md": "世界设定"}

    def load_context(self, chapter: int):
        self._rec("load_context")
        return {"story_contracts": {"chapter": chapter}, "recent_summaries": []}

    def extract_context(self, chapter: int):
        return self.load_context(chapter)

    def story_system(self, goal, genre, chapter, persist=True):
        self._rec("story_system")
        return CommandResult(0, '{"ok": true}', "")

    def write_gate(self, chapter: int, stage: str):
        self._rec(f"write_gate:{stage}")
        return {"ok": self.write_gate_ok, "stage": stage, "errors": []}

    def review_pipeline(self, chapter, review_results_path,
                        metrics_out="", report_file=""):
        self._rec("review_pipeline")
        if report_file:
            p = self._root / report_file
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("# 审查报告\n", encoding="utf-8")
        return CommandResult(0 if self.review_pipeline_ok else 1, "{}", "")

    def chapter_commit(self, chapter, review_result, fulfillment_result="",
                       disambiguation_result="", extraction_result=""):
        self._rec("chapter_commit")
        if self.commit_writes_file:
            p = self._root / ".story-system" / "commits" / f"chapter_{chapter:03d}.commit.json"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps({
                "meta": {"chapter": chapter, "status": self.commit_status},
                "projection_status": self.projection,
            }, ensure_ascii=False, indent=2), encoding="utf-8")
        return CommandResult(0, json.dumps({"status": self.commit_status}), "")

    def projections_retry(self, chapter):
        self._rec("projections_retry")
        return CommandResult(0, json.dumps({"projection_status": self.projection}), "")

    # ---- 投影归一化：委托真实实现，保证测的是生产逻辑 ----

    def _commit_path(self, chapter: int) -> Path:
        return self._real._commit_path(chapter)

    def _projection_log_path(self) -> Path:
        return self._real._projection_log_path()

    def normalize_vector_projection(self, chapter: int):
        self._rec("normalize_vector_projection")
        return self._real.normalize_vector_projection(chapter)

    def read_projection_status(self, chapter: int):
        self._rec("read_projection_status")
        return self._real.read_projection_status(chapter)

    def write_projection_log(self, chapter: int, status: Dict[str, str],
                             overall: str = "") -> Path:
        """测试辅助：写一条真实格式的 projection_log 记录。

        上游以该文件为投影状态的**权威来源**（优先于 commit 文件），
        所以涉及投影的测试必须构造它，否则测不到真实路径。
        """
        path = self._projection_log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        writers = {
            name: {"status": status_value, "result": {}}
            for name, status_value in status.items()
        }
        record = {
            "schema_version": "webnovel-projection-log/v1",
            "run_id": f"test-{chapter}",
            "created_at": "2026-01-01T00:00:00+00:00",
            "chapter": chapter,
            "commit_path": str(self._commit_path(chapter)),
            "commit_hash": "test",
            "commit_status": "accepted",
            "status": overall or ("done" if all(
                v in ("done", "skipped") for v in status.values()) else "failed"),
            "writers": writers,
            "projection_status": dict(status),
        }
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True))
            handle.write("\n")
        return path

    def backup(self, chapter, chapter_title=""):
        self._rec("backup")
        return CommandResult(0, "backup ok", "")

    def user_report(self, stage, chapter=None, volume=None):
        return f"总状态：已完成。\n（{stage} 报告）"

    def record_write_step(self, *a, **kw):
        self._rec("record_write_step")
        return CommandResult(0, "{}", "")

    def get_core_entities(self):
        self._rec("get_core_entities")
        return [{"id": "hero", "name": "主角"}]

    def recent_appearances(self, limit=20):
        return [{"id": "hero"}]

    def get_state_changes(self, limit=20):
        self._rec("get_state_changes")
        return [{"entity": "hero", "field": "realm"}]

    def write_resume(self, chapter, mode="default"):
        return {"chapter": chapter, "mode": mode, "resume_from": "draft"}

    # --- 文件 ---
    def chapter_file(self, chapter: int):
        hits = sorted((self._root / "正文").glob(f"第{chapter:04d}章*.md"))
        return hits[0] if hits else None

    def write_chapter_file(self, chapter: int, title: str, content: str) -> Path:
        self._rec("write_chapter_file")
        name = f"第{chapter:04d}章-{title}.md" if title else f"第{chapter:04d}章.md"
        p = self._root / "正文" / name
        p.write_text(content, encoding="utf-8")
        self._chapter_text[chapter] = content
        return p

    def tmp_dir(self) -> Path:
        p = self._root / ".webnovel" / "tmp"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def write_tmp_json(self, name: str, data: Any) -> Path:
        p = self.tmp_dir() / name
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return p

    def read_text(self, relative: str):
        p = self._root / relative
        return p.read_text(encoding="utf-8") if p.is_file() else None

    def update_state(self, *args):
        self._rec("update_state")
        return CommandResult(0, "{}", "")

    def master_outline_sync(self, volume, writeback_file=""):
        return CommandResult(0, "{}", "")


# ─────────────────────────────────────────────────────────────────────────────
# 常用数据
# ─────────────────────────────────────────────────────────────────────────────


def make_settings(**over) -> Settings:
    s = Settings()
    s.llm = LLMRoleConfig(
        base_url="http://fake/v1", api_key="fake-key", model="fake-model",
    )
    for k, v in over.items():
        setattr(s, k, v)
    return s


def review_payload(blocking: bool = False) -> Dict[str, Any]:
    issues = []
    if blocking:
        issues.append({
            "severity": "critical", "category": "logic", "location": "第3段",
            "description": "测试阻断问题", "evidence": "原文 vs 设定",
            "fix_hint": "删除该句", "blocking": True,
        })
    return {
        "chapter": 1,
        "issues": issues,
        "issues_count": len(issues),
        "blocking_count": len(issues),
        "has_blocking": bool(issues),
        "dimension_results": [
            {"dimension": d, "conclusion": "pass"}
            for d in ("setting", "timeline", "continuity", "character", "logic")
        ],
        "summary": "测试审查",
    }


def data_payload() -> Dict[str, Any]:
    return {
        "fulfillment_result": {
            "planned_nodes": ["a"], "covered_nodes": ["a"],
            "missed_nodes": [], "extra_nodes": [],
        },
        "disambiguation_result": {"pending": []},
        "extraction_result": {
            "accepted_events": [], "state_deltas": [], "entity_deltas": [],
            "entities_appeared": [], "scenes": [], "summary_text": "摘要",
        },
    }


def build_clients(**over) -> Dict[str, FakeLLM]:
    """四个角色各一个 FakeLLM，可用关键字覆盖。"""
    defaults = {
        "context": FakeLLM("context", text="五段任务书。" * 50),
        "draft": FakeLLM("draft", text="正文内容。" * 200),
        "review": FakeLLM("review", json_value=review_payload()),
        "data": FakeLLM("data", json_value=data_payload()),
    }
    defaults.update(over)
    return defaults


# ─────────────────────────────────────────────────────────────────────────────
# fixture
# ─────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def project(tmp_path: Path) -> Path:
    """一个最小的书项目目录。"""
    (tmp_path / ".webnovel" / "tmp").mkdir(parents=True, exist_ok=True)
    (tmp_path / "正文").mkdir(parents=True, exist_ok=True)
    (tmp_path / "大纲").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".story-system" / "commits").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".webnovel" / "state.json").write_text(
        json.dumps({"project_info": {"title": "测试书", "genre": "玄幻"}},
                   ensure_ascii=False),
        encoding="utf-8",
    )
    return tmp_path


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def engine(project: Path) -> FakeEngine:
    return FakeEngine(project)


@pytest.fixture
def clients() -> Dict[str, FakeLLM]:
    return build_clients()
