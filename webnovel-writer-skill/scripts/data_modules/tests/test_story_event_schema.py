#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import pytest

from data_modules.story_event_schema import StoryEvent


def test_story_event_supports_power_breakthrough():
    event = StoryEvent.model_validate(
        {
            "event_id": "evt-001",
            "chapter": 3,
            "event_type": "power_breakthrough",
            "subject": "xiaoyan",
            "payload": {"from": "斗之气三段", "to": "斗者"},
        }
    )
    assert event.event_type == "power_breakthrough"


def test_story_event_rejects_unknown_event_type():
    with pytest.raises(ValueError):
        StoryEvent.model_validate(
            {
                "event_id": "evt-002",
                "chapter": 3,
                "event_type": "unknown_event",
                "subject": "xiaoyan",
                "payload": {},
            }
        )
