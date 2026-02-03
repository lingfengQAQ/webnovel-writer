#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ContextManager - assemble context packs with weighted priorities.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import get_config
from .index_manager import IndexManager
from .snapshot_manager import SnapshotManager, SnapshotVersionMismatch


class ContextManager:
    DEFAULT_TEMPLATE = "plot"
    TEMPLATE_WEIGHTS = {
        "plot": {"core": 0.40, "scene": 0.35, "global": 0.25},
        "battle": {"core": 0.35, "scene": 0.45, "global": 0.20},
        "emotion": {"core": 0.45, "scene": 0.35, "global": 0.20},
        "transition": {"core": 0.50, "scene": 0.25, "global": 0.25},
    }
    EXTRA_SECTIONS = {"story_skeleton", "memory", "preferences", "alerts"}
    SECTION_ORDER = ["core", "scene", "global", "story_skeleton", "memory", "preferences", "alerts"]
    SUMMARY_SECTION_RE = re.compile(r"##\s*剧情摘要\s*\r?\n(.*?)(?=\r?\n##|\Z)", re.DOTALL)

    def __init__(self, config=None, snapshot_manager: Optional[SnapshotManager] = None):
        self.config = config or get_config()
        self.snapshot_manager = snapshot_manager or SnapshotManager(self.config)
        self.index_manager = IndexManager(self.config)

    def build_context(
        self,
        chapter: int,
        template: str | None = None,
        use_snapshot: bool = True,
        save_snapshot: bool = True,
        max_chars: Optional[int] = None,
    ) -> Dict[str, Any]:
        template = template or self.DEFAULT_TEMPLATE
        if template not in self.TEMPLATE_WEIGHTS:
            template = self.DEFAULT_TEMPLATE

        if use_snapshot:
            try:
                cached = self.snapshot_manager.load_snapshot(chapter)
                if cached:
                    return cached.get("payload", cached)
            except SnapshotVersionMismatch:
                # Snapshot incompatible; rebuild below.
                pass

        pack = self._build_pack(chapter)
        assembled = self.assemble_context(pack, template=template, max_chars=max_chars)

        if save_snapshot:
            meta = {"template": template}
            self.snapshot_manager.save_snapshot(chapter, assembled, meta=meta)

        return assembled

    def assemble_context(
        self,
        pack: Dict[str, Any],
        template: str = DEFAULT_TEMPLATE,
        max_chars: Optional[int] = None,
    ) -> Dict[str, Any]:
        weights = self.TEMPLATE_WEIGHTS.get(template, self.TEMPLATE_WEIGHTS[self.DEFAULT_TEMPLATE])
        max_chars = max_chars or 8000
        extra_budget = int(self.config.context_extra_section_budget or 0)

        sections = {}
        for section_name in self.SECTION_ORDER:
            if section_name in pack:
                sections[section_name] = pack[section_name]

        assembled: Dict[str, Any] = {"meta": pack.get("meta", {}), "sections": {}}
        for name, content in sections.items():
            weight = weights.get(name, 0.0)
            if weight > 0:
                budget = int(max_chars * weight)
            elif name in self.EXTRA_SECTIONS and extra_budget > 0:
                budget = extra_budget
            else:
                budget = None
            text = json.dumps(content, ensure_ascii=False)
            if budget is not None and len(text) > budget:
                text = text[:budget]
            assembled["sections"][name] = {"content": content, "text": text, "budget": budget}

        assembled["template"] = template
        assembled["weights"] = weights
        return assembled

    def filter_invalid_items(self, items: List[Dict[str, Any]], source_type: str, id_key: str) -> List[Dict[str, Any]]:
        confirmed = self.index_manager.get_invalid_ids(source_type, status="confirmed")
        pending = self.index_manager.get_invalid_ids(source_type, status="pending")
        result = []
        for item in items:
            item_id = str(item.get(id_key, ""))
            if item_id in confirmed:
                continue
            if item_id in pending:
                item = dict(item)
                item["warning"] = "pending_invalid"
            result.append(item)
        return result

    def apply_confidence_filter(self, items: List[Dict[str, Any]], min_confidence: float) -> List[Dict[str, Any]]:
        filtered: List[Dict[str, Any]] = []
        for item in items:
            conf = item.get("confidence")
            if conf is None or conf >= min_confidence:
                filtered.append(item)
        return filtered

    def _build_pack(self, chapter: int) -> Dict[str, Any]:
        state = self._load_state()
        core = {
            "chapter_outline": self._load_outline(chapter),
            "protagonist_snapshot": state.get("protagonist_state", {}),
            "recent_summaries": self._load_recent_summaries(
                chapter,
                window=self.config.context_recent_summaries_window,
            ),
            "recent_meta": self._load_recent_meta(
                state,
                chapter,
                window=self.config.context_recent_meta_window,
            ),
        }

        scene = {
            "location_context": state.get("protagonist_state", {}).get("location", {}),
            "appearing_characters": self._load_recent_appearances(
                limit=self.config.context_max_appearing_characters,
            ),
        }
        scene["appearing_characters"] = self.filter_invalid_items(
            scene["appearing_characters"], source_type="entity", id_key="entity_id"
        )

        global_ctx = {
            "worldview_skeleton": self._load_setting("世界观"),
            "power_system_skeleton": self._load_setting("力量体系"),
            "style_contract_ref": self._load_setting("风格契约"),
        }

        preferences = self._load_json_optional(self.config.webnovel_dir / "preferences.json")
        memory = self._load_json_optional(self.config.webnovel_dir / "project_memory.json")
        story_skeleton = self._load_story_skeleton(chapter)
        alert_slice = max(0, int(self.config.context_alerts_slice))

        return {
            "meta": {"chapter": chapter},
            "core": core,
            "scene": scene,
            "global": global_ctx,
            "story_skeleton": story_skeleton,
            "preferences": preferences,
            "memory": memory,
            "alerts": {
                "disambiguation_warnings": (
                    state.get("disambiguation_warnings", [])[-alert_slice:] if alert_slice else []
                ),
                "disambiguation_pending": (
                    state.get("disambiguation_pending", [])[-alert_slice:] if alert_slice else []
                ),
            },
        }

    def _load_state(self) -> Dict[str, Any]:
        path = self.config.state_file
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

    def _load_outline(self, chapter: int) -> str:
        outline_dir = self.config.outline_dir
        patterns = [
            f"第{chapter}章*.md",
            f"第{chapter:02d}章*.md",
            f"第{chapter:03d}章*.md",
            f"第{chapter:04d}章*.md",
        ]
        for pattern in patterns:
            matches = list(outline_dir.glob(pattern))
            if matches:
                return matches[0].read_text(encoding="utf-8")
        return f"[大纲未找到: 第{chapter}章]"

    def _load_recent_summaries(self, chapter: int, window: int = 3) -> List[Dict[str, Any]]:
        summaries = []
        for ch in range(max(1, chapter - window), chapter):
            summary = self._load_summary_text(ch)
            if summary:
                summaries.append(summary)
        return summaries

    def _load_recent_meta(self, state: Dict[str, Any], chapter: int, window: int = 3) -> List[Dict[str, Any]]:
        meta = state.get("chapter_meta", {}) or {}
        results = []
        for ch in range(max(1, chapter - window), chapter):
            for key in (f"{ch:04d}", str(ch)):
                if key in meta:
                    results.append({"chapter": ch, **meta.get(key, {})})
                    break
        return results

    def _load_recent_appearances(self, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        appearances = self.index_manager.get_recent_appearances(limit=limit)
        return appearances or []

    def _load_setting(self, keyword: str) -> str:
        settings_dir = self.config.settings_dir
        candidates = [
            settings_dir / f"{keyword}.md",
        ]
        for path in candidates:
            if path.exists():
                return path.read_text(encoding="utf-8")
        # fallback: any file containing keyword
        matches = list(settings_dir.glob(f"*{keyword}*.md"))
        if matches:
            return matches[0].read_text(encoding="utf-8")
        return f"[{keyword}设定未找到]"

    def _extract_summary_excerpt(self, text: str, max_chars: int) -> str:
        if not text:
            return ""
        match = self.SUMMARY_SECTION_RE.search(text)
        excerpt = match.group(1).strip() if match else text.strip()
        if max_chars > 0 and len(excerpt) > max_chars:
            return excerpt[:max_chars].rstrip()
        return excerpt

    def _load_summary_text(self, chapter: int, snippet_chars: Optional[int] = None) -> Optional[Dict[str, Any]]:
        summary_path = self.config.webnovel_dir / "summaries" / f"ch{chapter:04d}.md"
        if not summary_path.exists():
            return None
        text = summary_path.read_text(encoding="utf-8")
        if snippet_chars:
            summary_text = self._extract_summary_excerpt(text, snippet_chars)
        else:
            summary_text = text
        return {"chapter": chapter, "summary": summary_text}

    def _load_story_skeleton(self, chapter: int) -> List[Dict[str, Any]]:
        interval = max(1, int(self.config.context_story_skeleton_interval))
        max_samples = max(0, int(self.config.context_story_skeleton_max_samples))
        snippet_chars = int(self.config.context_story_skeleton_snippet_chars)

        if max_samples <= 0 or chapter <= interval:
            return []

        samples: List[Dict[str, Any]] = []
        cursor = chapter - interval
        while cursor >= 1 and len(samples) < max_samples:
            summary = self._load_summary_text(cursor, snippet_chars=snippet_chars)
            if summary and summary.get("summary"):
                samples.append(summary)
            cursor -= interval

        samples.reverse()
        return samples

    def _load_json_optional(self, path: Path) -> Dict[str, Any]:
        if not path.exists():
            return {}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}


def main():
    import argparse
    from .cli_output import print_success, print_error

    parser = argparse.ArgumentParser(description="Context Manager CLI")
    parser.add_argument("--project-root", type=str, help="项目根目录")
    parser.add_argument("--chapter", type=int, required=True)
    parser.add_argument("--template", type=str, default=ContextManager.DEFAULT_TEMPLATE)
    parser.add_argument("--no-snapshot", action="store_true")
    parser.add_argument("--max-chars", type=int, default=8000)

    args = parser.parse_args()

    config = None
    if args.project_root:
        from .config import DataModulesConfig

        config = DataModulesConfig.from_project_root(args.project_root)

    manager = ContextManager(config)
    try:
        payload = manager.build_context(
            chapter=args.chapter,
            template=args.template,
            use_snapshot=not args.no_snapshot,
            save_snapshot=True,
            max_chars=args.max_chars,
        )
        print_success(payload, message="context_built")
        try:
            manager.index_manager.log_tool_call("context_manager:build", True, chapter=args.chapter)
        except Exception:
            pass
    except Exception as exc:
        print_error("CONTEXT_BUILD_FAILED", str(exc), suggestion="请检查项目结构与依赖文件")
        try:
            manager.index_manager.log_tool_call(
                "context_manager:build", False, error_code="CONTEXT_BUILD_FAILED", error_message=str(exc), chapter=args.chapter
            )
        except Exception:
            pass


if __name__ == "__main__":
    main()
