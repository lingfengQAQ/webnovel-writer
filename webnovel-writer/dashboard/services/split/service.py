"""
Outline split backend service.

Implements split preview/apply/history with anchor mapping and atomic persistence.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from filelock import FileLock, Timeout

from ...models.outlines import (
    OutlineAnchor,
    OutlineBundleQuery,
    OutlineBundleResponse,
    OutlineSegment,
    OutlineSplitApplyRequest,
    OutlineSplitApplyResponse,
    OutlineSplitHistoryQuery,
    OutlineSplitHistoryResponse,
    OutlineSplitPreviewRequest,
    OutlineSplitPreviewResponse,
    OutlineSplitRecord,
)

TOTAL_OUTLINE_RELATIVE_PATH = Path("大纲") / "总纲.md"
DETAILED_OUTLINE_RELATIVE_PATH = Path("大纲") / "细纲.md"
OUTLINES_DATA_RELATIVE_PATH = Path(".webnovel") / "outlines"
SPLIT_MAP_FILENAME = "split-map.json"
DETAILED_SEGMENTS_FILENAME = "detailed-segments.jsonl"
WRITE_LOCK_FILENAME = "split.lock"


@dataclass(slots=True)
class SplitServiceError(Exception):
    status_code: int
    error_code: str
    message: str
    details: dict[str, Any] | None = None

    def __str__(self) -> str:
        return self.message


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _resolve_project_root(project_root: str) -> Path:
    if not project_root.strip():
        raise SplitServiceError(
            status_code=400,
            error_code="OUTLINE_PROJECT_ROOT_REQUIRED",
            message="workspace.project_root is required",
        )

    resolved = Path(project_root).expanduser().resolve()
    if not resolved.is_dir():
        raise SplitServiceError(
            status_code=404,
            error_code="OUTLINE_PROJECT_ROOT_NOT_FOUND",
            message="workspace.project_root does not exist",
            details={"project_root": str(resolved)},
        )
    return resolved


def _read_text(path: Path, default: str = "") -> str:
    if not path.is_file():
        return default
    return path.read_text(encoding="utf-8")


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
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
            tmp_path = Path(handle.name)

        if tmp_path is None:
            raise OSError("atomic temp file was not created")
        os.replace(tmp_path, path)
    finally:
        if tmp_path is not None and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    _atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def _load_split_map(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {
            "version": 1,
            "workspace_id": "",
            "updated_at": "",
            "records": [],
            "idempotency_keys": {},
            "history": [],
        }
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {
            "version": 1,
            "workspace_id": "",
            "updated_at": "",
            "records": [],
            "idempotency_keys": {},
            "history": [],
        }

    if not isinstance(payload, dict):
        return {
            "version": 1,
            "workspace_id": "",
            "updated_at": "",
            "records": [],
            "idempotency_keys": {},
            "history": [],
        }
    payload.setdefault("version", 1)
    payload.setdefault("workspace_id", "")
    payload.setdefault("updated_at", "")
    payload.setdefault("records", [])
    payload.setdefault("idempotency_keys", {})
    payload.setdefault("history", [])
    return payload


def _load_detailed_segments(path: Path) -> list[dict[str, Any]]:
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
        if isinstance(payload, dict):
            entries.append(payload)
    return entries


def _next_order_index(entries: list[dict[str, Any]]) -> int:
    if not entries:
        return 0
    return max(int(item.get("order_index", 0)) for item in entries) + 1


def _normalize_line(line: str) -> str:
    # Strip list markers to keep generated content plain and scene-oriented.
    cleaned = re.sub(r"^\s*(?:[-*+]|[0-9]+[.)、])\s*", "", line)
    return cleaned.strip()


def _normalize_paragraphs(content: str) -> list[str]:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    chunks = re.split(r"\n\s*\n", normalized)

    paragraphs: list[str] = []
    for chunk in chunks:
        lines = [_normalize_line(line) for line in chunk.split("\n")]
        merged = " ".join(line for line in lines if line)
        merged = re.sub(r"\s+", " ", merged).strip()
        if merged:
            paragraphs.append(merged)

    if not paragraphs:
        raise SplitServiceError(
            status_code=400,
            error_code="OUTLINE_EMPTY_SELECTION",
            message="selection text is empty after normalization",
        )
    return paragraphs


def _paragraph_index_for_offset(total_outline: str, offset: int) -> int:
    if offset <= 0:
        return 0
    return len(re.findall(r"\n\s*\n", total_outline[:offset]))


def _validate_selection(total_outline: str, selection_start: int, selection_end: int) -> None:
    if selection_end <= selection_start:
        raise SplitServiceError(
            status_code=400,
            error_code="OUTLINE_INVALID_SELECTION_RANGE",
            message="selection_end must be greater than selection_start",
            details={"selection_start": selection_start, "selection_end": selection_end},
        )
    if selection_start < 0 or selection_end < 0:
        raise SplitServiceError(
            status_code=400,
            error_code="OUTLINE_INVALID_SELECTION_RANGE",
            message="selection offsets must be non-negative",
            details={"selection_start": selection_start, "selection_end": selection_end},
        )
    if selection_end > len(total_outline):
        raise SplitServiceError(
            status_code=400,
            error_code="OUTLINE_SELECTION_OUT_OF_RANGE",
            message="selection range exceeds total outline length",
            details={"outline_length": len(total_outline), "selection_end": selection_end},
        )


def _selection_text(
    total_outline: str,
    selection_start: int,
    selection_end: int,
    preferred_text: str | None,
) -> str:
    _validate_selection(total_outline, selection_start, selection_end)
    if preferred_text and preferred_text.strip():
        return preferred_text
    return total_outline[selection_start:selection_end]


def _build_anchors(
    selection_start: int,
    selection_end: int,
    paragraph_index_start: int,
    count: int,
) -> list[OutlineAnchor]:
    if count <= 0:
        return []

    anchors: list[OutlineAnchor] = []
    span = max(selection_end - selection_start, 1)
    for idx in range(count):
        anchor_start = selection_start + int(span * idx / count)
        anchor_end = selection_end if idx == count - 1 else selection_start + int(span * (idx + 1) / count)
        anchors.append(
            OutlineAnchor(
                source_start=anchor_start,
                source_end=max(anchor_start, anchor_end),
                paragraph_index=paragraph_index_start + idx,
            )
        )
    return anchors


def _build_segments(paragraphs: list[str], start_order_index: int) -> list[OutlineSegment]:
    segments: list[OutlineSegment] = []
    for idx, paragraph in enumerate(paragraphs):
        order_index = start_order_index + idx
        segments.append(
            OutlineSegment(
                id=f"seg-{uuid4().hex[:12]}",
                title=f"Scene {order_index + 1}",
                content=paragraph,
                order_index=order_index,
            )
        )
    return segments


def _record_to_model(payload: dict[str, Any]) -> OutlineSplitRecord:
    segments = [OutlineSegment.model_validate(item) for item in payload.get("segments", [])]
    anchors = [OutlineAnchor.model_validate(item) for item in payload.get("anchors", [])]
    return OutlineSplitRecord(
        id=str(payload.get("id", f"split-{uuid4().hex[:8]}")),
        source_start=int(payload.get("source_start", 0)),
        source_end=int(payload.get("source_end", 0)),
        created_at=str(payload.get("created_at", _utc_now())),
        segments=segments,
        anchors=anchors,
    )


def _records_from_split_map(payload: dict[str, Any]) -> list[OutlineSplitRecord]:
    records: list[OutlineSplitRecord] = []
    for raw in payload.get("records", []):
        if isinstance(raw, dict):
            records.append(_record_to_model(raw))
    return records


def _segments_to_jsonl_entries(
    segments: list[OutlineSegment],
    anchors: list[OutlineAnchor],
    split_id: str,
    created_at: str,
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for segment, anchor in zip(segments, anchors):
        entries.append(
            {
                "id": segment.id,
                "title": segment.title,
                "content": segment.content,
                "order_index": segment.order_index,
                "source_split_id": split_id,
                "source_anchor": anchor.model_dump(),
                "created_at": created_at,
            }
        )
    return entries


def _render_detailed_outline(entries: list[dict[str, Any]]) -> str:
    ordered = sorted(entries, key=lambda item: int(item.get("order_index", 0)))
    lines: list[str] = []
    for item in ordered:
        order_index = int(item.get("order_index", 0))
        title = str(item.get("title", f"Scene {order_index + 1}"))
        content = str(item.get("content", "")).strip()
        if not content:
            continue
        lines.append(f"### [{order_index:04d}] {title}")
        lines.append(content)
        lines.append("")
    if not lines:
        return ""
    return "\n".join(lines).rstrip() + "\n"


def _jsonl_dump(entries: list[dict[str, Any]]) -> str:
    return "".join(json.dumps(entry, ensure_ascii=False) + "\n" for entry in entries)


def _idempotency_token(
    workspace_id: str,
    selection_start: int,
    selection_end: int,
    selection_text: str,
    idempotency_key: str | None,
) -> str:
    if idempotency_key and idempotency_key.strip():
        return idempotency_key.strip()

    digest = hashlib.sha256(selection_text.encode("utf-8")).hexdigest()[:16]
    return f"auto:{workspace_id}:{selection_start}:{selection_end}:{digest}"


class SplitService:
    def get_outline_bundle(self, query: OutlineBundleQuery) -> OutlineBundleResponse:
        project_root = _resolve_project_root(query.project_root)
        split_map_path = project_root / OUTLINES_DATA_RELATIVE_PATH / SPLIT_MAP_FILENAME

        return OutlineBundleResponse(
            status="ok",
            total_outline=_read_text(project_root / TOTAL_OUTLINE_RELATIVE_PATH, ""),
            detailed_outline=_read_text(project_root / DETAILED_OUTLINE_RELATIVE_PATH, ""),
            splits=_records_from_split_map(_load_split_map(split_map_path)),
        )

    def preview_split(self, request: OutlineSplitPreviewRequest) -> OutlineSplitPreviewResponse:
        project_root = _resolve_project_root(request.workspace.project_root)
        total_outline_path = project_root / TOTAL_OUTLINE_RELATIVE_PATH
        if not total_outline_path.is_file():
            raise SplitServiceError(
                status_code=404,
                error_code="OUTLINE_TOTAL_FILE_NOT_FOUND",
                message="总纲文件不存在",
                details={"path": str(total_outline_path)},
            )

        total_outline = _read_text(total_outline_path, "")
        selected_text = _selection_text(
            total_outline=total_outline,
            selection_start=request.selection_start,
            selection_end=request.selection_end,
            preferred_text=request.selection_text,
        )
        paragraphs = _normalize_paragraphs(selected_text)

        detailed_segments_path = project_root / OUTLINES_DATA_RELATIVE_PATH / DETAILED_SEGMENTS_FILENAME
        start_order_index = _next_order_index(_load_detailed_segments(detailed_segments_path))
        segments = _build_segments(paragraphs, start_order_index)
        anchors = _build_anchors(
            selection_start=request.selection_start,
            selection_end=request.selection_end,
            paragraph_index_start=_paragraph_index_for_offset(total_outline, request.selection_start),
            count=len(segments),
        )
        return OutlineSplitPreviewResponse(status="ok", segments=segments, anchors=anchors)

    def apply_split(self, request: OutlineSplitApplyRequest) -> OutlineSplitApplyResponse:
        project_root = _resolve_project_root(request.workspace.project_root)
        outlines_data_dir = project_root / OUTLINES_DATA_RELATIVE_PATH
        outlines_data_dir.mkdir(parents=True, exist_ok=True)

        total_outline_path = project_root / TOTAL_OUTLINE_RELATIVE_PATH
        if not total_outline_path.is_file():
            raise SplitServiceError(
                status_code=404,
                error_code="OUTLINE_TOTAL_FILE_NOT_FOUND",
                message="总纲文件不存在",
                details={"path": str(total_outline_path)},
            )
        total_outline = _read_text(total_outline_path, "")
        selected_text = _selection_text(
            total_outline=total_outline,
            selection_start=request.selection_start,
            selection_end=request.selection_end,
            preferred_text=None,
        )

        lock_path = outlines_data_dir / WRITE_LOCK_FILENAME
        split_map_path = outlines_data_dir / SPLIT_MAP_FILENAME
        detailed_segments_path = outlines_data_dir / DETAILED_SEGMENTS_FILENAME
        detailed_outline_path = project_root / DETAILED_OUTLINE_RELATIVE_PATH

        try:
            with FileLock(str(lock_path), timeout=10):
                split_map = _load_split_map(split_map_path)
                detailed_segments = _load_detailed_segments(detailed_segments_path)
                idempotency_keys = split_map.get("idempotency_keys", {})
                if not isinstance(idempotency_keys, dict):
                    idempotency_keys = {}

                token = _idempotency_token(
                    workspace_id=request.workspace.workspace_id,
                    selection_start=request.selection_start,
                    selection_end=request.selection_end,
                    selection_text=selected_text,
                    idempotency_key=request.idempotency_key,
                )

                existing_split_id = idempotency_keys.get(token)
                if isinstance(existing_split_id, str):
                    for record in split_map.get("records", []):
                        if isinstance(record, dict) and record.get("id") == existing_split_id:
                            return OutlineSplitApplyResponse(status="ok", record=_record_to_model(record))

                paragraphs = _normalize_paragraphs(selected_text)
                start_order_index = _next_order_index(detailed_segments)
                segments = _build_segments(paragraphs, start_order_index)
                anchors = _build_anchors(
                    selection_start=request.selection_start,
                    selection_end=request.selection_end,
                    paragraph_index_start=_paragraph_index_for_offset(total_outline, request.selection_start),
                    count=len(segments),
                )

                split_id = f"split-{uuid4().hex[:12]}"
                created_at = _utc_now()
                record = OutlineSplitRecord(
                    id=split_id,
                    source_start=request.selection_start,
                    source_end=request.selection_end,
                    created_at=created_at,
                    segments=segments,
                    anchors=anchors,
                )

                record_payload = record.model_dump()
                record_payload["source_file"] = str(TOTAL_OUTLINE_RELATIVE_PATH).replace("\\", "/")
                record_payload["target_insert_index"] = start_order_index
                record_payload["target_segment_ids"] = [segment.id for segment in segments]

                split_map["workspace_id"] = request.workspace.workspace_id
                split_map["updated_at"] = created_at
                records = split_map.get("records", [])
                if not isinstance(records, list):
                    records = []
                records.append(record_payload)
                split_map["records"] = records

                idempotency_keys[token] = split_id
                split_map["idempotency_keys"] = idempotency_keys

                new_entries = _segments_to_jsonl_entries(segments, anchors, split_id, created_at)
                all_entries = detailed_segments + new_entries
                all_entries.sort(key=lambda item: int(item.get("order_index", 0)))

                _atomic_write_text(detailed_segments_path, _jsonl_dump(all_entries))
                _atomic_write_text(detailed_outline_path, _render_detailed_outline(all_entries))
                _atomic_write_json(split_map_path, split_map)

                return OutlineSplitApplyResponse(status="ok", record=record)
        except Timeout as exc:
            raise SplitServiceError(
                status_code=409,
                error_code="OUTLINE_SPLIT_LOCK_TIMEOUT",
                message="split apply is locked by another operation",
            ) from exc
        except OSError as exc:
            raise SplitServiceError(
                status_code=500,
                error_code="OUTLINE_SPLIT_WRITE_FAILED",
                message="failed to persist split results",
                details={"error": str(exc)},
            ) from exc

    def list_splits(self, query: OutlineSplitHistoryQuery) -> OutlineSplitHistoryResponse:
        project_root = _resolve_project_root(query.project_root)
        split_map_path = project_root / OUTLINES_DATA_RELATIVE_PATH / SPLIT_MAP_FILENAME
        records = _records_from_split_map(_load_split_map(split_map_path))

        total = len(records)
        start = min(query.offset, total)
        end = min(start + query.limit, total)
        return OutlineSplitHistoryResponse(status="ok", items=records[start:end], total=total)
