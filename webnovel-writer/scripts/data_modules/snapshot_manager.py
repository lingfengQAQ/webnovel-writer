#!/usr/bin/env python3
"""
Context snapshot manager.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from filelock import FileLock

from .config import get_config

try:
    # 当 scripts 目录在 sys.path 中
    from security_utils import atomic_write_json
except ImportError:  # pragma: no cover
    # 当以 python -m scripts.data_modules... 形式运行
    from scripts.security_utils import atomic_write_json

SNAPSHOT_VERSION = "1.2"


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

    def _snapshot_lock_path(self, chapter: int) -> Path:
        return self._snapshot_path(chapter).with_suffix(".json.lock")

    def save_snapshot(self, chapter: int, payload: dict[str, Any], meta: dict[str, Any] | None = None) -> Path:
        data: dict[str, Any] = {
            "version": self.version,
            "chapter": chapter,
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "payload": payload,
        }
        if meta:
            data["meta"] = meta

        path = self._snapshot_path(chapter)
        lock = FileLock(str(self._snapshot_lock_path(chapter)), timeout=10)
        with lock:
            atomic_write_json(path, data, use_lock=False, backup=False)
        return path

    def load_snapshot(self, chapter: int) -> dict[str, Any] | None:
        path = self._snapshot_path(chapter)
        lock = FileLock(str(self._snapshot_lock_path(chapter)), timeout=10)
        with lock:
            if not path.exists():
                return None
            data = json.loads(path.read_text(encoding="utf-8"))
        version = str(data.get("version", ""))
        if version != self.version:
            raise SnapshotVersionMismatch(self.version, version)
        return data

    def delete_snapshot(self, chapter: int) -> bool:
        path = self._snapshot_path(chapter)
        lock = FileLock(str(self._snapshot_lock_path(chapter)), timeout=10)
        with lock:
            if path.exists():
                path.unlink()
                return True
        return False

    def list_snapshots(self) -> list[str]:
        return sorted(p.name for p in self.snapshot_dir.glob("ch*.json"))
