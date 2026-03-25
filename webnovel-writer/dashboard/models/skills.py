"""
Skills API placeholder models.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from .common import WorkspaceContext


class SkillMeta(BaseModel):
    id: str = Field(default="skill-placeholder")
    name: str = Field(default="Placeholder Skill")
    description: str = Field(default="Skill skeleton; implementation pending.")
    enabled: bool = Field(default=False)
    scope: str = Field(default="workspace")
    updated_at: str = Field(default="1970-01-01T00:00:00Z")
    last_called_at: str | None = Field(default=None)


class SkillAuditEntry(BaseModel):
    id: str = Field(default="audit-placeholder")
    action: str = Field(default="noop")
    skill_id: str = Field(default="skill-placeholder")
    actor: str = Field(default="system")
    created_at: str = Field(default="1970-01-01T00:00:00Z")
    details: dict[str, Any] = Field(default_factory=dict)


class SkillListQuery(BaseModel):
    workspace_id: str = Field(default="workspace-default")
    project_root: str = Field(default="")
    enabled: bool | None = Field(default=None)
    limit: int = Field(default=50, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


class SkillListResponse(BaseModel):
    status: str = Field(default="placeholder")
    items: list[SkillMeta] = Field(default_factory=list)
    total: int = Field(default=0)


class SkillCreateRequest(BaseModel):
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    id: str = Field(default="skill-placeholder")
    name: str = Field(default="Placeholder Skill")
    description: str = Field(default="Skill skeleton; implementation pending.")
    enabled: bool = Field(default=False)


class SkillCreateResponse(BaseModel):
    status: str = Field(default="placeholder")
    skill: SkillMeta


class SkillUpdateRequest(BaseModel):
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    name: str | None = Field(default=None)
    description: str | None = Field(default=None)
    enabled: bool | None = Field(default=None)


class SkillUpdateResponse(BaseModel):
    status: str = Field(default="placeholder")
    skill: SkillMeta


class SkillToggleRequest(BaseModel):
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    reason: str | None = Field(default=None)


class SkillToggleResponse(BaseModel):
    status: str = Field(default="placeholder")
    skill_id: str = Field(default="skill-placeholder")
    enabled: bool = Field(default=False)


class SkillDeleteRequest(BaseModel):
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    hard_delete: bool = Field(default=False)


class SkillDeleteResponse(BaseModel):
    status: str = Field(default="placeholder")
    skill_id: str = Field(default="skill-placeholder")
    deleted: bool = Field(default=False)


class SkillAuditQuery(BaseModel):
    workspace_id: str = Field(default="workspace-default")
    project_root: str = Field(default="")
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)


class SkillAuditListResponse(BaseModel):
    status: str = Field(default="placeholder")
    items: list[SkillAuditEntry] = Field(default_factory=list)
    total: int = Field(default=0)
