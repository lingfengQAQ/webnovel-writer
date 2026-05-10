#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import pytest

from data_modules.chapter_commit_schema import (
    DisambiguationResult,
    ExtractionResult,
    FulfillmentResult,
    ReviewResult,
    normalize_accepted_events,
)


def test_artifact_models_preserve_valid_top_level_payloads():
    review = ReviewResult.model_validate(
        {"blocking_count": 0, "issues_count": 2, "has_blocking": False}
    )
    fulfillment = FulfillmentResult.model_validate(
        {
            "planned_nodes": ["find trap"],
            "covered_nodes": ["find trap"],
            "missed_nodes": [],
            "extra_nodes": [],
        }
    )
    disambiguation = DisambiguationResult.model_validate({"pending": []})
    extraction = ExtractionResult.model_validate(
        {
            "accepted_events": [],
            "state_deltas": [{"entity_id": "xiaoyan", "field": "realm", "new": "fighter"}],
            "entity_deltas": [],
            "summary_text": "summary",
        }
    )

    assert review.model_dump()["issues_count"] == 2
    assert fulfillment.covered_nodes == ["find trap"]
    assert disambiguation.pending == []
    assert extraction.state_deltas[0]["entity_id"] == "xiaoyan"


def test_artifact_models_reject_nested_wrappers_and_missing_core_fields():
    with pytest.raises(ValueError, match="nested under fulfillment"):
        FulfillmentResult.model_validate({"fulfillment": {"missed_nodes": []}})

    with pytest.raises(ValueError, match="nested under disambiguation"):
        DisambiguationResult.model_validate({"disambiguation": {"pending": []}})

    with pytest.raises(ValueError, match="nested under extraction"):
        ExtractionResult.model_validate(
            {
                "accepted_events": [],
                "state_deltas": [],
                "entity_deltas": [],
                "extraction": {"summary_text": "wrapped"},
            }
        )

    with pytest.raises(ValueError, match="accepted_events"):
        ExtractionResult.model_validate({"state_deltas": [], "entity_deltas": []})


def test_accepted_event_model_normalizes_aliases_before_story_event_validation():
    events = normalize_accepted_events(
        76,
        [
            {
                "type": "scene_open",
                "characters": ["xiaoyan"],
                "payload": {"content": "new mystery"},
            }
        ],
    )

    assert events[0]["event_id"].startswith("evt-ch076-001-")
    assert events[0]["chapter"] == 76
    assert events[0]["event_type"] == "open_loop_created"
    assert events[0]["subject"] == "xiaoyan"


def test_accepted_event_model_rejects_malformed_event_collections():
    with pytest.raises(ValueError, match="accepted_events must be a list"):
        normalize_accepted_events(3, {"event_type": "open_loop_created"})

    with pytest.raises(ValueError, match=r"accepted_events\[0\]"):
        normalize_accepted_events(3, ["not-a-json-object"])


def test_accepted_event_model_rejects_blank_subject_and_unknown_type():
    with pytest.raises(ValueError, match="subject"):
        normalize_accepted_events(
            3,
            [
                {
                    "event_type": "open_loop_created",
                    "subject": "   ",
                    "payload": {"content": "三年之约提及"},
                }
            ],
        )

    with pytest.raises(ValueError, match="event_type"):
        normalize_accepted_events(
            3,
            [
                {
                    "event_id": "evt-unknown",
                    "event_type": "not_a_story_event",
                    "subject": "xiaoyan",
                    "payload": {},
                }
            ],
        )
