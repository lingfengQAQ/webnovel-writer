#!/usr/bin/env python3

import json
import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from incremental_indexer import IncrementalIndexer


def test_index_incremental_generates_index_artifacts(tmp_path: Path):
    project_root = tmp_path / "book"
    webnovel_dir = project_root / ".webnovel"
    content_dir = project_root / "正文"

    webnovel_dir.mkdir(parents=True, exist_ok=True)
    content_dir.mkdir(parents=True, exist_ok=True)
    (webnovel_dir / "state.json").write_text("{}", encoding="utf-8")
    (content_dir / "chapter1.md").write_text("第 1 章\n【开场】\n内容", encoding="utf-8")

    indexer = IncrementalIndexer(project_root)
    result = indexer.index_incremental()

    index_state = json.loads((project_root / ".webnovel" / "codex" / "index-state.json").read_text(encoding="utf-8"))
    fast_index = json.loads((project_root / ".webnovel" / "codex" / "fast-index.json").read_text(encoding="utf-8"))

    assert result["status"] == "ok"
    assert result["indexed_files"] == 1
    assert index_state == {
        "indexed": True,
        "last_updated": result["timestamp"],
        "chapter_count": 1,
        "scene_count": 1,
        "file_count": 1,
    }
    expected_rel_path = str(Path("正文") / "chapter1.md")

    assert fast_index["chapters"]["1"] == [expected_rel_path]
    assert fast_index["scenes"]["开场"] == [expected_rel_path]
    assert fast_index["files"][expected_rel_path] == {
        "chapter": "1",
        "scenes": ["开场"],
    }
