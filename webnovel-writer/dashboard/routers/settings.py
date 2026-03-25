"""
Settings router skeleton.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..models.common import ApiErrorResponse
from ..models.settings import (
    DictionaryConflictEntry,
    DictionaryConflictListQuery,
    DictionaryConflictListResponse,
    DictionaryConflictResolveRequest,
    DictionaryConflictResolveResponse,
    DictionaryEntry,
    DictionaryExtractRequest,
    DictionaryExtractResponse,
    DictionaryListQuery,
    DictionaryListResponse,
    SettingsFileNode,
    SettingsFileReadQuery,
    SettingsFileReadResponse,
    SettingsFileTreeQuery,
    SettingsFileTreeResponse,
)
from ..services.dictionary import (
    DictionaryServiceError,
    extract_dictionary as extract_dictionary_service,
    list_dictionary as list_dictionary_service,
    list_settings_tree as list_settings_tree_service,
    read_settings_file as read_settings_file_service,
    resolve_conflict as resolve_conflict_service,
)
from ..services.dictionary.service import list_dictionary_conflicts as list_dictionary_conflicts_service

WRITE_ERROR_RESPONSES = {
    400: {"model": ApiErrorResponse, "description": "Bad request placeholder response."},
    403: {"model": ApiErrorResponse, "description": "Workspace access denied placeholder response."},
    404: {"model": ApiErrorResponse, "description": "Resource not found placeholder response."},
    409: {"model": ApiErrorResponse, "description": "Conflict placeholder response."},
    500: {"model": ApiErrorResponse, "description": "Internal error placeholder response."},
}

files_router = APIRouter(prefix="/api/settings/files", tags=["settings"])
dictionary_router = APIRouter(prefix="/api/settings/dictionary", tags=["settings"])


@files_router.get("/tree", response_model=SettingsFileTreeResponse, responses=WRITE_ERROR_RESPONSES)
def get_settings_tree(query: SettingsFileTreeQuery = Depends()):
    try:
        nodes = list_settings_tree_service(workspace_id=query.workspace_id, project_root=query.project_root)
        return SettingsFileTreeResponse(
            status="ok",
            nodes=[SettingsFileNode.model_validate(node) for node in nodes],
        )
    except DictionaryServiceError as exc:
        return _error_response(exc)


@files_router.get("/read", response_model=SettingsFileReadResponse, responses=WRITE_ERROR_RESPONSES)
def read_settings_file(query: SettingsFileReadQuery = Depends()):
    try:
        content = read_settings_file_service(
            workspace_id=query.workspace_id,
            project_root=query.project_root,
            path=query.path,
        )
        return SettingsFileReadResponse(status="ok", path=query.path, content=content)
    except DictionaryServiceError as exc:
        return _error_response(exc)


@dictionary_router.post("/extract", response_model=DictionaryExtractResponse, responses=WRITE_ERROR_RESPONSES)
def extract_dictionary_route(request: DictionaryExtractRequest):
    try:
        extracted, conflicts = extract_dictionary_service(
            workspace_id=request.workspace.workspace_id,
            project_root=request.workspace.project_root,
            incremental=request.incremental,
        )
        return DictionaryExtractResponse(status="ok", extracted=extracted, conflicts=conflicts)
    except DictionaryServiceError as exc:
        return _error_response(exc)


@dictionary_router.get("", response_model=DictionaryListResponse, responses=WRITE_ERROR_RESPONSES)
def list_dictionary_route(query: DictionaryListQuery = Depends()):
    try:
        items, total = list_dictionary_service(
            workspace_id=query.workspace_id,
            project_root=query.project_root,
            term=query.term,
            entry_type=query.type,
            status=query.status,
            limit=query.limit,
            offset=query.offset,
        )
        return DictionaryListResponse(
            status="ok",
            items=[DictionaryEntry.model_validate(item) for item in items],
            total=total,
        )
    except DictionaryServiceError as exc:
        return _error_response(exc)


@dictionary_router.get("/conflicts", response_model=DictionaryConflictListResponse, responses=WRITE_ERROR_RESPONSES)
def list_dictionary_conflicts_route(query: DictionaryConflictListQuery = Depends()):
    try:
        items, total = list_dictionary_conflicts_service(
            workspace_id=query.workspace_id,
            project_root=query.project_root,
            term=query.term,
            entry_type=query.type,
            status=query.status,
            limit=query.limit,
            offset=query.offset,
        )
        return DictionaryConflictListResponse(
            status="ok",
            items=[DictionaryConflictEntry.model_validate(item) for item in items],
            total=total,
        )
    except DictionaryServiceError as exc:
        return _error_response(exc)


@dictionary_router.post(
    "/conflicts/{id}/resolve",
    response_model=DictionaryConflictResolveResponse,
    responses=WRITE_ERROR_RESPONSES,
)
def resolve_dictionary_conflict(id: str, request: DictionaryConflictResolveRequest):
    try:
        conflict = resolve_conflict_service(
            workspace_id=request.workspace.workspace_id,
            project_root=request.workspace.project_root,
            conflict_id=id,
            decision=request.decision,
            attrs=request.attrs,
        )
        return DictionaryConflictResolveResponse(
            status="ok",
            conflict=DictionaryConflictEntry.model_validate(conflict),
        )
    except DictionaryServiceError as exc:
        return _error_response(exc)


def _error_response(error: DictionaryServiceError) -> JSONResponse:
    payload = ApiErrorResponse(
        error_code=error.error_code,
        message=error.message,
        details=error.details,
        request_id=None,
    )
    return JSONResponse(status_code=error.status_code, content=payload.model_dump())
