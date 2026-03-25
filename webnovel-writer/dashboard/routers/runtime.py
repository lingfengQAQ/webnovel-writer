"""
Runtime router skeleton.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..models.common import ApiErrorResponse
from ..models.runtime import (
    RuntimeMigrateRequest,
    RuntimeMigrateResponse,
    RuntimeProfileQuery,
    RuntimeProfileResponse,
)
from ..services.runtime import RuntimeServiceError, get_runtime_profile as get_runtime_profile_service
from ..services.runtime import migrate_runtime as migrate_runtime_service

WRITE_ERROR_RESPONSES = {
    400: {"model": ApiErrorResponse, "description": "Bad request placeholder response."},
    403: {"model": ApiErrorResponse, "description": "Workspace access denied placeholder response."},
    404: {"model": ApiErrorResponse, "description": "Resource not found placeholder response."},
    409: {"model": ApiErrorResponse, "description": "Conflict placeholder response."},
    501: {"model": ApiErrorResponse, "description": "Runtime capability not implemented."},
    500: {"model": ApiErrorResponse, "description": "Internal error placeholder response."},
}

router = APIRouter(prefix="/api/runtime", tags=["runtime"])


@router.get("/profile", response_model=RuntimeProfileResponse, responses=WRITE_ERROR_RESPONSES)
def get_runtime_profile(query: RuntimeProfileQuery = Depends()):
    try:
        profile = get_runtime_profile_service(
            workspace_id=query.workspace_id,
            project_root=query.project_root,
        )
        return RuntimeProfileResponse.model_validate(profile)
    except RuntimeServiceError as exc:
        return _error_response(exc)


@router.post("/migrate", response_model=RuntimeMigrateResponse, responses=WRITE_ERROR_RESPONSES)
def migrate_runtime(request: RuntimeMigrateRequest):
    try:
        report = migrate_runtime_service(
            workspace_id=request.workspace.workspace_id,
            project_root=request.workspace.project_root,
            dry_run=request.dry_run,
        )
        return RuntimeMigrateResponse.model_validate(report)
    except RuntimeServiceError as exc:
        return _error_response(exc)


def _error_response(error: RuntimeServiceError) -> JSONResponse:
    payload = ApiErrorResponse(
        error_code=error.error_code,
        message=error.message,
        details=error.details,
        request_id=None,
    )
    return JSONResponse(status_code=error.status_code, content=payload.model_dump())
