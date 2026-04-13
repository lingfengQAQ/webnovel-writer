#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import sqlite3
from typing import Dict, List

from .amend_proposal_schema import AmendProposal


def normalize_override_record(
    *,
    record_type: str,
    field: str,
    base_value: str,
    override_value: str,
    source_level: str,
) -> Dict[str, str]:
    return {
        "record_type": str(record_type or "").strip(),
        "field": str(field or "").strip(),
        "base_value": str(base_value or "").strip(),
        "override_value": str(override_value or "").strip(),
        "source_level": str(source_level or "").strip(),
    }


def ensure_override_ledger_columns(conn: sqlite3.Connection) -> None:
    existing = {
        row[1] for row in conn.execute("PRAGMA table_info(override_contracts)").fetchall()
    }
    wanted = {
        "record_type": "TEXT DEFAULT 'soft_deviation'",
        "field": "TEXT DEFAULT ''",
        "base_value": "TEXT DEFAULT ''",
        "override_value": "TEXT DEFAULT ''",
        "source_level": "TEXT DEFAULT ''",
        "reason_tag": "TEXT DEFAULT ''",
    }
    for name, ddl in wanted.items():
        if name not in existing:
            # SECURITY: name 和 ddl 均来自上方硬编码字典，非用户输入，无 SQL 注入风险
            conn.execute(f"ALTER TABLE override_contracts ADD COLUMN {name} {ddl}")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_override_contracts_record_type ON override_contracts(record_type)"
    )


class AmendProposalTrigger:
    RULES = {
        "world_rule_broken": {"target_level": "master", "reason_tag": "world_rule_broken"},
        "relationship_changed": None,
        "power_breakthrough": None,
        "artifact_obtained": None,
        "character_state_changed": None,
        "world_rule_revealed": None,
        "open_loop_created": None,
        "open_loop_closed": None,
        "promise_created": None,
        "promise_paid_off": None,
    }

    def check(self, chapter: int, events: List[dict]) -> List[Dict[str, str | int]]:
        proposals: List[Dict[str, str | int]] = []
        for event in events or []:
            if not isinstance(event, dict):
                continue
            rule = self.RULES.get(str(event.get("event_type") or "").strip())
            if not rule:
                continue
            payload = dict(event.get("payload") or {})
            proposal = AmendProposal(
                proposal_id=f"amend-{chapter}-{event.get('event_id')}",
                chapter=chapter,
                target_level=rule["target_level"],
                field=str(payload.get("field") or "").strip(),
                base_value=str(payload.get("base_value") or "").strip(),
                proposed_value=str(payload.get("proposed_value") or "").strip(),
                reason_tag=rule["reason_tag"],
            )
            proposals.append(proposal.model_dump())
        return proposals


def persist_amend_proposals(
    conn: sqlite3.Connection, chapter: int, proposals: List[dict]
) -> int:
    inserted = 0
    for proposal in proposals or []:
        row = normalize_override_record(
            record_type="amend_proposal",
            field=str(proposal.get("field") or ""),
            base_value=str(proposal.get("base_value") or ""),
            override_value=str(proposal.get("proposed_value") or ""),
            source_level=str(proposal.get("target_level") or ""),
        )
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO override_contracts (
                chapter,
                constraint_type,
                constraint_id,
                rationale_type,
                rationale_text,
                payback_plan,
                due_chapter,
                status,
                record_type,
                field,
                base_value,
                override_value,
                source_level,
                reason_tag
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                chapter,
                "AMEND_PROPOSAL",
                str(proposal.get("proposal_id") or ""),
                "story_amend_proposal",
                f"事件触发合同修订提案: {proposal.get('proposal_id')}",
                "",
                chapter,
                "pending",
                row["record_type"],
                row["field"],
                row["base_value"],
                row["override_value"],
                row["source_level"],
                str(proposal.get("reason_tag") or ""),
            ),
        )
        inserted += max(int(cursor.rowcount), 0)
    return inserted
