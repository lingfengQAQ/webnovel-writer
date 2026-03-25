"""
Edit assist router.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..models.common import ApiErrorResponse
from ..models.edit_assist import (
    EditAssistApplyRequest,
    EditAssistApplyResponse,
    EditAssistLogListResponse,
    EditAssistLogQuery,
    EditAssistPreviewRequest,
    EditAssistPreviewResponse,
)
from ..services.edit_assist import EditAssistService, EditAssistServiceError

WRITE_ERROR_RESPONSES = {
    400: {"model": ApiErrorResponse, "description": "Bad request placeholder response."},
    403: {"model": ApiErrorResponse, "description": "Workspace access denied placeholder response."},
    404: {"model": ApiErrorResponse, "description": "Resource not found placeholder response."},
    409: {"model": ApiErrorResponse, "description": "Conflict placeholder response."},
    500: {"model": ApiErrorResponse, "description": "Internal error placeholder response."},
    501: {"model": ApiErrorResponse, "description": "Provider unavailable placeholder response."},
}

router = APIRouter(prefix="/api/edit-assist", tags=["edit-assist"])
edit_assist_service = EditAssistService()


@router.post("/preview", response_model=EditAssistPreviewResponse, responses=WRITE_ERROR_RESPONSES)
def preview_edit_assist(request: EditAssistPreviewRequest):
    try:
        return edit_assist_service.preview(request)
    except EditAssistServiceError as exc:
        return _error_response(exc)


@router.post("/apply", response_model=EditAssistApplyResponse, responses=WRITE_ERROR_RESPONSES)
def apply_edit_assist(request: EditAssistApplyRequest):
    try:
        return edit_assist_service.apply(request)
    except EditAssistServiceError as exc:
        return _error_response(exc)


@router.get("/logs", response_model=EditAssistLogListResponse, responses=WRITE_ERROR_RESPONSES)
def list_edit_assist_logs(query: EditAssistLogQuery = Depends()):
    try:
        return edit_assist_service.list_logs(query)
    except EditAssistServiceError as exc:
        return _error_response(exc)


def _error_response(error: EditAssistServiceError) -> JSONResponse:
    payload = ApiErrorResponse(
        error_code=error.error_code,
        message=error.message,
        details=error.details,
        request_id=None,
    )
    return JSONResponse(status_code=error.status_code, content=payload.model_dump())
