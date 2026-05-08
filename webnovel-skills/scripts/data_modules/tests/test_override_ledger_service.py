#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from data_modules.config import DataModulesConfig
from data_modules.index_manager import IndexManager
from data_modules.override_ledger_service import (
    AmendProposalTrigger,
    ensure_override_ledger_columns,
    normalize_override_record,
    persist_amend_proposals,
)


def test_normalize_override_record_sets_record_type():
    row = normalize_override_record(
        record_type="contract_override",
        field="core_tone",
        base_value="先压后爆",
        override_value="当场爆发",
        source_level="chapter",
    )
    assert row["record_type"] == "contract_override"
    assert row["field"] == "core_tone"


def test_normalize_override_record_supports_amend_proposal():
    row = normalize_override_record(
        record_type="amend_proposal",
        field="world_rule",
        base_value="金手指每日一次",
        override_value="金手指失控突破",
        source_level="master",
    )
    assert row["record_type"] == "amend_proposal"


def test_world_rule_broken_generates_amend_proposal():
    trigger = AmendProposalTrigger()
    proposals = trigger.check(
        chapter=3,
        events=[
            {
                "event_id": "evt-001",
                "event_type": "world_rule_broken",
                "subject": "金手指",
                "payload": {
                    "field": "world_rule",
                    "base_value": "每日一次",
                    "proposed_value": "短时失控突破",
                },
            }
        ],
    )
    assert len(proposals) == 1
    assert proposals[0]["target_level"] == "master"
    assert proposals[0]["field"] == "world_rule"


def test_persist_amend_proposals_writes_pending_rows(tmp_path):
    manager = IndexManager(DataModulesConfig.from_project_root(tmp_path))
    proposals = [
        {
            "proposal_id": "amend-3-evt-001",
            "chapter": 3,
            "target_level": "master",
            "field": "world_rule",
            "base_value": "每日一次",
            "proposed_value": "短时失控突破",
            "reason_tag": "world_rule_broken",
        }
    ]

    with manager._get_conn() as conn:
        ensure_override_ledger_columns(conn)
        inserted = persist_amend_proposals(conn, 3, proposals)
        conn.commit()

    with manager._get_conn() as conn:
        row = conn.execute(
            """
            SELECT record_type, field, override_value, source_level, status
            FROM override_contracts
            """
        ).fetchone()

    assert inserted == 1
    assert row["record_type"] == "amend_proposal"
    assert row["field"] == "world_rule"
    assert row["override_value"] == "短时失控突破"
    assert row["source_level"] == "master"
    assert row["status"] == "pending"
