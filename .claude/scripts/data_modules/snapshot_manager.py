#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Context snapshot manager.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from .config import get_config

SNAPSHOT_VERSION = "1.0"


class SnapshotVersionMismatch(RuntimeError):
    def __init__(self, expected: str, actual: str) -> None:
        super().__init__(f"snapshot version mismatch: expected {expected}, got {actual}")
        self.expected = expected
        self.actual = actual


@dataclass
class SnapshotMeta:
    chapter: int
    version: str
    saved_at: str


class SnapshotManager:
    def __init__(self, config=None, version: str = SNAPSHOT_VERSION):
        self.config = config or get_config()
        self.version = version
        self.snapshot_dir = self.config.webnovel_dir / "context_snapshots"
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)

    def _snapshot_path(self, chapter: int) -> Path:
        return self.snapshot_dir / f"ch{chapter:04d}.json"

    def save_snapshot(self, chapter: int, payload: Dict[str, Any], meta: Optional[Dict[str, Any]] = None) -> Path:
        data: Dict[str, Any] = {
            "version": self.version,
            "chapter": chapter,
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "payload": payload,
        }
        if meta:
            data["meta"] = meta

        path = self._snapshot_path(chapter)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def load_snapshot(self, chapter: int) -> Optional[Dict[str, Any]]:
        path = self._snapshot_path(chapter)
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        version = str(data.get("version", ""))
        if version != self.version:
            raise SnapshotVersionMismatch(self.version, version)
        return data

    def delete_snapshot(self, chapter: int) -> bool:
        path = self._snapshot_path(chapter)
        if path.exists():
            path.unlink()
            return True
        return False

    def list_snapshots(self) -> list[str]:
        return sorted(p.name for p in self.snapshot_dir.glob("ch*.json"))
