"""
Runtime API placeholder models.
"""

from pydantic import BaseModel, Field

from .common import WorkspaceContext


class RuntimeProfileQuery(BaseModel):
    workspace_id: str = Field(default="workspace-default")
    project_root: str = Field(default="")


class RuntimeProfileResponse(BaseModel):
    status: str = Field(default="placeholder")
    runtime_name: str = Field(default="codex")
    workspace: WorkspaceContext
    notes: str = Field(default="Runtime profile skeleton; implementation pending.")


class RuntimeMigrateRequest(BaseModel):
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    dry_run: bool = Field(default=True)


class RuntimeMigrateResponse(BaseModel):
    status: str = Field(default="placeholder")
    moved: int = Field(default=0)
    removed: int = Field(default=0)
    skipped: int = Field(default=0)
    warnings: list[str] = Field(default_factory=list)
    created_at: str = Field(default="1970-01-01T00:00:00Z")
