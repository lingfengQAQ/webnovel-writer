#!/usr/bin/env python3
"""FileWatcher unit tests."""

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from incremental_indexer import FileWatcher


def test_file_watcher_import_guard():
    """FileWatcher should be importable (None if watchdog missing)."""
    # Either FileWatcher is a class or None — both acceptable
    assert FileWatcher is None or callable(FileWatcher)


def test_index_event_handler_triggers_index():
    """_IndexEventHandler.on_modified should call indexer.index_incremental()."""
    if FileWatcher is None:
        pytest.skip("watchdog not installed")

    from incremental_indexer import _IndexEventHandler

    mock_indexer = MagicMock()
    mock_indexer.index_incremental.return_value = {"status": "ok", "indexed_files": 0}

    handler = _IndexEventHandler(mock_indexer, Path("/tmp"))

    # Simulate a .md file modification event
    event = MagicMock()
    event.src_path = "/tmp/test.md"
    handler.on_modified(event)

    mock_indexer.index_incremental.assert_called_once()


def test_index_event_handler_ignores_non_md():
    """_IndexEventHandler should ignore non-.md files."""
    if FileWatcher is None:
        pytest.skip("watchdog not installed")

    from incremental_indexer import _IndexEventHandler

    mock_indexer = MagicMock()
    handler = _IndexEventHandler(mock_indexer, Path("/tmp"))

    event = MagicMock()
    event.src_path = "/tmp/test.txt"
    handler.on_modified(event)

    mock_indexer.index_incremental.assert_not_called()


def test_index_event_handler_on_created():
    """_IndexEventHandler.on_created should trigger index for .md files."""
    if FileWatcher is None:
        pytest.skip("watchdog not installed")

    from incremental_indexer import _IndexEventHandler

    mock_indexer = MagicMock()
    mock_indexer.index_incremental.return_value = {"status": "ok", "indexed_files": 0}

    handler = _IndexEventHandler(mock_indexer, Path("/tmp"))

    event = MagicMock()
    event.src_path = "/tmp/new_chapter.md"
    handler.on_created(event)

    mock_indexer.index_incremental.assert_called_once()


def test_file_watcher_start_creates_content_dir(tmp_path: Path):
    """FileWatcher.start() should create 正文/ directory if missing."""
    if FileWatcher is None:
        pytest.skip("watchdog not installed")

    from incremental_indexer import IncrementalIndexer

    project_root = tmp_path / "project"
    project_root.mkdir()
    indexer = IncrementalIndexer(project_root)
    watcher = FileWatcher(project_root, indexer)

    assert not (project_root / "正文").exists()
    watcher.start()
    assert (project_root / "正文").exists()
    watcher.stop()


def test_watch_command_requires_watchdog():
    """codex index watch should fail gracefully without watchdog."""
    try:
        from codex_cli import cmd_index_watch
    except ImportError:
        pytest.skip("codex_cli not importable")

    import argparse
    args = argparse.Namespace(project_root=None)
    # This test just verifies the command doesn't crash
    # In a real environment without a valid project root it will fail,
    # but it should not raise an unhandled exception.
    result = cmd_index_watch(args)
    assert isinstance(result, int)
