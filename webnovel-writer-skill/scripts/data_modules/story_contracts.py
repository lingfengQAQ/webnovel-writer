#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List

from chapter_outline_loader import volume_num_for_chapter_from_state

try:
    from security_utils import atomic_write_json
except ImportError:  # pragma: no cover
    from scripts.security_utils import atomic_write_json


MARKER_BEGIN = "<!-- STORY-SYSTEM:BEGIN -->"
MARKER_END = "<!-- STORY-SYSTEM:END -->"


@dataclass(frozen=True)
class StoryContractPaths:
    project_root: Path

    @classmethod
    def from_project_root(cls, project_root: str | Path) -> "StoryContractPaths":
        return cls(Path(project_root).expanduser().resolve())

    @property
    def root(self) -> Path:
        return self.project_root / ".story-system"

    @property
    def chapters_dir(self) -> Path:
        return self.root / "chapters"

    @property
    def volumes_dir(self) -> Path:
        return self.root / "volumes"

    @property
    def reviews_dir(self) -> Path:
        return self.root / "reviews"

    @property
    def commits_dir(self) -> Path:
        return self.root / "commits"

    @property
    def events_dir(self) -> Path:
        return self.root / "events"

    @property
    def master_json(self) -> Path:
        return self.root / "MASTER_SETTING.json"

    @property
    def anti_patterns_json(self) -> Path:
        return self.root / "anti_patterns.json"

    def chapter_json(self, chapter: int) -> Path:
        return self.chapters_dir / f"chapter_{chapter:03d}.json"

    def volume_json(self, volume: int) -> Path:
        return self.volumes_dir / f"volume_{volume:03d}.json"

    def review_json(self, chapter: int) -> Path:
        return self.reviews_dir / f"chapter_{chapter:03d}.review.json"

    def commit_json(self, chapter: int) -> Path:
        return self.commits_dir / f"chapter_{chapter:03d}.commit.json"

    def event_json(self, chapter: int) -> Path:
        return self.events_dir / f"chapter_{chapter:03d}.events.json"


def _merge_append_only(master: Dict[str, Any], chapter: Dict[str, Any]) -> Dict[str, List[Any]]:
    merged: Dict[str, List[Any]] = {}
    for key in set(master) | set(chapter):
        seen: List[Any] = []
        for source_list in (master.get(key) or [], chapter.get(key) or []):
            for item in source_list:
                if item not in seen:
                    seen.append(item)
        merged[key] = seen
    return merged


def merge_contract_layers(master: Dict[str, Any], chapter: Dict[str, Any] | None) -> Dict[str, Any]:
    chapter = chapter or {}
    return {
        "locked": dict(master.get("locked") or {}),
        "append_only": _merge_append_only(
            master.get("append_only") or {},
            chapter.get("append_only") or {},
        ),
        "override_allowed": {
            **(master.get("override_allowed") or {}),
            **(chapter.get("override_allowed") or {}),
        },
    }


def merge_anti_patterns(*groups: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: set[str] = set()
    merged: List[Dict[str, Any]] = []
    for group in groups:
        for row in group:
            text = str(row.get("text") or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            merged.append(dict(row))
    return merged


def read_json_if_exists(path: Path) -> Any | None:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Bad JSON in {path}") from exc


def write_json(path: Path, payload: Any) -> None:
    atomic_write_json(path, payload, backup=True)


def write_marked_markdown(path: Path, generated_block: str) -> None:
    wrapped = f"{MARKER_BEGIN}\n{generated_block.rstrip()}\n{MARKER_END}\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        current = path.read_text(encoding="utf-8")
        if current.count(MARKER_BEGIN) > 1 or current.count(MARKER_END) > 1:
            raise ValueError(f"{path} contains multiple STORY-SYSTEM markers")
        if MARKER_BEGIN in current and MARKER_END in current:
            before, _, rest = current.partition(MARKER_BEGIN)
            _, _, after = rest.partition(MARKER_END)
            path.write_text(f"{before}{wrapped}{after.lstrip()}", encoding="utf-8")
            return
    path.write_text(wrapped, encoding="utf-8")


def render_master_markdown(master_payload: Dict[str, Any]) -> str:
    route = master_payload.get("route") or {}
    constraints = master_payload.get("master_constraints") or {}
    return "\n".join(
        [
            "# MASTER_SETTING",
            f"- 题材：{route.get('primary_genre', '')}",
            f"- 调性：{constraints.get('core_tone', '')}",
            f"- 节奏：{constraints.get('pacing_strategy', '')}",
        ]
    )


def render_anti_patterns_markdown(anti_patterns: List[Dict[str, Any]]) -> str:
    lines = ["# ANTI_PATTERNS"]
    for row in anti_patterns:
        lines.append(f"- {row.get('text', '')}")
    return "\n".join(lines)


def render_chapter_markdown(chapter_payload: Dict[str, Any]) -> str:
    focus = (chapter_payload.get("override_allowed") or {}).get("chapter_focus", "")
    return "\n".join(
        [
            f"# CHAPTER_{int(chapter_payload['meta']['chapter']):03d}",
            f"- 章节焦点：{focus}",
        ]
    )


def persist_story_seed(
    project_root: Path,
    master_payload: Dict[str, Any],
    chapter_payload: Dict[str, Any] | None,
    anti_patterns: List[Dict[str, Any]],
) -> None:
    paths = StoryContractPaths.from_project_root(project_root)
    paths.root.mkdir(parents=True, exist_ok=True)
    paths.chapters_dir.mkdir(parents=True, exist_ok=True)
    write_json(paths.master_json, master_payload)
    write_json(paths.anti_patterns_json, anti_patterns)
    write_marked_markdown(paths.master_json.with_suffix(".md"), render_master_markdown(master_payload))
    write_marked_markdown(
        paths.anti_patterns_json.with_suffix(".md"),
        render_anti_patterns_markdown(anti_patterns),
    )
    if chapter_payload is not None:
        chapter_num = int(chapter_payload["meta"]["chapter"])
        write_json(paths.chapter_json(chapter_num), chapter_payload)
        write_marked_markdown(
            paths.chapter_json(chapter_num).with_suffix(".md"),
            render_chapter_markdown(chapter_payload),
        )


def persist_runtime_contracts(
    project_root: Path,
    chapter: int,
    volume_brief: Dict[str, Any],
    review_contract: Dict[str, Any],
) -> None:
    paths = StoryContractPaths.from_project_root(project_root)
    volume = volume_num_for_chapter_from_state(paths.project_root, chapter) or 1
    paths.volumes_dir.mkdir(parents=True, exist_ok=True)
    paths.reviews_dir.mkdir(parents=True, exist_ok=True)
    write_json(paths.volume_json(volume), volume_brief)
    write_json(paths.review_json(chapter), review_contract)
