#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
补全 store CLI, compactor 边界, cli_args 解析, webnovel 路由 的测试覆盖。
"""

import json
import sys
from io import StringIO
from pathlib import Path

import pytest

from data_modules.config import DataModulesConfig
from data_modules.memory.schema import MemoryItem, ScratchpadData, memory_item_key
from data_modules.memory.store import ScratchpadManager
from data_modules.memory.compactor import compact_scratchpad, _key_for, _is_resolved_open_loop
from data_modules.cli_args import normalize_global_project_root, load_json_arg, _extract_flag_value


# ── helpers ──────────────────────────────────────────────────────────────

def _cfg(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    if not cfg.state_file.exists():
        cfg.state_file.write_text("{}", encoding="utf-8")
    return cfg


def _make_item(id, category="character_state", subject="x", field="f", value="v", chapter=1, **kw):
    return MemoryItem(
        id=id, layer="semantic", category=category,
        subject=subject, field=field, value=value,
        source_chapter=chapter, **kw,
    )


# ═══════════════════════════════════════════════════════════════════════
# 1. cli_args 补全
# ═══════════════════════════════════════════════════════════════════════

def test_extract_flag_value_equals_form():
    value, rest = _extract_flag_value(["cmd", "--project-root=/my/path", "sub"], "--project-root")
    assert value == "/my/path"
    assert rest == ["cmd", "sub"]


def test_extract_flag_value_dangling_flag():
    value, rest = _extract_flag_value(["--project-root"], "--project-root")
    assert value is None
    assert rest == ["--project-root"]


def test_extract_flag_value_last_wins():
    value, rest = _extract_flag_value(
        ["--project-root", "first", "cmd", "--project-root", "second"],
        "--project-root",
    )
    assert value == "second"
    assert rest == ["cmd"]


def test_normalize_global_project_root_no_flag():
    argv = ["cmd", "--other", "val"]
    assert normalize_global_project_root(argv) is argv


def test_load_json_arg_from_file(tmp_path):
    f = tmp_path / "data.json"
    f.write_text('{"a":1}', encoding="utf-8")
    result = load_json_arg(f"@{f}")
    assert result == {"a": 1}


def test_load_json_arg_from_stdin(monkeypatch):
    monkeypatch.setattr(sys, "stdin", StringIO('{"b":2}'))
    result = load_json_arg("@-")
    assert result == {"b": 2}


def test_load_json_arg_empty_at_raises():
    with pytest.raises(ValueError, match="without path"):
        load_json_arg("@")


def test_load_json_arg_none_raises():
    with pytest.raises(ValueError, match="missing"):
        load_json_arg(None)


# ═══════════════════════════════════════════════════════════════════════
# 2. compactor 边界补全
# ═══════════════════════════════════════════════════════════════════════

def test_key_for_unknown_category_falls_back_to_id():
    item = _make_item("x1", category="unknown_cat")
    assert _key_for(item) == ("x1",)


def test_is_resolved_open_loop_various_statuses():
    base = dict(id="ol1", layer="semantic", category="open_loop", subject="x", field="status", value="x", source_chapter=1)
    assert _is_resolved_open_loop(MemoryItem(**base, payload={"status": "resolved"})) is True
    assert _is_resolved_open_loop(MemoryItem(**base, payload={"status": "payoff"})) is True
    assert _is_resolved_open_loop(MemoryItem(**base, payload={"status": "active"})) is False
    assert _is_resolved_open_loop(MemoryItem(**base, payload=None)) is False

    non_loop = _make_item("cs1", category="character_state")
    assert _is_resolved_open_loop(non_loop) is False


def test_compactor_dedup_outdated_keeps_latest():
    """步骤1: 同key的outdated只保留最新一条。"""
    data = ScratchpadData.empty()
    # 3 items: 2 outdated (同key) + 1 active → dedup后变2 items, <= max_items=3
    data.character_state = [
        _make_item("a1", subject="x", field="realm", value="v1", status="outdated", updated_at="2026-01-01T00:00:00"),
        _make_item("a2", subject="x", field="realm", value="v2", status="outdated", updated_at="2026-02-01T00:00:00"),
        _make_item("a3", subject="x", field="realm", value="v3", status="active"),
    ]
    # 需1个额外item让总数=4 > max_items=3，触发压缩入口
    data.world_rules.append(_make_item("wr0", category="world_rule", subject="r0", field="f0", value="v0", chapter=1))
    result = compact_scratchpad(data, max_items=3)
    outdated = [r for r in result.character_state if r.status == "outdated"]
    # dedup去掉a1，保留a2（更新），压缩后总数=3（a2+a3+wr0）刚好 <= max_items
    assert len(outdated) == 1
    assert outdated[0].value == "v2"


def test_compactor_cleans_resolved_open_loops():
    """步骤2: 已resolved的open_loop被清除。"""
    data = ScratchpadData.empty()
    data.open_loops = [
        _make_item("ol1", category="open_loop", subject="伏笔A", field="status", value="A", payload={"status": "resolved"}),
        _make_item("ol2", category="open_loop", subject="伏笔B", field="status", value="B", payload={"status": "active"}),
    ]
    # 补2个填充项让总数=4 > max_items=3
    data.world_rules.append(_make_item("wr0", category="world_rule", subject="r0", field="f0", value="v0", chapter=1))
    data.world_rules.append(_make_item("wr1", category="world_rule", subject="r1", field="f1", value="v1", chapter=1))
    result = compact_scratchpad(data, max_items=3)
    loop_subjects = [r.subject for r in result.open_loops]
    assert "伏笔A" not in loop_subjects
    assert "伏笔B" in loop_subjects


def test_compactor_replaces_existing_timeline_summary():
    """步骤3的timeline summary只保留一条，即使field值随章节变化。"""
    data = ScratchpadData.empty()
    # pre-existing summary with old field value
    data.story_facts = [
        _make_item("sf-old", category="story_fact", subject="timeline_summary", field="<=ch5", value="旧摘要"),
    ]
    # old timeline entries (>50 chapters from latest)
    for i in range(3):
        data.timeline.append(_make_item(f"t-old-{i}", category="timeline", subject=f"旧事件{i}", field="event", value=f"旧事件{i}", chapter=i+1))
    # fresh timeline
    data.timeline.append(_make_item("t-fresh", category="timeline", subject="新事件", field="event", value="新事件", chapter=60))

    # max_items 设足够大，让 step 4 不截断，只测 step 3 的替换逻辑
    result = compact_scratchpad(data, max_items=4)
    summaries = [r for r in result.story_facts if r.subject == "timeline_summary"]
    # 旧 summary (field="<=ch5") 应被新 summary (field="<=ch3") 替换，而非共存
    assert len(summaries) == 1
    assert "旧事件" in summaries[0].value
    assert summaries[0].field != "<=ch5"  # 旧field已被覆盖


def test_compactor_resolved_open_loop_integration(tmp_path):
    """集成测试: compactor通过store.save()触发时正确清除resolved open_loop。"""
    cfg = _cfg(tmp_path)
    cfg.memory_compactor_enabled = True
    cfg.memory_compactor_threshold = 3
    manager = ScratchpadManager(cfg)

    # 插入一个resolved open_loop
    manager.upsert_item(_make_item("ol-resolved", category="open_loop", subject="伏笔已解",
                                   field="status", value="已解伏笔", payload={"status": "resolved"}))
    # 插入一个active open_loop
    manager.upsert_item(_make_item("ol-active", category="open_loop", subject="伏笔未解",
                                   field="status", value="未解伏笔", payload={"status": "active"}))
    # 再插入几条让总数超过threshold触发compaction
    manager.upsert_item(_make_item("w1", category="world_rule", subject="r1", field="f1", value="v1"))
    manager.upsert_item(_make_item("w2", category="world_rule", subject="r2", field="f2", value="v2"))

    data = manager.load()
    loop_subjects = [r.subject for r in data.open_loops]
    assert "伏笔已解" not in loop_subjects
    assert "伏笔未解" in loop_subjects


def test_memory_item_key_shared_function():
    """验证 schema.memory_item_key 与 compactor._key_for / store._key_for 一致。"""
    item = _make_item("x1", category="character_state", subject="hero", field="realm")
    assert memory_item_key(item) == ("hero", "realm")
    assert _key_for(item) == memory_item_key(item)

    mgr_key = ScratchpadManager.__new__(ScratchpadManager)
    # _key_for is instance method, call directly
    assert ScratchpadManager._key_for(mgr_key, item) == memory_item_key(item)

    unknown = _make_item("u1", category="unknown_category")
    assert memory_item_key(unknown) == ("u1",)


# ═══════════════════════════════════════════════════════════════════════
# 3. store CLI 补全
# ═══════════════════════════════════════════════════════════════════════

def test_store_cli_stats(tmp_path, monkeypatch, capsys):
    cfg = _cfg(tmp_path)
    manager = ScratchpadManager(cfg)
    manager.upsert_item(_make_item("c1"))

    monkeypatch.setattr(sys, "argv", ["store", "--project-root", str(tmp_path), "stats"])
    from data_modules.memory import store as store_module
    store_module.main()
    out = json.loads(capsys.readouterr().out)
    assert out["status"] == "success"
    assert out["data"]["total"] >= 1


def test_store_cli_dump(tmp_path, monkeypatch, capsys):
    cfg = _cfg(tmp_path)
    manager = ScratchpadManager(cfg)
    manager.upsert_item(_make_item("c1"))

    monkeypatch.setattr(sys, "argv", ["store", "--project-root", str(tmp_path), "dump"])
    from data_modules.memory import store as store_module
    store_module.main()
    out = json.loads(capsys.readouterr().out)
    assert out["status"] == "success"


def test_store_cli_conflicts(tmp_path, monkeypatch, capsys):
    cfg = _cfg(tmp_path)
    monkeypatch.setattr(sys, "argv", ["store", "--project-root", str(tmp_path), "conflicts"])
    from data_modules.memory import store as store_module
    store_module.main()
    out = json.loads(capsys.readouterr().out)
    assert out["status"] == "success"


def test_store_cli_query(tmp_path, monkeypatch, capsys):
    cfg = _cfg(tmp_path)
    manager = ScratchpadManager(cfg)
    manager.upsert_item(_make_item("c1", subject="hero", field="realm", value="斗者"))

    monkeypatch.setattr(sys, "argv", [
        "store", "--project-root", str(tmp_path),
        "query", "--category", "character_state", "--subject", "hero",
    ])
    from data_modules.memory import store as store_module
    store_module.main()
    out = json.loads(capsys.readouterr().out)
    assert out["status"] == "success"
    assert len(out["data"]) >= 1


def test_store_cli_update(tmp_path, monkeypatch, capsys):
    cfg = _cfg(tmp_path)
    payload = json.dumps({
        "state_changes": [{"entity_id": "hero", "field": "realm", "old": "斗者", "new": "斗师"}],
    })
    monkeypatch.setattr(sys, "argv", [
        "store", "--project-root", str(tmp_path),
        "update", "--chapter", "5", "--data", payload,
    ])
    from data_modules.memory import store as store_module
    store_module.main()
    out = json.loads(capsys.readouterr().out)
    assert out["status"] == "success"
    assert out["data"]["items_added"] >= 0


# ═══════════════════════════════════════════════════════════════════════
# 4. webnovel 路由补全
# ═══════════════════════════════════════════════════════════════════════

def _load_webnovel_module():
    scripts_dir = Path(__file__).resolve().parents[2]
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    import data_modules.webnovel as webnovel_module
    return webnovel_module


def test_webnovel_cmd_where(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()
    book_root = tmp_path / "book"
    monkeypatch.setattr(module, "_resolve_root", lambda _=None: book_root)
    monkeypatch.setattr(sys, "argv", ["webnovel", "where"])
    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    assert str(book_root) in capsys.readouterr().out


def test_webnovel_passthrough_state(monkeypatch, tmp_path):
    module = _load_webnovel_module()
    book_root = tmp_path / "book"
    called = {}

    def _fake_resolve(_=None):
        return book_root

    def _fake_run(mod_name, argv):
        called["mod"] = mod_name
        called["argv"] = list(argv)
        return 0

    monkeypatch.setattr(module, "_resolve_root", _fake_resolve)
    monkeypatch.setattr(module, "_run_data_module", _fake_run)
    monkeypatch.setattr(sys, "argv", ["webnovel", "state", "get-progress"])

    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    assert called["mod"] == "state_manager"
    assert "--project-root" in called["argv"]
    assert "get-progress" in called["argv"]


def test_webnovel_passthrough_memory(monkeypatch, tmp_path):
    module = _load_webnovel_module()
    book_root = tmp_path / "book"
    called = {}

    monkeypatch.setattr(module, "_resolve_root", lambda _=None: book_root)
    monkeypatch.setattr(module, "_run_data_module", lambda m, a: (called.update(mod=m, argv=list(a)), 0)[1])
    monkeypatch.setattr(sys, "argv", ["webnovel", "memory", "stats"])

    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    assert called["mod"] == "memory.store"


def test_webnovel_strip_project_root_args():
    module = _load_webnovel_module()
    result = module._strip_project_root_args(["--project-root", "/a", "cmd", "--project-root=/b", "--other"])
    assert result == ["cmd", "--other"]


def test_webnovel_passthrough_rag(monkeypatch, tmp_path):
    module = _load_webnovel_module()
    book_root = tmp_path / "book"
    called = {}
    monkeypatch.setattr(module, "_resolve_root", lambda _=None: book_root)
    monkeypatch.setattr(module, "_run_data_module", lambda m, a: (called.update(mod=m), 0)[1])
    monkeypatch.setattr(sys, "argv", ["webnovel", "rag", "search", "--query", "test"])
    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    assert called["mod"] == "rag_adapter"


def test_webnovel_passthrough_style(monkeypatch, tmp_path):
    module = _load_webnovel_module()
    book_root = tmp_path / "book"
    called = {}
    monkeypatch.setattr(module, "_resolve_root", lambda _=None: book_root)
    monkeypatch.setattr(module, "_run_data_module", lambda m, a: (called.update(mod=m), 0)[1])
    monkeypatch.setattr(sys, "argv", ["webnovel", "style", "list"])
    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    assert called["mod"] == "style_sampler"


def test_webnovel_passthrough_entity(monkeypatch, tmp_path):
    module = _load_webnovel_module()
    called = {}
    monkeypatch.setattr(module, "_resolve_root", lambda _=None: tmp_path)
    monkeypatch.setattr(module, "_run_data_module", lambda m, a: (called.update(mod=m), 0)[1])
    monkeypatch.setattr(sys, "argv", ["webnovel", "entity", "process"])
    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    assert called["mod"] == "entity_linker"


def test_webnovel_passthrough_context(monkeypatch, tmp_path):
    module = _load_webnovel_module()
    called = {}
    monkeypatch.setattr(module, "_resolve_root", lambda _=None: tmp_path)
    monkeypatch.setattr(module, "_run_data_module", lambda m, a: (called.update(mod=m), 0)[1])
    monkeypatch.setattr(sys, "argv", ["webnovel", "context", "build"])
    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    assert called["mod"] == "context_manager"


def test_webnovel_passthrough_migrate(monkeypatch, tmp_path):
    module = _load_webnovel_module()
    called = {}
    monkeypatch.setattr(module, "_resolve_root", lambda _=None: tmp_path)
    monkeypatch.setattr(module, "_run_data_module", lambda m, a: (called.update(mod=m), 0)[1])
    monkeypatch.setattr(sys, "argv", ["webnovel", "migrate"])
    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    assert called["mod"] == "migrate_state_to_sqlite"


def test_webnovel_passthrough_status_script(monkeypatch, tmp_path):
    module = _load_webnovel_module()
    called = {}
    monkeypatch.setattr(module, "_resolve_root", lambda _=None: tmp_path)
    monkeypatch.setattr(module, "_run_script", lambda s, a: (called.update(script=s), 0)[1])
    monkeypatch.setattr(sys, "argv", ["webnovel", "status"])
    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    assert called["script"] == "status_reporter.py"


def test_webnovel_passthrough_update_state_script(monkeypatch, tmp_path):
    module = _load_webnovel_module()
    called = {}
    monkeypatch.setattr(module, "_resolve_root", lambda _=None: tmp_path)
    monkeypatch.setattr(module, "_run_script", lambda s, a: (called.update(script=s), 0)[1])
    monkeypatch.setattr(sys, "argv", ["webnovel", "update-state", "add-review"])
    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    assert called["script"] == "update_state.py"


def test_webnovel_passthrough_backup_script(monkeypatch, tmp_path):
    module = _load_webnovel_module()
    called = {}
    monkeypatch.setattr(module, "_resolve_root", lambda _=None: tmp_path)
    monkeypatch.setattr(module, "_run_script", lambda s, a: (called.update(script=s), 0)[1])
    monkeypatch.setattr(sys, "argv", ["webnovel", "backup"])
    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    assert called["script"] == "backup_manager.py"


def test_webnovel_passthrough_archive_script(monkeypatch, tmp_path):
    module = _load_webnovel_module()
    called = {}
    monkeypatch.setattr(module, "_resolve_root", lambda _=None: tmp_path)
    monkeypatch.setattr(module, "_run_script", lambda s, a: (called.update(script=s), 0)[1])
    monkeypatch.setattr(sys, "argv", ["webnovel", "archive"])
    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    assert called["script"] == "archive_manager.py"


def test_webnovel_remainder_strips_leading_double_dash(monkeypatch, tmp_path):
    module = _load_webnovel_module()
    called = {}
    monkeypatch.setattr(module, "_resolve_root", lambda _=None: tmp_path)
    monkeypatch.setattr(module, "_run_data_module", lambda m, a: (called.update(argv=list(a)), 0)[1])
    monkeypatch.setattr(sys, "argv", ["webnovel", "index", "--", "get-core-entities"])
    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    assert "get-core-entities" in called["argv"]
    assert "--" not in called["argv"]


def test_webnovel_cmd_use(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()
    book_root = tmp_path / "book"
    (book_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (book_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    monkeypatch.setattr(module, "write_current_project_pointer", lambda pr, workspace_root=None: None)
    monkeypatch.setattr(module, "update_global_registry_current_project", lambda workspace_root=None, project_root=None: None)
    monkeypatch.setattr(sys, "argv", ["webnovel", "use", str(book_root)])

    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    out = capsys.readouterr().out
    assert "pointer" in out.lower() or "skipped" in out.lower()


def test_webnovel_cmd_use_with_workspace_root(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()
    book_root = tmp_path / "book"
    workspace_root = tmp_path / "ws"

    pointer_path = tmp_path / "pointer.txt"
    reg_path = tmp_path / "registry.json"

    monkeypatch.setattr(module, "write_current_project_pointer", lambda pr, workspace_root=None: pointer_path)
    monkeypatch.setattr(module, "update_global_registry_current_project", lambda workspace_root=None, project_root=None: reg_path)
    monkeypatch.setattr(sys, "argv", ["webnovel", "use", str(book_root), "--workspace-root", str(workspace_root)])

    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    out = capsys.readouterr().out
    assert str(pointer_path) in out
    assert str(reg_path) in out


def test_webnovel_run_script_missing_script():
    module = _load_webnovel_module()
    with pytest.raises(FileNotFoundError, match="未找到脚本"):
        module._run_script("nonexistent_script_xyz.py", [])


def test_webnovel_run_data_module_no_main():
    module = _load_webnovel_module()
    with pytest.raises(RuntimeError, match="缺少可调用的 main"):
        module._run_data_module("schemas", [])  # schemas 没有 main()


def test_webnovel_preflight_json_format(monkeypatch, tmp_path, capsys):
    module = _load_webnovel_module()
    project_root = tmp_path / "book"
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    monkeypatch.setattr(sys, "argv", ["webnovel", "--project-root", str(project_root), "preflight", "--format", "json"])
    with pytest.raises(SystemExit) as exc:
        module.main()
    assert int(exc.value.code or 0) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["ok"] is True or result["ok"] is False
    assert "checks" in result


def test_webnovel_resolve_root_fallback(monkeypatch):
    module = _load_webnovel_module()
    # _resolve_root with None should call resolve_project_root() without args
    called = {}
    monkeypatch.setattr(module, "resolve_project_root", lambda *a, **kw: (called.update(args=a), Path("/fake"))[1])
    result = module._resolve_root(None)
    assert result == Path("/fake")
    assert called["args"] == ()

