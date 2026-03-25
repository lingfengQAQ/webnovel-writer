"""
Outlines router skeleton.
"""

from fastapi import APIRouter, Depends, HTTPException

from ..models.common import ApiErrorResponse
from ..models.outlines import (
    OutlineBundleQuery,
    OutlineBundleResponse,
    OutlineOrderValidateRequest,
    OutlineOrderValidateResponse,
    OutlineResplitApplyRequest,
    OutlineResplitApplyResponse,
    OutlineResplitPreviewRequest,
    OutlineResplitPreviewResponse,
    OutlineSplitApplyRequest,
    OutlineSplitApplyResponse,
    OutlineSplitHistoryQuery,
    OutlineSplitHistoryResponse,
    OutlineSplitPreviewRequest,
    OutlineSplitPreviewResponse,
)
from ..services.split import SplitService, SplitServiceError
from ..services.split.resplit import ResplitService

WRITE_ERROR_RESPONSES = {
    400: {"model": ApiErrorResponse, "description": "Bad request placeholder response."},
    403: {"model": ApiErrorResponse, "description": "Workspace access denied placeholder response."},
    404: {"model": ApiErrorResponse, "description": "Resource not found placeholder response."},
    409: {"model": ApiErrorResponse, "description": "Conflict placeholder response."},
    500: {"model": ApiErrorResponse, "description": "Internal error placeholder response."},
}

router = APIRouter(prefix="/api/outlines", tags=["outlines"])
split_service = SplitService()
resplit_service = ResplitService()


def _raise_service_error(exc: SplitServiceError) -> None:
    raise HTTPException(
        status_code=exc.status_code,
        detail=ApiErrorResponse(
            error_code=exc.error_code,
            message=exc.message,
            details=exc.details,
            request_id=None,
        ).model_dump(),
    )


@router.get("", response_model=OutlineBundleResponse, responses=WRITE_ERROR_RESPONSES)
def get_outlines(query: OutlineBundleQuery = Depends()):
    try:
        return split_service.get_outline_bundle(query)
    except SplitServiceError as exc:
        _raise_service_error(exc)


@router.post("/split/preview", response_model=OutlineSplitPreviewResponse, responses=WRITE_ERROR_RESPONSES)
def preview_split(request: OutlineSplitPreviewRequest):
    try:
        return split_service.preview_split(request)
    except SplitServiceError as exc:
        _raise_service_error(exc)


@router.post("/split/apply", response_model=OutlineSplitApplyResponse, responses=WRITE_ERROR_RESPONSES)
def apply_split(request: OutlineSplitApplyRequest):
    try:
        return split_service.apply_split(request)
    except SplitServiceError as exc:
        _raise_service_error(exc)


@router.get("/splits", response_model=OutlineSplitHistoryResponse, responses=WRITE_ERROR_RESPONSES)
def list_splits(query: OutlineSplitHistoryQuery = Depends()):
    try:
        return split_service.list_splits(query)
    except SplitServiceError as exc:
        _raise_service_error(exc)


@router.post("/resplit/preview", response_model=OutlineResplitPreviewResponse, responses=WRITE_ERROR_RESPONSES)
def preview_resplit(request: OutlineResplitPreviewRequest):
    try:
        return resplit_service.preview_resplit(request)
    except SplitServiceError as exc:
        _raise_service_error(exc)


@router.post("/resplit/apply", response_model=OutlineResplitApplyResponse, responses=WRITE_ERROR_RESPONSES)
def apply_resplit(request: OutlineResplitApplyRequest):
    try:
        return resplit_service.apply_resplit(request)
    except SplitServiceError as exc:
        _raise_service_error(exc)


@router.post("/order/validate", response_model=OutlineOrderValidateResponse, responses=WRITE_ERROR_RESPONSES)
def validate_outline_order(request: OutlineOrderValidateRequest):
    try:
        return resplit_service.validate_outline_order(request)
    except SplitServiceError as exc:
        _raise_service_error(exc)
