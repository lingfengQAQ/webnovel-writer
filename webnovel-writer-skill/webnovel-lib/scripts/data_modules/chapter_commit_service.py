#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from chapter_outline_loader import volume_num_for_chapter_from_state

from .config import DataModulesConfig
from .event_log_store import EventLogStore
from .event_projection_router import EventProjectionRouter
from .story_contracts import write_json
from .index_manager import IndexManager
from .override_ledger_service import (
    AmendProposalTrigger,
    ensure_override_ledger_columns,
    persist_amend_proposals,
)


class ChapterCommitService:
    def __init__(self, project_root: Path):
        self.project_root = Path(project_root)

    def build_commit(
        self,
        chapter: int,
        review_result: Dict[str, Any],
        fulfillment_result: Dict[str, Any],
        disambiguation_result: Dict[str, Any],
        extraction_result: Dict[str, Any],
    ) -> Dict[str, Any]:
        rejected = bool(review_result.get("blocking_count")) or bool(
            fulfillment_result.get("missed_nodes")
        ) or bool(disambiguation_result.get("pending"))
        status = "rejected" if rejected else "accepted"
        volume = volume_num_for_chapter_from_state(self.project_root, chapter) or 1
        return {
            "meta": {
                "schema_version": "story-system/v1",
                "chapter": chapter,
                "status": status,
            },
            "contract_refs": {
                "master": "MASTER_SETTING.json",
                "volume": f"volume_{volume:03d}.json",
                "chapter": f"chapter_{chapter:03d}.json",
                "review": f"chapter_{chapter:03d}.review.json",
            },
            "provenance": {
                "write_fact_role": "chapter_commit",
                "projection_role": "derived_read_models",
                "legacy_state_role": "projection_only",
            },
            "outline_snapshot": {
                "planned_nodes": fulfillment_result.get("planned_nodes", []),
                "covered_nodes": fulfillment_result.get("covered_nodes", []),
                "missed_nodes": fulfillment_result.get("missed_nodes", []),
                "extra_nodes": fulfillment_result.get("extra_nodes", []),
            },
            "review_result": review_result,
            "fulfillment_result": fulfillment_result,
            "disambiguation_result": disambiguation_result,
            "accepted_events": extraction_result.get("accepted_events", []),
            "state_deltas": extraction_result.get("state_deltas", []),
            "entity_deltas": extraction_result.get("entity_deltas", []),
            "entities_appeared": extraction_result.get("entities_appeared", []),
            "scenes": extraction_result.get("scenes", []),
            "chapter_meta": extraction_result.get("chapter_meta", {}),
            "dominant_strand": extraction_result.get("dominant_strand", ""),
            "summary_text": extraction_result.get("summary_text", ""),
            "projection_status": {
                "state": "pending",
                "index": "pending",
                "summary": "pending",
                "memory": "pending",
                "vector": "pending",
            },
        }

    def persist_commit(self, payload: Dict[str, Any]) -> Path:
        target = self.project_root / ".story-system" / "commits"
        target.mkdir(parents=True, exist_ok=True)
        path = target / f"chapter_{int(payload['meta']['chapter']):03d}.commit.json"
        write_json(path, payload)
        return path

    def apply_projections(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if payload["meta"]["status"] != "accepted":
            return payload

        chapter = int((payload.get("meta") or {}).get("chapter") or 0)
        EventLogStore(self.project_root).write_events(chapter, payload.get("accepted_events", []))

        proposals = AmendProposalTrigger().check(chapter, payload.get("accepted_events", []))
        if proposals:
            manager = IndexManager(DataModulesConfig.from_project_root(self.project_root))
            with manager._get_conn() as conn:
                ensure_override_ledger_columns(conn)
                persist_amend_proposals(conn, chapter, proposals)
                conn.commit()

        from .index_projection_writer import IndexProjectionWriter
        from .memory_projection_writer import MemoryProjectionWriter
        from .state_projection_writer import StateProjectionWriter
        from .summary_projection_writer import SummaryProjectionWriter
        from .vector_projection_writer import VectorProjectionWriter

        writers = {
            "state": StateProjectionWriter(self.project_root),
            "index": IndexProjectionWriter(self.project_root),
            "summary": SummaryProjectionWriter(self.project_root),
            "memory": MemoryProjectionWriter(self.project_root),
            "vector": VectorProjectionWriter(self.project_root),
        }
        required_writers = set(EventProjectionRouter().required_writers(payload))
        for name, writer in writers.items():
            if name not in required_writers:
                payload["projection_status"][name] = "skipped"
                continue
            try:
                result = writer.apply(payload)
                payload["projection_status"][name] = "done" if result.get("applied") else "skipped"
            except Exception as exc:
                payload["projection_status"][name] = f"failed:{exc}"
        self.persist_commit(payload)
        return payload
