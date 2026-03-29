"""
Runtime router - M1 阶段：仅保留只读查询接口。

写接口（迁移相关）已全部删除，由 CLI 统一入口 `webnovel codex` 承载。
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..models.common import ApiErrorResponse
from ..models.runtime import (
    RuntimeProfileQuery,
    RuntimeProfileResponse,
)
from ..services.runtime import RuntimeServiceError
from ..services.runtime import get_runtime_profile as get_runtime_profile_service

READ_ERROR_RESPONSES = {
    404: {"model": ApiErrorResponse, "description": "Resource not found."},
    500: {"model": ApiErrorResponse, "description": "Internal server error."},
}

router = APIRouter(prefix="/api/runtime", tags=["runtime"])

_DEPENDS_QUERY = Depends()


@router.get("/profile", response_model=RuntimeProfileResponse, responses=READ_ERROR_RESPONSES)
def get_runtime_profile(query: RuntimeProfileQuery = _DEPENDS_QUERY):
    """获取运行时配置信息（只读）。"""
    try:
        profile = get_runtime_profile_service(
            workspace_id=query.workspace_id,
            project_root=query.project_root,
        )
        return RuntimeProfileResponse.model_validate(profile)
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
