"""
Watchdog 文件变更监听器 + SSE 推送

监控 PROJECT_ROOT/.webnovel/ 目录下 state.json / index.db 等文件的写事件，
通过 SSE 通知所有已连接的前端客户端刷新数据。
"""

import asyncio
import json
import time
from pathlib import Path
from typing import AsyncGenerator

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileModifiedEvent, FileCreatedEvent


class _WebnovelFileHandler(FileSystemEventHandler):
    """仅关注 .webnovel/ 目录下关键文件的修改/创建事件。"""

    WATCH_NAMES = {"state.json", "index.db", "workflow_state.json"}

    def __init__(self, notify_callback):
        super().__init__()
        self._notify = notify_callback

    def on_modified(self, event):
        if event.is_directory:
            return
        if Path(event.src_path).name in self.WATCH_NAMES:
            self._notify(event.src_path, "modified")

    def on_created(self, event):
        if event.is_directory:
            return
        if Path(event.src_path).name in self.WATCH_NAMES:
            self._notify(event.src_path, "created")


class FileWatcher:
    """管理 watchdog Observer 和 SSE 客户端订阅。"""

    # P1-C 修复：默认最大 SSE 客户端数限制，防止无限订阅导致内存耗尽
    DEFAULT_MAX_SSE_CLIENTS = 50

    def __init__(self):
        self._observer: Observer | None = None
        self._subscribers: list[asyncio.Queue] = []
        self._loop: asyncio.AbstractEventLoop | None = None

    # --- 订阅管理 ---

    @property
    def subscriber_count(self) -> int:
        """P1-C 修复：返回当前活跌的 SSE 订阅数。"""
        return len(self._subscribers)

    def subscribe(self, max_clients: int = DEFAULT_MAX_SSE_CLIENTS) -> asyncio.Queue | None:
        """P1-C 修复：订阅 SSE 队列。若当前连接数已达 max_clients 上限，返回 None。"""
        if len(self._subscribers) >= max_clients:
            return None
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass

    # --- 推送 ---

    def _on_change(self, path: str, kind: str):
        """在 watchdog 线程中调用，向主事件循环投递通知。"""
        msg = json.dumps({"file": Path(path).name, "kind": kind, "ts": time.time()})
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._dispatch, msg)

    def _dispatch(self, msg: str):
        dead: list[asyncio.Queue] = []
        for q in self._subscribers:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                dead.append(q)
        for dq in dead:
            self.unsubscribe(dq)

    # --- 生命周期 ---

    def start(self, watch_dir: Path, loop: asyncio.AbstractEventLoop):
        """启动 watchdog observer，监听 watch_dir。"""
        self._loop = loop
        handler = _WebnovelFileHandler(self._on_change)
        self._observer = Observer()
        self._observer.schedule(handler, str(watch_dir), recursive=False)
        self._observer.daemon = True
        self._observer.start()

    def stop(self):
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=3)
            self._observer = None
