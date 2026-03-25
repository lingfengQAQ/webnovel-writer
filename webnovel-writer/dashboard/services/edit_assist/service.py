"""
Edit assist backend service.

Implements preview/apply/logs with two-stage confirmation, selection version
validation, and failure rollback logging.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any, Protocol
from uuid import uuid4

from filelock import FileLock, Timeout
from fastapi import HTTPException

from ...models.edit_assist import (
    EditAssistApplyProposal,
    EditAssistApplyRequest,
    EditAssistApplyResponse,
    EditAssistLogEntry,
    EditAssistLogListResponse,
    EditAssistLogQuery,
    EditAssistPreviewRequest,
    EditAssistPreviewResponse,
    EditAssistProposal,
)
from ...path_guard import safe_resolve

EDITS_RELATIVE_PATH = Path(".webnovel") / "edits"
ASSIST_LOG_FILENAME = "assist-log.jsonl"
PROPOSAL_STORE_FILENAME = "assist-proposals.json"
WRITE_LOCK_FILENAME = "assist.lock"
DEFAULT_WORKSPACE_ID = "workspace-default"
PROPOSAL_SCHEMA_VERSION = 1


@dataclass(slots=True)
class EditAssistServiceError(Exception):
    status_code: int
    error_code: str
    message: str
    details: dict[str, Any] | None = None

    def __str__(self) -> str:
        return self.message


@dataclass(slots=True, frozen=True)
class EditAssistPaths:
    edits_dir: Path
    log_path: Path
    proposal_store_path: Path
    lock_path: Path


@dataclass(slots=True, frozen=True)
class EditAssistProviderResult:
    output_text: str
    provider: str
    model: str = ""


class EditAssistProvider(Protocol):
    provider_name: str
    model_name: str

    def ensure_available(self) -> None: ...

    def rewrite(
        self,
        *,
        project_root: Path,
        file_path: str,
        selection_start: int,
        selection_end: int,
        selection_text: str,
        prompt: str,
    ) -> EditAssistProviderResult: ...


class UnavailableEditAssistProvider:
    provider_name = "unavailable"
    model_name = ""

    def ensure_available(self) -> None:
        raise EditAssistServiceError(
            status_code=501,
            error_code="EDIT_ASSIST_UNAVAILABLE",
            message="edit assist provider is unavailable",
        )

    def rewrite(
        self,
        *,
        project_root: Path,
        file_path: str,
        selection_start: int,
        selection_end: int,
        selection_text: str,
        prompt: str,
    ) -> EditAssistProviderResult:
        self.ensure_available()
        return EditAssistProviderResult(
            output_text=selection_text,
            provider=self.provider_name,
            model=self.model_name,
        )


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _workspace_id_for_root(root: Path) -> str:
    digest = hashlib.sha1(str(root).encode("utf-8")).hexdigest()[:12]
    return f"ws-{digest}"


def _elapsed_ms(started_at: float) -> int:
    return max(0, int((perf_counter() - started_at) * 1000))


def _coerce_non_negative_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if number < 0:
        return None
    return number


def _normalize_source_payload(source: Any) -> dict[str, str]:
    if not isinstance(source, dict):
        source = {}
    provider = str(source.get("provider", "")).strip()
    model = str(source.get("model", "")).strip()
    return {"provider": provider, "model": model}


def _source_payload_from_provider(
    provider: EditAssistProvider,
    provider_result: EditAssistProviderResult | None = None,
) -> dict[str, str]:
    provider_name = ""
    model_name = ""
    if provider_result is not None:
        provider_name = str(provider_result.provider or "").strip()
        model_name = str(provider_result.model or "").strip()
    if not provider_name:
        provider_name = str(getattr(provider, "provider_name", "") or "").strip()
    if not model_name:
        model_name = str(getattr(provider, "model_name", "") or "").strip()
    return {
        "provider": provider_name or "unknown",
        "model": model_name,
    }


def _resolve_workspace_root(workspace_id: str | None, project_root: str | None) -> Path:
    root_hint = (project_root or "").strip()
    if not root_hint:
        raise EditAssistServiceError(
            status_code=400,
            error_code="EDIT_ASSIST_PROJECT_ROOT_REQUIRED",
            message="workspace.project_root is required",
        )

    root = Path(root_hint).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise EditAssistServiceError(
            status_code=404,
            error_code="EDIT_ASSIST_PROJECT_ROOT_NOT_FOUND",
            message="workspace.project_root does not exist",
            details={"project_root": str(root)},
        )

    normalized_workspace_id = (workspace_id or DEFAULT_WORKSPACE_ID).strip() or DEFAULT_WORKSPACE_ID
    expected_workspace_id = _workspace_id_for_root(root)
    if normalized_workspace_id not in {DEFAULT_WORKSPACE_ID, expected_workspace_id}:
        raise EditAssistServiceError(
            status_code=403,
            error_code="EDIT_ASSIST_WORKSPACE_FORBIDDEN",
            message="workspace_id does not match project_root",
            details={
                "workspace_id": normalized_workspace_id,
                "expected_workspace_id": expected_workspace_id,
            },
        )
    return root


def _normalize_file_path(file_path: str) -> str:
    return str(file_path or "").replace("\\", "/")


def _resolve_target_file(project_root: Path, file_path: str) -> Path:
    normalized = _normalize_file_path(file_path).strip()
    if not normalized:
        raise EditAssistServiceError(
            status_code=400,
            error_code="EDIT_ASSIST_FILE_PATH_REQUIRED",
            message="file_path is required",
        )

    try:
        resolved = safe_resolve(project_root, normalized)
    except HTTPException as exc:
        raise EditAssistServiceError(
            status_code=403,
            error_code="EDIT_ASSIST_PATH_FORBIDDEN",
            message="file_path is outside project_root",
            details={"file_path": normalized, "detail": str(exc.detail)},
        ) from exc

    if not resolved.exists() or not resolved.is_file():
        raise EditAssistServiceError(
            status_code=404,
            error_code="EDIT_ASSIST_FILE_NOT_FOUND",
            message="target file does not exist",
            details={"file_path": normalized},
        )
    return resolved


def _paths_for_root(project_root: Path) -> EditAssistPaths:
    edits_dir = project_root / EDITS_RELATIVE_PATH
    edits_dir.mkdir(parents=True, exist_ok=True)
    return EditAssistPaths(
        edits_dir=edits_dir,
        log_path=edits_dir / ASSIST_LOG_FILENAME,
        proposal_store_path=edits_dir / PROPOSAL_STORE_FILENAME,
        lock_path=edits_dir / WRITE_LOCK_FILENAME,
    )


def _validate_selection_range(content: str, selection_start: int, selection_end: int) -> None:
    if selection_start < 0 or selection_end < 0:
        raise EditAssistServiceError(
            status_code=400,
            error_code="EDIT_ASSIST_INVALID_SELECTION_RANGE",
            message="selection offsets must be non-negative",
            details={"selection_start": selection_start, "selection_end": selection_end},
        )
    if selection_end <= selection_start:
        raise EditAssistServiceError(
            status_code=400,
            error_code="EDIT_ASSIST_INVALID_SELECTION_RANGE",
            message="selection_end must be greater than selection_start",
            details={"selection_start": selection_start, "selection_end": selection_end},
        )
    if selection_end > len(content):
        raise EditAssistServiceError(
            status_code=400,
            error_code="EDIT_ASSIST_SELECTION_OUT_OF_RANGE",
            message="selection range exceeds file length",
            details={"selection_end": selection_end, "file_length": len(content)},
        )


def _extract_selection_text(
    content: str,
    selection_start: int,
    selection_end: int,
    requested_selection_text: str | None,
) -> str:
    _validate_selection_range(content, selection_start, selection_end)
    selected_text = content[selection_start:selection_end]
    if requested_selection_text is not None and requested_selection_text != "" and requested_selection_text != selected_text:
        raise EditAssistServiceError(
            status_code=409,
            error_code="EDIT_ASSIST_SELECTION_TEXT_MISMATCH",
            message="selection_text does not match current file content",
            details={
                "selection_start": selection_start,
                "selection_end": selection_end,
            },
        )
    return selected_text


def _selection_version(file_path: str, selection_start: int, selection_end: int, text: str) -> str:
    payload = json.dumps(
        {
            "file_path": _normalize_file_path(file_path),
            "selection_start": selection_start,
            "selection_end": selection_end,
            "text": text,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=path.parent,
            delete=False,
            prefix=f".{path.name}.",
            suffix=".tmp",
        ) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            temp_path = Path(handle.name)

        if temp_path is None:
            raise OSError("temp file was not created")
        os.replace(temp_path, path)
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink(missing_ok=True)


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    _atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        raise EditAssistServiceError(
            status_code=500,
            error_code="EDIT_ASSIST_FILE_READ_FAILED",
            message="failed to read target file",
            details={"path": str(path), "error": str(exc)},
        ) from exc


def _empty_proposal_store() -> dict[str, Any]:
    return {
        "version": 1,
        "updated_at": "",
        "items": {},
    }


def _load_proposal_store(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return _empty_proposal_store()

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise EditAssistServiceError(
            status_code=500,
            error_code="EDIT_ASSIST_PROPOSAL_STORE_CORRUPT",
            message="failed to load proposal store",
            details={"path": str(path)},
        ) from exc

    if not isinstance(raw, dict):
        raise EditAssistServiceError(
            status_code=500,
            error_code="EDIT_ASSIST_PROPOSAL_STORE_INVALID",
            message="proposal store format is invalid",
            details={"path": str(path)},
        )

    store = _empty_proposal_store()
    try:
        store["version"] = int(raw.get("version", 1))
    except (TypeError, ValueError):
        store["version"] = 1
    store["updated_at"] = str(raw.get("updated_at", ""))
    items = raw.get("items", {})
    store["items"] = items if isinstance(items, dict) else {}
    return store


def _read_log_entries(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []

    entries: list[dict[str, Any]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        try:
            model = EditAssistLogEntry.model_validate(payload)
        except Exception:
            continue
        entry = model.model_dump()
        for key, value in payload.items():
            if key not in entry:
                entry[key] = value
        entries.append(entry)
    return entries


def _build_log_entry(
    *,
    file_path: str,
    selection_start: int,
    selection_end: int,
    prompt: str,
    preview: str,
    applied: bool,
    proposal_id: str,
    created_at: str,
    provider: str | None = None,
    model: str | None = None,
    provider_latency_ms: int | None = None,
    apply_latency_ms: int | None = None,
    error_code: str | None = None,
    failure_reason: str | None = None,
    expected_version: str | None = None,
    selection_version: str | None = None,
    current_version: str | None = None,
    rollback_performed: bool | None = None,
    rollback_error: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": f"assist-{uuid4().hex[:12]}",
        "file_path": _normalize_file_path(file_path),
        "selection_start": selection_start,
        "selection_end": selection_end,
        "prompt": prompt,
        "preview": preview,
        "applied": applied,
        "created_at": created_at,
        "proposal_id": proposal_id,
    }
    if provider is not None:
        payload["provider"] = provider
    if model is not None:
        payload["model"] = model
    if provider_latency_ms is not None:
        payload["provider_latency_ms"] = provider_latency_ms
    if apply_latency_ms is not None:
        payload["apply_latency_ms"] = apply_latency_ms
    if error_code:
        payload["error_code"] = error_code
    if failure_reason:
        payload["failure_reason"] = failure_reason
    if expected_version:
        payload["expected_version"] = expected_version
    if selection_version:
        payload["selection_version"] = selection_version
    if current_version:
        payload["current_version"] = current_version
    if rollback_performed is not None:
        payload["rollback_performed"] = rollback_performed
    if rollback_error:
        payload["rollback_error"] = rollback_error
    return payload


def _assert_apply_matches_proposal(request: EditAssistApplyRequest, proposal: dict[str, Any]) -> None:
    expected_file_path = _normalize_file_path(str(proposal.get("file_path", "")))
    if _normalize_file_path(request.file_path) != expected_file_path:
        raise EditAssistServiceError(
            status_code=409,
            error_code="EDIT_ASSIST_PROPOSAL_MISMATCH",
            message="apply request does not match preview proposal file_path",
            details={"proposal_file_path": expected_file_path, "request_file_path": request.file_path},
        )

    expected_start = int(proposal.get("selection_start", -1))
    expected_end = int(proposal.get("selection_end", -1))
    if request.selection_start != expected_start or request.selection_end != expected_end:
        raise EditAssistServiceError(
            status_code=409,
            error_code="EDIT_ASSIST_PROPOSAL_MISMATCH",
            message="apply request does not match preview proposal selection",
            details={
                "proposal_selection_start": expected_start,
                "proposal_selection_end": expected_end,
                "request_selection_start": request.selection_start,
                "request_selection_end": request.selection_end,
            },
        )

    proposal_workspace = str(proposal.get("workspace_id", DEFAULT_WORKSPACE_ID)).strip() or DEFAULT_WORKSPACE_ID
    request_workspace = (request.workspace.workspace_id or DEFAULT_WORKSPACE_ID).strip() or DEFAULT_WORKSPACE_ID
    if proposal_workspace != request_workspace:
        raise EditAssistServiceError(
            status_code=403,
            error_code="EDIT_ASSIST_WORKSPACE_FORBIDDEN",
            message="proposal workspace_id does not match apply request workspace_id",
            details={
                "proposal_workspace_id": proposal_workspace,
                "request_workspace_id": request_workspace,
            },
        )


def _assert_structured_proposal_matches(request_proposal: EditAssistApplyProposal, stored_proposal: dict[str, Any]) -> None:
    stored_schema_version = int(stored_proposal.get("version", PROPOSAL_SCHEMA_VERSION))
    if request_proposal.version != stored_schema_version:
        raise EditAssistServiceError(
            status_code=409,
            error_code="EDIT_ASSIST_PROPOSAL_VERSION_MISMATCH",
            message="apply proposal version does not match preview proposal version",
            details={
                "request_proposal_version": request_proposal.version,
                "stored_proposal_version": stored_schema_version,
            },
        )

    stored_selection_version = str(stored_proposal.get("selection_version", "")).strip()
    if not stored_selection_version:
        raise EditAssistServiceError(
            status_code=500,
            error_code="EDIT_ASSIST_PROPOSAL_INVALID",
            message="proposal is missing selection version",
            details={"proposal_id": request_proposal.id},
        )
    if request_proposal.selection_version != stored_selection_version:
        raise EditAssistServiceError(
            status_code=409,
            error_code="EDIT_ASSIST_PROPOSAL_VERSION_MISMATCH",
            message="apply proposal selection_version does not match preview proposal",
            details={
                "request_selection_version": request_proposal.selection_version,
                "stored_selection_version": stored_selection_version,
            },
        )

    request_source = _normalize_source_payload(request_proposal.source.model_dump())
    stored_source = _normalize_source_payload(stored_proposal.get("source", {}))
    if request_source != stored_source:
        raise EditAssistServiceError(
            status_code=409,
            error_code="EDIT_ASSIST_PROPOSAL_SOURCE_MISMATCH",
            message="apply proposal source does not match preview proposal source",
            details={
                "request_source": request_source,
                "stored_source": stored_source,
            },
        )


class EditAssistService:
    def __init__(self, provider: EditAssistProvider | None = None):
        self._provider: EditAssistProvider = provider or UnavailableEditAssistProvider()

    def _ensure_provider_available(self) -> None:
        check = getattr(self._provider, "ensure_available", None)
        if not callable(check):
            raise EditAssistServiceError(
                status_code=501,
                error_code="EDIT_ASSIST_UNAVAILABLE",
                message="edit assist provider is unavailable",
                details={"reason": "provider_missing_healthcheck"},
            )
        try:
            check()
        except EditAssistServiceError:
            raise
        except Exception as exc:
            raise EditAssistServiceError(
                status_code=501,
                error_code="EDIT_ASSIST_UNAVAILABLE",
                message="edit assist provider is unavailable",
                details={"error": f"{type(exc).__name__}: {exc}"},
            ) from exc

    def preview(self, request: EditAssistPreviewRequest) -> EditAssistPreviewResponse:
        self._ensure_provider_available()
        project_root = _resolve_workspace_root(request.workspace.workspace_id, request.workspace.project_root)
        target_path = _resolve_target_file(project_root, request.file_path)
        content = _read_text(target_path)
        before_text = _extract_selection_text(
            content,
            request.selection_start,
            request.selection_end,
            request.selection_text,
        )

        provider_started = perf_counter()
        try:
            provider_result = self._provider.rewrite(
                project_root=project_root,
                file_path=_normalize_file_path(request.file_path),
                selection_start=request.selection_start,
                selection_end=request.selection_end,
                selection_text=before_text,
                prompt=request.prompt,
            )
        except EditAssistServiceError:
            raise
        except Exception as exc:
            raise EditAssistServiceError(
                status_code=500,
                error_code="EDIT_ASSIST_PROVIDER_FAILED",
                message="edit assist provider invocation failed",
                details={"error": f"{type(exc).__name__}: {exc}"},
            ) from exc
        provider_latency_ms = _elapsed_ms(provider_started)

        if not isinstance(provider_result, EditAssistProviderResult):
            raise EditAssistServiceError(
                status_code=500,
                error_code="EDIT_ASSIST_PROVIDER_INVALID_RESPONSE",
                message="edit assist provider returned invalid payload",
            )
        if not isinstance(provider_result.output_text, str):
            raise EditAssistServiceError(
                status_code=500,
                error_code="EDIT_ASSIST_PROVIDER_INVALID_RESPONSE",
                message="edit assist provider returned non-string output",
            )

        preview_text = provider_result.output_text
        source_payload = _source_payload_from_provider(self._provider, provider_result)
        created_at = _utc_now()
        proposal_id = f"proposal-{uuid4().hex[:12]}"
        selection_version = _selection_version(
            request.file_path,
            request.selection_start,
            request.selection_end,
            before_text,
        )

        proposal_payload = {
            "id": proposal_id,
            "version": PROPOSAL_SCHEMA_VERSION,
            "workspace_id": (request.workspace.workspace_id or DEFAULT_WORKSPACE_ID).strip() or DEFAULT_WORKSPACE_ID,
            "file_path": _normalize_file_path(request.file_path),
            "selection_start": request.selection_start,
            "selection_end": request.selection_end,
            "selection_version": selection_version,
            "source": source_payload,
            "provider_latency_ms": provider_latency_ms,
            "prompt": request.prompt,
            "before_text": before_text,
            "preview": preview_text,
            "after_text": preview_text,
            "created_at": created_at,
        }

        paths = _paths_for_root(project_root)
        try:
            with FileLock(str(paths.lock_path), timeout=10):
                store = _load_proposal_store(paths.proposal_store_path)
                items = store.get("items", {})
                if not isinstance(items, dict):
                    items = {}
                items[proposal_id] = proposal_payload
                store["items"] = items
                store["updated_at"] = created_at
                _atomic_write_json(paths.proposal_store_path, store)
        except Timeout as exc:
            raise EditAssistServiceError(
                status_code=409,
                error_code="EDIT_ASSIST_LOCK_TIMEOUT",
                message="edit assist is locked by another operation",
            ) from exc
        except OSError as exc:
            raise EditAssistServiceError(
                status_code=500,
                error_code="EDIT_ASSIST_PREVIEW_PERSIST_FAILED",
                message="failed to persist preview proposal",
                details={"error": str(exc)},
            ) from exc

        return EditAssistPreviewResponse(
            status="ok",
            proposal=EditAssistProposal(
                id=proposal_id,
                version=PROPOSAL_SCHEMA_VERSION,
                selection_version=selection_version,
                source=source_payload,
                prompt=request.prompt,
                preview=preview_text,
                before_text=before_text,
                after_text=preview_text,
                provider_latency_ms=provider_latency_ms,
            ),
        )

    def apply(self, request: EditAssistApplyRequest) -> EditAssistApplyResponse:
        self._ensure_provider_available()
        apply_started = perf_counter()

        proposal_id = (request.proposal.id or "").strip()
        if not proposal_id:
            raise EditAssistServiceError(
                status_code=400,
                error_code="EDIT_ASSIST_PROPOSAL_ID_REQUIRED",
                message="proposal.id is required",
            )

        project_root = _resolve_workspace_root(request.workspace.workspace_id, request.workspace.project_root)
        target_path = _resolve_target_file(project_root, request.file_path)
        paths = _paths_for_root(project_root)

        try:
            with FileLock(str(paths.lock_path), timeout=10):
                store = _load_proposal_store(paths.proposal_store_path)
                items = store.get("items", {})
                if not isinstance(items, dict):
                    items = {}

                raw_proposal = items.get(proposal_id)
                if not isinstance(raw_proposal, dict):
                    raise EditAssistServiceError(
                        status_code=404,
                        error_code="EDIT_ASSIST_PROPOSAL_NOT_FOUND",
                        message="preview proposal not found",
                        details={"proposal_id": proposal_id},
                    )

                _assert_apply_matches_proposal(request, raw_proposal)
                _assert_structured_proposal_matches(request.proposal, raw_proposal)

                proposal_prompt = str(raw_proposal.get("prompt", ""))
                proposal_preview = str(raw_proposal.get("preview", ""))
                proposal_selection_version = str(raw_proposal.get("selection_version", "")).strip()
                proposal_source = _normalize_source_payload(raw_proposal.get("source", {}))
                provider_name = proposal_source.get("provider") or None
                model_name = proposal_source.get("model") or None
                provider_latency_ms = _coerce_non_negative_int(raw_proposal.get("provider_latency_ms"))

                active_source = _source_payload_from_provider(self._provider)
                if provider_name and provider_name != active_source["provider"]:
                    raise EditAssistServiceError(
                        status_code=409,
                        error_code="EDIT_ASSIST_PROPOSAL_SOURCE_MISMATCH",
                        message="proposal provider source does not match current provider",
                        details={
                            "proposal_source": proposal_source,
                            "active_source": active_source,
                        },
                    )

                if request.expected_version and request.expected_version.strip() and request.expected_version != proposal_selection_version:
                    failure_log = _build_log_entry(
                        file_path=request.file_path,
                        selection_start=request.selection_start,
                        selection_end=request.selection_end,
                        prompt=proposal_prompt,
                        preview=proposal_preview,
                        applied=False,
                        proposal_id=proposal_id,
                        created_at=_utc_now(),
                        provider=provider_name,
                        model=model_name,
                        provider_latency_ms=provider_latency_ms,
                        apply_latency_ms=_elapsed_ms(apply_started),
                        error_code="EDIT_ASSIST_EXPECTED_VERSION_MISMATCH",
                        failure_reason="expected_version_mismatch",
                        expected_version=request.expected_version,
                        selection_version=proposal_selection_version,
                        rollback_performed=False,
                    )
                    _append_jsonl(paths.log_path, failure_log)
                    raise EditAssistServiceError(
                        status_code=409,
                        error_code="EDIT_ASSIST_EXPECTED_VERSION_MISMATCH",
                        message="expected_version does not match preview selection version",
                    )

                original_content = _read_text(target_path)
                current_selection = _extract_selection_text(
                    original_content,
                    request.selection_start,
                    request.selection_end,
                    None,
                )
                current_version = _selection_version(
                    request.file_path,
                    request.selection_start,
                    request.selection_end,
                    current_selection,
                )
                if current_version != proposal_selection_version:
                    failure_log = _build_log_entry(
                        file_path=request.file_path,
                        selection_start=request.selection_start,
                        selection_end=request.selection_end,
                        prompt=proposal_prompt,
                        preview=proposal_preview,
                        applied=False,
                        proposal_id=proposal_id,
                        created_at=_utc_now(),
                        provider=provider_name,
                        model=model_name,
                        provider_latency_ms=provider_latency_ms,
                        apply_latency_ms=_elapsed_ms(apply_started),
                        error_code="EDIT_ASSIST_SELECTION_VERSION_CONFLICT",
                        failure_reason="selection_version_conflict",
                        expected_version=request.expected_version,
                        selection_version=proposal_selection_version,
                        current_version=current_version,
                        rollback_performed=False,
                    )
                    _append_jsonl(paths.log_path, failure_log)
                    raise EditAssistServiceError(
                        status_code=409,
                        error_code="EDIT_ASSIST_SELECTION_VERSION_CONFLICT",
                        message="selection has changed since preview",
                        details={"proposal_id": proposal_id},
                    )

                updated_content = (
                    original_content[: request.selection_start]
                    + proposal_preview
                    + original_content[request.selection_end :]
                )
                success_log = _build_log_entry(
                    file_path=request.file_path,
                    selection_start=request.selection_start,
                    selection_end=request.selection_end,
                    prompt=proposal_prompt,
                    preview=proposal_preview,
                    applied=True,
                    proposal_id=proposal_id,
                    created_at=_utc_now(),
                    provider=provider_name,
                    model=model_name,
                    provider_latency_ms=provider_latency_ms,
                    apply_latency_ms=_elapsed_ms(apply_started),
                    expected_version=request.expected_version,
                    selection_version=proposal_selection_version,
                    current_version=current_version,
                    rollback_performed=False,
                )

                try:
                    _atomic_write_text(target_path, updated_content)
                    _append_jsonl(paths.log_path, success_log)
                except OSError as exc:
                    rollback_performed = False
                    rollback_error: str | None = None
                    try:
                        persisted_content = target_path.read_text(encoding="utf-8")
                    except OSError:
                        persisted_content = None

                    if persisted_content is not None and persisted_content != original_content:
                        try:
                            _atomic_write_text(target_path, original_content)
                            rollback_performed = True
                        except OSError as rollback_exc:
                            rollback_error = str(rollback_exc)

                    failure_log = _build_log_entry(
                        file_path=request.file_path,
                        selection_start=request.selection_start,
                        selection_end=request.selection_end,
                        prompt=proposal_prompt,
                        preview=proposal_preview,
                        applied=False,
                        proposal_id=proposal_id,
                        created_at=_utc_now(),
                        provider=provider_name,
                        model=model_name,
                        provider_latency_ms=provider_latency_ms,
                        apply_latency_ms=_elapsed_ms(apply_started),
                        error_code="EDIT_ASSIST_APPLY_WRITE_FAILED",
                        failure_reason="write_failed",
                        expected_version=request.expected_version,
                        selection_version=proposal_selection_version,
                        current_version=current_version,
                        rollback_performed=rollback_performed,
                        rollback_error=rollback_error,
                    )
                    try:
                        _append_jsonl(paths.log_path, failure_log)
                    except OSError:
                        pass

                    raise EditAssistServiceError(
                        status_code=500,
                        error_code="EDIT_ASSIST_APPLY_WRITE_FAILED",
                        message="failed to apply edit assist changes",
                        details={
                            "proposal_id": proposal_id,
                            "error": str(exc),
                            "rollback_performed": rollback_performed,
                            "rollback_error": rollback_error,
                        },
                    ) from exc

                items.pop(proposal_id, None)
                store["items"] = items
                store["updated_at"] = _utc_now()
                try:
                    _atomic_write_json(paths.proposal_store_path, store)
                except OSError:
                    # Proposal cleanup is best-effort; applied content and audit log are already persisted.
                    pass

                return EditAssistApplyResponse(
                    status="ok",
                    log_entry=EditAssistLogEntry.model_validate(success_log),
                )
        except Timeout as exc:
            raise EditAssistServiceError(
                status_code=409,
                error_code="EDIT_ASSIST_LOCK_TIMEOUT",
                message="edit assist is locked by another operation",
            ) from exc

    def list_logs(self, query: EditAssistLogQuery) -> EditAssistLogListResponse:
        project_root = _resolve_workspace_root(query.workspace_id, query.project_root)
        paths = _paths_for_root(project_root)
        entries = _read_log_entries(paths.log_path)

        if query.applied is not None:
            entries = [entry for entry in entries if bool(entry.get("applied")) is query.applied]

        total = len(entries)
        start = min(query.offset, total)
        end = min(start + query.limit, total)
        paged_entries = entries[start:end]

        return EditAssistLogListResponse(
            status="ok",
            items=[EditAssistLogEntry.model_validate(entry) for entry in paged_entries],
            total=total,
        )
