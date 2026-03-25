"""
Dashboard API common models.

These schemas are placeholders for frozen interface contracts.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ApiErrorResponse(BaseModel):
    error_code: str = Field(..., description="Stable machine-readable error code.")
    message: str = Field(..., description="Human-readable error message.")
    details: dict[str, Any] | None = Field(default=None, description="Optional structured details.")
    request_id: str | None = Field(default=None, description="Optional request correlation id.")


class PageQuery(BaseModel):
    limit: int = Field(default=50, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


class WorkspaceContext(BaseModel):
    workspace_id: str = Field(default="workspace-default")
    project_root: str = Field(default="", description="Workspace project root path.")
