#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Data Modules 单元测试
"""

import pytest
import asyncio
import json
import tempfile
import sys
from pathlib import Path

from data_modules import (
    DataModulesConfig,
    EntityLinker,
    StateManager,
    IndexManager,
    RAGAdapter,
    StyleSampler,
    EntityState,
    ChapterMeta,
    SceneMeta,
    StyleSample,
)
import data_modules.index_manager as index_manager_module
from data_modules.index_manager import (
    EntityMeta,
    StateChangeMeta,
    RelationshipMeta,
    OverrideContractMeta,
    ChaseDebtMeta,
    ChapterReadingPowerMeta,
    ReviewMetrics,
)


@pytest.fixture
def temp_project():
    """创建临时项目目录"""
    with tempfile.TemporaryDirectory() as tmpdir:
        config = DataModulesConfig.from_project_root(tmpdir)
        config.ensure_dirs()
        yield config


class TestEntityLinker:
    """实体链接器测试"""

    def test_register_and_lookup_alias(self, temp_project):
        linker = EntityLinker(temp_project)
        # 先注册实体，否则 aliases JOIN 不会返回
        IndexManager(temp_project).upsert_entity(
            EntityMeta(
                id="xiaoyan",
                type="角色",
                canonical_name="萧炎",
                current={},
                first_appearance=1,
                last_appearance=1,
            )
        )

        # 注册别名
        assert linker.register_alias("xiaoyan", "萧炎")
        assert linker.register_alias("xiaoyan", "小炎子")

        # 查找
        assert linker.lookup_alias("萧炎") == "xiaoyan"
        assert linker.lookup_alias("小炎子") == "xiaoyan"
        assert linker.lookup_alias("不存在") is None

    def test_alias_one_to_many(self, temp_project):
        """v5.0: 同一别名可映射多个实体（一对多）"""
        linker = EntityLinker(temp_project)

        idx = IndexManager(temp_project)
        idx.upsert_entity(
            EntityMeta(
                id="xiaoyan",
                type="角色",
                canonical_name="萧炎",
                current={},
                first_appearance=1,
                last_appearance=1,
            )
        )
        idx.upsert_entity(
            EntityMeta(
                id="other_person",
                type="角色",
                canonical_name="萧炎",
                current={},
                first_appearance=1,
                last_appearance=1,
            )
        )

        linker.register_alias("xiaoyan", "萧炎", "角色")
        # v5.0: 同一别名可绑定不同实体（一对多）
        assert linker.register_alias("other_person", "萧炎", "角色")

        # 查找所有匹配
        entries = linker.lookup_alias_all("萧炎")
        assert len(entries) == 2

    def test_get_all_aliases(self, temp_project):
        linker = EntityLinker(temp_project)
        IndexManager(temp_project).upsert_entity(
            EntityMeta(
                id="xiaoyan",
                type="角色",
                canonical_name="萧炎",
                current={},
                first_appearance=1,
                last_appearance=1,
            )
        )

        linker.register_alias("xiaoyan", "萧炎")
        linker.register_alias("xiaoyan", "小炎子")
        linker.register_alias("xiaoyan", "炎哥")

        aliases = linker.get_all_aliases("xiaoyan")
        assert len(aliases) == 3
        assert "萧炎" in aliases

    def test_confidence_evaluation(self, temp_project):
        linker = EntityLinker(temp_project)

        # 高置信度
        action, adopt, warning = linker.evaluate_confidence(0.9)
        assert action == "auto"
        assert adopt is True
        assert warning is None

        # 中置信度
        action, adopt, warning = linker.evaluate_confidence(0.6)
        assert action == "warn"
        assert adopt is True
        assert warning is not None

        # 低置信度
        action, adopt, warning = linker.evaluate_confidence(0.3)
        assert action == "manual"
        assert adopt is False

    def test_process_uncertain(self, temp_project):
        linker = EntityLinker(temp_project)

        result = linker.process_uncertain(
            mention="那位前辈",
            candidates=["yaolao", "elder_zhang"],
            suggested="yaolao",
            confidence=0.7
        )

        assert result.mention == "那位前辈"
        assert result.entity_id == "yaolao"
        assert result.adopted is True
        assert result.warning is not None


class TestStateManager:
    """状态管理器测试"""

    def test_add_and_get_entity(self, temp_project):
        manager = StateManager(temp_project)

        entity = EntityState(
            id="xiaoyan",
            name="萧炎",
            type="角色",
            tier="核心"
        )
        assert manager.add_entity(entity)

        # 获取实体
        result = manager.get_entity("xiaoyan")
        assert result is not None
        assert result["canonical_name"] == "萧炎"

    def test_update_entity(self, temp_project):
        manager = StateManager(temp_project)

        entity = EntityState(id="xiaoyan", name="萧炎", type="角色")
        manager.add_entity(entity)

        # 更新属性 (v5.0: attributes 存在 current 字段)
        manager.update_entity("xiaoyan", {"current": {"realm": "斗师"}})

        result = manager.get_entity("xiaoyan")
        assert result["current"]["realm"] == "斗师"

    def test_record_state_change(self, temp_project):
        manager = StateManager(temp_project)

        entity = EntityState(id="xiaoyan", name="萧炎", type="角色")
        manager.add_entity(entity)

        manager.record_state_change(
            entity_id="xiaoyan",
            field="realm",
            old_value="斗者",
            new_value="斗师",
            reason="突破",
            chapter=100
        )

        changes = manager.get_state_changes("xiaoyan")
        assert len(changes) == 1
        assert changes[0]["new_value"] == "斗师"

    def test_add_relationship(self, temp_project):
        manager = StateManager(temp_project)

        manager.add_relationship(
            from_entity="xiaoyan",
            to_entity="yaolao",
            rel_type="师徒",
            description="药老收萧炎为徒",
            chapter=10
        )

        rels = manager.get_relationships("xiaoyan")
        assert len(rels) == 1
        assert rels[0]["type"] == "师徒"

    def test_process_chapter_result(self, temp_project):
        manager = StateManager(temp_project)

        result = {
            "entities_appeared": [
                {"id": "xiaoyan", "mentions": ["萧炎", "他"]}
            ],
            "entities_new": [
                {"suggested_id": "hongyi_girl", "name": "红衣女子", "type": "角色", "tier": "装饰"}
            ],
            "state_changes": [
                {"entity_id": "xiaoyan", "field": "realm", "old": "斗者", "new": "斗师", "reason": "突破"}
            ],
            "relationships_new": [
                {"from": "xiaoyan", "to": "hongyi_girl", "type": "相识", "description": "初次见面"}
            ]
        }

        # 先添加萧炎
        manager.add_entity(EntityState(id="xiaoyan", name="萧炎", type="角色"))

        warnings = manager.process_chapter_result(100, result)

        # 验证新实体被添加
        assert manager.get_entity("hongyi_girl") is not None

        # 验证状态变化
        changes = manager.get_state_changes("xiaoyan")
        assert len(changes) == 1

        # 验证进度更新
        assert manager.get_current_chapter() == 100

    def test_save_state_with_init_project_schema(self, temp_project):
        """回归：init_project 生成的 state.json，StateManager 仍应可写入。(v5.1 SQLite-only)"""
        # v5.1: state.json 不再包含 entities_v3/alias_index，实体数据在 SQLite
        init_state = {
            "project_info": {"title": "测试书名", "genre": "修仙/玄幻", "created_at": "2026-01-01"},
            "progress": {"current_chapter": 0, "total_words": 0, "last_updated": "2026-01-01 00:00:00"},
            "protagonist_state": {"name": "测试主角"},
            "relationships": {},
            "world_settings": {"power_system": [], "factions": [], "locations": []},
            "plot_threads": {"active_threads": [], "foreshadowing": []},
            "review_checkpoints": [],
            "strand_tracker": {"current_dominant": "quest", "history": []},
        }
        temp_project.state_file.write_text(json.dumps(init_state, ensure_ascii=False, indent=2), encoding="utf-8")

        manager = StateManager(temp_project)
        manager.update_progress(5, words=100)
        manager.save_state()

        saved = json.loads(temp_project.state_file.read_text(encoding="utf-8"))
        assert "meta" not in saved
        assert saved["progress"]["current_chapter"] == 5
        assert saved["progress"]["total_words"] == 100
        # v5.1: entities_v3/alias_index 不再在 state.json 中

    def test_save_state_preserves_unrelated_fields(self, temp_project):
        """回归：仅写入增量，不应覆盖/丢失其他模块维护的字段。(v5.1 SQLite-only)"""
        init_state = {
            "project_info": {"title": "测试书名", "genre": "修仙/玄幻", "created_at": "2026-01-01"},
            "progress": {"current_chapter": 10, "total_words": 1000, "last_updated": "2026-01-01 00:00:00"},
            "protagonist_state": {"name": "测试主角"},
            "relationships": {"allies": ["药老"], "enemies": []},
            "world_settings": {"power_system": [], "factions": [], "locations": []},
            "plot_threads": {"active_threads": [{"id": "t1", "title": "主线"}], "foreshadowing": []},
            "review_checkpoints": [],
            "strand_tracker": {"current_dominant": "quest", "history": []},
            "custom_field": {"keep": True},
        }
        temp_project.state_file.write_text(json.dumps(init_state, ensure_ascii=False, indent=2), encoding="utf-8")

        manager = StateManager(temp_project)
        manager.add_entity(EntityState(id="xiaoyan", name="萧炎", type="角色", tier="核心"))
        manager.save_state()

        saved = json.loads(temp_project.state_file.read_text(encoding="utf-8"))
        assert saved.get("custom_field", {}).get("keep") is True
        assert saved.get("plot_threads", {}).get("active_threads", [])[0].get("id") == "t1"
        assert isinstance(saved.get("relationships"), dict)

    def test_disambiguation_feedback_persisted(self, temp_project):
        """回归：中/低置信度消歧必须对 Writer 可见（写入 state.json）。"""
        manager = StateManager(temp_project)

        result = {
            "entities_appeared": [],
            "entities_new": [],
            "state_changes": [],
            "relationships_new": [],
            "uncertain": [
                {
                    "mention": "那位前辈",
                    "context": "那位前辈看了他一眼",
                    "candidates": [{"type": "角色", "id": "yaolao"}, {"type": "角色", "id": "elder_zhang"}],
                    "suggested": "yaolao",
                    "confidence": 0.6,
                },
                {
                    "mention": "宗主",
                    "context": "宗主出现在血煞秘境",
                    "candidates": ["xueshazonzhu", "lintian"],
                    "suggested": "xueshazonzhu",
                    "confidence": 0.4,
                },
            ],
        }

        warnings = manager.process_chapter_result(100, result)
        manager.save_state()

        state = json.loads(temp_project.state_file.read_text(encoding="utf-8"))
        assert isinstance(state.get("disambiguation_warnings"), list)
        assert isinstance(state.get("disambiguation_pending"), list)

        assert len(state["disambiguation_warnings"]) == 1
        assert len(state["disambiguation_pending"]) == 1

        warn = state["disambiguation_warnings"][0]
        assert warn.get("chapter") == 100
        assert warn.get("mention") == "那位前辈"
        assert warn.get("chosen_id") == "yaolao"

        pending = state["disambiguation_pending"][0]
        assert pending.get("chapter") == 100
        assert pending.get("mention") == "宗主"

        # 返回值也应包含可见警告，便于 CLI/日志透出
        assert any("消歧警告" in w for w in warnings)
        assert any("需人工确认" in w for w in warnings)


class TestIndexManager:
    """索引管理器测试"""

    def test_add_and_get_chapter(self, temp_project):
        manager = IndexManager(temp_project)

        meta = ChapterMeta(
            chapter=100,
            title="突破",
            location="天云宗",
            word_count=3500,
            characters=["xiaoyan", "yaolao"]
        )
        manager.add_chapter(meta)

        result = manager.get_chapter(100)
        assert result is not None
        assert result["title"] == "突破"
        assert "xiaoyan" in result["characters"]

    def test_add_scenes(self, temp_project):
        manager = IndexManager(temp_project)

        scenes = [
            SceneMeta(chapter=100, scene_index=1, start_line=1, end_line=50,
                     location="天云宗·闭关室", summary="萧炎闭关突破", characters=["xiaoyan"]),
            SceneMeta(chapter=100, scene_index=2, start_line=51, end_line=100,
                     location="天云宗·演武场", summary="展示实力", characters=["xiaoyan", "lintian"])
        ]
        manager.add_scenes(100, scenes)

        result = manager.get_scenes(100)
        assert len(result) == 2
        assert result[0]["location"] == "天云宗·闭关室"

    def test_record_appearance(self, temp_project):
        manager = IndexManager(temp_project)

        manager.record_appearance("xiaoyan", 100, ["萧炎", "他"], 0.95)
        manager.record_appearance("yaolao", 100, ["药老"], 0.92)

        appearances = manager.get_chapter_appearances(100)
        assert len(appearances) == 2

        entity_history = manager.get_entity_appearances("xiaoyan")
        assert len(entity_history) == 1

    def test_search_scenes_by_location(self, temp_project):
        manager = IndexManager(temp_project)

        scenes = [
            SceneMeta(chapter=100, scene_index=1, start_line=1, end_line=50,
                     location="天云宗·闭关室", summary="闭关", characters=[]),
            SceneMeta(chapter=101, scene_index=1, start_line=1, end_line=50,
                     location="天云宗·大殿", summary="议事", characters=[])
        ]
        manager.add_scenes(100, scenes[:1])
        manager.add_scenes(101, scenes[1:])

        results = manager.search_scenes_by_location("天云宗")
        assert len(results) == 2

    def test_get_stats(self, temp_project):
        manager = IndexManager(temp_project)

        manager.upsert_entity(
            EntityMeta(
                id="xiaoyan",
                type="角色",
                canonical_name="萧炎",
                current={},
                first_appearance=1,
                last_appearance=1,
            )
        )
        manager.add_chapter(ChapterMeta(chapter=1, title="", location="", word_count=1000, characters=[]))
        manager.add_scenes(1, [SceneMeta(chapter=1, scene_index=1, start_line=1, end_line=50,
                                        location="", summary="", characters=[])])
        manager.record_appearance("xiaoyan", 1, [], 1.0)

        stats = manager.get_stats()
        assert stats["chapters"] == 1
        assert stats["scenes"] == 1
        assert stats["entities"] == 1

    def test_entity_alias_and_relationships(self, temp_project):
        manager = IndexManager(temp_project)

        entity_main = EntityMeta(
            id="xiaoyan",
            type="角色",
            canonical_name="萧炎",
            tier="核心",
            desc="主角",
            current={"realm": "斗者"},
            first_appearance=1,
            last_appearance=1,
            is_protagonist=True,
        )
        entity_other = EntityMeta(
            id="yaolao",
            type="角色",
            canonical_name="药老",
            tier="重要",
            current={},
            first_appearance=1,
            last_appearance=2,
        )

        assert manager.upsert_entity(entity_main) is True
        assert manager.upsert_entity(entity_other) is True

        # 更新 current
        assert manager.update_entity_current("xiaoyan", {"realm": "斗师"}) is True
        entity = manager.get_entity("xiaoyan")
        assert entity["current_json"]["realm"] == "斗师"

        # 元数据更新
        entity_main.desc = "主角（更新）"
        entity_main.last_appearance = 3
        assert manager.upsert_entity(entity_main, update_metadata=True) is False

        # 别名管理
        assert manager.register_alias("炎帝", "xiaoyan", "角色")
        assert "炎帝" in manager.get_entity_aliases("xiaoyan")
        assert manager.get_entities_by_alias("炎帝")[0]["id"] == "xiaoyan"
        assert manager.remove_alias("炎帝", "xiaoyan")
        assert manager.get_entities_by_alias("炎帝") == []

        # 类型/层级/核心/主角查询
        assert len(manager.get_entities_by_type("角色")) == 2
        assert any(e["id"] == "xiaoyan" for e in manager.get_entities_by_tier("核心"))
        assert any(e["id"] == "xiaoyan" for e in manager.get_core_entities())
        assert manager.get_protagonist()["id"] == "xiaoyan"

        # 归档实体
        assert manager.archive_entity("yaolao") is True
        assert all(e["id"] != "yaolao" for e in manager.get_entities_by_type("角色"))
        assert any(
            e["id"] == "yaolao"
            for e in manager.get_entities_by_type("角色", include_archived=True)
        )

        # 关系管理（新建 + 更新）
        rel = RelationshipMeta(
            from_entity="xiaoyan",
            to_entity="yaolao",
            type="师徒",
            description="收徒",
            chapter=1,
        )
        assert manager.upsert_relationship(rel) is True
        rel.description = "收徒（更新）"
        rel.chapter = 2
        assert manager.upsert_relationship(rel) is False

        assert len(manager.get_entity_relationships("xiaoyan", "from")) == 1
        assert len(manager.get_entity_relationships("yaolao", "to")) == 1
        assert len(manager.get_entity_relationships("xiaoyan", "both")) >= 1
        assert len(manager.get_relationship_between("xiaoyan", "yaolao")) == 1
        assert len(manager.get_recent_relationships(limit=5)) >= 1

    def test_state_changes_and_appearances(self, temp_project):
        manager = IndexManager(temp_project)

        entity = EntityMeta(
            id="xiaoyan",
            type="角色",
            canonical_name="萧炎",
            current={},
            first_appearance=1,
            last_appearance=1,
        )
        manager.upsert_entity(entity)

        change = StateChangeMeta(
            entity_id="xiaoyan",
            field="realm",
            old_value="斗者",
            new_value="斗师",
            reason="突破",
            chapter=2,
        )
        change_id = manager.record_state_change(change)
        assert change_id > 0

        assert len(manager.get_entity_state_changes("xiaoyan")) == 1
        assert len(manager.get_recent_state_changes(limit=5)) == 1
        assert len(manager.get_chapter_state_changes(2)) == 1

        # 出场记录（含 skip_if_exists 分支）
        manager.record_appearance("xiaoyan", 2, ["萧炎"], 1.0)
        manager.record_appearance("xiaoyan", 2, ["萧炎"], 1.0, skip_if_exists=True)
        manager.record_appearance("xiaoyan", 3, ["萧炎"], 1.0)

        assert len(manager.get_entity_appearances("xiaoyan")) == 2
        assert len(manager.get_recent_appearances(limit=5)) >= 1
        assert len(manager.get_chapter_appearances(2)) == 1

    def test_chapter_queries_and_bulk(self, temp_project):
        manager = IndexManager(temp_project)

        manager.add_chapter(
            ChapterMeta(
                chapter=1,
                title="起点",
                location="天云宗",
                word_count=1000,
                characters=["xiaoyan"],
            )
        )
        manager.add_chapter(
            ChapterMeta(
                chapter=2,
                title="突破",
                location="天云宗",
                word_count=1200,
                characters=["xiaoyan", "yaolao"],
            )
        )

        recent = manager.get_recent_chapters()
        assert recent[0]["chapter"] == 2

        scenes = [
            SceneMeta(
                chapter=1,
                scene_index=1,
                start_line=1,
                end_line=50,
                location="天云宗·闭关室",
                summary="闭关",
                characters=["xiaoyan"],
            ),
            SceneMeta(
                chapter=1,
                scene_index=2,
                start_line=51,
                end_line=80,
                location="天云宗·演武场",
                summary="练习",
                characters=["xiaoyan"],
            ),
        ]
        manager.add_scenes(1, scenes)
        assert len(manager.get_scenes(1)) == 2

        results = manager.search_scenes_by_location("天云宗")
        assert len(results) >= 2

        stats = manager.process_chapter_data(
            chapter=10,
            title="试炼",
            location="秘境",
            word_count=1500,
            entities=[{"id": "xiaoyan", "type": "角色", "mentions": ["萧炎"]}],
            scenes=[{"index": 1, "start_line": 1, "end_line": 20, "location": "秘境", "summary": "开场", "characters": ["xiaoyan"]}],
        )
        assert stats["chapters"] == 1
        assert stats["scenes"] == 1
        assert stats["appearances"] == 1

    def test_debt_and_override_flow(self, temp_project):
        manager = IndexManager(temp_project)

        contract = OverrideContractMeta(
            chapter=1,
            constraint_type="SOFT_MICROPAYOFF",
            constraint_id="micropayoff_count",
            rationale_type="TRANSITIONAL_SETUP",
            rationale_text="铺垫需要",
            payback_plan="下章补偿",
            due_chapter=3,
            status="pending",
        )
        contract_id = manager.create_override_contract(contract)
        assert contract_id > 0

        # pending 状态允许更新
        contract.rationale_text = "调整理由"
        contract.due_chapter = 4
        assert manager.create_override_contract(contract) == contract_id
        updated = manager.get_chapter_overrides(1)[0]
        assert updated["rationale_text"] == "调整理由"
        assert updated["due_chapter"] == 4

        # 终态冻结
        contract.status = "fulfilled"
        contract.rationale_text = "终态理由"
        contract.due_chapter = 5
        manager.create_override_contract(contract)
        frozen = manager.get_chapter_overrides(1)[0]
        assert frozen["status"] == "fulfilled"
        assert frozen["rationale_text"] == "终态理由"

        # 试图回写 pending，不应改动终态字段
        contract.status = "pending"
        contract.rationale_text = "不应生效"
        contract.due_chapter = 99
        manager.create_override_contract(contract)
        frozen_again = manager.get_chapter_overrides(1)[0]
        assert frozen_again["status"] == "fulfilled"
        assert frozen_again["rationale_text"] == "终态理由"
        assert frozen_again["due_chapter"] == 5

        debt_contract_id = manager.create_override_contract(
            OverrideContractMeta(
                chapter=2,
                constraint_type="SOFT_HOOK_STRENGTH",
                constraint_id="hook_strength",
                rationale_type="ARC_TIMING",
                rationale_text="节奏安排",
                payback_plan="后续补强",
                due_chapter=4,
                status="pending",
            )
        )

        debt1 = ChaseDebtMeta(
            debt_type="hook_strength",
            original_amount=1.0,
            current_amount=1.0,
            interest_rate=0.1,
            source_chapter=1,
            due_chapter=2,
            override_contract_id=debt_contract_id,
            status="active",
        )
        debt2 = ChaseDebtMeta(
            debt_type="micropayoff",
            original_amount=2.0,
            current_amount=2.0,
            interest_rate=0.2,
            source_chapter=1,
            due_chapter=2,
            override_contract_id=debt_contract_id,
            status="active",
        )
        debt_id_1 = manager.create_debt(debt1)
        debt_id_2 = manager.create_debt(debt2)
        assert len(manager.get_active_debts()) == 2
        assert manager.get_total_debt_balance() > 0

        # 计息与幂等保护
        result = manager.accrue_interest(current_chapter=2)
        assert result["debts_processed"] == 2
        result_again = manager.accrue_interest(current_chapter=2)
        assert result_again["skipped_already_processed"] == 2

        # 逾期标记
        result_overdue = manager.accrue_interest(current_chapter=3)
        assert result_overdue["new_overdues"] >= 1
        overdue = manager.get_overdue_debts(current_chapter=3)
        assert any(d["status"] == "overdue" for d in overdue)
        history = manager.get_debt_history(debt_id_1)
        assert any(h["event_type"] == "interest_accrued" for h in history)

        # 金额校验
        error = manager.pay_debt(debt_id_1, 0, chapter=3)
        assert "error" in error

        # 部分偿还
        partial = manager.pay_debt(debt_id_1, 0.5, chapter=3)
        assert partial["fully_paid"] is False

        # 完全偿还（仍有另一笔债务时不应 fulfilled）
        full = manager.pay_debt(debt_id_1, 100, chapter=3)
        assert full["fully_paid"] is True
        assert full["override_fulfilled"] is False

        # 清空最后一笔债务 -> fulfilled
        full2 = manager.pay_debt(debt_id_2, 100, chapter=3)
        assert full2["fully_paid"] is True
        assert full2["override_fulfilled"] is True

    def test_reading_power_and_debt_summary(self, temp_project):
        manager = IndexManager(temp_project)

        # 追读力元数据
        manager.save_chapter_reading_power(
            ChapterReadingPowerMeta(
                chapter=1,
                hook_type="渴望钩",
                hook_strength="strong",
                coolpoint_patterns=["打脸权威", "身份掉马"],
                micropayoffs=["能力兑现"],
                hard_violations=[],
                soft_suggestions=["SOFT_HOOK_STRENGTH"],
                is_transition=False,
                override_count=1,
                debt_balance=1.5,
            )
        )
        manager.save_chapter_reading_power(
            ChapterReadingPowerMeta(
                chapter=2,
                hook_type="悬念钩",
                hook_strength="medium",
                coolpoint_patterns=["身份掉马"],
                micropayoffs=["信息兑现"],
                hard_violations=["HARD-004"],
                soft_suggestions=[],
                is_transition=True,
                override_count=0,
                debt_balance=0.0,
            )
        )

        record = manager.get_chapter_reading_power(1)
        assert record["hook_type"] == "渴望钩"
        assert "身份掉马" in record["coolpoint_patterns"]
        assert record["is_transition"] == 0  # SQLite 存储为 0/1
        assert manager.get_chapter_reading_power(999) is None

        recent = manager.get_recent_reading_power(limit=2)
        assert len(recent) == 2

        pattern_stats = manager.get_pattern_usage_stats(last_n_chapters=5)
        assert pattern_stats.get("身份掉马") == 2

        hook_stats = manager.get_hook_type_stats(last_n_chapters=5)
        assert hook_stats.get("渴望钩") == 1

        # 债务汇总
        contract_id = manager.create_override_contract(
            OverrideContractMeta(
                chapter=3,
                constraint_type="SOFT_HOOK_STRENGTH",
                constraint_id="hook_strength",
                rationale_type="ARC_TIMING",
                rationale_text="节奏安排",
                payback_plan="后续补强",
                due_chapter=5,
                status="pending",
            )
        )
        manager.create_debt(
            ChaseDebtMeta(
                debt_type="hook_strength",
                original_amount=1.0,
                current_amount=1.0,
                interest_rate=0.1,
                source_chapter=3,
                due_chapter=4,
                override_contract_id=contract_id,
                status="active",
            )
        )
        manager.create_debt(
            ChaseDebtMeta(
                debt_type="micropayoff",
                original_amount=2.0,
                current_amount=2.0,
                interest_rate=0.1,
                source_chapter=3,
                due_chapter=4,
                override_contract_id=0,
                status="overdue",
            )
        )

        summary = manager.get_debt_summary()
        assert summary["active_debts"] == 1
        assert summary["overdue_debts"] == 1
        assert summary["pending_overrides"] >= 1
        assert summary["total_balance"] == summary["active_total"] + summary["overdue_total"]

        pending = manager.get_pending_overrides()
        assert any(o["id"] == contract_id for o in pending)
        pending_before = manager.get_pending_overrides(before_chapter=10)
        assert any(o["id"] == contract_id for o in pending_before)
        overdue_overrides = manager.get_overdue_overrides(current_chapter=6)
        assert any(o["id"] == contract_id for o in overdue_overrides)

        other_id = manager.create_override_contract(
            OverrideContractMeta(
                chapter=4,
                constraint_type="SOFT_EXPECTATION_OVERLOAD",
                constraint_id="expectation_count",
                rationale_type="EDITORIAL_INTENT",
                rationale_text="作者意图",
                payback_plan="后续补足",
                due_chapter=6,
                status="pending",
            )
        )
        assert manager.fulfill_override(other_id) is True
        assert manager.get_chapter_overrides(4)[0]["status"] == "fulfilled"

    def test_review_metrics_and_trends(self, temp_project):
        manager = IndexManager(temp_project)

        manager.save_review_metrics(
            ReviewMetrics(
                start_chapter=1,
                end_chapter=1,
                overall_score=48,
                dimension_scores={
                    "爽点密度": 8,
                    "设定一致性": 7,
                    "节奏控制": 7,
                    "人物塑造": 8,
                    "连贯性": 9,
                    "追读力": 9,
                },
                severity_counts={"critical": 0, "high": 1, "medium": 2, "low": 0},
                critical_issues=[],
                report_file="审查报告/第1-1章审查报告.md",
            )
        )
        manager.save_review_metrics(
            ReviewMetrics(
                start_chapter=2,
                end_chapter=2,
                overall_score=42,
                dimension_scores={
                    "爽点密度": 6,
                    "设定一致性": 8,
                    "节奏控制": 7,
                    "人物塑造": 7,
                    "连贯性": 7,
                    "追读力": 7,
                },
                severity_counts={"critical": 1, "high": 0, "medium": 1, "low": 2},
                critical_issues=["设定自相矛盾"],
                report_file="审查报告/第2-2章审查报告.md",
            )
        )

        recent = manager.get_recent_review_metrics(limit=2)
        assert len(recent) == 2

        trends = manager.get_review_trend_stats(last_n=5)
        assert trends["count"] == 2
        assert trends["overall_avg"] > 0
        assert "爽点密度" in trends["dimension_avg"]

    def test_index_manager_cli(self, temp_project, monkeypatch, capsys):
        root = str(temp_project.project_root)
        manager = IndexManager(temp_project)

        # 基础数据
        manager.upsert_entity(
            EntityMeta(
                id="xiaoyan",
                type="角色",
                canonical_name="萧炎",
                tier="核心",
                current={"realm": "斗者"},
                first_appearance=1,
                last_appearance=1,
                is_protagonist=True,
            )
        )
        manager.upsert_entity(
            EntityMeta(
                id="yaolao",
                type="角色",
                canonical_name="药老",
                tier="重要",
                current={},
                first_appearance=1,
                last_appearance=2,
            )
        )

        manager.register_alias("炎帝", "xiaoyan", "角色")
        manager.add_chapter(
            ChapterMeta(
                chapter=1,
                title="起点",
                location="天云宗",
                word_count=1000,
                characters=["xiaoyan"],
            )
        )
        manager.add_scenes(
            1,
            [
                SceneMeta(
                    chapter=1,
                    scene_index=1,
                    start_line=1,
                    end_line=20,
                    location="天云宗·闭关室",
                    summary="闭关",
                    characters=["xiaoyan"],
                )
            ],
        )
        manager.record_appearance("xiaoyan", 1, ["萧炎"], 1.0)
        manager.record_state_change(
            StateChangeMeta(
                entity_id="xiaoyan",
                field="realm",
                old_value="斗者",
                new_value="斗师",
                reason="突破",
                chapter=1,
            )
        )
        manager.upsert_relationship(
            RelationshipMeta(
                from_entity="xiaoyan",
                to_entity="yaolao",
                type="师徒",
                description="收徒",
                chapter=1,
            )
        )

        # 追读力与债务
        manager.save_chapter_reading_power(
            ChapterReadingPowerMeta(
                chapter=1,
                hook_type="渴望钩",
                hook_strength="medium",
                coolpoint_patterns=["身份掉马"],
                micropayoffs=["能力兑现"],
                hard_violations=[],
                soft_suggestions=[],
            )
        )
        contract_id = manager.create_override_contract(
            OverrideContractMeta(
                chapter=1,
                constraint_type="SOFT_HOOK_STRENGTH",
                constraint_id="hook_strength",
                rationale_type="ARC_TIMING",
                rationale_text="节奏安排",
                payback_plan="后续补强",
                due_chapter=2,
                status="pending",
            )
        )
        debt_id = manager.create_debt(
            ChaseDebtMeta(
                debt_type="hook_strength",
                original_amount=1.0,
                current_amount=1.0,
                interest_rate=0.1,
                source_chapter=1,
                due_chapter=2,
                override_contract_id=contract_id,
                status="active",
            )
        )

        def run_cli(args):
            monkeypatch.setattr(sys, "argv", ["index_manager"] + args)
            index_manager_module.main()

        # 基础命令
        run_cli(["--project-root", root, "stats"])
        run_cli(["--project-root", root, "get-chapter", "--chapter", "1"])
        run_cli(["--project-root", root, "get-chapter", "--chapter", "99"])
        run_cli(["--project-root", root, "recent-appearances", "--limit", "5"])
        run_cli(["--project-root", root, "entity-appearances", "--entity", "xiaoyan", "--limit", "5"])
        run_cli(["--project-root", root, "search-scenes", "--location", "天云宗", "--limit", "5"])

        # 处理章节
        run_cli(
            [
                "--project-root",
                root,
                "process-chapter",
                "--chapter",
                "2",
                "--title",
                "试炼",
                "--location",
                "秘境",
                "--word-count",
                "1200",
                "--entities",
                json.dumps([{"id": "xiaoyan", "mentions": ["萧炎"]}], ensure_ascii=False),
                "--scenes",
                json.dumps(
                    [
                        {
                            "index": 1,
                            "start_line": 1,
                            "end_line": 10,
                            "location": "秘境",
                            "summary": "开场",
                            "characters": ["xiaoyan"],
                        }
                    ],
                    ensure_ascii=False,
                ),
            ]
        )

        # v5.1 命令
        run_cli(["--project-root", root, "get-entity", "--id", "xiaoyan"])
        run_cli(["--project-root", root, "get-entity", "--id", "missing"])
        run_cli(["--project-root", root, "get-core-entities"])
        run_cli(["--project-root", root, "get-protagonist"])
        run_cli(
            ["--project-root", root, "get-entities-by-type", "--type", "角色", "--include-archived"]
        )
        run_cli(["--project-root", root, "get-by-alias", "--alias", "炎帝"])
        run_cli(["--project-root", root, "get-by-alias", "--alias", "不存在"])
        run_cli(["--project-root", root, "get-aliases", "--entity", "xiaoyan"])
        run_cli(["--project-root", root, "register-alias", "--alias", "炎哥", "--entity", "xiaoyan", "--type", "角色"])
        run_cli(["--project-root", root, "get-relationships", "--entity", "xiaoyan", "--direction", "from"])
        run_cli(["--project-root", root, "get-state-changes", "--entity", "xiaoyan", "--limit", "20"])
        run_cli(
            [
                "--project-root",
                root,
                "upsert-entity",
                "--data",
                json.dumps(
                    {
                        "id": "lintian",
                        "type": "角色",
                        "canonical_name": "林天",
                        "tier": "装饰",
                        "current": {"realm": "斗者"},
                    },
                    ensure_ascii=False,
                ),
            ]
        )
        run_cli(
            [
                "--project-root",
                root,
                "upsert-relationship",
                "--data",
                json.dumps(
                    {
                        "from_entity": "xiaoyan",
                        "to_entity": "lintian",
                        "type": "相识",
                        "description": "初见",
                        "chapter": 2,
                    },
                    ensure_ascii=False,
                ),
            ]
        )
        run_cli(
            [
                "--project-root",
                root,
                "record-state-change",
                "--data",
                json.dumps(
                    {
                        "entity_id": "xiaoyan",
                        "field": "realm",
                        "old_value": "斗者",
                        "new_value": "斗师",
                        "reason": "突破",
                        "chapter": 2,
                    },
                    ensure_ascii=False,
                ),
            ]
        )

        # v5.3 命令
        run_cli(["--project-root", root, "get-debt-summary"])
        run_cli(["--project-root", root, "get-recent-reading-power", "--limit", "5"])
        run_cli(["--project-root", root, "get-chapter-reading-power", "--chapter", "1"])
        run_cli(["--project-root", root, "get-chapter-reading-power", "--chapter", "99"])
        run_cli(["--project-root", root, "get-pattern-usage-stats", "--last-n", "5"])
        run_cli(["--project-root", root, "get-hook-type-stats", "--last-n", "5"])
        run_cli(["--project-root", root, "get-pending-overrides"])
        run_cli(["--project-root", root, "get-overdue-overrides", "--current-chapter", "3"])
        run_cli(["--project-root", root, "get-active-debts"])
        run_cli(["--project-root", root, "get-overdue-debts", "--current-chapter", "3"])
        run_cli(["--project-root", root, "accrue-interest", "--current-chapter", "3"])
        run_cli(["--project-root", root, "pay-debt", "--debt-id", str(debt_id), "--amount", "0", "--chapter", "3"])
        run_cli(["--project-root", root, "pay-debt", "--debt-id", str(debt_id), "--amount", "5", "--chapter", "3"])
        run_cli(
            [
                "--project-root",
                root,
                "create-override-contract",
                "--data",
                json.dumps(
                    {
                        "chapter": 3,
                        "constraint_type": "SOFT_MICROPAYOFF",
                        "constraint_id": "micropayoff_count",
                        "rationale_type": "TRANSITIONAL_SETUP",
                        "rationale_text": "铺垫",
                        "payback_plan": "后续补偿",
                        "due_chapter": 4,
                    },
                    ensure_ascii=False,
                ),
            ]
        )
        run_cli(
            [
                "--project-root",
                root,
                "create-debt",
                "--data",
                json.dumps(
                    {
                        "debt_type": "micropayoff",
                        "original_amount": 1.0,
                        "current_amount": 1.0,
                        "interest_rate": 0.1,
                        "source_chapter": 3,
                        "due_chapter": 4,
                        "override_contract_id": contract_id,
                    },
                    ensure_ascii=False,
                ),
            ]
        )
        run_cli(["--project-root", root, "fulfill-override", "--contract-id", str(contract_id)])
        run_cli(
            [
                "--project-root",
                root,
                "save-chapter-reading-power",
                "--data",
                json.dumps(
                    {
                        "chapter": 3,
                        "hook_type": "悬念钩",
                        "hook_strength": "medium",
                        "coolpoint_patterns": ["打脸权威"],
                        "micropayoffs": ["信息兑现"],
                        "hard_violations": [],
                        "soft_suggestions": [],
                        "is_transition": False,
                        "override_count": 0,
                        "debt_balance": 0.0,
                    },
                    ensure_ascii=False,
                ),
            ]
        )

        review_payload = {
            "start_chapter": 1,
            "end_chapter": 1,
            "overall_score": 50,
            "dimension_scores": {
                "爽点密度": 8,
                "设定一致性": 7,
                "节奏控制": 8,
                "人物塑造": 8,
                "连贯性": 9,
                "追读力": 10,
            },
            "severity_counts": {"critical": 0, "high": 1, "medium": 2, "low": 0},
            "critical_issues": [],
            "report_file": "审查报告/第1-1章审查报告.md",
        }
        run_cli(
            [
                "--project-root",
                root,
                "save-review-metrics",
                "--data",
                json.dumps(review_payload, ensure_ascii=False),
            ]
        )
        run_cli(["--project-root", root, "get-recent-review-metrics", "--limit", "5"])
        run_cli(["--project-root", root, "get-review-trend-stats", "--last-n", "5"])

        capsys.readouterr()


class TestStyleSampler:
    """风格样本测试"""

    def test_add_and_get_sample(self, temp_project):
        sampler = StyleSampler(temp_project)

        sample = StyleSample(
            id="ch100_s1",
            chapter=100,
            scene_type="战斗",
            content="萧炎一拳轰出...",
            score=0.85,
            tags=["战斗", "激烈"]
        )
        assert sampler.add_sample(sample)

        results = sampler.get_samples_by_type("战斗")
        assert len(results) == 1
        assert results[0].id == "ch100_s1"

    def test_extract_candidates(self, temp_project):
        sampler = StyleSampler(temp_project)

        scenes = [
            {"index": 1, "summary": "战斗场景", "content": "萧炎一拳轰出，斗气如虹，直接将对手击退三丈，周围的空气都被震得嗡嗡作响..." + "a" * 200}
        ]

        # 低分不提取
        candidates = sampler.extract_candidates(100, "", 70, scenes)
        assert len(candidates) == 0

        # 高分提取
        candidates = sampler.extract_candidates(100, "", 85, scenes)
        assert len(candidates) == 1
        assert candidates[0].scene_type == "战斗"

    def test_select_samples_for_chapter(self, temp_project):
        sampler = StyleSampler(temp_project)

        # 添加一些样本
        for i in range(3):
            sampler.add_sample(StyleSample(
                id=f"battle_{i}",
                chapter=i,
                scene_type="战斗",
                content=f"战斗内容 {i}",
                score=0.9,
                tags=[]
            ))

        samples = sampler.select_samples_for_chapter("本章有一场激烈的战斗")
        assert len(samples) <= 3
        assert all(s.scene_type == "战斗" for s in samples)


class TestRAGAdapter:
    """RAG 适配器测试（不包含 API 调用）"""

    def test_bm25_search(self, temp_project):
        adapter = RAGAdapter(temp_project)

        # 手动插入一些测试数据
        with adapter._get_conn() as conn:
            cursor = conn.cursor()

            # 插入向量记录（空向量，只测试 BM25）
            cursor.execute("""
                INSERT INTO vectors (chunk_id, chapter, scene_index, content, embedding)
                VALUES (?, ?, ?, ?, ?)
            """, ("ch1_s1", 1, 1, "萧炎在天云宗修炼斗气", b""))

            cursor.execute("""
                INSERT INTO vectors (chunk_id, chapter, scene_index, content, embedding)
                VALUES (?, ?, ?, ?, ?)
            """, ("ch1_s2", 1, 2, "药老传授炼药技巧", b""))

            conn.commit()

            # 更新 BM25 索引
            adapter._update_bm25_index(cursor, "ch1_s1", "萧炎在天云宗修炼斗气")
            adapter._update_bm25_index(cursor, "ch1_s2", "药老传授炼药技巧")
            conn.commit()

        # BM25 搜索
        results = adapter.bm25_search("萧炎修炼", top_k=5)
        assert len(results) >= 1
        assert results[0].chunk_id == "ch1_s1"

    def test_tokenize(self, temp_project):
        adapter = RAGAdapter(temp_project)

        tokens = adapter._tokenize("萧炎hello世界world")
        assert "萧" in tokens
        assert "炎" in tokens
        assert "hello" in tokens
        assert "world" in tokens


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
