#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import asyncio
import importlib
import json
import sys
from pathlib import Path

import pytest


def _ensure_scripts_on_path() -> None:
    scripts_dir = Path(__file__).resolve().parents[2]
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))


def _load_webnovel_module():
    _ensure_scripts_on_path()
    import data_modules.webnovel as webnovel_module

    return webnovel_module


def test_init_does_not_resolve_existing_project_root(monkeypatch):
    module = _load_webnovel_module()

    called = {}

    def _fake_run_script(script_name, argv):
        called["script_name"] = script_name
        called["argv"] = list(argv)
        return 0

    def _fail_resolve(_explicit_project_root=None):
        raise AssertionError("init 子命令不应触发 project_root 解析")

    monkeypatch.setenv("WEBNOVEL_PROJECT_ROOT", r"D:\invalid\root")
    monkeypatch.setattr(module, "_run_script", _fake_run_script)
    monkeypatch.setattr(module, "_resolve_root", _fail_resolve)
    monkeypatch.setattr(sys, "argv", ["webnovel", "init", "proj-dir", "测试书", "修仙"])

    with pytest.raises(SystemExit) as exc:
        module.main()

    assert int(exc.value.code or 0) == 0
    assert called["script_name"] == "init_project.py"
    assert called["argv"] == ["proj-dir", "测试书", "修仙"]


def test_extract_context_forwards_with_resolved_project_root(monkeypatch, tmp_path):
    module = _load_webnovel_module()

    book_root = (tmp_path / "book").resolve()
    called = {}

    def _fake_resolve(explicit_project_root=None):
        return book_root

    def _fake_run_script(script_name, argv):
        called["script_name"] = script_name
        called["argv"] = list(argv)
        return 0

    monkeypatch.setattr(module, "_resolve_root", _fake_resolve)
    monkeypatch.setattr(module, "_run_script", _fake_run_script)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "--project-root",
            str(tmp_path),
            "extract-context",
            "--chapter",
            "12",
            "--format",
            "json",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    assert int(exc.value.code or 0) == 0
    assert called["script_name"] == "extract_chapter_context.py"
    assert called["argv"] == [
        "--project-root",
        str(book_root),
        "--chapter",
        "12",
        "--format",
        "json",
    ]


def test_backup_forwards_resolved_book_root_from_parent_workspace(monkeypatch, tmp_path):
    module = _load_webnovel_module()

    workspace_root = (tmp_path / "workspace").resolve()
    book_root = (workspace_root / "book").resolve()
    (workspace_root / ".git").mkdir(parents=True, exist_ok=True)
    (book_root / ".git").mkdir(parents=True, exist_ok=True)
    (book_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (book_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    called = {}

    def _fake_run_script(script_name, argv):
        called["script_name"] = script_name
        called["argv"] = list(argv)
        return 0

    monkeypatch.chdir(workspace_root)
    monkeypatch.setattr(module, "_run_script", _fake_run_script)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "--project-root",
            str(workspace_root),
            "backup",
            "--chapter",
            "2",
            "--chapter-title",
            "第二章",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    assert int(exc.value.code or 0) == 0
    assert called["script_name"] == "backup_manager.py"
    assert called["argv"] == [
        "--project-root",
        str(book_root),
        "--chapter",
        "2",
        "--chapter-title",
        "第二章",
    ]


def test_webnovel_story_system_forwards_with_resolved_project_root(monkeypatch, tmp_path):
    module = _load_webnovel_module()

    book_root = (tmp_path / "book").resolve()
    called = {}

    def _fake_resolve(explicit_project_root=None):
        return book_root

    def _fake_run_script(script_name, argv):
        called["script_name"] = script_name
        called["argv"] = list(argv)
        return 0

    monkeypatch.setattr(module, "_resolve_root", _fake_resolve)
    monkeypatch.setattr(module, "_run_script", _fake_run_script)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "--project-root",
            str(tmp_path),
            "story-system",
            "玄幻退婚流",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    assert int(exc.value.code or 0) == 0
    assert called["script_name"] == "story_system.py"
    assert called["argv"][:2] == ["--project-root", str(book_root)]


def test_webnovel_story_system_runtime_forwards(monkeypatch, tmp_path):
    module = _load_webnovel_module()

    project_root = (tmp_path / "book").resolve()
    called = {}

    def _fake_resolve(explicit_project_root=None):
        return project_root

    def _fake_run_script(script_name, argv):
        called["script_name"] = script_name
        called["argv"] = list(argv)
        return 0

    monkeypatch.setattr(module, "_resolve_root", _fake_resolve)
    monkeypatch.setattr(module, "_run_script", _fake_run_script)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "--project-root",
            str(project_root),
            "story-system",
            "玄幻退婚流",
            "--emit-runtime-contracts",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    assert int(exc.value.code or 0) == 0
    assert called["script_name"] == "story_system.py"
    assert "--emit-runtime-contracts" in called["argv"]


def test_webnovel_commit_forwards(monkeypatch, tmp_path):
    module = _load_webnovel_module()
    project_root = tmp_path / "book"
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    called = {}

    def _fake_run_script(script_name, argv):
        called["script_name"] = script_name
        called["argv"] = list(argv)
        return 0

    monkeypatch.setattr(module, "_run_script", _fake_run_script)
    monkeypatch.setattr(sys, "argv", ["webnovel", "--project-root", str(project_root), "chapter-commit", "--chapter", "3"])

    with pytest.raises(SystemExit) as exc:
        module.main()

    assert int(exc.value.code or 0) == 0
    assert called["script_name"] == "chapter_commit.py"


def test_webnovel_story_events_forwards(monkeypatch, tmp_path):
    module = _load_webnovel_module()
    project_root = tmp_path / "book"
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    called = {}

    def _fake_run_script(script_name, argv):
        called["script_name"] = script_name
        called["argv"] = list(argv)
        return 0

    monkeypatch.setattr(module, "_run_script", _fake_run_script)
    monkeypatch.setattr(
        sys,
        "argv",
        ["webnovel", "--project-root", str(project_root), "story-events", "--chapter", "3"],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    assert int(exc.value.code or 0) == 0
    assert called["script_name"] == "story_events.py"


def test_preflight_succeeds_for_valid_project_root(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()

    project_root = tmp_path / "book"
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    monkeypatch.setattr(sys, "argv", ["webnovel", "--project-root", str(project_root), "preflight"])

    with pytest.raises(SystemExit) as exc:
        module.main()

    captured = capsys.readouterr()
    assert int(exc.value.code or 0) == 0
    assert "OK project_root" in captured.out
    assert str(project_root.resolve()) in captured.out


def test_preflight_fails_when_required_scripts_are_missing(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()

    project_root = tmp_path / "book"
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    fake_scripts_dir = tmp_path / "fake-scripts"
    fake_scripts_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(module, "_scripts_dir", lambda: fake_scripts_dir)
    monkeypatch.setattr(sys, "argv", ["webnovel", "--project-root", str(project_root), "preflight", "--format", "json"])

    with pytest.raises(SystemExit) as exc:
        module.main()

    captured = capsys.readouterr()
    assert int(exc.value.code or 0) == 1
    assert '"ok": false' in captured.out
    assert '"name": "entry_script"' in captured.out


def test_preflight_includes_story_runtime_health(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()

    project_root = tmp_path / "book"
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    monkeypatch.setattr(
        sys,
        "argv",
        ["webnovel", "--project-root", str(project_root), "preflight", "--format", "json"],
    )

    with pytest.raises(SystemExit):
        module.main()

    captured = capsys.readouterr()
    assert '"story_runtime"' in captured.out
    assert '"mainline_ready"' in captured.out


def test_where_reports_empty_workspace_without_traceback(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / ".git").mkdir(parents=True, exist_ok=True)

    monkeypatch.chdir(workspace)
    monkeypatch.delenv("WEBNOVEL_PROJECT_ROOT", raising=False)
    monkeypatch.delenv("CLAUDE_PROJECT_DIR", raising=False)
    monkeypatch.setenv("WEBNOVEL_CLAUDE_HOME", str(tmp_path / "empty-claude-home"))
    monkeypatch.setattr(sys, "argv", ["webnovel", "where"])

    with pytest.raises(SystemExit) as exc:
        module.main()

    captured = capsys.readouterr()
    assert int(exc.value.code or 0) == 1
    assert "还没有激活的书项目" in captured.err
    assert "Traceback" not in captured.err


def test_preflight_reports_empty_workspace_without_traceback(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / ".git").mkdir(parents=True, exist_ok=True)

    monkeypatch.chdir(workspace)
    monkeypatch.delenv("WEBNOVEL_PROJECT_ROOT", raising=False)
    monkeypatch.delenv("CLAUDE_PROJECT_DIR", raising=False)
    monkeypatch.setenv("WEBNOVEL_CLAUDE_HOME", str(tmp_path / "empty-claude-home"))
    monkeypatch.setattr(sys, "argv", ["webnovel", "preflight", "--format", "json"])

    with pytest.raises(SystemExit) as exc:
        module.main()

    captured = capsys.readouterr()
    report = json.loads(captured.out)
    assert int(exc.value.code or 0) == 1
    assert report["ok"] is False
    assert "还没有激活的书项目" in report["project_root_error"]
    assert "Traceback" not in captured.err


def test_quality_trend_report_writes_to_book_root_when_input_is_workspace_root(tmp_path, monkeypatch):
    _ensure_scripts_on_path()
    import quality_trend_report as quality_trend_report_module

    workspace_root = (tmp_path / "workspace").resolve()
    book_root = (workspace_root / "凡人资本论").resolve()

    (workspace_root / ".claude").mkdir(parents=True, exist_ok=True)
    (workspace_root / ".claude" / ".webnovel-current-project").write_text(str(book_root), encoding="utf-8")

    (book_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (book_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    output_path = workspace_root / "report.md"

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "quality_trend_report",
            "--project-root",
            str(workspace_root),
            "--limit",
            "1",
            "--output",
            str(output_path),
        ],
    )

    quality_trend_report_module.main()

    assert output_path.is_file()
    assert (book_root / ".webnovel" / "index.db").is_file()
    assert not (workspace_root / ".webnovel" / "index.db").exists()






def test_review_pipeline_builds_artifacts(tmp_path):
    _ensure_scripts_on_path()
    import review_pipeline as review_pipeline_module

    project_root = (tmp_path / "book").resolve()
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    review_results_path = tmp_path / "review_results.json"
    review_results_path.write_text(
        json.dumps(
            {
                "issues": [
                    {
                        "severity": "critical",
                        "category": "timeline",
                        "location": "第2段",
                        "description": "时间线回跳",
                        "evidence": "上章深夜，本章突然中午",
                        "fix_hint": "补时间过渡",
                        "blocking": True,
                    },
                    {
                        "severity": "medium",
                        "category": "ai_flavor",
                        "location": "第5段",
                        "description": "'稳住心神'出现2次",
                        "fix_hint": "替换为具体动作",
                    },
                ],
                "summary": "1个阻断，1个中等",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    payload = review_pipeline_module.build_review_artifacts(
        project_root=project_root,
        chapter=20,
        review_results_path=review_results_path,
        report_file="审查报告/第20章.md",
    )

    assert payload["review_result"]["blocking_count"] == 1
    assert payload["review_result"]["has_blocking"] is True
    assert payload["review_result"]["issues_count"] == 2
    assert payload["metrics"]["start_chapter"] == 20
    assert payload["metrics"]["end_chapter"] == 20
    assert payload["metrics"]["issues_count"] == 2
    assert payload["metrics"]["blocking_count"] == 1
    assert payload["metrics"]["severity_counts"]["critical"] == 1
    assert payload["metrics"]["severity_counts"]["medium"] == 1
    assert payload["metrics"]["critical_issues"] == ["时间线回跳"]
    assert payload["metrics"]["overall_score"] < 100
    assert payload["metrics"]["report_file"] == "审查报告/第20章.md"


def test_review_pipeline_forwards_with_resolved_project_root(monkeypatch, tmp_path):
    module = _load_webnovel_module()

    book_root = (tmp_path / "book").resolve()
    review_results = (tmp_path / "review_results.json").resolve()
    called = {}

    def _fake_resolve(explicit_project_root=None):
        return book_root

    def _fake_run_script(script_name, argv):
        called["script_name"] = script_name
        called["argv"] = list(argv)
        return 0

    monkeypatch.setattr(module, "_resolve_root", _fake_resolve)
    monkeypatch.setattr(module, "_run_script", _fake_run_script)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "--project-root",
            str(tmp_path),
            "review-pipeline",
            "--chapter",
            "18",
            "--review-results",
            str(review_results),
            "--metrics-out",
            str(tmp_path / "metrics.json"),
            "--report-file",
            "审查报告/第18章.md",
            "--save-metrics",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    assert int(exc.value.code or 0) == 0
    assert called["script_name"] == "review_pipeline.py"
    assert called["argv"] == [
        "--project-root",
        str(book_root),
        "--chapter",
        "18",
        "--review-results",
        str(review_results),
        "--metrics-out",
        str(tmp_path / "metrics.json"),
        "--report-file",
        "审查报告/第18章.md",
        "--save-metrics",
    ]


def test_project_memory_forwards_with_resolved_project_root(monkeypatch, tmp_path):
    module = _load_webnovel_module()

    book_root = (tmp_path / "book").resolve()
    called = {}

    def _fake_resolve(explicit_project_root=None):
        return book_root

    def _fake_run_script(script_name, argv):
        called["script_name"] = script_name
        called["argv"] = list(argv)
        return 0

    monkeypatch.setattr(module, "_resolve_root", _fake_resolve)
    monkeypatch.setattr(module, "_run_script", _fake_run_script)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "--project-root",
            str(tmp_path),
            "project-memory",
            "add-pattern",
            "--pattern-type",
            "format",
            "--description",
            '内心独白使用双引号""',
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    assert int(exc.value.code or 0) == 0
    assert called["script_name"] == "project_memory.py"
    assert called["argv"] == [
        "--project-root",
        str(book_root),
        "add-pattern",
        "--pattern-type",
        "format",
        "--description",
        '内心独白使用双引号""',
    ]


def test_project_memory_add_pattern_escapes_quotes(tmp_path):
    _ensure_scripts_on_path()
    import project_memory as project_memory_module

    project_root = (tmp_path / "book").resolve()
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text(
        json.dumps({"progress": {"current_chapter": 3}}, ensure_ascii=False),
        encoding="utf-8",
    )

    description = "正文格式规范：内心独白使用双引号\"\"，系统界面保留方括号[]"
    result = project_memory_module.add_pattern(
        project_root,
        pattern_type="format",
        description=description,
        category="写作规范",
        importance="high",
    )

    memory_path = project_root / ".webnovel" / "project_memory.json"
    raw_text = memory_path.read_text(encoding="utf-8")
    payload = json.loads(raw_text)

    assert result["status"] == "success"
    assert '\\"\\"' in raw_text
    assert payload["patterns"][0]["description"] == description
    assert payload["patterns"][0]["source_chapter"] == 3


def test_review_pipeline_main_creates_output_directories(tmp_path):
    _ensure_scripts_on_path()
    import review_pipeline as review_pipeline_module

    project_root = (tmp_path / "book").resolve()
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    review_results_path = tmp_path / "review_results.json"
    review_results_path.write_text(
        json.dumps(
            {
                "issues": [
                    {
                        "severity": "low",
                        "category": "other",
                        "location": "p1",
                        "description": "小问题",
                    }
                ],
                "summary": "轻微",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    metrics_out = project_root / ".webnovel" / "tmp" / "review" / "metrics.json"
    report_file = project_root / "审查报告" / "第9章审查报告.md"

    old_argv = sys.argv
    sys.argv = [
        "review_pipeline",
        "--project-root",
        str(project_root),
        "--chapter",
        "9",
        "--review-results",
        str(review_results_path),
        "--metrics-out",
        str(metrics_out),
        "--report-file",
        "审查报告/第9章审查报告.md",
        "--save-metrics",
    ]
    try:
        review_pipeline_module.main()
    finally:
        sys.argv = old_argv

    assert metrics_out.is_file()
    assert report_file.is_file()
    report_text = report_file.read_text(encoding="utf-8")
    assert "# 第9章审查报告" in report_text
    assert "小问题" in report_text
    assert "## 其他问题" in report_text

    import sqlite3

    with sqlite3.connect(project_root / ".webnovel" / "index.db") as conn:
        row = conn.execute(
            "SELECT start_chapter, end_chapter, report_file FROM review_metrics"
        ).fetchone()
    assert row == (9, 9, "审查报告/第9章审查报告.md")


def test_webnovel_skill_flow_runs_story_contract_context_and_review_pipeline_with_stubbed_vector_model(
    monkeypatch, tmp_path, capsys
):
    _ensure_scripts_on_path()
    module = _load_webnovel_module()
    import data_modules.rag_adapter as rag_module
    from data_modules.config import DataModulesConfig

    project_root = (tmp_path / "book").resolve()
    cfg = DataModulesConfig.from_project_root(project_root)
    cfg.ensure_dirs()

    cfg.state_file.write_text(
        json.dumps(
            {
                "project": {"genre": "xuanhuan"},
                "progress": {
                    "current_chapter": 3,
                    "total_words": 9000,
                    "volumes_planned": [{"volume": 1, "chapters_range": "1-20"}],
                },
                "protagonist_state": {
                    "name": "萧炎",
                    "location": {"current": "天云宗外院"},
                    "power": {"realm": "斗者", "layer": 9},
                },
                "chapter_meta": {},
                "disambiguation_warnings": [],
                "disambiguation_pending": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    outline_dir = project_root / "大纲"
    outline_dir.mkdir(parents=True, exist_ok=True)
    (outline_dir / "第1卷-详细大纲.md").write_text(
        "\n".join(
            [
                "### 第3章：试炼冲突",
                "本章将聚焦萧炎与药老关系冲突，并回收旧线索真相。",
                "CBN：萧炎进入试炼场",
                "CPNs：",
                "- 药老提醒规则异常",
                "- 萧炎发现师徒分歧",
                "CEN：萧炎决定暂缓冲突",
                "必须覆盖节点：发现规则异常",
                "本章禁区：不可提前摊牌",
            ]
        ),
        encoding="utf-8",
    )

    refs_dir = project_root / ".claude" / "references"
    refs_dir.mkdir(parents=True, exist_ok=True)
    (refs_dir / "genre-profiles.md").write_text("## xuanhuan\n- 升级线清晰", encoding="utf-8")
    (refs_dir / "reading-power-taxonomy.md").write_text("## xuanhuan\n- 冲突钩优先", encoding="utf-8")

    calls = {"embed": 0, "embed_batch": 0, "rerank": 0}

    class _StubVectorClient:
        async def embed(self, texts):
            calls["embed"] += 1
            return [[1.0, 0.0] for _ in texts]

        async def embed_batch(self, texts, skip_failures=True):
            calls["embed_batch"] += 1
            return [[1.0, 0.0] for _ in texts]

        async def rerank(self, query, documents, top_n=None):
            calls["rerank"] += 1
            limit = top_n or len(documents)
            return [
                {"index": i, "relevance_score": 1.0 / (i + 1)}
                for i in range(min(limit, len(documents)))
            ]

    monkeypatch.setenv("EMBED_API_KEY", "fake-embed-key")
    monkeypatch.setattr(rag_module, "get_client", lambda config: _StubVectorClient())

    adapter = rag_module.RAGAdapter(cfg)
    asyncio.run(
        adapter.store_chunks(
            [
                {
                    "chapter": 2,
                    "scene_index": 1,
                    "content": "萧炎与药老关系紧张，线索逐步浮现，冲突升级。",
                }
            ]
        )
    )

    script_to_module = {
        "story_system.py": "story_system",
        "extract_chapter_context.py": "extract_chapter_context",
        "review_pipeline.py": "review_pipeline",
    }

    def _run_script_inproc(script_name, argv):
        module_name = script_to_module.get(script_name)
        if not module_name:
            raise AssertionError(f"unexpected script call: {script_name}")
        script_module = importlib.import_module(module_name)
        old_argv = sys.argv
        try:
            sys.argv = [module_name, *argv]
            script_module.main()
            return 0
        except SystemExit as exc:
            return int(exc.code or 0)
        finally:
            sys.argv = old_argv

    monkeypatch.setattr(module, "_run_script", _run_script_inproc)

    def _run_webnovel(argv):
        monkeypatch.setattr(sys, "argv", ["webnovel", *argv])
        with pytest.raises(SystemExit) as exc:
            module.main()
        return int(exc.value.code or 0)

    assert (
        _run_webnovel(
            [
                "--project-root",
                str(project_root),
                "story-system",
                "玄幻退婚流",
                "--chapter",
                "3",
                "--persist",
                "--emit-runtime-contracts",
                "--format",
                "json",
            ]
        )
        == 0
    )
    capsys.readouterr()

    story_root = project_root / ".story-system"
    assert (story_root / "MASTER_SETTING.json").is_file()
    assert (story_root / "volumes" / "volume_001.json").is_file()
    assert (story_root / "reviews" / "chapter_003.review.json").is_file()

    assert (
        _run_webnovel(
            [
                "--project-root",
                str(project_root),
                "extract-context",
                "--chapter",
                "3",
                "--format",
                "json",
            ]
        )
        == 0
    )
    context_payload = json.loads(capsys.readouterr().out)
    assert (
        context_payload["story_contract"]["review_contract"]["meta"]["contract_type"]
        == "REVIEW_CONTRACT"
    )
    assert context_payload["prewrite_validation"]["blocking"] is False
    assert context_payload["rag_assist"]["invoked"] is True
    assert context_payload["rag_assist"]["hits"]
    assert calls["embed_batch"] >= 1
    assert calls["embed"] >= 1
    assert calls["rerank"] >= 1

    review_results_path = project_root / ".webnovel" / "tmp" / "review_results.json"
    review_results_path.parent.mkdir(parents=True, exist_ok=True)
    review_results_path.write_text(
        json.dumps(
            {
                "issues": [
                    {
                        "severity": "medium",
                        "category": "continuity",
                        "location": "第3段",
                        "description": "衔接略弱",
                        "evidence": "上章钩子未明确承接",
                        "fix_hint": "补衔接句",
                    }
                ],
                "summary": "1个中优问题",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    metrics_out = project_root / ".webnovel" / "tmp" / "review_metrics.json"
    assert (
        _run_webnovel(
            [
                "--project-root",
                str(project_root),
                "review-pipeline",
                "--chapter",
                "3",
                "--review-results",
                str(review_results_path),
                "--metrics-out",
                str(metrics_out),
                "--report-file",
                "审查报告/第3章.md",
            ]
        )
        == 0
    )
    assert metrics_out.is_file()
    metrics_payload = json.loads(metrics_out.read_text(encoding="utf-8"))
    assert metrics_payload["issues_count"] == 1
