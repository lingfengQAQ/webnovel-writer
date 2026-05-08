#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from data_modules.event_projection_router import EventProjectionRouter


def test_router_maps_power_breakthrough_to_state_and_memory():
    router = EventProjectionRouter()
    targets = router.route(
        {"event_type": "power_breakthrough", "subject": "xiaoyan", "payload": {}}
    )
    assert targets == ["state", "memory", "vector"]


def test_router_maps_relationship_changed_to_index():
    router = EventProjectionRouter()
    targets = router.route(
        {
            "event_type": "relationship_changed",
            "subject": "xiaoyan",
            "payload": {"to": "yaolao"},
        }
    )
    assert "index" in targets


def test_router_maps_world_rule_broken_to_memory_only():
    router = EventProjectionRouter()
    targets = router.route(
        {
            "event_type": "world_rule_broken",
            "subject": "金手指",
            "payload": {"field": "world_rule"},
        }
    )
    assert targets == ["memory", "vector"]


def test_router_collects_required_writers_from_commit_payload():
    router = EventProjectionRouter()
    targets = router.required_writers(
        {
            "accepted_events": [
                {"event_type": "power_breakthrough", "subject": "xiaoyan", "payload": {}},
                {
                    "event_type": "relationship_changed",
                    "subject": "xiaoyan",
                    "payload": {"to": "yaolao"},
                },
            ],
            "summary_text": "本章摘要",
        }
    )
    assert targets == ["index", "memory", "state", "summary", "vector"]


def test_router_maps_power_breakthrough_to_state_memory_vector():
    router = EventProjectionRouter()
    targets = router.route(
        {"event_type": "power_breakthrough", "subject": "xiaoyan", "payload": {}}
    )
    assert "vector" in targets
    assert "state" in targets
    assert "memory" in targets


def test_router_maps_relationship_changed_to_index_and_vector():
    router = EventProjectionRouter()
    targets = router.route(
        {"event_type": "relationship_changed", "subject": "xiaoyan", "payload": {}}
    )
    assert "index" in targets
    assert "vector" in targets


def test_required_writers_includes_vector_for_key_events():
    router = EventProjectionRouter()
    payload = {
        "meta": {"status": "accepted", "chapter": 5},
        "accepted_events": [
            {"event_type": "power_breakthrough", "subject": "xiaoyan", "payload": {}},
        ],
        "entity_deltas": [],
        "summary_text": "摘要",
    }
    writers = router.required_writers(payload)
    assert "vector" in writers


def test_required_writers_includes_index_for_accepted_commit():
    router = EventProjectionRouter()
    writers = router.required_writers(
        {
            "meta": {"status": "accepted", "chapter": 5},
            "accepted_events": [],
            "entity_deltas": [],
            "summary_text": "",
        }
    )
    assert "index" in writers


def test_router_ignores_unknown_and_non_dict_events():
    router = EventProjectionRouter()
    assert router.route({"event_type": "unknown"}) == []
    writers = router.required_writers(
        {
            "meta": {"status": "rejected"},
            "accepted_events": ["not-a-dict", {"event_type": "unknown"}],
            "entity_deltas": [],
            "summary_text": "   ",
        }
    )
    assert writers == []
