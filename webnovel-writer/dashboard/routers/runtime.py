"""
Runtime router skeleton.
"""

from fastapi import APIRouter, Depends

from ..models.common import ApiErrorResponse, WorkspaceContext
from ..models.runtime import (
    RuntimeMigrateRequest,
    RuntimeMigrateResponse,
    RuntimeProfileQuery,
    RuntimeProfileResponse,
)

WRITE_ERROR_RESPONSES = {
    400: {"model": ApiErrorResponse, "description": "Bad request placeholder response."},
    403: {"model": ApiErrorResponse, "description": "Workspace access denied placeholder response."},
    404: {"model": ApiErrorResponse, "description": "Resource not found placeholder response."},
    409: {"model": ApiErrorResponse, "description": "Conflict placeholder response."},
    500: {"model": ApiErrorResponse, "description": "Internal error placeholder response."},
}

router = APIRouter(prefix="/api/runtime", tags=["runtime"])


@router.get("/profile", response_model=RuntimeProfileResponse, responses=WRITE_ERROR_RESPONSES)
def get_runtime_profile(query: RuntimeProfileQuery = Depends()):
    workspace = WorkspaceContext(workspace_id=query.workspace_id, project_root=query.project_root)
    return RuntimeProfileResponse(workspace=workspace)


@router.post("/migrate", response_model=RuntimeMigrateResponse, responses=WRITE_ERROR_RESPONSES)
def migrate_runtime(_: RuntimeMigrateRequest):
    return RuntimeMigrateResponse()
