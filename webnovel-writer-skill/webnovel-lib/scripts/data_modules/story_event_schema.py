#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any, Dict, Literal

from pydantic import BaseModel, Field


class StoryEvent(BaseModel):
    event_id: str
    chapter: int = Field(ge=1)
    event_type: Literal[
        "character_state_changed",
        "relationship_changed",
        "world_rule_revealed",
        "world_rule_broken",
        "power_breakthrough",
        "artifact_obtained",
        "promise_created",
        "promise_paid_off",
        "open_loop_created",
        "open_loop_closed",
    ]
    subject: str
    payload: Dict[str, Any] = Field(default_factory=dict)
