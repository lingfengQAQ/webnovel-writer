"""
Runtime API models.
"""

from pydantic import BaseModel, ConfigDict, Field

from .common import WorkspaceContext


class RuntimeProfileQuery(BaseModel):
    workspace_id: str = Field(default="workspace-default")
    project_root: str = Field(default="")


class RuntimeMigrateMovedItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: str
    from_path: str = Field(alias="from")
    to: str
    dry_run: bool


class RuntimeMigrateRemovedItem(BaseModel):
    kind: str
    path: str
    reason: str
    dry_run: bool


class RuntimeMigrateSkippedItem(BaseModel):
    kind: str
    path: str
    reason: str


class RuntimeMigrationPreview(BaseModel):
    moved: list[RuntimeMigrateMovedItem] = Field(default_factory=list)
    removed: list[RuntimeMigrateRemovedItem] = Field(default_factory=list)
    skipped: list[RuntimeMigrateSkippedItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    created_at: str
    dry_run: bool = Field(default=True)
    project_root: str
    migratable_items: int = Field(default=0, ge=0)


class RuntimePointerFileState(BaseModel):
    path: str
    exists: bool = Field(default=False)
    target: str | None = Field(default=None)
    target_exists: bool | None = Field(default=None)
    target_is_project_root: bool | None = Field(default=None)
    read_error: str | None = Field(default=None)


class RuntimePointerState(BaseModel):
    workspace_root: str
    status: str
    has_conflict: bool = Field(default=False)
    codex: RuntimePointerFileState
    legacy: RuntimePointerFileState


class RuntimeLegacyState(BaseModel):
    workspace_legacy_dir: str
    workspace_legacy_dir_exists: bool = Field(default=False)
    project_legacy_dir: str
    project_legacy_dir_exists: bool = Field(default=False)
    project_legacy_references_dir: str
    project_legacy_references_exists: bool = Field(default=False)
    project_legacy_reference_files: int = Field(default=0, ge=0)


class RuntimeProfileResponse(BaseModel):
    runtime_name: str = Field(default="codex")
    workspace: WorkspaceContext
    pointer: RuntimePointerState
    legacy: RuntimeLegacyState
    migration_preview: RuntimeMigrationPreview


class RuntimeMigrateRequest(BaseModel):
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    dry_run: bool = Field(default=True)


class RuntimeMigrateResponse(BaseModel):
    moved: list[RuntimeMigrateMovedItem] = Field(default_factory=list)
    removed: list[RuntimeMigrateRemovedItem] = Field(default_factory=list)
    skipped: list[RuntimeMigrateSkippedItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    created_at: str
    dry_run: bool
    project_root: str
    report_path: str
