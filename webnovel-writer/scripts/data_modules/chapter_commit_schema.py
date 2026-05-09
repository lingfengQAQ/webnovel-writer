#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import hashlib
import json
from typing import Any, ClassVar

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationInfo,
    field_validator,
    model_validator,
)

from .story_event_schema import StoryEvent

EXTRACTION_CORE_FIELDS = ("accepted_events", "state_deltas", "entity_deltas")
EXTRACTION_LIST_FIELDS = (
    "accepted_events",
    "state_deltas",
    "entity_deltas",
    "entities_appeared",
    "scenes",
)
FULFILLMENT_LIST_FIELDS = (
    "planned_nodes",
    "covered_nodes",
    "missed_nodes",
    "extra_nodes",
)

EVENT_TYPE_ALIASES = {
    "character_state": "character_state_changed",
    "character_state_change": "character_state_changed",
    "state_changed": "character_state_changed",
    "relationship_change": "relationship_changed",
    "relation_changed": "relationship_changed",
    "world_rule": "world_rule_revealed",
    "rule_revealed": "world_rule_revealed",
    "rule_broken": "world_rule_broken",
    "breakthrough": "power_breakthrough",
    "power_up": "power_breakthrough",
    "artifact": "artifact_obtained",
    "item_obtained": "artifact_obtained",
    "promise": "promise_created",
    "promise_resolved": "promise_paid_off",
    "promise_fulfilled": "promise_paid_off",
    "mystery_introduction": "open_loop_created",
    "mystery_introduced": "open_loop_created",
    "unresolved_thread": "open_loop_created",
    "scene_open": "open_loop_created",
    "open_loop": "open_loop_created",
    "loop_closed": "open_loop_closed",
}


class CommitArtifactModel(BaseModel):
    model_config = ConfigDict(extra="allow")

    artifact_name: ClassVar[str]
    wrapper_key: ClassVar[str | None] = None
    required_top_level_fields: ClassVar[tuple[str, ...]] = ()

    @model_validator(mode="before")
    @classmethod
    def validate_top_level_shape(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            raise ValueError(f"{cls.artifact_name} must be a JSON object")

        wrapper_key = cls.wrapper_key
        if wrapper_key and wrapper_key in value:
            if cls.artifact_name == "extraction_result":
                raise ValueError(
                    "extraction_result must expose accepted_events/state_deltas/entity_deltas "
                    "as top-level fields, not nested under extraction"
                )
            raise ValueError(
                f"{cls.artifact_name} fields must be top-level, not nested under {wrapper_key}"
            )

        missing = [
            field for field in cls.required_top_level_fields if field not in value
        ]
        if missing:
            raise ValueError(
                f"{cls.artifact_name} missing required top-level fields: "
                + ", ".join(missing)
            )
        return value


def _ensure_list(artifact_name: str, field_name: str, value: Any) -> Any:
    if not isinstance(value, list):
        raise ValueError(f"{artifact_name}.{field_name} must be a list")
    return value


def _ensure_object_list(artifact_name: str, field_name: str, value: Any) -> Any:
    _ensure_list(artifact_name, field_name, value)
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ValueError(f"{artifact_name}.{field_name}[{index}] must be a JSON object")
    return value


class ReviewResult(CommitArtifactModel):
    artifact_name: ClassVar[str] = "review_result"
    wrapper_key: ClassVar[str | None] = "review"
    required_top_level_fields: ClassVar[tuple[str, ...]] = ("blocking_count",)

    blocking_count: int = Field(ge=0, strict=True)


class FulfillmentResult(CommitArtifactModel):
    artifact_name: ClassVar[str] = "fulfillment_result"
    wrapper_key: ClassVar[str | None] = "fulfillment"
    required_top_level_fields: ClassVar[tuple[str, ...]] = FULFILLMENT_LIST_FIELDS

    planned_nodes: list[Any]
    covered_nodes: list[Any]
    missed_nodes: list[Any]
    extra_nodes: list[Any]

    @field_validator(*FULFILLMENT_LIST_FIELDS, mode="before")
    @classmethod
    def validate_list_fields(cls, value: Any, info: ValidationInfo) -> Any:
        return _ensure_list(cls.artifact_name, info.field_name, value)


class DisambiguationResult(CommitArtifactModel):
    artifact_name: ClassVar[str] = "disambiguation_result"
    wrapper_key: ClassVar[str | None] = "disambiguation"
    required_top_level_fields: ClassVar[tuple[str, ...]] = ("pending",)

    pending: list[Any]

    @field_validator("pending", mode="before")
    @classmethod
    def validate_pending(cls, value: Any, info: ValidationInfo) -> Any:
        return _ensure_list(cls.artifact_name, info.field_name, value)


class ExtractionResult(CommitArtifactModel):
    artifact_name: ClassVar[str] = "extraction_result"
    wrapper_key: ClassVar[str | None] = "extraction"
    required_top_level_fields: ClassVar[tuple[str, ...]] = EXTRACTION_CORE_FIELDS

    accepted_events: list[dict[str, Any]]
    state_deltas: list[dict[str, Any]]
    entity_deltas: list[dict[str, Any]]
    entities_appeared: list[dict[str, Any]] = Field(default_factory=list)
    scenes: list[dict[str, Any]] = Field(default_factory=list)
    chapter_meta: Any = Field(default_factory=dict)
    dominant_strand: Any = ""
    summary_text: str = ""

    @field_validator(*EXTRACTION_LIST_FIELDS, mode="before")
    @classmethod
    def validate_object_list_fields(cls, value: Any, info: ValidationInfo) -> Any:
        return _ensure_object_list(cls.artifact_name, info.field_name, value)

    @field_validator("summary_text", mode="before")
    @classmethod
    def validate_summary_text(cls, value: Any) -> Any:
        if not isinstance(value, str):
            raise ValueError("extraction_result.summary_text must be a string")
        return value


class AcceptedEventInput(BaseModel):
    model_config = ConfigDict(extra="allow")

    event_id: str
    chapter: int = Field(ge=1)
    event_type: str
    subject: str
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def normalize_aliases(cls, value: Any, info: ValidationInfo) -> Any:
        if not isinstance(value, dict):
            index = _event_context_index(info)
            raise ValueError(f"accepted_events[{index}] must be a JSON object")

        payload = dict(value)
        context = info.context or {}
        chapter = int(payload.get("chapter") or context.get("chapter") or 0)
        payload["chapter"] = chapter

        event_type = str(payload.get("event_type") or payload.get("type") or "").strip()
        if event_type:
            normalized_type = event_type.lower().replace("-", "_")
            payload["event_type"] = EVENT_TYPE_ALIASES.get(normalized_type, normalized_type)

        subject = _event_subject(payload)
        if not subject:
            index = _event_context_index(info)
            raise ValueError(
                f"accepted_events[{index}].subject must be a non-empty string"
            )
        payload["subject"] = subject

        if not str(payload.get("event_id") or "").strip():
            index = _event_context_index(info)
            payload["event_id"] = _generated_event_id(chapter, index + 1, payload)

        return payload


class AcceptedEventsInput(BaseModel):
    accepted_events: list[Any]

    @field_validator("accepted_events", mode="before")
    @classmethod
    def validate_events_list(cls, value: Any) -> Any:
        if not isinstance(value, list):
            raise ValueError("accepted_events must be a list")
        return value

    def normalize(self, chapter: int) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        for index, event in enumerate(self.accepted_events):
            if not isinstance(event, dict):
                raise ValueError(f"accepted_events[{index}] must be a JSON object")
            payload = AcceptedEventInput.model_validate(
                event,
                context={"chapter": chapter, "index": index},
            ).model_dump()
            normalized.append(StoryEvent.model_validate(payload).model_dump())
        return normalized


def normalize_accepted_events(chapter: int, events: Any) -> list[dict[str, Any]]:
    accepted_events = AcceptedEventsInput.model_validate({"accepted_events": events})
    return accepted_events.normalize(chapter)


def _event_context_index(info: ValidationInfo) -> int:
    context = info.context or {}
    return int(context.get("index") or 0)


def _event_subject(payload: dict[str, Any]) -> str:
    for key in ("subject", "entity_id", "from_entity", "to_entity"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    characters = payload.get("characters")
    if isinstance(characters, str) and characters.strip():
        return characters.strip()
    if isinstance(characters, list):
        for character in characters:
            if isinstance(character, str) and character.strip():
                return character.strip()

    event_payload = payload.get("payload") or {}
    if isinstance(event_payload, dict):
        for key in ("subject", "entity_id", "owner", "holder", "artifact_id", "name"):
            value = event_payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def _generated_event_id(chapter: int, index: int, payload: dict[str, Any]) -> str:
    stable_payload = {
        key: value
        for key, value in payload.items()
        if key not in {"event_id", "chapter"}
    }
    raw = json.dumps(stable_payload, ensure_ascii=False, sort_keys=True)
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]
    return f"evt-ch{chapter:03d}-{index:03d}-{digest}"
