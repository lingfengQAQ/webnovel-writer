#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
关系事件与关系图谱测试
"""

import json
import sys

import pytest

import data_modules.index_manager as index_manager_module
from data_modules.config import DataModulesConfig
from data_modules.index_manager import (
    EntityMeta,
    IndexManager,
    RelationshipEventMeta,
    RelationshipMeta,
)


@pytest.fixture
def temp_project(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    if not cfg.state_file.exists():
        cfg.state_file.write_text("{}", encoding="utf-8")
    return cfg


def test_relationship_events_timeline_and_subgraph(temp_project):
    manager = IndexManager(temp_project)
    manager.upsert_entity(
        EntityMeta(
            id="xiaoyan",
            type="角色",
            canonical_name="萧炎",
            tier="核心",
            current={},
            first_appearance=1,
            last_appearance=10,
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
            last_appearance=10,
        )
    )
    manager.upsert_entity(
        EntityMeta(
            id="lintian",
            type="角色",
            canonical_name="林天",
            tier="重要",
            current={},
            first_appearance=2,
            last_appearance=10,
        )
    )
    manager.upsert_relationship(
        RelationshipMeta(
            from_entity="xiaoyan",
            to_entity="yaolao",
            type="师徒",
            description="正式拜师",
            chapter=3,
        )
    )
    manager.upsert_relationship(
        RelationshipMeta(
            from_entity="yaolao",
            to_entity="lintian",
            type="敌对",
            description="理念冲突",
            chapter=5,
        )
    )
    event_id = manager.record_relationship_event(
        RelationshipEventMeta(
            from_entity="xiaoyan",
            to_entity="yaolao",
            type="师徒",
            chapter=3,
            action="create",
            polarity=1,
            strength=0.9,
            description="拜师",
            evidence="公开收徒",
            confidence=0.95,
        )
    )
    assert event_id > 0
    manager.record_relationship_event(
        RelationshipEventMeta(
            from_entity="yaolao",
            to_entity="lintian",
            type="敌对",
            chapter=5,
            action="create",
            polarity=-1,
            strength=0.8,
            description="结怨",
            evidence="比斗失手",
            confidence=0.8,
        )
    )

    events = manager.get_relationship_events("xiaoyan", direction="both", limit=20)
    assert events
    timeline = manager.get_relationship_timeline("xiaoyan", "yaolao", limit=20)
    assert timeline
    assert timeline[0]["type"] == "师徒"

    graph = manager.build_relationship_subgraph("xiaoyan", depth=2, chapter=10, top_edges=10)
    node_ids = {n["id"] for n in graph["nodes"]}
    assert "xiaoyan" in node_ids
    assert "yaolao" in node_ids
    assert "lintian" in node_ids
    assert graph["edges"]
    mermaid = manager.render_relationship_subgraph_mermaid(graph)
    assert "mermaid" in mermaid
    assert "师徒" in mermaid


def test_relationship_subgraph_respects_chapter_slice(temp_project):
    manager = IndexManager(temp_project)
    manager.upsert_entity(
        EntityMeta(
            id="a",
            type="角色",
            canonical_name="甲",
            current={},
            first_appearance=1,
            last_appearance=3,
            is_protagonist=True,
        )
    )
    manager.upsert_entity(
        EntityMeta(
            id="b",
            type="角色",
            canonical_name="乙",
            current={},
            first_appearance=1,
            last_appearance=3,
        )
    )
    manager.record_relationship_event(
        RelationshipEventMeta(
            from_entity="a",
            to_entity="b",
            type="同盟",
            chapter=1,
            action="create",
            polarity=1,
            strength=0.6,
        )
    )
    manager.record_relationship_event(
        RelationshipEventMeta(
            from_entity="a",
            to_entity="b",
            type="同盟",
            chapter=2,
            action="remove",
            polarity=0,
            strength=0.0,
        )
    )

    graph_ch1 = manager.build_relationship_subgraph("a", depth=1, chapter=1, top_edges=10)
    graph_ch3 = manager.build_relationship_subgraph("a", depth=1, chapter=3, top_edges=10)
    assert len(graph_ch1["edges"]) == 1
    assert len(graph_ch3["edges"]) == 0


def test_relationship_subgraph_fallbacks_to_snapshot_when_events_missing(temp_project):
    manager = IndexManager(temp_project)
    manager.upsert_entity(
        EntityMeta(
            id="a",
            type="角色",
            canonical_name="甲",
            current={},
            first_appearance=1,
            last_appearance=5,
            is_protagonist=True,
        )
    )
    manager.upsert_entity(
        EntityMeta(
            id="b",
            type="角色",
            canonical_name="乙",
            current={},
            first_appearance=1,
            last_appearance=5,
        )
    )
    # 只写 relationships 快照，不写 relationship_events
    manager.upsert_relationship(
        RelationshipMeta(
            from_entity="a",
            to_entity="b",
            type="同盟",
            description="旧版快照数据",
            chapter=3,
        )
    )

    graph = manager.build_relationship_subgraph("a", depth=1, chapter=3, top_edges=10)
    assert graph["edges"]
    assert graph["edges"][0]["action"] == "snapshot"
    assert graph["edges"][0]["type"] == "同盟"


def test_relationship_graph_cli_commands(temp_project, monkeypatch, capsys):
    manager = IndexManager(temp_project)
    manager.upsert_entity(
        EntityMeta(
            id="hero",
            type="角色",
            canonical_name="主角",
            current={},
            first_appearance=1,
            last_appearance=1,
            is_protagonist=True,
        )
    )
    manager.upsert_entity(
        EntityMeta(
            id="mentor",
            type="角色",
            canonical_name="师父",
            current={},
            first_appearance=1,
            last_appearance=1,
        )
    )
    manager.record_relationship_event(
        RelationshipEventMeta(
            from_entity="hero",
            to_entity="mentor",
            type="师徒",
            chapter=1,
            action="create",
            polarity=1,
            strength=0.9,
        )
    )

    root = str(temp_project.project_root)

    def run_cli(args):
        monkeypatch.setattr(sys, "argv", ["index_manager"] + args)
        index_manager_module.main()
        output = capsys.readouterr().out.strip().splitlines()
        assert output
        return json.loads(output[-1])

    payload = run_cli(
        [
            "--project-root",
            root,
            "get-relationship-events",
            "--entity",
            "hero",
            "--direction",
            "both",
            "--limit",
            "10",
        ]
    )
    assert payload["status"] == "success"
    assert payload["data"]

    payload = run_cli(
        [
            "--project-root",
            root,
            "get-relationship-graph",
            "--center",
            "hero",
            "--depth",
            "1",
            "--chapter",
            "1",
            "--format",
            "mermaid",
        ]
    )
    assert payload["status"] == "success"
    assert "mermaid" in payload["data"]["mermaid"]

    payload = run_cli(
        [
            "--project-root",
            root,
            "get-relationship-timeline",
            "--a",
            "hero",
            "--b",
            "mentor",
            "--limit",
            "10",
        ]
    )
    assert payload["status"] == "success"
    assert payload["data"]

    payload = run_cli(
        [
            "--project-root",
            root,
            "record-relationship-event",
            "--data",
            json.dumps(
                {
                    "from_entity": "hero",
                    "type": "师徒",
                    "chapter": 1,
                },
                ensure_ascii=False,
            ),
        ]
    )
    assert payload["status"] == "error"
    assert payload["error"]["code"] == "INVALID_RELATIONSHIP_EVENT"
