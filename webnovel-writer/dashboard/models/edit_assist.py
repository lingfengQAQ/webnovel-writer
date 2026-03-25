"""
Edit assist API placeholder models.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .common import WorkspaceContext


class EditAssistProposalSource(BaseModel):
    provider: str = Field(default="")
    model: str = Field(default="")


class EditAssistProposal(BaseModel):
    id: str = Field(default="proposal-placeholder")
    version: int = Field(default=1, ge=1)
    selection_version: str = Field(default="")
    source: EditAssistProposalSource = Field(default_factory=EditAssistProposalSource)
    prompt: str = Field(default="")
    preview: str = Field(default="")
    before_text: str = Field(default="")
    after_text: str = Field(default="")
    provider_latency_ms: int | None = Field(default=None, ge=0)


class EditAssistApplyProposal(BaseModel):
    id: str = Field(default="proposal-placeholder")
    version: int = Field(default=1, ge=1)
    selection_version: str = Field(default="")
    source: EditAssistProposalSource = Field(default_factory=EditAssistProposalSource)


class EditAssistLogEntry(BaseModel):
    id: str = Field(default="log-placeholder")
    file_path: str = Field(default="")
    selection_start: int = Field(default=0, ge=0)
    selection_end: int = Field(default=0, ge=0)
    prompt: str = Field(default="")
    preview: str = Field(default="")
    applied: bool = Field(default=False)
    created_at: str = Field(default="1970-01-01T00:00:00Z")
    proposal_id: str = Field(default="")
    provider: str | None = Field(default=None)
    model: str | None = Field(default=None)
    provider_latency_ms: int | None = Field(default=None, ge=0)
    apply_latency_ms: int | None = Field(default=None, ge=0)
    error_code: str | None = Field(default=None)
    failure_reason: str | None = Field(default=None)
    expected_version: str | None = Field(default=None)
    selection_version: str | None = Field(default=None)
    current_version: str | None = Field(default=None)
    rollback_performed: bool | None = Field(default=None)
    rollback_error: str | None = Field(default=None)


class EditAssistPreviewRequest(BaseModel):
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    file_path: str = Field(default="")
    selection_start: int = Field(default=0, ge=0)
    selection_end: int = Field(default=0, ge=0)
    selection_text: str = Field(default="")
    prompt: str = Field(default="")


class EditAssistPreviewResponse(BaseModel):
    status: str = Field(default="placeholder")
    proposal: EditAssistProposal = Field(default_factory=EditAssistProposal)


class EditAssistApplyRequest(BaseModel):
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    proposal: EditAssistApplyProposal = Field(default_factory=EditAssistApplyProposal)
    file_path: str = Field(default="")
    selection_start: int = Field(default=0, ge=0)
    selection_end: int = Field(default=0, ge=0)
    expected_version: str | None = Field(default=None)


class EditAssistApplyResponse(BaseModel):
    status: str = Field(default="placeholder")
    log_entry: EditAssistLogEntry = Field(default_factory=EditAssistLogEntry)


class EditAssistLogQuery(BaseModel):
    workspace_id: str = Field(default="workspace-default")
    project_root: str = Field(default="")
    applied: bool | None = Field(default=None)
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)


class EditAssistLogListResponse(BaseModel):
    status: str = Field(default="placeholder")
    items: list[EditAssistLogEntry] = Field(default_factory=list)
    total: int = Field(default=0)
