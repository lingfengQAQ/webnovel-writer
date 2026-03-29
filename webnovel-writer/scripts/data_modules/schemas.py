#!/usr/bin/env python3
"""
Pydantic schemas for data_modules outputs.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class EntityAppeared(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    type: str
    mentions: list[str] = Field(default_factory=list)
    confidence: float = 1.0


class EntityNew(BaseModel):
    model_config = ConfigDict(extra="allow")

    suggested_id: str
    name: str
    type: str
    tier: str = "装饰"


class StateChange(BaseModel):
    model_config = ConfigDict(extra="allow")

    entity_id: str
    field: str
    old: str | None = None
    new: str
    reason: str | None = None


class RelationshipNew(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    from_entity: str = Field(alias="from")
    to_entity: str = Field(alias="to")
    type: str
    description: str | None = None
    chapter: int | None = None


class UncertainCandidate(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    id: str


class UncertainMention(BaseModel):
    model_config = ConfigDict(extra="allow")

    mention: str
    candidates: list[UncertainCandidate] = Field(default_factory=list)
    confidence: float = 0.0
    adopted: str | None = None


class DataAgentOutput(BaseModel):
    model_config = ConfigDict(extra="allow")

    entities_appeared: list[EntityAppeared] = Field(default_factory=list)
    entities_new: list[EntityNew] = Field(default_factory=list)
    state_changes: list[StateChange] = Field(default_factory=list)
    relationships_new: list[RelationshipNew] = Field(default_factory=list)
    scenes_chunked: int = 0
    uncertain: list[UncertainMention] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ErrorSchema(BaseModel):
    model_config = ConfigDict(extra="allow")

    code: str
    message: str
    suggestion: str | None = None
    details: dict[str, Any] | None = None


def validate_data_agent_output(payload: dict[str, Any]) -> DataAgentOutput:
    return DataAgentOutput.model_validate(payload)


def format_validation_error(exc: ValidationError) -> dict[str, Any]:
    return {
        "code": "SCHEMA_VALIDATION_FAILED",
        "message": "数据结构校验失败",
        "details": {"errors": exc.errors()},
        "suggestion": "请检查 data-agent 输出字段是否完整且类型正确",
    }


def normalize_data_agent_output(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}

    def _ensure_list(key: str):
        value = payload.get(key)
        if value is None:
            payload[key] = []
        elif isinstance(value, list):
            return
        else:
            payload[key] = [value]

    for key in [
        "entities_appeared",
        "entities_new",
        "state_changes",
        "relationships_new",
        "uncertain",
        "warnings",
    ]:
        _ensure_list(key)

    payload.setdefault("scenes_chunked", 0)
    return payload
