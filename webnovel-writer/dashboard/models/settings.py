"""
Settings API placeholder models.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from .common import WorkspaceContext


class SettingsFileNode(BaseModel):
    name: str = Field(default="placeholder.md")
    path: str = Field(default="设定集/placeholder.md")
    type: str = Field(default="file")
    children: list["SettingsFileNode"] = Field(default_factory=list)


class SettingsFileTreeQuery(BaseModel):
    workspace_id: str = Field(default="workspace-default")
    project_root: str = Field(default="")


class SettingsFileTreeResponse(BaseModel):
    status: str = Field(default="placeholder")
    nodes: list[SettingsFileNode] = Field(default_factory=list)


class SettingsFileReadQuery(BaseModel):
    workspace_id: str = Field(default="workspace-default")
    project_root: str = Field(default="")
    path: str = Field(default="")


class SettingsFileReadResponse(BaseModel):
    status: str = Field(default="placeholder")
    path: str = Field(default="")
    content: str = Field(default="")


class DictionaryEntry(BaseModel):
    id: str = Field(default="dict-placeholder")
    term: str = Field(default="placeholder")
    type: str = Field(default="concept")
    attrs: dict[str, Any] = Field(default_factory=dict)
    source_file: str = Field(default="设定集/placeholder.md")
    source_span: str = Field(default="0-0")
    status: str = Field(default="pending")
    fingerprint: str = Field(default="placeholder")
    conflict_id: str | None = Field(default=None)


class DictionaryConflictEntry(BaseModel):
    id: str = Field(default="conflict-placeholder")
    term: str = Field(default="placeholder")
    type: str = Field(default="concept")
    candidates: list[DictionaryEntry] = Field(default_factory=list)
    status: str = Field(default="conflict")


class DictionaryExtractRequest(BaseModel):
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    incremental: bool = Field(default=True)


class DictionaryExtractResponse(BaseModel):
    status: str = Field(default="placeholder")
    extracted: int = Field(default=0)
    conflicts: int = Field(default=0)


class DictionaryListQuery(BaseModel):
    workspace_id: str = Field(default="workspace-default")
    project_root: str = Field(default="")
    term: str | None = Field(default=None)
    type: str | None = Field(default=None)
    status: str | None = Field(default=None)
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)


class DictionaryListResponse(BaseModel):
    status: str = Field(default="placeholder")
    items: list[DictionaryEntry] = Field(default_factory=list)
    total: int = Field(default=0)


class DictionaryConflictListQuery(BaseModel):
    workspace_id: str = Field(default="workspace-default")
    project_root: str = Field(default="")
    term: str | None = Field(default=None)
    type: str | None = Field(default=None)
    status: str | None = Field(default=None)
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)


class DictionaryConflictListResponse(BaseModel):
    status: str = Field(default="placeholder")
    items: list[DictionaryConflictEntry] = Field(default_factory=list)
    total: int = Field(default=0)


class DictionaryConflictResolveRequest(BaseModel):
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    decision: str = Field(default="confirm")
    attrs: dict[str, Any] = Field(default_factory=dict)


class DictionaryConflictResolveResponse(BaseModel):
    status: str = Field(default="placeholder")
    conflict: DictionaryConflictEntry = Field(default_factory=DictionaryConflictEntry)
