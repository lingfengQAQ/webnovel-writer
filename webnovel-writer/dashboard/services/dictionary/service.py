"""Settings file access and dictionary extraction service."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from filelock import FileLock, Timeout

from ...path_guard import safe_resolve


_TEXT_FILE_EXTENSIONS = {".md", ".markdown", ".txt", ".yml", ".yaml", ".json"}
_DEFAULT_WORKSPACE_ID = "workspace-default"


class DictionaryServiceError(Exception):
    """Structured service error for API mapping."""

    def __init__(
        self,
        *,
        status_code: int,
        error_code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.message = message
        self.details = details


def list_settings_tree(*, workspace_id: str | None, project_root: str | None) -> list[dict[str, Any]]:
    root = _resolve_workspace_root(workspace_id=workspace_id, project_root=project_root)
    settings_root = root / "设定集"
    if not settings_root.is_dir():
        return []
    return [_build_tree_node(settings_root, root)]


def read_settings_file(*, workspace_id: str | None, project_root: str | None, path: str) -> str:
    root = _resolve_workspace_root(workspace_id=workspace_id, project_root=project_root)
    if not path.strip():
        raise DictionaryServiceError(
            status_code=400,
            error_code="invalid_path",
            message="path is required.",
        )

    try:
        resolved = safe_resolve(root, path)
    except Exception as exc:
        raise DictionaryServiceError(
            status_code=403,
            error_code="path_forbidden",
            message="Path is outside project root.",
            details={"path": path},
        ) from exc

    settings_root = (root / "设定集").resolve()
    if not _is_subpath(resolved, settings_root):
        raise DictionaryServiceError(
            status_code=403,
            error_code="path_forbidden",
            message="Only files under 设定集/ are allowed.",
            details={"path": path},
        )
    if not resolved.is_file():
        raise DictionaryServiceError(
            status_code=404,
            error_code="settings_file_not_found",
            message="Settings file not found.",
            details={"path": path},
        )
    return resolved.read_text(encoding="utf-8", errors="replace")


def extract_dictionary(
    *,
    workspace_id: str | None,
    project_root: str | None,
    incremental: bool,
) -> tuple[int, int]:
    root = _resolve_workspace_root(workspace_id=workspace_id, project_root=project_root)
    store = _load_store(root) if incremental else _new_store()
    entries = [_normalize_entry(entry) for entry in store["entries"]]
    conflicts = [_normalize_conflict(conflict) for conflict in store["conflicts"]]

    conflicts_by_id = {conflict["id"]: conflict for conflict in conflicts}
    entries_by_fingerprint = {entry["fingerprint"]: entry for entry in entries}
    entries_by_key: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for entry in entries:
        key = (entry["term"], entry["type"])
        entries_by_key.setdefault(key, []).append(entry)

    extracted = 0
    for source_path in _iter_settings_files(root):
        for candidate in _extract_entries_from_file(source_path, root):
            fingerprint = candidate["fingerprint"]
            if fingerprint in entries_by_fingerprint:
                continue

            key = (candidate["term"], candidate["type"])
            key_entries = entries_by_key.setdefault(key, [])
            conflicting = [
                entry
                for entry in key_entries
                if _attrs_signature(entry["attrs"]) != _attrs_signature(candidate["attrs"])
                and entry.get("status") != "resolved_conflict"
            ]
            if conflicting:
                candidate["status"] = "conflict"
                for entry in conflicting:
                    entry["status"] = "conflict"
                conflict_id = _build_conflict_id(candidate["term"], candidate["type"])
                conflict = conflicts_by_id.get(conflict_id)
                if conflict is None:
                    conflict = {
                        "id": conflict_id,
                        "term": candidate["term"],
                        "type": candidate["type"],
                        "candidates": [],
                        "status": "conflict",
                    }
                    conflicts_by_id[conflict_id] = conflict
                conflict["status"] = "conflict"
                _merge_conflict_candidates(conflict, [*conflicting, candidate])

            entries.append(candidate)
            entries_by_fingerprint[fingerprint] = candidate
            key_entries.append(candidate)
            extracted += 1

    store["entries"] = entries
    store["conflicts"] = list(conflicts_by_id.values())
    _save_store(root, store)
    active_conflicts = sum(1 for conflict in store["conflicts"] if conflict.get("status") == "conflict")
    return extracted, active_conflicts


def list_dictionary(
    *,
    workspace_id: str | None,
    project_root: str | None,
    term: str | None,
    entry_type: str | None,
    status: str | None,
    limit: int,
    offset: int,
) -> tuple[list[dict[str, Any]], int]:
    root = _resolve_workspace_root(workspace_id=workspace_id, project_root=project_root)
    store = _load_store(root)
    items = [_normalize_entry(entry) for entry in store["entries"]]

    if term:
        needle = term.strip().lower()
        items = [item for item in items if needle in item["term"].lower()]
    if entry_type:
        items = [item for item in items if item["type"] == entry_type]
    if status:
        items = [item for item in items if item["status"] == status]

    total = len(items)
    paged = items[offset : offset + limit]
    return paged, total


def resolve_conflict(
    *,
    workspace_id: str | None,
    project_root: str | None,
    conflict_id: str,
    decision: str,
    attrs: dict[str, Any],
) -> dict[str, Any]:
    root = _resolve_workspace_root(workspace_id=workspace_id, project_root=project_root)
    if not conflict_id:
        raise DictionaryServiceError(
            status_code=400,
            error_code="invalid_conflict_id",
            message="Conflict id is required.",
        )

    store = _load_store(root)
    conflicts = [_normalize_conflict(conflict) for conflict in store["conflicts"]]
    entries = [_normalize_entry(entry) for entry in store["entries"]]

    target = None
    for conflict in conflicts:
        if conflict["id"] == conflict_id:
            target = conflict
            break
    if target is None:
        raise DictionaryServiceError(
            status_code=404,
            error_code="conflict_not_found",
            message="Conflict not found.",
            details={"id": conflict_id},
        )

    decision_value = (decision or "").strip().lower()
    if decision_value not in {"confirm", "reject", "keep_conflict"}:
        raise DictionaryServiceError(
            status_code=400,
            error_code="invalid_decision",
            message="Decision must be one of: confirm, reject, keep_conflict.",
        )

    if decision_value == "confirm":
        _confirm_conflict(target, entries, attrs)
        target["status"] = "resolved"
    elif decision_value == "reject":
        target["status"] = "rejected"
    else:
        target["status"] = "conflict"

    store["entries"] = entries
    store["conflicts"] = conflicts
    _save_store(root, store)
    return target


def _confirm_conflict(
    conflict: dict[str, Any],
    entries: list[dict[str, Any]],
    attrs_override: dict[str, Any],
) -> None:
    candidates = [_normalize_entry(entry) for entry in conflict.get("candidates", [])]
    if not candidates:
        raise DictionaryServiceError(
            status_code=409,
            error_code="empty_conflict",
            message="Conflict has no candidates to confirm.",
            details={"id": conflict.get("id")},
        )

    winner_source = candidates[0]
    winner_attrs = _normalize_attrs(attrs_override) if attrs_override else winner_source["attrs"]
    confirmed_fingerprint = _build_fingerprint(conflict["term"], conflict["type"], winner_attrs)
    confirmed_entry = {
        "id": _build_entry_id(confirmed_fingerprint),
        "term": conflict["term"],
        "type": conflict["type"],
        "attrs": winner_attrs,
        "source_file": winner_source["source_file"],
        "source_span": winner_source["source_span"],
        "status": "confirmed",
        "fingerprint": confirmed_fingerprint,
    }

    conflict_fingerprints = {candidate["fingerprint"] for candidate in candidates}
    for entry in entries:
        if entry["fingerprint"] in conflict_fingerprints and entry.get("status") == "conflict":
            entry["status"] = "resolved_conflict"

    for index, existing in enumerate(entries):
        if existing["fingerprint"] == confirmed_fingerprint:
            entries[index] = confirmed_entry
            break
    else:
        entries.append(confirmed_entry)


def _resolve_workspace_root(*, workspace_id: str | None, project_root: str | None) -> Path:
    root_hint = (project_root or "").strip() or os.environ.get("WEBNOVEL_PROJECT_ROOT", "").strip()
    root = Path(root_hint).resolve() if root_hint else Path.cwd().resolve()
    if not root.exists() or not root.is_dir():
        raise DictionaryServiceError(
            status_code=404,
            error_code="project_root_not_found",
            message="project_root does not exist.",
            details={"project_root": str(root)},
        )

    expected_workspace_id = _workspace_id_for_root(root)
    normalized_workspace_id = (workspace_id or _DEFAULT_WORKSPACE_ID).strip()
    if normalized_workspace_id not in {"", _DEFAULT_WORKSPACE_ID, expected_workspace_id}:
        raise DictionaryServiceError(
            status_code=403,
            error_code="workspace_forbidden",
            message="workspace_id does not match project_root.",
            details={"workspace_id": normalized_workspace_id},
        )
    return root


def _workspace_id_for_root(root: Path) -> str:
    digest = hashlib.sha1(str(root).encode("utf-8")).hexdigest()[:12]
    return f"ws-{digest}"


def _build_tree_node(path: Path, root: Path) -> dict[str, Any]:
    rel = str(path.relative_to(root)).replace("\\", "/")
    if path.is_dir():
        children = [_build_tree_node(child, root) for child in sorted(path.iterdir(), key=lambda item: item.name)]
        return {"name": path.name, "path": rel, "type": "dir", "children": children}
    return {"name": path.name, "path": rel, "type": "file", "children": []}


def _is_subpath(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def _iter_settings_files(root: Path) -> list[Path]:
    settings_root = root / "设定集"
    if not settings_root.is_dir():
        return []
    files: list[Path] = []
    for path in settings_root.rglob("*"):
        if path.is_file() and path.suffix.lower() in _TEXT_FILE_EXTENSIONS:
            files.append(path)
    files.sort()
    return files


def _extract_entries_from_file(path: Path, root: Path) -> list[dict[str, Any]]:
    content = path.read_text(encoding="utf-8", errors="replace")
    rel_path = str(path.relative_to(root)).replace("\\", "/")
    entries: list[dict[str, Any]] = []

    offset = 0
    for raw_line in content.splitlines(keepends=True):
        line = raw_line.strip()
        line_end = offset + len(raw_line.rstrip("\r\n"))
        offset_next = offset + len(raw_line)

        if not line or line.startswith("#") or line.startswith("//"):
            offset = offset_next
            continue

        parsed = _parse_dictionary_line(line)
        if parsed is None:
            offset = offset_next
            continue

        term, entry_type, attrs = parsed
        normalized_attrs = _normalize_attrs(attrs)
        fingerprint = _build_fingerprint(term, entry_type, normalized_attrs)
        entry = {
            "id": _build_entry_id(fingerprint),
            "term": term,
            "type": entry_type,
            "attrs": normalized_attrs,
            "source_file": rel_path,
            "source_span": f"{offset}-{line_end}",
            "status": "pending",
            "fingerprint": fingerprint,
        }
        entries.append(entry)
        offset = offset_next

    return entries


def _parse_dictionary_line(line: str) -> tuple[str, str, dict[str, Any]] | None:
    delimiter = "：" if "：" in line else ":"
    if delimiter not in line:
        return None

    left, right = line.split(delimiter, 1)
    left = left.strip()
    right = right.strip()
    if not left:
        return None

    term, entry_type = _parse_term_and_type(left)
    attrs = _parse_attrs(right)
    return term, entry_type, attrs


def _parse_term_and_type(left: str) -> tuple[str, str]:
    if left.endswith(")") and "(" in left:
        term, entry_type = left.rsplit("(", 1)
        return term.strip(), entry_type[:-1].strip() or "concept"
    if left.endswith("）") and "（" in left:
        term, entry_type = left.rsplit("（", 1)
        return term.strip(), entry_type[:-1].strip() or "concept"
    if "/" in left:
        maybe_type, maybe_term = left.split("/", 1)
        maybe_type = maybe_type.strip()
        maybe_term = maybe_term.strip()
        if maybe_type and maybe_term and len(maybe_type) <= 16:
            return maybe_term, maybe_type
    return left.strip(), "concept"


def _parse_attrs(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if not text:
        return {}
    if text.startswith("{") and text.endswith("}"):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    attrs: dict[str, Any] = {}
    segments = [segment.strip() for segment in text.replace("；", ";").replace("，", ",").split(";")]
    for segment in segments:
        if not segment:
            continue
        parts = [part.strip() for part in segment.split(",") if part.strip()]
        if len(parts) > 1:
            for part in parts:
                _merge_attr_segment(attrs, part)
            continue
        _merge_attr_segment(attrs, segment)

    if attrs:
        return attrs
    return {"description": text}


def _merge_attr_segment(attrs: dict[str, Any], segment: str) -> None:
    for marker in ("=", "：", ":"):
        if marker in segment:
            key, value = segment.split(marker, 1)
            key = key.strip()
            value = value.strip()
            if key:
                attrs[key] = value
            return

    existing = attrs.get("description")
    if existing:
        attrs["description"] = f"{existing}; {segment.strip()}"
    else:
        attrs["description"] = segment.strip()


def _build_entry_id(fingerprint: str) -> str:
    return f"dict-{fingerprint[:12]}"


def _build_conflict_id(term: str, entry_type: str) -> str:
    digest = hashlib.sha1(f"{term}\x1f{entry_type}".encode("utf-8")).hexdigest()[:12]
    return f"conf-{digest}"


def _build_fingerprint(term: str, entry_type: str, attrs: dict[str, Any]) -> str:
    payload = f"{term}\x1f{entry_type}\x1f{_attrs_signature(attrs)}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _attrs_signature(attrs: dict[str, Any]) -> str:
    return json.dumps(attrs, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _normalize_attrs(attrs: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(attrs, dict):
        return {"value": str(attrs)}
    normalized: dict[str, Any] = {}
    for key, value in attrs.items():
        normalized[str(key)] = value
    return normalized


def _merge_conflict_candidates(conflict: dict[str, Any], candidates: list[dict[str, Any]]) -> None:
    known = {candidate.get("fingerprint") for candidate in conflict.get("candidates", [])}
    merged = [candidate for candidate in conflict.get("candidates", []) if isinstance(candidate, dict)]
    for candidate in candidates:
        fingerprint = candidate.get("fingerprint")
        if not fingerprint or fingerprint in known:
            continue
        merged.append(_normalize_entry(candidate))
        known.add(fingerprint)
    conflict["candidates"] = merged


def _dictionary_path(root: Path) -> Path:
    return root / ".webnovel" / "dictionaries" / "setting-dictionary.json"


def _new_store() -> dict[str, Any]:
    return {
        "version": 1,
        "updated_at": _now_iso(),
        "entries": [],
        "conflicts": [],
    }


def _load_store(root: Path) -> dict[str, Any]:
    dictionary_path = _dictionary_path(root)
    if not dictionary_path.is_file():
        return _new_store()
    try:
        raw = json.loads(dictionary_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DictionaryServiceError(
            status_code=500,
            error_code="dictionary_store_corrupt",
            message="Failed to load dictionary store.",
            details={"path": str(dictionary_path)},
        ) from exc

    if not isinstance(raw, dict):
        raise DictionaryServiceError(
            status_code=500,
            error_code="dictionary_store_invalid",
            message="Dictionary store root must be an object.",
            details={"path": str(dictionary_path)},
        )

    return {
        "version": raw.get("version", 1),
        "updated_at": raw.get("updated_at", _now_iso()),
        "entries": raw.get("entries", []),
        "conflicts": raw.get("conflicts", []),
    }


def _save_store(root: Path, store: dict[str, Any]) -> None:
    dictionary_path = _dictionary_path(root)
    dictionary_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": store.get("version", 1),
        "updated_at": _now_iso(),
        "entries": [_normalize_entry(entry) for entry in store.get("entries", [])],
        "conflicts": [_normalize_conflict(conflict) for conflict in store.get("conflicts", [])],
    }
    _atomic_write_json(dictionary_path, payload)


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    try:
        from scripts.security_utils import atomic_write_json as security_atomic_write_json

        security_atomic_write_json(path, payload, use_lock=True, backup=False)
        return
    except Exception:
        pass

    lock = FileLock(f"{path}.lock", timeout=10)
    fd, temp_file = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp", prefix=f"{path.stem}-")
    temp_path = Path(temp_file)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)
            file.flush()
            os.fsync(file.fileno())

        try:
            with lock:
                os.replace(temp_path, path)
                temp_path = None
        except Timeout as exc:
            raise DictionaryServiceError(
                status_code=409,
                error_code="dictionary_store_locked",
                message="Dictionary store is locked by another process.",
                details={"path": str(path)},
            ) from exc
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink(missing_ok=True)


def _normalize_entry(entry: dict[str, Any]) -> dict[str, Any]:
    value = dict(entry or {})
    attrs = _normalize_attrs(value.get("attrs", {}))
    term = str(value.get("term", "")).strip()
    entry_type = str(value.get("type", "concept")).strip() or "concept"
    fingerprint = str(value.get("fingerprint", "")).strip()
    if not fingerprint and term:
        fingerprint = _build_fingerprint(term, entry_type, attrs)
    source_file = str(value.get("source_file", "设定集/unknown")).replace("\\", "/")
    source_span = str(value.get("source_span", "0-0"))
    status = str(value.get("status", "pending"))
    return {
        "id": str(value.get("id") or _build_entry_id(fingerprint or "unknown")),
        "term": term,
        "type": entry_type,
        "attrs": attrs,
        "source_file": source_file,
        "source_span": source_span,
        "status": status,
        "fingerprint": fingerprint,
    }


def _normalize_conflict(conflict: dict[str, Any]) -> dict[str, Any]:
    value = dict(conflict or {})
    candidates = [_normalize_entry(entry) for entry in value.get("candidates", [])]
    term = str(value.get("term", "")).strip()
    entry_type = str(value.get("type", "concept")).strip() or "concept"
    conflict_id = str(value.get("id") or _build_conflict_id(term or "unknown", entry_type))
    status = str(value.get("status", "conflict"))
    return {
        "id": conflict_id,
        "term": term,
        "type": entry_type,
        "candidates": candidates,
        "status": status,
    }


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()
