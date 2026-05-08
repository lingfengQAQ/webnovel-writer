#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from data_modules.schemas import normalize_data_agent_output, validate_data_agent_output


def test_data_agent_output_compatible_without_memory_facts():
    payload = {
        "entities_appeared": [],
        "entities_new": [],
        "state_changes": [],
        "relationships_new": [],
    }
    normalized = normalize_data_agent_output(payload)
    validated = validate_data_agent_output(normalized)
    assert validated.memory_facts is not None


def test_data_agent_output_accepts_memory_facts():
    payload = {
        "entities_appeared": [],
        "entities_new": [],
        "state_changes": [],
        "relationships_new": [],
        "memory_facts": {
            "timeline_events": [{"event": "萧炎离开天云宗", "chapter": 12}],
            "world_rules": [{"rule": "修炼体系九境", "scope": "global"}],
            "open_loops": [{"content": "三年之约", "status": "active"}],
            "reader_promises": [{"content": "纳兰嫣然会出场", "type": "encounter"}],
        },
    }
    normalized = normalize_data_agent_output(payload)
    validated = validate_data_agent_output(normalized)
    assert len(validated.memory_facts.timeline_events) == 1
    assert len(validated.memory_facts.world_rules) == 1

