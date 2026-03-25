"""
Outline resplit backend service.

Implements rollback preview/apply with smaller/larger selection strategies and
order validation before persistence.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from filelock import FileLock, Timeout

from ...models.outlines import (
    OutlineOrderValidateRequest,
    OutlineOrderValidateResponse,
    OutlineResplitApplyRequest,
    OutlineResplitApplyResponse,
    OutlineResplitPreviewRequest,
    OutlineResplitPreviewResponse,
    OutlineRollbackPlan,
    OutlineSegment,
    OutlineSplitRecord,
)
from .service import (
    DETAILED_OUTLINE_RELATIVE_PATH,
    DETAILED_SEGMENTS_FILENAME,
    OUTLINES_DATA_RELATIVE_PATH,
    SPLIT_MAP_FILENAME,
    TOTAL_OUTLINE_RELATIVE_PATH,
    WRITE_LOCK_FILENAME,
    SplitServiceError,
    _atomic_write_json,
    _atomic_write_text,
    _build_anchors,
    _build_segments,
    _idempotency_token,
    _jsonl_dump,
    _load_detailed_segments,
    _load_split_map,
    _normalize_paragraphs,
    _paragraph_index_for_offset,
    _read_text,
    _record_to_model,
    _render_detailed_outline,
    _resolve_project_root,
    _selection_text,
    _utc_now,
)

_ROLLBACK_STRATEGIES = {"smaller_selection", "larger_selection"}


@dataclass(slots=True)
class _OverlapState:
    records: list[OutlineSplitRecord]
    covered_start: int
    covered_end: int


def _raw_record_payloads(split_map: dict[str, Any]) -> list[dict[str, Any]]:
    records = split_map.get("records", [])
    if not isinstance(records, list):
        return []
    return [item for item in records if isinstance(item, dict)]


def _is_overlapping(source_start: int, source_end: int, selection_start: int, selection_end: int) -> bool:
    return source_start < selection_end and selection_start < source_end


def _find_overlap_state(
    records: list[OutlineSplitRecord],
    selection_start: int,
    selection_end: int,
) -> _OverlapState | None:
    overlapping = [
        record
        for record in records
        if _is_overlapping(record.source_start, record.source_end, selection_start, selection_end)
    ]
    if not overlapping:
        return None

    covered_start = min(record.source_start for record in overlapping)
    covered_end = max(record.source_end for record in overlapping)
    return _OverlapState(records=overlapping, covered_start=covered_start, covered_end=covered_end)


def _entry_order_index(entry: dict[str, Any]) -> int:
    value = entry.get("order_index", 0)
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _insert_order_index(overlap_records: list[OutlineSplitRecord], detailed_entries: list[dict[str, Any]]) -> int:
    indexes = [segment.order_index for record in overlap_records for segment in record.segments]
    if indexes:
        return min(indexes)

    split_ids = {record.id for record in overlap_records}
    detailed_indexes = [
        _entry_order_index(entry)
        for entry in detailed_entries
        if str(entry.get("source_split_id", "")) in split_ids
    ]
    if detailed_indexes:
        return min(detailed_indexes)

    if not detailed_entries:
        return 0
    return max(_entry_order_index(entry) for entry in detailed_entries) + 1


def _build_rollback_plan(
    selection_start: int,
    selection_end: int,
    overlap_state: _OverlapState,
) -> OutlineRollbackPlan:
    selection_inside_covered = (
        selection_start >= overlap_state.covered_start and selection_end <= overlap_state.covered_end
    )
    if selection_inside_covered:
        strategy = "smaller_selection"
        rollback_start = overlap_state.covered_start
        rollback_end = overlap_state.covered_end
        notes = "新选区更小，回退整段后重拆。"
    else:
        strategy = "larger_selection"
        rollback_start = min(selection_start, overlap_state.covered_start)
        rollback_end = max(selection_end, overlap_state.covered_end)
        notes = "新选区更大，回退覆盖片段并按更大区间重拆。"

    return OutlineRollbackPlan(
        rollback_strategy=strategy,
        rollback_start=rollback_start,
        rollback_end=rollback_end,
        notes=notes,
    )


def _validate_strategy(strategy: str) -> str:
    normalized = strategy.strip()
    if normalized in _ROLLBACK_STRATEGIES:
        return normalized
    return "smaller_selection"


def _validate_order_segments(segments: list[OutlineSegment]) -> list[str]:
    if not segments:
        return []

    conflicts: list[str] = []
    order_indexes = [int(segment.order_index) for segment in segments]
    sorted_indexes = sorted(order_indexes)

    if len(set(order_indexes)) != len(order_indexes):
        conflicts.append("order_index duplicated in segments")
    if order_indexes != sorted_indexes:
        conflicts.append("segments are not sorted by order_index")

    expected = list(range(sorted_indexes[0], sorted_indexes[0] + len(sorted_indexes)))
    if sorted_indexes != expected:
        conflicts.append("order_index is not contiguous")

    segment_ids = [segment.id for segment in segments]
    if len(set(segment_ids)) != len(segment_ids):
        conflicts.append("segment id duplicated")

    return conflicts


def _validate_entry_anchors(entries: list[dict[str, Any]]) -> list[str]:
    conflicts: list[str] = []
    for index, entry in enumerate(entries):
        if _entry_order_index(entry) != index:
            conflicts.append(f"order_index mismatch at position {index}")

        anchor = entry.get("source_anchor")
        if not isinstance(anchor, dict):
            conflicts.append(f"source_anchor missing for segment {entry.get('id', index)}")
            continue

        source_start = anchor.get("source_start")
        source_end = anchor.get("source_end")
        if not isinstance(source_start, int) or not isinstance(source_end, int):
            conflicts.append(f"source_anchor invalid for segment {entry.get('id', index)}")
            continue
        if source_start < 0 or source_end < source_start:
            conflicts.append(f"source_anchor range invalid for segment {entry.get('id', index)}")
    return conflicts


def _segments_from_entries(entries: list[dict[str, Any]]) -> list[OutlineSegment]:
    return [
        OutlineSegment(
            id=str(entry.get("id", f"segment-{idx}")),
            title=str(entry.get("title", f"Scene {idx + 1}")),
            content=str(entry.get("content", "")),
            order_index=idx,
        )
        for idx, entry in enumerate(entries)
    ]


def _build_entry(
    segment: OutlineSegment,
    split_id: str,
    created_at: str,
    source_anchor: dict[str, Any],
) -> dict[str, Any]:
    return {
        "id": segment.id,
        "title": segment.title,
        "content": segment.content,
        "order_index": segment.order_index,
        "source_split_id": split_id,
        "source_anchor": source_anchor,
        "created_at": created_at,
    }


class ResplitService:
    def preview_resplit(self, request: OutlineResplitPreviewRequest) -> OutlineResplitPreviewResponse:
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
        _selection_text(
            total_outline=total_outline,
            selection_start=request.selection_start,
            selection_end=request.selection_end,
            preferred_text=None,
        )

        split_map_path = project_root / OUTLINES_DATA_RELATIVE_PATH / SPLIT_MAP_FILENAME
        split_map = _load_split_map(split_map_path)
        records = [_record_to_model(payload) for payload in _raw_record_payloads(split_map)]
        overlap_state = _find_overlap_state(records, request.selection_start, request.selection_end)
        if overlap_state is None:
            raise SplitServiceError(
                status_code=409,
                error_code="OUTLINE_RESPLIT_NO_OVERLAP",
                message="当前选区未命中可回退的拆分记录",
            )

        rollback_plan = _build_rollback_plan(
            selection_start=request.selection_start,
            selection_end=request.selection_end,
            overlap_state=overlap_state,
        )
        selected_text = _selection_text(
            total_outline=total_outline,
            selection_start=rollback_plan.rollback_start,
            selection_end=rollback_plan.rollback_end,
            preferred_text=None,
        )
        paragraphs = _normalize_paragraphs(selected_text)

        detailed_segments_path = project_root / OUTLINES_DATA_RELATIVE_PATH / DETAILED_SEGMENTS_FILENAME
        detailed_segments = _load_detailed_segments(detailed_segments_path)
        start_order = _insert_order_index(overlap_state.records, detailed_segments)
        segments = _build_segments(paragraphs, start_order)

        return OutlineResplitPreviewResponse(
            status="ok",
            rollback_plan=rollback_plan,
            segments=segments,
        )

    def apply_resplit(self, request: OutlineResplitApplyRequest) -> OutlineResplitApplyResponse:
        project_root = _resolve_project_root(request.workspace.project_root)
        outlines_data_dir = project_root / OUTLINES_DATA_RELATIVE_PATH
        outlines_data_dir.mkdir(parents=True, exist_ok=True)

        rollback_start = request.rollback_plan.rollback_start
        rollback_end = request.rollback_plan.rollback_end
        rollback_strategy = _validate_strategy(request.rollback_plan.rollback_strategy)

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
            selection_start=rollback_start,
            selection_end=rollback_end,
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
                raw_records = _raw_record_payloads(split_map)

                idempotency_keys = split_map.get("idempotency_keys", {})
                if not isinstance(idempotency_keys, dict):
                    idempotency_keys = {}

                token = f"resplit:{rollback_strategy}:{_idempotency_token(
                    workspace_id=request.workspace.workspace_id,
                    selection_start=rollback_start,
                    selection_end=rollback_end,
                    selection_text=selected_text,
                    idempotency_key=request.idempotency_key,
                )}"
                existing_split_id = idempotency_keys.get(token)
                if isinstance(existing_split_id, str):
                    for payload in raw_records:
                        if str(payload.get("id", "")) == existing_split_id:
                            return OutlineResplitApplyResponse(status="ok", record=_record_to_model(payload))

                records = [_record_to_model(payload) for payload in raw_records]
                overlap_state = _find_overlap_state(records, rollback_start, rollback_end)
                if overlap_state is None:
                    raise SplitServiceError(
                        status_code=409,
                        error_code="OUTLINE_RESPLIT_NO_OVERLAP",
                        message="当前回退计划未命中可回退的拆分记录",
                    )

                paragraphs = _normalize_paragraphs(selected_text)
                affected_split_ids = {record.id for record in overlap_state.records}
                remaining_record_payloads = [
                    payload
                    for payload in raw_records
                    if str(payload.get("id", "")) not in affected_split_ids
                ]

                removed_entries = [
                    entry
                    for entry in detailed_segments
                    if str(entry.get("source_split_id", "")) in affected_split_ids
                ]
                if not removed_entries:
                    raise SplitServiceError(
                        status_code=409,
                        error_code="OUTLINE_ORDER_CONFLICT",
                        message="重拆回退失败：缺少可回退的细纲锚点",
                        details={"conflicts": ["source_anchor missing for rollback target"]},
                    )

                remaining_entries = [
                    deepcopy(entry)
                    for entry in detailed_segments
                    if str(entry.get("source_split_id", "")) not in affected_split_ids
                ]
                insert_at = _insert_order_index(overlap_state.records, detailed_segments)
                before_entries = sorted(
                    [entry for entry in remaining_entries if _entry_order_index(entry) < insert_at],
                    key=_entry_order_index,
                )
                after_entries = sorted(
                    [entry for entry in remaining_entries if _entry_order_index(entry) >= insert_at],
                    key=_entry_order_index,
                )

                start_order = len(before_entries)
                segments = _build_segments(paragraphs, start_order)
                for idx, segment in enumerate(segments):
                    segment.order_index = start_order + idx
                    segment.title = f"Scene {segment.order_index + 1}"

                anchors = _build_anchors(
                    selection_start=rollback_start,
                    selection_end=rollback_end,
                    paragraph_index_start=_paragraph_index_for_offset(total_outline, rollback_start),
                    count=len(segments),
                )

                created_at = _utc_now()
                split_id = f"resplit-{uuid4().hex[:12]}"
                new_entries = [
                    _build_entry(
                        segment=segment,
                        split_id=split_id,
                        created_at=created_at,
                        source_anchor=anchor.model_dump(),
                    )
                    for segment, anchor in zip(segments, anchors)
                ]

                merged_entries = before_entries + new_entries + after_entries
                for idx, entry in enumerate(merged_entries):
                    entry["order_index"] = idx

                order_conflicts = _validate_order_segments(_segments_from_entries(merged_entries))
                order_conflicts.extend(_validate_entry_anchors(merged_entries))
                if order_conflicts:
                    raise SplitServiceError(
                        status_code=409,
                        error_code="OUTLINE_ORDER_CONFLICT",
                        message="重拆回退失败：落盘前顺序校验未通过",
                        details={"conflicts": order_conflicts},
                    )

                record = OutlineSplitRecord(
                    id=split_id,
                    source_start=rollback_start,
                    source_end=rollback_end,
                    created_at=created_at,
                    segments=segments,
                    anchors=anchors,
                )
                record_payload = record.model_dump()
                record_payload["source_file"] = str(TOTAL_OUTLINE_RELATIVE_PATH).replace("\\", "/")
                record_payload["target_insert_index"] = start_order
                record_payload["target_segment_ids"] = [segment.id for segment in segments]
                record_payload["rollback_strategy"] = rollback_strategy
                record_payload["rollback_replaced_split_ids"] = sorted(affected_split_ids)

                split_map["workspace_id"] = request.workspace.workspace_id
                split_map["updated_at"] = created_at
                split_map["records"] = remaining_record_payloads + [record_payload]

                history = split_map.get("history", [])
                if not isinstance(history, list):
                    history = []
                history.append(
                    {
                        "event": "resplit",
                        "created_at": created_at,
                        "rollback_strategy": rollback_strategy,
                        "rollback_start": rollback_start,
                        "rollback_end": rollback_end,
                        "rollback_replaced_split_ids": sorted(affected_split_ids),
                        "new_split_id": split_id,
                    }
                )
                split_map["history"] = history

                idempotency_keys[token] = split_id
                split_map["idempotency_keys"] = idempotency_keys

                _atomic_write_text(detailed_segments_path, _jsonl_dump(merged_entries))
                _atomic_write_text(detailed_outline_path, _render_detailed_outline(merged_entries))
                _atomic_write_json(split_map_path, split_map)

                return OutlineResplitApplyResponse(status="ok", record=record)
        except Timeout as exc:
            raise SplitServiceError(
                status_code=409,
                error_code="OUTLINE_RESPLIT_LOCK_TIMEOUT",
                message="resplit apply is locked by another operation",
            ) from exc
        except OSError as exc:
            raise SplitServiceError(
                status_code=500,
                error_code="OUTLINE_RESPLIT_WRITE_FAILED",
                message="failed to persist resplit results",
                details={"error": str(exc)},
            ) from exc

    def validate_outline_order(self, request: OutlineOrderValidateRequest) -> OutlineOrderValidateResponse:
        conflicts = _validate_order_segments(request.segments)
        return OutlineOrderValidateResponse(status="ok", valid=len(conflicts) == 0, conflicts=conflicts)
