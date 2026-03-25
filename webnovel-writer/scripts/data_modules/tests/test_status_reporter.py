#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import tempfile

from data_modules.config import DataModulesConfig
from data_modules.index_manager import (
    IndexManager,
    ChapterReadingPowerMeta,
    EntityMeta,
    RelationshipMeta,
    RelationshipEventMeta,
)
from status_reporter import StatusReporter, main


def _write_state(project_root, state: dict):
    webnovel_dir = project_root / ".webnovel"
    webnovel_dir.mkdir(parents=True, exist_ok=True)
    (webnovel_dir / "state.json").write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _write_chapter(project_root, chapter: int, text: str = "测试章节正文"):
    chapters_dir = project_root / "正文"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter_file = chapters_dir / f"第{chapter:04d}章.md"
    chapter_file.write_text(f"# 第{chapter}章\n\n{text}\n", encoding="utf-8")


def test_foreshadowing_analysis_uses_real_chapters_and_handles_missing_data():
    with tempfile.TemporaryDirectory() as tmpdir:
        project_root = DataModulesConfig.from_project_root(tmpdir).project_root

        state = {
            "progress": {"current_chapter": 120, "total_words": 360000},
            "plot_threads": {
                "foreshadowing": [
                    {
                        "content": "林家宝库铭文的秘密",
                        "status": "未回收",
                        "tier": "核心",
                        "planted_chapter": 20,
                        "target_chapter": 100,
                    },
                    {
                        "content": "神秘玉佩来历",
                        "status": "待回收",
                        "tier": "支线",
                        "added_chapter": 50,
                        "target": 150,
                    },
                    {
                        "content": "旧日誓言",
                        "status": "未回收",
                        "tier": "装饰",
                    },
                    {
                        "content": "已完成伏笔",
                        "status": "已回收",
                        "planted_chapter": 10,
                        "target_chapter": 20,
                    },
                ]
            },
        }
        _write_state(project_root, state)

        reporter = StatusReporter(str(project_root))
        assert reporter.load_state() is True

        foreshadowing = reporter.analyze_foreshadowing()
        assert len(foreshadowing) == 3

        records = {item["content"]: item for item in foreshadowing}
        assert records["林家宝库铭文的秘密"]["planted_chapter"] == 20
        assert records["林家宝库铭文的秘密"]["elapsed"] == 100
        assert records["林家宝库铭文的秘密"]["status"] == "🔴 已超期"

        assert records["神秘玉佩来历"]["planted_chapter"] == 50
        assert records["神秘玉佩来历"]["target_chapter"] == 150
        assert records["神秘玉佩来历"]["status"] in {"🟡 轻度超时", "🟢 正常"}

        assert records["旧日誓言"]["planted_chapter"] is None
        assert records["旧日誓言"]["status"] == "⚪ 数据不足"

        urgency = reporter.analyze_foreshadowing_urgency()
        urgency_by_content = {item["content"]: item for item in urgency}

        assert urgency_by_content["林家宝库铭文的秘密"]["urgency"] is not None
        assert urgency_by_content["林家宝库铭文的秘密"]["status"] == "🔴 已超期"
        assert urgency_by_content["旧日誓言"]["urgency"] is None
        assert urgency_by_content["旧日誓言"]["status"] == "⚪ 数据不足"


def test_pacing_analysis_prefers_real_coolpoint_metadata_over_estimation():
    with tempfile.TemporaryDirectory() as tmpdir:
        config = DataModulesConfig.from_project_root(tmpdir)
        config.ensure_dirs()
        project_root = config.project_root

        state = {
            "progress": {"current_chapter": 3, "total_words": 12000},
            "chapter_meta": {
                "0003": {
                    "hook": "下章有变",
                    "coolpoint_patterns": ["身份掉马", "反派翻车"],
                }
            },
        }
        _write_state(project_root, state)

        idx = IndexManager(config)
        idx.save_chapter_reading_power(
            ChapterReadingPowerMeta(
                chapter=1,
                hook_type="渴望钩",
                hook_strength="strong",
                coolpoint_patterns=["打脸权威", "身份掉马"],
            )
        )
        idx.save_chapter_reading_power(
            ChapterReadingPowerMeta(
                chapter=2,
                hook_type="悬念钩",
                hook_strength="medium",
                coolpoint_patterns=["身份掉马"],
            )
        )

        reporter = StatusReporter(str(project_root))
        assert reporter.load_state() is True
        reporter.chapters_data = [
            {"chapter": 1, "word_count": 4000, "cool_point": "", "dominant": "", "characters": []},
            {"chapter": 2, "word_count": 3000, "cool_point": "", "dominant": "", "characters": []},
            {"chapter": 3, "word_count": 5000, "cool_point": "", "dominant": "", "characters": []},
        ]

        segments = reporter.analyze_pacing()
        assert len(segments) == 1

        seg = segments[0]
        assert seg["cool_points"] == 5
        assert round(seg["words_per_point"], 2) == 2400.00
        assert seg["missing_chapters"] == 0
        assert seg["dominant_source"] == "chapter_reading_power"


def test_pacing_analysis_marks_missing_data_instead_of_assuming_one_point_per_chapter():
    with tempfile.TemporaryDirectory() as tmpdir:
        config = DataModulesConfig.from_project_root(tmpdir)
        config.ensure_dirs()
        project_root = config.project_root

        state = {
            "progress": {"current_chapter": 1, "total_words": 2000},
            "chapter_meta": {},
        }
        _write_state(project_root, state)

        reporter = StatusReporter(str(project_root))
        assert reporter.load_state() is True
        reporter.chapters_data = [
            {"chapter": 1, "word_count": 2000, "cool_point": "", "dominant": "", "characters": []}
        ]

        seg = reporter.analyze_pacing()[0]
        assert seg["cool_points"] == 0
        assert seg["words_per_point"] is None
        assert seg["rating"] == "数据不足"
        assert seg["missing_chapters"] == 1


def test_relationship_graph_prefers_index_db_data():
    with tempfile.TemporaryDirectory() as tmpdir:
        config = DataModulesConfig.from_project_root(tmpdir)
        config.ensure_dirs()
        project_root = config.project_root

        state = {
            "progress": {"current_chapter": 12, "total_words": 24000},
            "protagonist_state": {"name": "萧炎"},
            "relationships": {"allies": [{"name": "旧盟友", "relation": "友好"}], "enemies": []},
        }
        _write_state(project_root, state)

        idx = IndexManager(config)
        idx.upsert_entity(
            EntityMeta(
                id="xiaoyan",
                type="角色",
                canonical_name="萧炎",
                tier="核心",
                current={},
                first_appearance=1,
                last_appearance=12,
                is_protagonist=True,
            )
        )
        idx.upsert_entity(
            EntityMeta(
                id="yaolao",
                type="角色",
                canonical_name="药老",
                tier="重要",
                current={},
                first_appearance=1,
                last_appearance=12,
            )
        )
        idx.upsert_relationship(
            RelationshipMeta(
                from_entity="xiaoyan",
                to_entity="yaolao",
                type="师徒",
                description="师徒关系",
                chapter=10,
            )
        )
        idx.record_relationship_event(
            RelationshipEventMeta(
                from_entity="xiaoyan",
                to_entity="yaolao",
                type="师徒",
                chapter=10,
                action="create",
                polarity=1,
                strength=0.9,
                description="拜师",
                evidence="萧炎拜药老为师",
            )
        )

        reporter = StatusReporter(str(project_root))
        assert reporter.load_state() is True
        graph = reporter.generate_relationship_graph()
        assert "mermaid" in graph
        assert "药老" in graph
        assert "师徒" in graph


def test_json_report_schema_snapshot_and_metric_sources():
    with tempfile.TemporaryDirectory() as tmpdir:
        config = DataModulesConfig.from_project_root(tmpdir)
        config.ensure_dirs()
        project_root = config.project_root

        state = {
            "progress": {"current_chapter": 2, "total_words": 4000},
            "project_info": {"target_words": 10000},
            "protagonist_state": {"name": "林夜"},
            "relationships": {"allies": [{"name": "苏青", "relation": "盟友"}], "enemies": []},
            "plot_threads": {"foreshadowing": []},
        }
        _write_state(project_root, state)
        _write_chapter(project_root, 1)
        _write_chapter(project_root, 2)

        reporter = StatusReporter(str(project_root))
        assert reporter.load_state() is True
        reporter.scan_chapters()

        payload = reporter.generate_json_report("all")
        assert payload["schema_version"] == 1
        assert payload["focus"] == "all"
        assert "generated_at" in payload
        assert set(payload["sources"].keys()) == {"state", "index"}
        assert set(payload["sections"].keys()) == {
            "basic",
            "characters",
            "foreshadowing",
            "urgency",
            "pacing",
            "strand",
            "relationships",
        }

        snapshot = {
            "schema_version": payload["schema_version"],
            "sections": sorted(payload["sections"].keys()),
            "metric_sources": {
                key: payload["metric_sources"][key]["depends_on"]
                for key in sorted(payload["metric_sources"].keys())
            },
            "health_gate_passed": payload["health_gate"]["passed"],
        }
        assert snapshot == {
            "schema_version": 1,
            "sections": [
                "basic",
                "characters",
                "foreshadowing",
                "pacing",
                "relationships",
                "strand",
                "urgency",
            ],
            "metric_sources": {
                "basic": ["state"],
                "characters": ["index", "state"],
                "foreshadowing": ["state"],
                "pacing": ["index", "state"],
                "relationships": ["index", "state"],
                "strand": ["state"],
                "urgency": ["state"],
            },
            "health_gate_passed": True,
        }

        markdown = reporter.generate_report("all")
        assert "## 🧭 数据来源与新鲜度" in markdown
        assert "## 🚦 健康门禁结果" in markdown


def test_health_gate_detects_relationship_missing_and_chapter_gap():
    with tempfile.TemporaryDirectory() as tmpdir:
        config = DataModulesConfig.from_project_root(tmpdir)
        config.ensure_dirs()
        project_root = config.project_root

        state = {
            "progress": {"current_chapter": 3, "total_words": 9000},
            "protagonist_state": {"name": "主角"},
            "relationships": {"allies": [], "enemies": []},
        }
        _write_state(project_root, state)
        _write_chapter(project_root, 1)
        _write_chapter(project_root, 3)

        reporter = StatusReporter(str(project_root))
        assert reporter.load_state() is True
        reporter.scan_chapters()

        gate = reporter.evaluate_health_gate("all")
        assert gate["passed"] is False
        codes = {item["code"] for item in gate["anomalies"]}
        assert "chapter_gap_detected" in codes
        assert "relationship_missing" in codes

        output_path = project_root / ".webnovel" / "status_report.json"
        exit_code = main(
            [
                "--project-root",
                str(project_root),
                "--format",
                "json",
                "--output",
                str(output_path),
            ]
        )
        assert exit_code == 2
        payload = json.loads(output_path.read_text(encoding="utf-8"))
        assert payload["health_gate"]["passed"] is False
