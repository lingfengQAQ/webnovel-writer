#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Dict, List, Set


class EventProjectionRouter:
    TABLE = {
        "character_state_changed": ["state", "memory", "vector"],
        "power_breakthrough": ["state", "memory", "vector"],
        "relationship_changed": ["index", "vector"],
        "world_rule_revealed": ["memory", "vector"],
        "world_rule_broken": ["memory", "vector"],
        "open_loop_created": ["memory"],
        "open_loop_closed": ["memory"],
        "promise_created": ["memory"],
        "promise_paid_off": ["memory"],
        "artifact_obtained": ["index", "vector"],
    }

    def route(self, event: Dict) -> List[str]:
        return list(self.TABLE.get(str(event.get("event_type") or "").strip(), []))

    def required_writers(self, commit_payload: Dict) -> List[str]:
        writers: Set[str] = set()
        if str((commit_payload.get("meta") or {}).get("status") or "") == "accepted":
            writers.add("state")
            writers.add("index")
        if commit_payload.get("entity_deltas"):
            writers.add("index")
        if str(commit_payload.get("summary_text") or "").strip():
            writers.add("summary")
        for event in commit_payload.get("accepted_events") or []:
            if not isinstance(event, dict):
                continue
            writers.update(self.route(event))
        return sorted(writers)
