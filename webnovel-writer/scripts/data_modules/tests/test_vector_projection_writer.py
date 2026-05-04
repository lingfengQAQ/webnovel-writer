#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""VectorProjectionWriter 单元测试。"""
from data_modules.vector_projection_writer import VectorProjectionWriter


def test_event_to_text_formats_power_breakthrough():
    writer = VectorProjectionWriter.__new__(VectorProjectionWriter)
    event = {
        "event_type": "power_breakthrough",
        "chapter": 47,
        "subject": "韩立",
        "payload": {"field": "realm", "new": "筑基初期"},
    }
    text = writer._event_to_text(event)
    assert "第47章" in text
    assert "韩立" in text
    assert "筑基初期" in text


def test_delta_to_text_formats_relationship():
    writer = VectorProjectionWriter.__new__(VectorProjectionWriter)
    delta = {
        "from_entity": "韩立",
        "to_entity": "陈巧倩",
        "relationship_type": "合作",
        "chapter": 47,
    }
    text = writer._delta_to_text(delta)
    assert "第47章" in text
    assert "韩立" in text
    assert "陈巧倩" in text
    assert "合作" in text


def test_collect_chunks_from_commit():
    writer = VectorProjectionWriter.__new__(VectorProjectionWriter)
    payload = {
        "meta": {"chapter": 47, "status": "accepted"},
        "accepted_events": [
            {
                "event_type": "power_breakthrough",
                "chapter": 47,
                "subject": "韩立",
                "payload": {"field": "realm", "new": "筑基初期"},
            },
        ],
        "entity_deltas": [
            {
                "from_entity": "韩立",
                "to_entity": "陈巧倩",
                "relationship_type": "合作",
                "chapter": 47,
            },
        ],
    }
    chunks = writer._collect_chunks(payload)
    assert len(chunks) == 2
    assert chunks[0]["chunk_type"] == "event"
    assert chunks[1]["chunk_type"] == "entity_delta"
    assert chunks[0]["chunk_id"] != chunks[1]["chunk_id"]


def test_collect_chunks_assigns_unique_ids_for_same_chapter_events():
    writer = VectorProjectionWriter.__new__(VectorProjectionWriter)
    payload = {
        "meta": {"chapter": 47, "status": "accepted"},
        "accepted_events": [
            {
                "event_type": "character_state_changed",
                "chapter": 47,
                "subject": "韩立",
                "payload": {"field": "状态", "new": "警觉"},
            },
            {
                "event_type": "character_state_changed",
                "chapter": 47,
                "subject": "陈巧倩",
                "payload": {"field": "状态", "new": "迟疑"},
            },
        ],
        "entity_deltas": [],
    }

    chunks = writer._collect_chunks(payload)

    assert len(chunks) == 2
    assert len({chunk["chunk_id"] for chunk in chunks}) == 2
    assert all(chunk["scene_index"] == 0 for chunk in chunks)


def test_collect_chunks_keeps_event_id_stable_when_order_changes():
    writer = VectorProjectionWriter.__new__(VectorProjectionWriter)
    event_a = {
        "event_id": "evt-a",
        "event_type": "character_state_changed",
        "chapter": 47,
        "subject": "韩立",
        "payload": {"field": "状态", "new": "警觉"},
    }
    event_b = {
        "event_id": "evt-b",
        "event_type": "character_state_changed",
        "chapter": 47,
        "subject": "陈巧倩",
        "payload": {"field": "状态", "new": "迟疑"},
    }

    first = writer._collect_chunks(
        {"meta": {"chapter": 47}, "accepted_events": [event_a, event_b], "entity_deltas": []}
    )
    second = writer._collect_chunks(
        {"meta": {"chapter": 47}, "accepted_events": [event_b, event_a], "entity_deltas": []}
    )

    first_ids = {chunk["content"]: chunk["chunk_id"] for chunk in first}
    second_ids = {chunk["content"]: chunk["chunk_id"] for chunk in second}
    assert first_ids == second_ids


def test_rejected_commit_returns_not_applied():
    writer = VectorProjectionWriter.__new__(VectorProjectionWriter)
    writer.project_root = None
    result = writer.apply({"meta": {"status": "rejected", "chapter": 1}})
    assert result["applied"] is False
