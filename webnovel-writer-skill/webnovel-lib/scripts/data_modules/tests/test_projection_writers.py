#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json

from data_modules.chapter_commit_service import ChapterCommitService
from data_modules.config import DataModulesConfig
from data_modules.index_manager import IndexManager
from data_modules.memory.store import ScratchpadManager
from data_modules.index_projection_writer import IndexProjectionWriter
from data_modules.memory_projection_writer import MemoryProjectionWriter
from data_modules.state_projection_writer import StateProjectionWriter
from data_modules.summary_projection_writer import SummaryProjectionWriter


def test_state_projection_writer_handles_rejected_commit(tmp_path):
    (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    writer = StateProjectionWriter(tmp_path)
    result = writer.apply({"meta": {"status": "rejected", "chapter": 3}, "state_deltas": []})
    assert result["applied"] is True
    state = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    assert state["progress"]["chapter_status"]["3"] == "chapter_rejected"


def test_state_projection_writer_applies_accepted_commit(tmp_path):
    (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    writer = StateProjectionWriter(tmp_path)
    result = writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 3},
            "state_deltas": [{"entity_id": "x", "field": "realm", "new": "斗者"}],
        }
    )
    assert result["applied"] is True
    payload = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    assert payload["entity_state"]["x"]["realm"] == "斗者"
    assert payload["progress"]["chapter_status"]["3"] == "chapter_committed"
    assert payload["progress"]["current_chapter"] == 3
    assert payload["progress"]["last_updated"]


def test_accepted_chapter_commits_advance_progress_and_word_count(tmp_path):
    (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".webnovel" / "state.json").write_text(
        json.dumps(
            {"progress": {"current_chapter": 0, "total_words": 0, "last_updated": "2026-01-01 00:00:00"}},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    chapters_dir = tmp_path / "正文"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "第0001章.md").write_text("第一章正文内容", encoding="utf-8")
    (chapters_dir / "第0002章.md").write_text("第二章正文内容更多", encoding="utf-8")

    service = ChapterCommitService(tmp_path)
    for chapter in (1, 2):
        payload = service.build_commit(
            chapter=chapter,
            review_result={"blocking_count": 0},
            fulfillment_result={"planned_nodes": [], "covered_nodes": [], "missed_nodes": [], "extra_nodes": []},
            disambiguation_result={"pending": []},
            extraction_result={"state_deltas": [], "entity_deltas": [], "accepted_events": []},
        )
        service.apply_projections(payload)

    state = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    assert state["progress"]["chapter_status"]["1"] == "chapter_committed"
    assert state["progress"]["chapter_status"]["2"] == "chapter_committed"
    assert state["progress"]["current_chapter"] == 2
    assert state["progress"]["total_words"] > 0
    assert state["progress"]["last_updated"] != "2026-01-01 00:00:00"


def test_reapplying_accepted_chapter_commit_does_not_double_count_words(tmp_path):
    (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".webnovel" / "state.json").write_text(
        json.dumps(
            {"progress": {"current_chapter": 0, "total_words": 0}},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    chapters_dir = tmp_path / "正文"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "第0001章.md").write_text("第一章正文内容", encoding="utf-8")

    payload = {
        "meta": {"status": "accepted", "chapter": 1},
        "state_deltas": [],
        "accepted_events": [],
    }
    writer = StateProjectionWriter(tmp_path)
    writer.apply(payload)
    first_state = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))

    writer.apply(payload)
    second_state = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))

    assert second_state["progress"]["current_chapter"] == 1
    assert second_state["progress"]["total_words"] == first_state["progress"]["total_words"]
    assert second_state["progress"]["last_updated"] == first_state["progress"]["last_updated"]


def test_state_projection_writer_derives_delta_from_power_breakthrough_event(tmp_path):
    (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    writer = StateProjectionWriter(tmp_path)
    result = writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 3},
            "state_deltas": [],
            "accepted_events": [
                {
                    "event_id": "evt-001",
                    "chapter": 3,
                    "event_type": "power_breakthrough",
                    "subject": "xiaoyan",
                    "payload": {"from": "斗者", "to": "斗师"},
                }
            ],
        }
    )

    payload = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    assert result["applied"] is True
    assert payload["entity_state"]["xiaoyan"]["realm"] == "斗师"


def test_state_projection_writer_updates_strand_tracker(tmp_path):
    (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    writer = StateProjectionWriter(tmp_path)

    writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 3},
            "state_deltas": [],
            "accepted_events": [],
            "dominant_strand": "quest",
        }
    )
    writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 4},
            "state_deltas": [],
            "accepted_events": [],
            "dominant_strand": "quest",
        }
    )

    payload = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    tracker = payload["strand_tracker"]
    assert tracker["current_dominant"] == "quest"
    assert tracker["last_quest_chapter"] == 4
    assert tracker["chapters_since_switch"] == 2
    assert len(tracker["history"]) == 2


def test_state_projection_writer_reapplying_chapter_replaces_strand(tmp_path):
    (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    writer = StateProjectionWriter(tmp_path)

    writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 3},
            "state_deltas": [],
            "accepted_events": [],
            "dominant_strand": "quest",
        }
    )
    writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 3},
            "state_deltas": [],
            "accepted_events": [],
            "dominant_strand": "fire",
        }
    )

    payload = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    tracker = payload["strand_tracker"]
    assert tracker["current_dominant"] == "fire"
    assert tracker["last_quest_chapter"] == 0
    assert tracker["last_fire_chapter"] == 3
    assert tracker["history"] == [{"chapter": 3, "dominant": "fire"}]


def test_accepted_commit_updates_state_json_end_to_end(tmp_path):
    (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    service = ChapterCommitService(tmp_path)
    commit_payload = service.build_commit(
        chapter=3,
        review_result={"blocking_count": 0},
        fulfillment_result={"planned_nodes": ["发现陷阱"], "covered_nodes": ["发现陷阱"], "missed_nodes": [], "extra_nodes": []},
        disambiguation_result={"pending": []},
        extraction_result={"state_deltas": [{"entity_id": "x", "field": "realm", "new": "斗者"}], "entity_deltas": [], "accepted_events": []},
    )

    StateProjectionWriter(tmp_path).apply(commit_payload)
    payload = json.loads((tmp_path / ".webnovel" / "state.json").read_text(encoding="utf-8"))
    assert payload["entity_state"]["x"]["realm"] == "斗者"


def test_index_projection_writer_applies_entity_delta(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    writer = IndexProjectionWriter(tmp_path)

    result = writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 3},
            "entity_deltas": [
                {
                    "entity_id": "xiaoyan",
                    "canonical_name": "萧炎",
                    "type": "角色",
                    "current": {"realm": "斗者"},
                    "chapter": 3,
                }
            ],
        }
    )

    entity = IndexManager(cfg).get_entity("xiaoyan")
    assert result["applied"] is True
    assert entity["canonical_name"] == "萧炎"
    assert entity["current_json"]["realm"] == "斗者"


def test_index_projection_writer_registers_stable_protagonist_aliases(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    writer = IndexProjectionWriter(tmp_path)

    result = writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 1},
            "entity_deltas": [
                {
                    "entity_id": "lu_ming",
                    "canonical_name": "陆鸣",
                    "type": "角色",
                    "tier": "核心",
                    "chapter": 1,
                    "is_protagonist": True,
                }
            ],
        }
    )

    manager = IndexManager(cfg)
    assert result["applied"] is True
    assert manager.get_entity("lu_ming")["canonical_name"] == "陆鸣"
    assert manager.get_entity("陆鸣")["id"] == "lu_ming"
    assert manager.get_entity("protagonist")["id"] == "lu_ming"
    assert manager.get_entity("luming")["id"] == "lu_ming"


def test_entity_delta_without_protagonist_flag_preserves_existing_protagonist(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    manager = IndexManager(cfg)
    manager.apply_entity_delta(
        {
            "entity_id": "lu_ming",
            "canonical_name": "陆鸣",
            "type": "角色",
            "tier": "核心",
            "chapter": 1,
            "is_protagonist": True,
        }
    )

    manager.apply_entity_delta(
        {
            "entity_id": "lu_ming",
            "canonical_name": "陆鸣",
            "type": "角色",
            "tier": "核心",
            "chapter": 2,
            "field": "realm",
            "new": "炼气二层",
        }
    )

    assert manager.get_protagonist()["id"] == "lu_ming"
    assert manager.get_entity("protagonist")["id"] == "lu_ming"
    assert manager.get_entity("lu_ming")["is_protagonist"] == 1


def test_index_projection_writer_derives_relationship_from_event(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    writer = IndexProjectionWriter(tmp_path)

    result = writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 3},
            "entity_deltas": [],
            "accepted_events": [
                {
                    "event_id": "evt-001",
                    "chapter": 3,
                    "event_type": "relationship_changed",
                    "subject": "xiaoyan",
                    "payload": {
                        "to_entity": "yaolao",
                        "relationship_type": "师徒",
                        "description": "关系正式确立",
                    },
                }
            ],
        }
    )

    rels = IndexManager(cfg).get_relationship_between("xiaoyan", "yaolao")
    assert result["applied"] is True
    assert rels[0]["type"] == "师徒"


def test_index_projection_writer_derives_artifact_entity_from_event(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    writer = IndexProjectionWriter(tmp_path)

    result = writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 3},
            "entity_deltas": [],
            "accepted_events": [
                {
                    "event_id": "evt-002",
                    "chapter": 3,
                    "event_type": "artifact_obtained",
                    "subject": "黑戒",
                    "payload": {
                        "artifact_id": "black_ring",
                        "name": "黑戒",
                        "owner": "xiaoyan",
                    },
                }
            ],
        }
    )

    entity = IndexManager(cfg).get_entity("black_ring")
    assert result["applied"] is True
    assert entity["canonical_name"] == "黑戒"
    assert entity["current_json"]["holder"] == "xiaoyan"


def test_accepted_commit_writes_chapter_index_tables(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    (tmp_path / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")
    chapters_dir = tmp_path / "正文"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "第0003章.md").write_text("第三章正文内容", encoding="utf-8")

    service = ChapterCommitService(tmp_path)
    payload = service.build_commit(
        chapter=3,
        review_result={"blocking_count": 0},
        fulfillment_result={"planned_nodes": [], "covered_nodes": [], "missed_nodes": [], "extra_nodes": []},
        disambiguation_result={"pending": []},
        extraction_result={
            "summary_text": "本章摘要",
            "state_deltas": [{"entity_id": "xiaoyan", "field": "realm", "old": "斗者", "new": "斗师"}],
            "entity_deltas": [],
            "entities_appeared": [{"id": "xiaoyan", "mentions": ["萧炎"], "confidence": 0.95}],
            "scenes": [
                {
                    "index": 1,
                    "start_line": 1,
                    "end_line": 12,
                    "location": "山门",
                    "summary": "萧炎完成突破",
                    "characters": ["xiaoyan"],
                }
            ],
            "accepted_events": [],
        },
    )

    result = service.apply_projections(payload)
    manager = IndexManager(cfg)

    assert result["projection_status"]["index"] == "done"
    assert manager.get_chapter(3)["summary"] == "本章摘要"
    assert manager.get_chapter_appearances(3)[0]["entity_id"] == "xiaoyan"
    assert manager.get_scenes(3)[0]["location"] == "山门"
    changes = manager.get_chapter_state_changes(3)
    assert len(changes) == 1
    assert changes[0]["entity_id"] == "xiaoyan"
    assert changes[0]["field"] == "realm"


def test_index_projection_writer_records_state_change_from_event(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    writer = IndexProjectionWriter(tmp_path)

    result = writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 3},
            "state_deltas": [],
            "entity_deltas": [],
            "accepted_events": [
                {
                    "event_id": "evt-001",
                    "chapter": 3,
                    "event_type": "character_state_changed",
                    "subject": "xiaoyan",
                    "payload": {"field": "mood", "old": "躁动", "new": "冷静"},
                }
            ],
        }
    )

    changes = IndexManager(cfg).get_chapter_state_changes(3)
    assert result["state_changes"] == 1
    assert len(changes) == 1
    assert changes[0]["entity_id"] == "xiaoyan"
    assert changes[0]["field"] == "mood"


def test_summary_projection_writer_writes_summary_markdown(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    writer = SummaryProjectionWriter(tmp_path)

    result = writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 3},
            "summary_text": "本章主角发现陷阱并决定隐忍。",
        }
    )

    summary_path = tmp_path / ".webnovel" / "summaries" / "ch0003.md"
    assert result["applied"] is True
    assert summary_path.is_file()
    assert "剧情摘要" in summary_path.read_text(encoding="utf-8")


def test_memory_projection_writer_maps_commit_into_scratchpad(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    writer = MemoryProjectionWriter(tmp_path)

    result = writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 3},
            "state_deltas": [
                {"entity_id": "xiaoyan", "field": "realm", "old": "斗者", "new": "斗师"}
            ],
            "entity_deltas": [],
            "accepted_events": [],
        }
    )

    store = ScratchpadManager(cfg)
    chars = store.query(category="character_state", status="active")
    assert result["applied"] is True
    assert any(x.subject == "xiaoyan" and x.field == "realm" for x in chars)


def test_memory_projection_writer_maps_open_loop_event_into_scratchpad(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    writer = MemoryProjectionWriter(tmp_path)

    result = writer.apply(
        {
            "meta": {"status": "accepted", "chapter": 3},
            "state_deltas": [],
            "entity_deltas": [],
            "accepted_events": [
                {
                    "event_id": "evt-001",
                    "chapter": 3,
                    "event_type": "open_loop_created",
                    "subject": "三年之约",
                    "payload": {"content": "三年之约"},
                }
            ],
        }
    )

    store = ScratchpadManager(cfg)
    loops = store.query(category="open_loop", status="active")
    assert result["applied"] is True
    assert any("三年之约" in x.subject for x in loops)
