#!/usr/bin/env python3
"""
增量索引器 - M2 阶段实现

负责：
1. 扫描正文目录并生成索引产物
2. 维护章节号/场景标签倒排索引
3. 持久化索引状态与索引事件
4. 提供快速定位能力
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path


class IncrementalIndexer:
    """增量索引器。"""

    def __init__(self, project_root: Path):
        """初始化增量索引器。

        Args:
            project_root: 项目根目录
        """
        self.project_root = project_root.resolve()
        self.index_dir = self.project_root / ".webnovel" / "codex"
        self.index_dir.mkdir(parents=True, exist_ok=True)

        self.fast_index_file = self.index_dir / "fast-index.json"
        self.index_state_file = self.index_dir / "index-state.json"
        self.watch_events_file = self.index_dir / "watch-events.jsonl"

    def get_status(self) -> dict:
        """获取索引状态。

        Returns:
            索引状态信息
        """
        status = {
            "indexed": False,
            "last_updated": None,
            "chapter_count": 0,
            "scene_count": 0,
            "file_count": 0,
        }

        if self.index_state_file.exists():
            state = json.loads(self.index_state_file.read_text(encoding="utf-8"))
            status.update(state)

        return status

    def index_incremental(self) -> dict:
        """执行增量索引。

        Returns:
            索引结果
        """
        result = {
            "status": "ok",
            "indexed_files": 0,
            "indexed_chapters": 0,
            "indexed_scenes": 0,
            "timestamp": datetime.now(UTC).isoformat(),
        }

        # 扫描正文目录
        content_dir = self.project_root / "正文"
        if not content_dir.exists():
            return result

        # 构建快速索引
        fast_index = {
            "chapters": {},  # chapter_num -> [file_paths]
            "scenes": {},    # scene_tag -> [file_paths]
            "files": {},     # file_path -> {chapter, scenes}
        }

        for file_path in content_dir.rglob("*.md"):
            if file_path.is_file():
                rel_path = str(file_path.relative_to(self.project_root))
                content = file_path.read_text(encoding="utf-8")

                # 提取章节号
                chapter_match = re.search(r"第\s*(\d+)\s*章", content)
                if chapter_match:
                    chapter_num = int(chapter_match.group(1))
                    if chapter_num not in fast_index["chapters"]:
                        fast_index["chapters"][chapter_num] = []
                    fast_index["chapters"][chapter_num].append(rel_path)
                    result["indexed_chapters"] += 1

                # 提取场景标签
                scene_tags = re.findall(r"【(.+?)】", content)
                file_scenes = []
                for tag in scene_tags:
                    if tag not in fast_index["scenes"]:
                        fast_index["scenes"][tag] = []
                    fast_index["scenes"][tag].append(rel_path)
                    file_scenes.append(tag)
                    result["indexed_scenes"] += 1

                fast_index["files"][rel_path] = {
                    "chapter": chapter_match.group(1) if chapter_match else None,
                    "scenes": file_scenes,
                }
                result["indexed_files"] += 1

        # 保存快速索引
        self.fast_index_file.write_text(
            json.dumps(fast_index, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

        # 更新索引状态
        state = {
            "indexed": True,
            "last_updated": result["timestamp"],
            "chapter_count": len(fast_index["chapters"]),
            "scene_count": len(fast_index["scenes"]),
            "file_count": len(fast_index["files"]),
        }
        self.index_state_file.write_text(
            json.dumps(state, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

        # 记录事件
        self._log_event({
            "type": "index_incremental",
            "timestamp": result["timestamp"],
            "result": result,
        })

        return result

    def locate_by_chapter(self, chapter_num: int) -> list[str]:
        """按章节号快速定位文件。

        Args:
            chapter_num: 章节号

        Returns:
            文件路径列表
        """
        if not self.fast_index_file.exists():
            return []

        fast_index = json.loads(self.fast_index_file.read_text(encoding="utf-8"))
        return fast_index.get("chapters", {}).get(chapter_num, [])

    def locate_by_scene_tag(self, scene_tag: str) -> list[str]:
        """按场景标签快速定位文件。

        Args:
            scene_tag: 场景标签

        Returns:
            文件路径列表
        """
        if not self.fast_index_file.exists():
            return []

        fast_index = json.loads(self.fast_index_file.read_text(encoding="utf-8"))
        return fast_index.get("scenes", {}).get(scene_tag, [])

    def _log_event(self, event: dict) -> None:
        """记录索引事件。

        Args:
            event: 事件信息
        """
        with open(self.watch_events_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")


# --- File Watcher (optional, requires watchdog) ---
try:
    from watchdog.events import FileSystemEventHandler
    from watchdog.observers import Observer

    class _IndexEventHandler(FileSystemEventHandler):
        """Handles file change events by triggering incremental re-index."""

        def __init__(self, indexer: IncrementalIndexer, content_dir: Path):
            super().__init__()
            self.indexer = indexer
            self.content_dir = content_dir

        def on_modified(self, event):
            if event.src_path.endswith('.md'):
                self.indexer.index_incremental()

        def on_created(self, event):
            if event.src_path.endswith('.md'):
                self.indexer.index_incremental()

    class FileWatcher:
        """Watchdog-based file watcher for 正文/ directory.

        Monitors file changes and triggers incremental re-indexing.
        Requires the 'watchdog' package. If not installed, the watch
        command will be unavailable.
        """

        def __init__(self, project_root: Path, indexer: IncrementalIndexer):
            self.observer = Observer()
            self.indexer = indexer
            self._content_dir = project_root / "正文"
            self._handler = _IndexEventHandler(indexer, self._content_dir)

        def start(self) -> None:
            """Start watching for file changes."""
            if not self._content_dir.exists():
                self._content_dir.mkdir(parents=True, exist_ok=True)
            self.observer.schedule(self._handler, str(self._content_dir), recursive=True)
            self.observer.start()

        def stop(self) -> None:
            """Stop watching."""
            self.observer.stop()
            self.observer.join(timeout=5)

        def is_alive(self) -> bool:
            """Check if watcher is running."""
            return self.observer.is_alive()

except ImportError:
    # watchdog not installed - FileWatcher unavailable
    FileWatcher = None  # type: ignore[assignment,misc]
    _IndexEventHandler = None  # type: ignore[assignment,misc]
