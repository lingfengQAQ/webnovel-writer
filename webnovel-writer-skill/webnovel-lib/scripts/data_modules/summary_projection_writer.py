#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from pathlib import Path


def append_summary_projection(project_root: Path, commit_payload: dict) -> dict:
    chapter = int(commit_payload.get("meta", {}).get("chapter") or 0)
    summary_text = str(commit_payload.get("summary_text") or "").strip()
    if chapter <= 0 or not summary_text:
        return {"applied": False, "writer": "summary", "reason": "missing_summary"}

    target = Path(project_root) / ".webnovel" / "summaries" / f"ch{chapter:04d}.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    if "## 剧情摘要" not in summary_text:
        summary_text = f"## 剧情摘要\n{summary_text}\n"
    target.write_text(summary_text, encoding="utf-8")
    return {"applied": True, "writer": "summary", "path": str(target)}


class SummaryProjectionWriter:
    def __init__(self, project_root: Path):
        self.project_root = Path(project_root)

    def apply(self, commit_payload: dict) -> dict:
        if commit_payload["meta"]["status"] != "accepted":
            return {"applied": False, "writer": "summary", "reason": "commit_rejected"}
        return append_summary_projection(self.project_root, commit_payload)
