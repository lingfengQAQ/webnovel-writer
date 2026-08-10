from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProviderConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_url: str = "https://api.deepseek.com"
    fast_model: str = "deepseek-v4-flash"
    deep_model: str = "deepseek-v4-pro"
    timeout_seconds: int = Field(default=180, ge=10, le=900)
    api_key_present: bool = False


class SettingsUpdate(BaseModel):
    base_url: str = "https://api.deepseek.com"
    fast_model: str = "deepseek-v4-flash"
    deep_model: str = "deepseek-v4-pro"
    timeout_seconds: int = Field(default=180, ge=10, le=900)
    api_key: str | None = None


class WorkflowRequest(BaseModel):
    type: Literal["init", "plan", "write", "review", "revise"]
    project_root: str | None = None
    chapter: int | None = Field(default=None, ge=1)
    volume: int | None = Field(default=None, ge=1)
    instruction: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)


class WorkflowRun(BaseModel):
    id: str
    type: str
    project_root: str
    status: Literal["queued", "running", "awaiting_user", "failed", "cancelled", "completed"]
    stage: str = "queued"
    progress: int = Field(default=0, ge=0, le=100)
    request: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    error: str = ""
    created_at: str
    updated_at: str


class WorkflowAction(BaseModel):
    action: Literal["confirm", "cancel", "retry", "resume"]
    payload: dict[str, Any] = Field(default_factory=dict)


class DraftUpdate(BaseModel):
    content: str
    base_revision: int = Field(ge=0)


class DraftRevision(BaseModel):
    project_root: str
    chapter: int
    content: str
    revision: int
    sha256: str
    reviewed_sha256: str = ""
    review: dict[str, Any] = Field(default_factory=dict)
    updated_at: str


class FinalizeRequest(BaseModel):
    expected_revision: int = Field(ge=1)


class LLMUsage(BaseModel):
    workflow_id: str = ""
    project_root: str
    task: str
    model: str
    prefix_id: str
    prompt_cache_hit_tokens: int = 0
    prompt_cache_miss_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: int = 0
    estimated_cost_usd: float = 0.0
    is_warmup: bool = False
    created_at: str


class ReviewIssue(BaseModel):
    description: str
    severity: Literal["low", "medium", "high", "critical"] = "medium"
    category: str = "other"
    location: str = ""
    evidence: str = ""
    fix_hint: str = ""
    blocking: bool = False


class ReviewPayload(BaseModel):
    blocking_count: int = Field(ge=0)
    issues: list[ReviewIssue] = Field(default_factory=list)
    summary: str = ""

    @model_validator(mode="after")
    def blocking_count_matches(self):
        actual = sum(1 for issue in self.issues if issue.blocking)
        if self.blocking_count != actual:
            raise ValueError(f"blocking_count={self.blocking_count}, but issues contain {actual} blocker(s)")
        return self


class PlanPayload(BaseModel):
    volume: int = Field(ge=1)
    start_chapter: int = Field(ge=1)
    end_chapter: int = Field(ge=1)
    volume_outline_markdown: str
    chapter_queries: dict[str, str]


class ExtractionPayload(BaseModel):
    accepted_events: list[dict[str, Any]] = Field(default_factory=list)
    state_deltas: list[dict[str, Any]] = Field(default_factory=list)
    entity_deltas: list[dict[str, Any]] = Field(default_factory=list)
    entities_appeared: list[dict[str, Any]] = Field(default_factory=list)
    scenes: list[dict[str, Any]] = Field(default_factory=list)
    chapter_meta: dict[str, Any] = Field(default_factory=dict)
    dominant_strand: str = ""
    summary_text: str = ""


class CommitArtifactsPayload(BaseModel):
    planned_nodes: list[Any] = Field(default_factory=list)
    covered_nodes: list[Any] = Field(default_factory=list)
    missed_nodes: list[Any] = Field(default_factory=list)
    extra_nodes: list[Any] = Field(default_factory=list)
    pending_disambiguation: list[Any] = Field(default_factory=list)
    extraction: ExtractionPayload


class IdeaCandidate(BaseModel):
    title: str
    one_liner: str
    anti_trope: str = ""
    hard_constraints: list[str] = Field(default_factory=list)
    opening_hook: str = ""


class IdeaOptionsPayload(BaseModel):
    candidates: list[IdeaCandidate] = Field(min_length=2, max_length=3)
