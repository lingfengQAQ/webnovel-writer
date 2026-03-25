"""
Outlines API placeholder models.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .common import WorkspaceContext


class OutlineAnchor(BaseModel):
    source_start: int = Field(default=0, ge=0)
    source_end: int = Field(default=0, ge=0)
    paragraph_index: int = Field(default=0, ge=0)


class OutlineSegment(BaseModel):
    id: str = Field(default="segment-placeholder")
    title: str = Field(default="Placeholder Segment")
    content: str = Field(default="Outline segment skeleton; implementation pending.")
    order_index: int = Field(default=0, ge=0)


class OutlineSplitRecord(BaseModel):
    id: str = Field(default="split-placeholder")
    source_start: int = Field(default=0, ge=0)
    source_end: int = Field(default=0, ge=0)
    created_at: str = Field(default="1970-01-01T00:00:00Z")
    segments: list[OutlineSegment] = Field(default_factory=list)
    anchors: list[OutlineAnchor] = Field(default_factory=list)


class OutlineRollbackPlan(BaseModel):
    rollback_strategy: str = Field(default="smaller_selection")
    rollback_start: int = Field(default=0, ge=0)
    rollback_end: int = Field(default=0, ge=0)
    notes: str = Field(default="Rollback plan skeleton; implementation pending.")


class OutlineBundleQuery(BaseModel):
    workspace_id: str = Field(default="workspace-default")
    project_root: str = Field(default="")


class OutlineBundleResponse(BaseModel):
    status: str = Field(default="placeholder")
    total_outline: str = Field(default="")
    detailed_outline: str = Field(default="")
    splits: list[OutlineSplitRecord] = Field(default_factory=list)


class OutlineSplitPreviewRequest(BaseModel):
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    selection_start: int = Field(default=0, ge=0)
    selection_end: int = Field(default=0, ge=0)
    selection_text: str = Field(default="")


class OutlineSplitPreviewResponse(BaseModel):
    status: str = Field(default="placeholder")
    segments: list[OutlineSegment] = Field(default_factory=list)
    anchors: list[OutlineAnchor] = Field(default_factory=list)


class OutlineSplitApplyRequest(BaseModel):
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    selection_start: int = Field(default=0, ge=0)
    selection_end: int = Field(default=0, ge=0)
    idempotency_key: str | None = Field(default=None)


class OutlineSplitApplyResponse(BaseModel):
    status: str = Field(default="placeholder")
    record: OutlineSplitRecord = Field(default_factory=OutlineSplitRecord)


class OutlineSplitHistoryQuery(BaseModel):
    workspace_id: str = Field(default="workspace-default")
    project_root: str = Field(default="")
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)


class OutlineSplitHistoryResponse(BaseModel):
    status: str = Field(default="placeholder")
    items: list[OutlineSplitRecord] = Field(default_factory=list)
    total: int = Field(default=0)


class OutlineResplitPreviewRequest(BaseModel):
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    selection_start: int = Field(default=0, ge=0)
    selection_end: int = Field(default=0, ge=0)


class OutlineResplitPreviewResponse(BaseModel):
    status: str = Field(default="placeholder")
    rollback_plan: OutlineRollbackPlan = Field(default_factory=OutlineRollbackPlan)
    segments: list[OutlineSegment] = Field(default_factory=list)


class OutlineResplitApplyRequest(BaseModel):
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    rollback_plan: OutlineRollbackPlan = Field(default_factory=OutlineRollbackPlan)
    idempotency_key: str | None = Field(default=None)


class OutlineResplitApplyResponse(BaseModel):
    status: str = Field(default="placeholder")
    record: OutlineSplitRecord = Field(default_factory=OutlineSplitRecord)


class OutlineOrderValidateRequest(BaseModel):
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    segments: list[OutlineSegment] = Field(default_factory=list)


class OutlineOrderValidateResponse(BaseModel):
    status: str = Field(default="placeholder")
    valid: bool = Field(default=True)
    conflicts: list[str] = Field(default_factory=list)
