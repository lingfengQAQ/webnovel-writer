"""
Skills router skeleton.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ..models.common import ApiErrorResponse
from ..models.skills import (
    SkillAuditEntry,
    SkillAuditListResponse,
    SkillAuditQuery,
    SkillCreateRequest,
    SkillCreateResponse,
    SkillDeleteRequest,
    SkillDeleteResponse,
    SkillListQuery,
    SkillListResponse,
    SkillMeta,
    SkillToggleRequest,
    SkillToggleResponse,
    SkillUpdateRequest,
    SkillUpdateResponse,
)
from ..services.skills import (
    SkillServiceError,
    create_skill as create_skill_service,
    delete_skill as delete_skill_service,
    list_skill_audit as list_skill_audit_service,
    list_skills as list_skills_service,
    set_skill_enabled as set_skill_enabled_service,
    update_skill as update_skill_service,
)

WRITE_ERROR_RESPONSES = {
    400: {"model": ApiErrorResponse, "description": "Bad request placeholder response."},
    403: {"model": ApiErrorResponse, "description": "Workspace access denied placeholder response."},
    404: {"model": ApiErrorResponse, "description": "Resource not found placeholder response."},
    409: {"model": ApiErrorResponse, "description": "Conflict placeholder response."},
    500: {"model": ApiErrorResponse, "description": "Internal error placeholder response."},
}

router = APIRouter(prefix="/api/skills", tags=["skills"])


def _runtime_project_root(request: Request) -> Path:
    """P0-B 修复：从 app.state 读取 project_root，消除 sys.modules 反射脆弱实现。"""
    root = getattr(request.app.state, "project_root", None)
    if root is not None:
        return Path(root).resolve()

    raise SkillServiceError(
        status_code=500,
        error_code="runtime_project_root_unavailable",
        message="Runtime project root is unavailable.",
    )


def _error_response(error: SkillServiceError | Exception) -> JSONResponse:
    if isinstance(error, SkillServiceError):
        payload = ApiErrorResponse(
            error_code=error.error_code,
            message=error.message,
            details=error.details,
            request_id=None,
        )
        return JSONResponse(status_code=error.status_code, content=payload.model_dump())

    payload = ApiErrorResponse(
        error_code="skill_internal_error",
        message="Unexpected skill service error.",
        details={"error": str(error)},
        request_id=None,
    )
    return JSONResponse(status_code=500, content=payload.model_dump())


def _skill_meta_list(items: list[dict[str, Any]]) -> list[SkillMeta]:
    return [SkillMeta(**item) for item in items]


@router.get("", response_model=SkillListResponse, responses=WRITE_ERROR_RESPONSES)
def list_skills(request: Request, query: SkillListQuery = Depends()):
    try:
        runtime_root = _runtime_project_root(request)
        items, total = list_skills_service(
            runtime_project_root=runtime_root,
            workspace_id=query.workspace_id,
            workspace_project_root=query.project_root,
            enabled=query.enabled,
            limit=query.limit,
            offset=query.offset,
        )
    except Exception as exc:  # noqa: BLE001
        return _error_response(exc)

    return SkillListResponse(status="ok", items=_skill_meta_list(items), total=total)


@router.post("", response_model=SkillCreateResponse, responses=WRITE_ERROR_RESPONSES)
def create_skill(request_http: Request, request: SkillCreateRequest):
    try:
        runtime_root = _runtime_project_root(request_http)
        skill = create_skill_service(
            runtime_project_root=runtime_root,
            workspace_id=request.workspace.workspace_id,
            workspace_project_root=request.workspace.project_root,
            skill_id=request.id,
            name=request.name,
            description=request.description,
            enabled=request.enabled,
            actor="api",
        )
    except Exception as exc:  # noqa: BLE001
        return _error_response(exc)

    return SkillCreateResponse(status="ok", skill=SkillMeta(**skill))


@router.patch("/{skill_id}", response_model=SkillUpdateResponse, responses=WRITE_ERROR_RESPONSES)
def update_skill(request_http: Request, skill_id: str, request: SkillUpdateRequest):
    try:
        runtime_root = _runtime_project_root(request_http)
        skill = update_skill_service(
            runtime_project_root=runtime_root,
            workspace_id=request.workspace.workspace_id,
            workspace_project_root=request.workspace.project_root,
            skill_id=skill_id,
            name=request.name,
            description=request.description,
            enabled=request.enabled,
            actor="api",
        )
    except Exception as exc:  # noqa: BLE001
        return _error_response(exc)

    return SkillUpdateResponse(status="ok", skill=SkillMeta(**skill))


@router.post("/{skill_id}/enable", response_model=SkillToggleResponse, responses=WRITE_ERROR_RESPONSES)
def enable_skill(request_http: Request, skill_id: str, request: SkillToggleRequest):
    try:
        runtime_root = _runtime_project_root(request_http)
        skill = set_skill_enabled_service(
            runtime_project_root=runtime_root,
            workspace_id=request.workspace.workspace_id,
            workspace_project_root=request.workspace.project_root,
            skill_id=skill_id,
            enabled=True,
            reason=request.reason,
            actor="api",
        )
    except Exception as exc:  # noqa: BLE001
        return _error_response(exc)

    return SkillToggleResponse(status="ok", skill_id=skill_id, enabled=bool(skill["enabled"]))


@router.post("/{skill_id}/disable", response_model=SkillToggleResponse, responses=WRITE_ERROR_RESPONSES)
def disable_skill(request_http: Request, skill_id: str, request: SkillToggleRequest):
    try:
        runtime_root = _runtime_project_root(request_http)
        skill = set_skill_enabled_service(
            runtime_project_root=runtime_root,
            workspace_id=request.workspace.workspace_id,
            workspace_project_root=request.workspace.project_root,
            skill_id=skill_id,
            enabled=False,
            reason=request.reason,
            actor="api",
        )
    except Exception as exc:  # noqa: BLE001
        return _error_response(exc)

    return SkillToggleResponse(status="ok", skill_id=skill_id, enabled=bool(skill["enabled"]))


@router.delete("/{skill_id}", response_model=SkillDeleteResponse, responses=WRITE_ERROR_RESPONSES)
def delete_skill(request_http: Request, skill_id: str, request: SkillDeleteRequest):
    try:
        runtime_root = _runtime_project_root(request_http)
        deleted = delete_skill_service(
            runtime_project_root=runtime_root,
            workspace_id=request.workspace.workspace_id,
            workspace_project_root=request.workspace.project_root,
            skill_id=skill_id,
            hard_delete=request.hard_delete,
            actor="api",
        )
    except Exception as exc:  # noqa: BLE001
        return _error_response(exc)

    return SkillDeleteResponse(status="ok", skill_id=skill_id, deleted=deleted)


@router.get("/audit", response_model=SkillAuditListResponse, responses=WRITE_ERROR_RESPONSES)
def list_skill_audit(request: Request, query: SkillAuditQuery = Depends()):
    try:
        runtime_root = _runtime_project_root(request)
        items, total = list_skill_audit_service(
            runtime_project_root=runtime_root,
            workspace_id=query.workspace_id,
            workspace_project_root=query.project_root,
            action=query.action,
            actor=query.actor,
            start_time=query.start_time,
            end_time=query.end_time,
            limit=query.limit,
            offset=query.offset,
        )
    except Exception as exc:  # noqa: BLE001
        return _error_response(exc)

    return SkillAuditListResponse(
        status="ok",
        items=[SkillAuditEntry(**item) for item in items],
        total=total,
    )
