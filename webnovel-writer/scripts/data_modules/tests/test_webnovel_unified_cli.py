#!/usr/bin/env python3

import json
import sqlite3
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


def test_extract_context_accepts_marker_root_when_state_missing(monkeypatch, tmp_path):
    module = _load_webnovel_module()

    marker_root = (tmp_path / "book").resolve()
    (marker_root / "正文").mkdir(parents=True, exist_ok=True)
    called = {}

    def _fake_resolve(_explicit_project_root=None):
        raise FileNotFoundError("missing .webnovel/state.json")

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
            str(marker_root),
            "extract-context",
            "--chapter",
            "7",
            "--format",
            "text",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    assert int(exc.value.code or 0) == 0
    assert called["script_name"] == "extract_chapter_context.py"
    assert called["argv"][0:2] == ["--project-root", str(marker_root)]


def test_extract_context_reports_project_root_error(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()

    invalid_root = (tmp_path / "workspace").resolve()

    def _fake_resolve_root_for_extract_context(_explicit_project_root=None):
        raise FileNotFoundError(f"extract-context project_root 不存在: {invalid_root}")

    def _fake_run_script(*_args, **_kwargs):
        raise AssertionError("project_root 解析失败时不应继续转发子脚本")

    monkeypatch.setattr(module, "_resolve_root_for_extract_context", _fake_resolve_root_for_extract_context)
    monkeypatch.setattr(module, "_run_script", _fake_run_script)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "--project-root",
            str(invalid_root),
            "extract-context",
            "--chapter",
            "3",
            "--format",
            "json",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    captured = capsys.readouterr()
    assert int(exc.value.code) == 1
    assert "ERROR project_root (extract-context):" in captured.err
    assert "extract-context project_root 不存在" in captured.err


def test_migrate_codex_dispatches_to_runtime_migration(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()

    book_root = (tmp_path / "book").resolve()
    (book_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (book_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    called = {}

    def _fake_resolve(explicit_project_root=None):
        called["resolve_arg"] = explicit_project_root
        return book_root

    def _fake_run_codex_migration(*, project_root, dry_run, workspace_hint):
        called["project_root"] = project_root
        called["dry_run"] = dry_run
        called["workspace_hint"] = workspace_hint
        print("{}")
        return 0

    workspace_root = (tmp_path / "workspace").resolve()
    workspace_root.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(module, "_resolve_root", _fake_resolve)
    monkeypatch.setattr(module, "_run_codex_migration", _fake_run_codex_migration)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "migrate",
            "codex",
            "--project-root",
            str(workspace_root),
            "--dry-run",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    captured = capsys.readouterr()
    assert int(exc.value.code or 0) == 0
    assert captured.out.strip() == "{}"
    assert called["resolve_arg"] == str(workspace_root)
    assert called["project_root"] == book_root
    assert called["dry_run"] is True
    assert called["workspace_hint"] == workspace_root


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


def test_preflight_json_includes_binding_details(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()

    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir(parents=True, exist_ok=True)
    (workspace_root / ".codex").mkdir(parents=True, exist_ok=True)

    project_root = workspace_root / "book"
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    pointer_file = workspace_root / ".codex" / ".webnovel-current-project"
    pointer_file.write_text(str(project_root.resolve()), encoding="utf-8")

    registry_home = tmp_path / "codex-home"
    monkeypatch.setenv("CODEX_HOME", str(registry_home))
    registry_path = registry_home / "webnovel-writer" / "registry.json"
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "workspaces": {
                    str(workspace_root.resolve()).lower(): {
                        "workspace_root": str(workspace_root.resolve()),
                        "current_project_root": str(project_root.resolve()),
                        "updated_at": "2026-03-25T00:00:00",
                    }
                },
                "last_used_project_root": str(project_root.resolve()),
                "updated_at": "2026-03-25T00:00:00",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        sys,
        "argv",
        ["webnovel", "--project-root", str(workspace_root), "preflight", "--format", "json"],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    captured = capsys.readouterr()
    assert int(exc.value.code or 0) == 0
    payload = json.loads(captured.out)
    assert "binding" in payload
    assert "pointer" in payload["binding"]
    assert "registry" in payload["binding"]
    assert payload["binding"]["project_root"]["ok"] is True


def test_where_fails_with_clear_reason_when_state_json_missing(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()

    # Clear env vars that previous tests may have set (e.g. CODEX_HOME pointing to a valid registry)
    monkeypatch.delenv("CODEX_HOME", raising=False)
    monkeypatch.delenv("WEBNOVEL_PROJECT_ROOT", raising=False)

    invalid_root = tmp_path / "workspace"
    (invalid_root / ".webnovel").mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(sys, "argv", ["webnovel", "--project-root", str(invalid_root), "where"])

    with pytest.raises(SystemExit) as exc:
        module.main()

    captured = capsys.readouterr()
    assert int(exc.value.code or 0) == 1
    assert "missing .webnovel/state.json" in captured.err


def test_use_writes_registry_and_reports_pointer_skip_reason(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()

    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir(parents=True, exist_ok=True)

    project_root = workspace_root / "book"
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    registry_home = tmp_path / "codex-home"
    monkeypatch.setenv("CODEX_HOME", str(registry_home))

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "use",
            str(project_root),
            "--workspace-root",
            str(workspace_root),
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    captured = capsys.readouterr()
    assert int(exc.value.code or 0) == 0
    assert "workspace pointer: (skipped: reason=context_dir_missing" in captured.out
    assert "global registry:" in captured.out

    registry_path = registry_home / "webnovel-writer" / "registry.json"
    assert registry_path.is_file()

def test_quality_trend_report_writes_to_book_root_when_input_is_workspace_root(tmp_path, monkeypatch):
    _ensure_scripts_on_path()
    import quality_trend_report as quality_trend_report_module

    workspace_root = (tmp_path / "workspace").resolve()
    book_root = (workspace_root / "凡人资本论").resolve()

    (workspace_root / ".codex").mkdir(parents=True, exist_ok=True)
    (workspace_root / ".codex" / ".webnovel-current-project").write_text(str(book_root), encoding="utf-8")

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


def test_update_state_runs_index_sync_hook_after_success(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()

    project_root = (tmp_path / "book").resolve()
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text(
        json.dumps(
            {
                "progress": {"current_chapter": 12, "last_updated": "2026-03-26 12:00:00"},
                "consistency_meta": {"version": "f03-v1"},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    called = {"script": None, "sync": None}

    def _fake_run_script(script_name, argv):
        called["script"] = (script_name, list(argv))
        return 0

    def _fake_sync(project_root_arg):
        called["sync"] = str(project_root_arg)
        return {
            "state_current_chapter": 12,
            "sync_updated_at": "2026-03-26 12:00:01",
            "sync_version": "f03-v1",
        }

    monkeypatch.setattr(module, "_run_script", _fake_run_script)
    monkeypatch.setattr(module, "_sync_index_after_update_state", _fake_sync)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "--project-root",
            str(project_root),
            "update-state",
            "--progress",
            "12",
            "20000",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    captured = capsys.readouterr()
    assert int(exc.value.code or 0) == 0
    assert called["script"] is not None
    assert called["script"][0] == "update_state.py"
    assert called["sync"] == str(project_root)
    assert "index sync: ok" in captured.out


def test_update_state_returns_sync_failed_exit_code_when_hook_fails(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()

    project_root = (tmp_path / "book").resolve()
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    def _fake_run_script(_script_name, _argv):
        return 0

    def _fail_sync(_project_root_arg):
        raise RuntimeError("index locked")

    monkeypatch.setattr(module, "_run_script", _fake_run_script)
    monkeypatch.setattr(module, "_sync_index_after_update_state", _fail_sync)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "--project-root",
            str(project_root),
            "update-state",
            "--progress",
            "13",
            "23000",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    captured = capsys.readouterr()
    assert int(exc.value.code or 0) == module.USE_EXIT_UPDATE_STATE_SYNC_FAILED
    assert "index sync failed" in captured.err


def test_update_state_skip_flag_bypasses_index_sync_hook(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()

    project_root = (tmp_path / "book").resolve()
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    called = {"script": None}

    def _fake_run_script(script_name, argv):
        called["script"] = (script_name, list(argv))
        return 0

    def _unexpected_sync(_project_root_arg):
        raise AssertionError("skip-index-sync 时不应执行索引同步钩子")

    monkeypatch.setattr(module, "_run_script", _fake_run_script)
    monkeypatch.setattr(module, "_sync_index_after_update_state", _unexpected_sync)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "--project-root",
            str(project_root),
            "update-state",
            "--skip-index-sync",
            "--progress",
            "14",
            "26000",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    captured = capsys.readouterr()
    assert int(exc.value.code or 0) == 0
    assert called["script"] is not None
    assert "--skip-index-sync" not in called["script"][1]
    assert "index sync: (skipped: reason=skip_index_sync_flag" in captured.out


def test_consistency_check_reports_drift_with_suggestions(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()

    project_root = (tmp_path / "book").resolve()
    webnovel_dir = project_root / ".webnovel"
    webnovel_dir.mkdir(parents=True, exist_ok=True)
    (webnovel_dir / "state.json").write_text(
        json.dumps(
            {
                "progress": {
                    "current_chapter": 15,
                    "total_words": 45000,
                    "last_updated": "2026-03-26 15:00:00",
                },
                "consistency_meta": {
                    "version": "f03-v1",
                    "updated_at": "2026-03-26 15:00:00",
                    "source": "update_state.py",
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    index_db = webnovel_dir / "index.db"
    with sqlite3.connect(str(index_db)) as conn:
        cursor = conn.cursor()
        cursor.execute("CREATE TABLE chapters (chapter INTEGER PRIMARY KEY)")
        cursor.execute("INSERT INTO chapters (chapter) VALUES (10)")
        cursor.execute(
            """
            CREATE TABLE consistency_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cursor.execute(
            "INSERT INTO consistency_meta (key, value, updated_at) VALUES (?, ?, ?)",
            ("state_current_chapter", "10", "2026-03-26 15:00:01"),
        )
        conn.commit()

    vectors_db = webnovel_dir / "vectors.db"
    with sqlite3.connect(str(vectors_db)) as conn:
        cursor = conn.cursor()
        cursor.execute("CREATE TABLE vectors (chunk_id TEXT PRIMARY KEY, chapter INTEGER)")
        cursor.execute("INSERT INTO vectors (chunk_id, chapter) VALUES (?, ?)", ("ch0010_s1", 10))
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
            ("schema_version", "2", "2026-03-26 15:00:02"),
        )
        conn.commit()

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "--project-root",
            str(project_root),
            "consistency-check",
            "--format",
            "json",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    issue_codes = {item.get("code") for item in payload.get("issues", [])}

    assert int(exc.value.code or 0) == module.USE_EXIT_CONSISTENCY_DRIFT
    assert payload["status"] == "drift"
    assert "INDEX_SYNC_STALE" in issue_codes
    assert "INDEX_DATA_BEHIND" in issue_codes


def test_codex_rag_verify_passthrough_injects_project_root(monkeypatch, tmp_path):
    module = _load_webnovel_module()

    project_root = (tmp_path / "book").resolve()
    project_root.mkdir(parents=True, exist_ok=True)
    captured = {}

    def _fake_resolve(explicit_project_root=None):
        return project_root

    def _fake_run_data_module(module_name, argv):
        captured["module_name"] = module_name
        captured["argv"] = list(argv)
        return 0

    monkeypatch.setattr(module, "_resolve_root", _fake_resolve)
    monkeypatch.setattr(module, "_run_data_module", _fake_run_data_module)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "--project-root",
            str(project_root),
            "codex",
            "rag",
            "verify",
            "--report",
            "json",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    assert int(exc.value.code or 0) == 0
    assert captured["module_name"] == "codex_cli"
    assert captured["argv"] == ["rag", "verify", "--report", "json", "--project-root", str(project_root)]


def test_codex_session_stop_passthrough_does_not_inject_project_root(monkeypatch, tmp_path):
    module = _load_webnovel_module()

    project_root = (tmp_path / "book").resolve()
    project_root.mkdir(parents=True, exist_ok=True)
    captured = {}

    def _fake_resolve(explicit_project_root=None):
        return project_root

    def _fake_run_data_module(module_name, argv):
        captured["module_name"] = module_name
        captured["argv"] = list(argv)
        return 0

    monkeypatch.setattr(module, "_resolve_root", _fake_resolve)
    monkeypatch.setattr(module, "_run_data_module", _fake_run_data_module)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "webnovel",
            "--project-root",
            str(project_root),
            "codex",
            "session",
            "stop",
            "--session-id",
            "session-123",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    assert int(exc.value.code or 0) == 0
    assert captured["module_name"] == "codex_cli"
    assert captured["argv"] == ["session", "stop", "--session-id", "session-123"]
