#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Data Modules 单元测试
"""

import pytest
import asyncio
import json
import tempfile
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

        linker.register_alias("xiaoyan", "萧炎", "角色")
        # v5.0: 同一别名可绑定不同实体（一对多）
        assert linker.register_alias("other_person", "萧炎", "角色")

        # 查找所有匹配
        entries = linker.lookup_alias_all("萧炎")
        assert len(entries) == 2

    def test_get_all_aliases(self, temp_project):
        linker = EntityLinker(temp_project)

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
        """回归：init_project 生成的 state.json 无 meta 字段，StateManager 仍应可写入。"""
        # 模拟 init_project.py 生成的 v5.0 state.json 形状（包含 entities_v3/alias_index）
        init_state = {
            "project_info": {"title": "测试书名", "genre": "修仙/玄幻", "created_at": "2026-01-01"},
            "progress": {"current_chapter": 0, "total_words": 0, "last_updated": "2026-01-01 00:00:00"},
            "protagonist_state": {"name": "测试主角"},
            "relationships": {},
            "world_settings": {"power_system": [], "factions": [], "locations": []},
            "plot_threads": {"active_threads": [], "foreshadowing": []},
            "review_checkpoints": [],
            "strand_tracker": {"current_dominant": "quest", "history": []},
            "entities_v3": {"角色": {}, "地点": {}, "物品": {}, "势力": {}, "招式": {}},
            "alias_index": {},
        }
        temp_project.state_file.write_text(json.dumps(init_state, ensure_ascii=False, indent=2), encoding="utf-8")

        manager = StateManager(temp_project)
        manager.update_progress(5, words=100)
        manager.save_state()

        saved = json.loads(temp_project.state_file.read_text(encoding="utf-8"))
        assert "meta" not in saved
        assert saved["progress"]["current_chapter"] == 5
        assert saved["progress"]["total_words"] == 100
        assert isinstance(saved.get("entities_v3"), dict)
        assert isinstance(saved.get("alias_index"), dict)

    def test_save_state_preserves_unrelated_fields(self, temp_project):
        """回归：仅写入增量，不应覆盖/丢失其他模块维护的字段。"""
        init_state = {
            "project_info": {"title": "测试书名", "genre": "修仙/玄幻", "created_at": "2026-01-01"},
            "progress": {"current_chapter": 10, "total_words": 1000, "last_updated": "2026-01-01 00:00:00"},
            "protagonist_state": {"name": "测试主角"},
            "relationships": {"allies": ["药老"], "enemies": []},
            "world_settings": {"power_system": [], "factions": [], "locations": []},
            "plot_threads": {"active_threads": [{"id": "t1", "title": "主线"}], "foreshadowing": []},
            "review_checkpoints": [],
            "strand_tracker": {"current_dominant": "quest", "history": []},
            "entities_v3": {"角色": {}, "地点": {}, "物品": {}, "势力": {}, "招式": {}},
            "alias_index": {},
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

        manager.add_chapter(ChapterMeta(chapter=1, title="", location="", word_count=1000, characters=[]))
        manager.add_scenes(1, [SceneMeta(chapter=1, scene_index=1, start_line=1, end_line=50,
                                        location="", summary="", characters=[])])
        manager.record_appearance("xiaoyan", 1, [], 1.0)

        stats = manager.get_stats()
        assert stats["chapters"] == 1
        assert stats["scenes"] == 1
        assert stats["entities"] == 1


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
