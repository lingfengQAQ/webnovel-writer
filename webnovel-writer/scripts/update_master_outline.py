#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from runtime_compat import enable_windows_utf8_stdio

try:
    from data_modules.naming import DIR_OUTLINE, LEGACY_DIR_OUTLINE
except ImportError:  # pragma: no cover
    from scripts.data_modules.naming import DIR_OUTLINE, LEGACY_DIR_OUTLINE


def _outline_dir(project_root: Path) -> Path:
    """대강 디렉터리. 영문(outline) 우선, 레거시(大纲)는 읽기 호환."""
    eng = project_root / DIR_OUTLINE
    if eng.exists():
        return eng
    legacy = project_root / LEGACY_DIR_OUTLINE
    if legacy.exists():
        return legacy
    return eng


# 권 단위 대강 아티팩트 파일명 — (한국어 신규, 레거시 중국어) 쌍.
# 쓰기는 한국어, 읽기는 둘 중 존재하는 쪽을 인정한다.
REQUIRED_VOLUME_ARTIFACTS = (
    ("제{volume}권-비트시트.md", "第{volume}卷-节拍表.md"),
    ("제{volume}권-타임라인.md", "第{volume}卷-时间线.md"),
    ("제{volume}권-상세대강.md", "第{volume}卷-详细大纲.md"),
)


class MasterOutlineSyncError(RuntimeError):
    pass


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise MasterOutlineSyncError(f"missing writeback file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise MasterOutlineSyncError(f"invalid writeback JSON: {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise MasterOutlineSyncError("writeback JSON must be an object")
    return payload


def _require_current_volume_artifacts(project_root: Path, volume: int) -> list[str]:
    missing: list[str] = []
    found: list[str] = []
    outline_dir = _outline_dir(project_root)
    for korean, legacy in REQUIRED_VOLUME_ARTIFACTS:
        kor_path = outline_dir / korean.format(volume=volume)
        leg_path = outline_dir / legacy.format(volume=volume)
        chosen = None
        for path in (kor_path, leg_path):
            if path.is_file() and path.read_text(encoding="utf-8").strip():
                chosen = path
                break
        if chosen is None:
            missing.append(kor_path.relative_to(project_root).as_posix())
        else:
            found.append(chosen.name)
    if missing:
        raise MasterOutlineSyncError(
            "current volume planning artifacts are incomplete: " + ", ".join(missing)
        )
    return found


def _resolve_writeback_source(
    project_root: Path,
    outline_dir: Path,
    volume: int,
    writeback_file: str | Path | None,
) -> Path:
    expected_kor = (outline_dir / f"제{volume}권-마스터반영.json").resolve()
    expected_legacy = (outline_dir / f"第{volume}卷-总纲写回.json").resolve()
    if writeback_file:
        candidate = Path(writeback_file)
        if not candidate.is_absolute():
            candidate = project_root / candidate
        candidate = candidate.resolve()
        if candidate not in (expected_kor, expected_legacy):
            raise MasterOutlineSyncError(
                "writeback source must be the structured planning file: "
                f"{expected_kor.relative_to(project_root).as_posix()}"
            )
        return candidate
    # 명시 지정이 없으면: 한국어 우선, 없으면 레거시
    if expected_kor.is_file():
        return expected_kor
    if expected_legacy.is_file():
        return expected_legacy
    return expected_kor


def _cell(value: Any) -> str:
    text = "" if value is None else str(value)
    return text.replace("\n", " ").replace("|", "/").strip()


def _split_row(line: str) -> list[str]:
    return [part.strip() for part in line.strip().strip("|").split("|")]


def _render_row(cells: list[Any]) -> str:
    return "| " + " | ".join(_cell(cell) for cell in cells) + " |"


def _normalize_anchor(payload: dict[str, Any], expected_volume: int) -> dict[str, str]:
    raw = payload.get("next_volume_anchor")
    if not isinstance(raw, dict):
        raise MasterOutlineSyncError("writeback JSON missing object field: next_volume_anchor")

    volume_value = raw.get("volume") or raw.get("volume_id") or raw.get("卷号") or expected_volume
    try:
        volume = int(volume_value)
    except (TypeError, ValueError) as exc:
        raise MasterOutlineSyncError(f"invalid next volume value: {volume_value}") from exc
    if volume != expected_volume:
        raise MasterOutlineSyncError(f"next_volume_anchor.volume must be {expected_volume}, got {volume}")

    name = raw.get("volume_name") or raw.get("name") or raw.get("권명") or raw.get("卷名")
    conflict = raw.get("core_conflict") or raw.get("핵심갈등") or raw.get("核心冲突")
    climax = raw.get("volume_end_climax") or raw.get("end_climax") or raw.get("권말클라이맥스") or raw.get("卷末高潮")
    if not all(_cell(v) for v in (name, conflict, climax)):
        raise MasterOutlineSyncError(
            "next_volume_anchor requires volume_name, core_conflict, and volume_end_climax"
        )
    return {
        "volume": str(expected_volume),
        "volume_name": _cell(name),
        "core_conflict": _cell(conflict),
        "volume_end_climax": _cell(climax),
        "chapters_range": _cell(raw.get("chapters_range") or raw.get("화범위") or raw.get("章节范围") or ""),
    }


def _update_volume_table(text: str, anchor: dict[str, str]) -> tuple[str, bool]:
    lines = text.splitlines()
    header_idx = next((i for i, line in enumerate(lines) if line.strip().startswith(("| 권 번호", "| 卷号"))), None)
    new_row = _render_row(
        [
            anchor["volume"],
            anchor["volume_name"],
            anchor["chapters_range"],
            anchor["core_conflict"],
            anchor["volume_end_climax"],
        ]
    )
    if header_idx is None:
        addition = [
            "",
            "## 권 구성",
            "| 권 번호 | 권 제목 | 화 범위 | 핵심 갈등 | 권말 클라이맥스 |",
            "|------|------|----------|----------|----------|",
            new_row,
        ]
        return "\n".join(lines + addition).rstrip() + "\n", True

    row_start = header_idx + 2
    row_end = row_start
    while row_end < len(lines) and lines[row_end].strip().startswith("|"):
        row_end += 1

    changed = False
    for idx in range(row_start, row_end):
        cells = _split_row(lines[idx])
        if cells and cells[0] == anchor["volume"]:
            while len(cells) < 5:
                cells.append("")
            cells[1] = anchor["volume_name"]
            if anchor["chapters_range"]:
                cells[2] = anchor["chapters_range"]
            cells[3] = anchor["core_conflict"]
            cells[4] = anchor["volume_end_climax"]
            rendered = _render_row(cells[:5])
            changed = rendered != lines[idx]
            lines[idx] = rendered
            return "\n".join(lines).rstrip() + "\n", changed

    lines.insert(row_end, new_row)
    return "\n".join(lines).rstrip() + "\n", True


def _structured_writeback_items(payload: dict[str, Any]) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for field, default_level in (
        ("foreshadow_writeback", "伏笔"),
        ("open_loop_writeback", "持续开放环"),
    ):
        raw_items = payload.get(field, [])
        if raw_items is None:
            continue
        if not isinstance(raw_items, list):
            raise MasterOutlineSyncError(f"{field} must be a list")
        for raw in raw_items:
            if not isinstance(raw, dict):
                raise MasterOutlineSyncError(f"{field} entries must be objects")
            content = raw.get("content") or raw.get("text") or raw.get("복선내용") or raw.get("伏笔内容")
            if not _cell(content):
                continue
            items.append(
                {
                    "content": _cell(content),
                    "buried_chapter": _cell(raw.get("buried_chapter") or raw.get("bury_chapter") or raw.get("매설화") or raw.get("埋设章") or ""),
                    "payoff_chapter": _cell(raw.get("payoff_chapter") or raw.get("recover_chapter") or raw.get("회수화") or raw.get("回收章") or ""),
                    "level": _cell(raw.get("level") or raw.get("층위") or raw.get("层级") or default_level),
                }
            )
    return items


def _append_foreshadow_rows(text: str, items: list[dict[str, str]]) -> tuple[str, int]:
    if not items:
        return text, 0

    lines = text.splitlines()
    header_idx = next((i for i, line in enumerate(lines) if line.strip().startswith(("| 복선 내용", "| 伏笔内容"))), None)
    if header_idx is None:
        lines.extend(
            [
                "",
                "## 복선 표",
                "| 복선 내용 | 매설 화 | 회수 화 | 층위 |",
                "|----------|--------|--------|------|",
            ]
        )
        header_idx = len(lines) - 2

    row_start = header_idx + 2
    row_end = row_start
    while row_end < len(lines) and lines[row_end].strip().startswith("|"):
        row_end += 1

    existing_contents = set()
    blank_row_indices: list[int] = []
    for idx in range(row_start, row_end):
        cells = _split_row(lines[idx])
        if cells and any(cell for cell in cells):
            existing_contents.add(cells[0])
        else:
            blank_row_indices.append(idx)

    for idx in reversed(blank_row_indices):
        del lines[idx]
        row_end -= 1

    appended = 0
    insert_at = row_end
    for item in items:
        if item["content"] in existing_contents:
            continue
        lines.insert(
            insert_at,
            _render_row([item["content"], item["buried_chapter"], item["payoff_chapter"], item["level"]]),
        )
        insert_at += 1
        appended += 1
        existing_contents.add(item["content"])

    return "\n".join(lines).rstrip() + "\n", appended


def sync_master_outline(
    project_root: str | Path,
    volume: int,
    *,
    writeback_file: str | Path | None = None,
) -> dict[str, Any]:
    root = Path(project_root).expanduser().resolve()
    if volume < 1:
        raise MasterOutlineSyncError("volume must be >= 1")

    _require_current_volume_artifacts(root, volume)

    outline_dir = _outline_dir(root)
    master_path = outline_dir / "마스터아웃라인.md"
    if not master_path.is_file():
        # 레거시(중국어) 마스터 대강 읽기 호환
        legacy_master = outline_dir / "总纲.md"
        if legacy_master.is_file():
            master_path = legacy_master
        else:
            raise MasterOutlineSyncError(f"missing master outline: {outline_dir.name}/마스터아웃라인.md")

    source_path = _resolve_writeback_source(root, outline_dir, volume, writeback_file)
    payload = _read_json(source_path)
    anchor = _normalize_anchor(payload, volume + 1)
    structured_items = _structured_writeback_items(payload)

    before = master_path.read_text(encoding="utf-8")
    after, volume_changed = _update_volume_table(before, anchor)
    after, appended_count = _append_foreshadow_rows(after, structured_items)
    if after != before:
        master_path.write_text(after, encoding="utf-8")

    return {
        "ok": True,
        "master_outline": master_path.relative_to(root).as_posix(),
        "writeback_file": source_path.relative_to(root).as_posix(),
        "next_volume": volume + 1,
        "volume_anchor_written": volume_changed,
        "structured_items_appended": appended_count,
        "updated": after != before,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="다음 권 앵커를 마스터 대강(outline/마스터아웃라인.md)에 동기화")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--volume", type=int, required=True, help="규획을 완료한 현재 권 번호")
    parser.add_argument("--writeback-file", default="", help="구조화 라이트백 JSON 명시 지정; 기본값 outline/제N권-마스터반영.json")
    parser.add_argument("--format", choices=["json", "text"], default="json")
    args = parser.parse_args()

    try:
        result = sync_master_outline(
            args.project_root,
            args.volume,
            writeback_file=args.writeback_file or None,
        )
    except MasterOutlineSyncError as exc:
        if args.format == "json":
            print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        else:
            print(f"ERROR {exc}", file=sys.stderr)
        raise SystemExit(1)

    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(
            "OK master outline synced: "
            f"next_volume={result['next_volume']} "
            f"structured_items_appended={result['structured_items_appended']}"
        )


if __name__ == "__main__":
    enable_windows_utf8_stdio(skip_in_pytest=True)
    main()
