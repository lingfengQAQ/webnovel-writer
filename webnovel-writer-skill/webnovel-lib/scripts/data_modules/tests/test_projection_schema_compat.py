#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Schema 兼容性测试：保护投影器在 LLM (DeepSeek v4pro) 实际输出 schema 下的行为。

背景：data-agent.md 提示词写的是 `{"field": "realm", "new": "..."}`，
但 LLM 实际输出 `{"field_path": "physical.condition", "new_value": "..."}`，
entity_deltas 用 `entity_type` 而非 `type`，open_loop_created 事件 payload 没有 `content`
但有 `description/loop_type/unanswered_question`。

这些测试用真实 DeepSeek v4pro 输出形态作为 fixture，确保投影器同时接受新旧 schema。
"""

import json

from data_modules.config import DataModulesConfig
from data_modules.memory.store import ScratchpadManager
from data_modules.memory_projection_writer import MemoryProjectionWriter
from data_modules.state_projection_writer import StateProjectionWriter
from data_modules.vector_projection_writer import VectorProjectionWriter


# ============================================================
# state_projection_writer：接受 field_path / new_value
# ============================================================


def test_state_writer_accepts_field_path_alias(tmp_path):
    (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    writer = StateProjectionWriter(tmp_path)

    writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 2},
            "state_deltas": [
                {
                    "entity_id": "luming",
                    "field_path": "physical.condition",
                    "old_value": "虚弱",
                    "new_value": "虚弱（持续）",
                    "change_type": "confirmed",
                }
            ],
        }
    )

    payload = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    luming = payload["entity_state"]["luming"]
    # 嵌套路径展开成字典
    assert luming["physical"]["condition"] == "虚弱（持续）"


def test_state_writer_accepts_flat_field_legacy(tmp_path):
    """既有 schema field/new 也必须继续工作（向后兼容）。"""
    (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    writer = StateProjectionWriter(tmp_path)

    writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 3},
            "state_deltas": [{"entity_id": "x", "field": "realm", "new": "斗师"}],
        }
    )

    payload = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    assert payload["entity_state"]["x"]["realm"] == "斗师"


def test_state_writer_handles_array_value_in_field_path(tmp_path):
    (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    writer = StateProjectionWriter(tmp_path)

    writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 2},
            "state_deltas": [
                {
                    "entity_id": "luming",
                    "field_path": "relationships.acquaintances",
                    "old_value": [],
                    "new_value": [
                        {"entity_id": "liu_dazhu", "type": "同屋杂役"},
                        {"entity_id": "sun_wang", "type": "同屋杂役"},
                    ],
                    "change_type": "initialize",
                }
            ],
        }
    )

    payload = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    acquaintances = payload["entity_state"]["luming"]["relationships"]["acquaintances"]
    assert len(acquaintances) == 2
    assert acquaintances[0]["entity_id"] == "liu_dazhu"


def test_state_writer_mirrors_protagonist_state_when_entity_is_protagonist(tmp_path):
    """主角实体的 state_delta 应同步到 state.json:protagonist_state，让旧读取路径仍可用。"""
    (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
    initial = {
        "protagonist_state": {
            "name": "陆鸣",
            "power": {"realm": "", "layer": 1},
            "location": {"current": "", "last_chapter": 0},
            "golden_finger": {"name": "穿越者知识", "level": 1, "cooldown": 0, "skills": []},
            "attributes": {},
        }
    }
    (tmp_path / ".webnovel" / "state.json").write_text(json.dumps(initial), encoding="utf-8")
    writer = StateProjectionWriter(tmp_path)

    writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 2},
            "state_deltas": [
                {"entity_id": "luming", "field_path": "power.realm", "new_value": "练气五层"},
                {
                    "entity_id": "luming",
                    "field_path": "location.current",
                    "new_value": "青云宗杂役院",
                },
            ],
            "entity_deltas": [
                {
                    "entity_id": "luming",
                    "canonical_name": "陆鸣",
                    "entity_type": "角色",
                    "tier": "核心",
                    "is_protagonist": True,
                }
            ],
        }
    )

    payload = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    assert payload["protagonist_state"]["power"]["realm"] == "练气五层"
    assert payload["protagonist_state"]["location"]["current"] == "青云宗杂役院"
    # name 不应被 delta 写回覆盖
    assert payload["protagonist_state"]["name"] == "陆鸣"


def test_state_writer_recognizes_protagonist_via_tier_zhujue(tmp_path):
    """实际 LLM 用 tier='主角' 标注，而不是 is_protagonist=True。"""
    (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
    initial = {
        "protagonist_state": {
            "name": "陆鸣",
            "power": {"realm": "", "layer": 1},
        }
    }
    (tmp_path / ".webnovel" / "state.json").write_text(json.dumps(initial), encoding="utf-8")
    writer = StateProjectionWriter(tmp_path)

    writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 1},
            "state_deltas": [
                {"entity_id": "luming", "field_path": "power.realm", "new_value": "练气五层"},
            ],
            "entity_deltas": [
                {
                    "entity_id": "luming",
                    "canonical_name": "陆鸣",
                    "entity_type": "角色",
                    "tier": "主角",
                }
            ],
        }
    )

    payload = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    assert payload["protagonist_state"]["power"]["realm"] == "练气五层"


def test_state_writer_recognizes_protagonist_via_canonical_name_match(tmp_path):
    """没有 tier 也没有 is_protagonist 时，按名字匹配 state.protagonist_state.name 兜底。"""
    (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
    initial = {"protagonist_state": {"name": "陆鸣", "power": {}}}
    (tmp_path / ".webnovel" / "state.json").write_text(json.dumps(initial), encoding="utf-8")
    writer = StateProjectionWriter(tmp_path)

    writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 1},
            "state_deltas": [
                {"entity_id": "luming", "field_path": "power.realm", "new_value": "练气五层"},
            ],
            "entity_deltas": [
                {"entity_id": "luming", "canonical_name": "陆鸣", "entity_type": "角色"}
            ],
        }
    )

    payload = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    assert payload["protagonist_state"]["power"]["realm"] == "练气五层"


# ============================================================
# index_manager.apply_entity_delta：tier=主角 / entity_type 识别
# ============================================================


def test_index_manager_marks_protagonist_via_tier_zhujue(tmp_path):
    """tier='主角' 时应自动设置 is_protagonist=True，让 get_protagonist 找得到。"""
    from data_modules.index_manager import IndexManager

    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    manager = IndexManager(cfg)

    manager.apply_entity_delta(
        {
            "entity_id": "luming",
            "action": "upsert",
            "entity_type": "角色",
            "tier": "主角",
            "chapter": 1,
            "payload": {"name": "陆鸣"},
        }
    )

    protagonist = manager.get_protagonist()
    assert protagonist is not None, "tier=主角 should be recognized as protagonist"
    assert protagonist["id"] == "luming"


def test_index_manager_preserves_entity_type_for_organization(tmp_path):
    """entity_deltas 用 entity_type='组织' 时，索引里 type 也必须是 '组织' 而非默认 '角色'。"""
    from data_modules.index_manager import IndexManager

    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    manager = IndexManager(cfg)

    manager.apply_entity_delta(
        {
            "entity_id": "qingyun_zong",
            "action": "upsert",
            "entity_type": "组织",
            "tier": "重要",
            "chapter": 1,
            "payload": {"name": "青云宗"},
        }
    )

    entity = manager.get_entity("qingyun_zong")
    assert entity is not None
    assert entity["type"] == "组织", f"expected type=组织, got {entity['type']!r}"


def test_index_manager_uses_payload_name_when_canonical_name_missing(tmp_path):
    """LLM 实际输出常把名字放在 payload.name，而非顶层 canonical_name。"""
    from data_modules.index_manager import IndexManager

    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    manager = IndexManager(cfg)

    manager.apply_entity_delta(
        {
            "entity_id": "lu_ming",
            "action": "upsert",
            "entity_type": "角色",
            "tier": "主角",
            "chapter": 1,
            "payload": {"name": "陆鸣"},
        }
    )

    entity = manager.get_entity("lu_ming")
    assert entity is not None
    assert entity["canonical_name"] == "陆鸣", (
        f"expected canonical_name=陆鸣, got {entity['canonical_name']!r}"
    )


def test_index_manager_corrects_entity_type_on_re_upsert(tmp_path):
    """已有实体被旧版本误标为 '角色' 时，重放新 commit 必须能把 type 修正为 '组织' 等。"""
    from data_modules.index_manager import IndexManager

    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    manager = IndexManager(cfg)

    # 模拟旧 bug：先以 type='角色' 落库（默认兜底）
    manager.apply_entity_delta(
        {
            "entity_id": "qingyun_zong",
            "tier": "重要",
            "chapter": 1,
            "payload": {"name": "青云宗"},
        }
    )
    entity = manager.get_entity("qingyun_zong")
    assert entity["type"] == "角色"

    # 修复后重放 commit，明确传 entity_type='组织'
    manager.apply_entity_delta(
        {
            "entity_id": "qingyun_zong",
            "entity_type": "组织",
            "tier": "重要",
            "chapter": 1,
            "payload": {"name": "青云宗"},
        }
    )
    entity = manager.get_entity("qingyun_zong")
    assert entity["type"] == "组织", f"expected type=组织 after re-upsert, got {entity['type']!r}"


def test_index_manager_resolves_underscored_id_to_compact_entity(tmp_path):
    """实体登记为 'luming' 时，查询 'lu_ming' 也应能找到（LLM 命名风格不一致兜底）。"""
    from data_modules.index_manager import IndexManager

    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    manager = IndexManager(cfg)

    manager.apply_entity_delta(
        {
            "entity_id": "luming",
            "entity_type": "角色",
            "tier": "主角",
            "chapter": 1,
            "payload": {"name": "陆鸣"},
        }
    )

    # 直接查 — 已经能工作
    assert manager.get_entity("luming")["id"] == "luming"
    # 反向兜底 — 带下划线变体
    found = manager.get_entity("lu_ming")
    assert found is not None, "lu_ming should resolve to luming"
    assert found["id"] == "luming"


# ============================================================
# memory_writer：接受 entity_type / field_path / loop description
# ============================================================


def test_memory_writer_preserves_entity_type_for_organization(tmp_path):
    """entity_deltas 用 entity_type 字段时，组织不能被误标为'角色'。"""
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    writer = MemoryProjectionWriter(tmp_path)

    writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 1},
            "entity_deltas": [
                {
                    "entity_id": "qingyun_zong",
                    "action": "upsert",
                    "entity_type": "组织",
                    "tier": "重要",
                    "payload": {"name": "青云宗"},
                }
            ],
            "state_deltas": [],
            "accepted_events": [],
        }
    )

    store = ScratchpadManager(cfg)
    chars = store.query(category="character_state", status="active")
    qingyun = [x for x in chars if x.subject == "qingyun_zong"]
    assert qingyun, "qingyun_zong entity should be recorded"
    assert qingyun[0].payload.get("type") == "组织", (
        f"expected type=组织, got {qingyun[0].payload.get('type')!r}"
    )


def test_memory_writer_accepts_field_path_in_state_delta(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    writer = MemoryProjectionWriter(tmp_path)

    writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 2},
            "state_deltas": [
                {
                    "entity_id": "luming",
                    "field_path": "physical.condition",
                    "old_value": "虚弱",
                    "new_value": "虚弱（持续）",
                }
            ],
            "entity_deltas": [],
            "accepted_events": [],
        }
    )

    store = ScratchpadManager(cfg)
    chars = store.query(category="character_state", status="active")
    assert any(
        x.subject == "luming" and "physical" in x.field for x in chars
    ), [(x.subject, x.field) for x in chars]


def test_memory_writer_extracts_open_loop_from_description_when_no_content(tmp_path):
    """open_loop_created 事件 payload 没有 content 时，应从 description / unanswered_question 取。"""
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    writer = MemoryProjectionWriter(tmp_path)

    writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 2},
            "state_deltas": [],
            "entity_deltas": [],
            "accepted_events": [
                {
                    "event_id": "evt_002",
                    "chapter": 2,
                    "event_type": "open_loop_created",
                    "subject": "luming",
                    "payload": {
                        "description": "陆鸣发现借据'一式三份'条款，保人身份成谜",
                        "loop_type": "身份悬疑",
                        "unanswered_question": "保人是谁？谁带原身去签的借据？",
                        "narrative_weight": "major",
                    },
                }
            ],
        }
    )

    store = ScratchpadManager(cfg)
    loops = store.query(category="open_loop", status="active")
    assert loops, "open_loop should be recorded"
    # subject 应是有意义的悬念内容，不应是 'luming'（来自 event.subject 的兜底）
    contents = [x.subject for x in loops]
    assert any("保人" in c or "借据" in c or "身份" in c for c in contents), (
        f"expected meaningful loop content, got {contents}"
    )


def test_memory_writer_extracts_world_rule_from_rule_content(tmp_path):
    """world_rule_revealed 事件用 rule_content / description 时，应能落入 world_rule 记忆。"""
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    writer = MemoryProjectionWriter(tmp_path)

    writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 2},
            "state_deltas": [],
            "entity_deltas": [],
            "accepted_events": [
                {
                    "event_id": "evt_003",
                    "chapter": 2,
                    "event_type": "world_rule_revealed",
                    "subject": "luming",
                    "payload": {
                        "description": "青云城借贷市场三大空白",
                        "rule_category": "金融/经济",
                        "rule_content": "利率垄断、无信用体系、暴力收债",
                    },
                }
            ],
        }
    )

    store = ScratchpadManager(cfg)
    rules = store.query(category="world_rule", status="active")
    assert rules
    rule_texts = [x.value for x in rules]
    assert any("利率" in r or "信用" in r or "金融" in r or "借贷" in r for r in rule_texts), (
        f"expected meaningful rule text, got {rule_texts}"
    )


# ============================================================
# vector_projection_writer：接受 description / new_state
# ============================================================


def test_vector_writer_handles_character_state_changed_with_description():
    writer = VectorProjectionWriter.__new__(VectorProjectionWriter)
    event = {
        "event_type": "character_state_changed",
        "chapter": 2,
        "subject": "luming",
        "payload": {
            "description": "陆鸣意识到自己是这个世界唯一懂金融的人",
            "previous_state": "刚穿越的茫然",
            "new_state": "认知激活",
            "narrative_weight": "pivotal",
        },
    }
    text = writer._event_to_text(event)
    assert text, "should produce non-empty text"
    assert "第2章" in text
    assert "luming" in text or "陆鸣" in text or "认知" in text or "金融" in text


# ============================================================
# 集成：用真实 DeepSeek 输出 commit payload 走完整投影链
# ============================================================


def test_integration_real_deepseek_commit_projects_full_state(tmp_path):
    """端到端：组合 state + memory 投影器处理真实 commit payload，确认所有数据都落到对应位置。"""
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    (tmp_path / ".webnovel" / "state.json").write_text(
        json.dumps(
            {
                "protagonist_state": {
                    "name": "陆鸣",
                    "power": {"realm": "", "layer": 1},
                    "location": {"current": ""},
                }
            }
        ),
        encoding="utf-8",
    )

    # 真实 DeepSeek v4pro 输出片段
    real_payload = {
        "meta": {"status": "accepted", "chapter": 2},
        "state_deltas": [
            {
                "entity_id": "luming",
                "field_path": "physical.condition",
                "old_value": "虚弱",
                "new_value": "虚弱（持续）",
                "change_type": "confirmed",
            },
            {
                "entity_id": "luming",
                "field_path": "knowledge.lending_ecosystem",
                "old_value": "仅知有阎王债",
                "new_value": "完整市场图谱",
                "change_type": "initialize",
            },
        ],
        "entity_deltas": [
            {
                "entity_id": "luming",
                "action": "upsert",
                "entity_type": "角色",
                "tier": "核心",
                "is_protagonist": True,
                "payload": {"name": "陆鸣"},
            },
            {
                "entity_id": "qingyun_zong",
                "action": "upsert",
                "entity_type": "组织",
                "tier": "重要",
                "payload": {"name": "青云宗"},
            },
            {
                "entity_id": "heishi_fangshi",
                "action": "upsert",
                "entity_type": "地点",
                "tier": "重要",
                "payload": {"name": "黑石坊市"},
            },
        ],
        "accepted_events": [
            {
                "event_id": "evt_ch002_guarantor_mystery",
                "chapter": 2,
                "event_type": "open_loop_created",
                "subject": "luming",
                "payload": {
                    "description": "保人身份不明",
                    "loop_type": "身份悬疑",
                    "unanswered_question": "保人是谁？",
                },
            }
        ],
    }

    StateProjectionWriter(tmp_path).apply(real_payload)
    MemoryProjectionWriter(tmp_path).apply(real_payload)

    state = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    # entity_state 必须有内容（不能再是 {}）
    assert state["entity_state"], "entity_state should not be empty"
    assert "luming" in state["entity_state"]
    # 主角字段镜像到 protagonist_state 不丢
    assert state["protagonist_state"]["name"] == "陆鸣"

    # memory_scratchpad：组织和地点不能被误标
    store = ScratchpadManager(cfg)
    chars = store.query(category="character_state", status="active")
    by_id = {x.subject: x for x in chars}
    assert by_id["qingyun_zong"].payload.get("type") == "组织"
    assert by_id["heishi_fangshi"].payload.get("type") == "地点"

    # open_loop 必须有有意义内容（不能是 'luming'）
    loops = store.query(category="open_loop", status="active")
    contents = [x.subject for x in loops]
    assert any("保人" in c or "身份悬疑" in c for c in contents), contents
