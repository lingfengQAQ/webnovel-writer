from __future__ import annotations

import json
import sys
from pathlib import Path
from uuid import uuid4

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from dashboard.models.common import WorkspaceContext
from dashboard.models.outlines import OutlineSplitApplyRequest, OutlineSplitHistoryQuery, OutlineSplitPreviewRequest
from dashboard.services.split import SplitService


def _bootstrap_outline(project_root: Path) -> str:
    (project_root / "大纲").mkdir(parents=True, exist_ok=True)
    total_outline = "- 第一段剧情推进，主角进入城镇。\n\n2. 第二段冲突升级，主角发现线索。"
    (project_root / "大纲" / "总纲.md").write_text(total_outline, encoding="utf-8")
    return total_outline


def run_smoke() -> dict[str, str]:
    runs_root = PACKAGE_ROOT / ".t06-smoke"
    runs_root.mkdir(parents=True, exist_ok=True)
    project_root = runs_root / f"run-{uuid4().hex[:8]}"
    project_root.mkdir(parents=True, exist_ok=False)

    total_outline = _bootstrap_outline(project_root)
    workspace = WorkspaceContext(workspace_id="ws-t06-smoke", project_root=str(project_root))
    service = SplitService()

    preview = service.preview_split(
        OutlineSplitPreviewRequest(
            workspace=workspace,
            selection_start=0,
            selection_end=len(total_outline),
            selection_text=total_outline,
        )
    )
    assert preview.status == "ok"
    assert len(preview.segments) == 2
    assert len(preview.anchors) == 2
    assert preview.segments[0].content == "第一段剧情推进，主角进入城镇。"
    assert preview.segments[1].content == "第二段冲突升级，主角发现线索。"

    apply_result = service.apply_split(
        OutlineSplitApplyRequest(
            workspace=workspace,
            selection_start=0,
            selection_end=len(total_outline),
            idempotency_key="t06-smoke-key",
        )
    )
    assert apply_result.status == "ok"
    record = apply_result.record
    assert [item.order_index for item in record.segments] == [0, 1]
    assert [item.paragraph_index for item in record.anchors] == [0, 1]

    history = service.list_splits(
        OutlineSplitHistoryQuery(
            workspace_id="ws-t06-smoke",
            project_root=str(project_root),
            limit=10,
            offset=0,
        )
    )
    assert history.status == "ok"
    assert history.total == 1
    assert history.items[0].id == record.id

    split_map_path = project_root / ".webnovel" / "outlines" / "split-map.json"
    detailed_segments_path = project_root / ".webnovel" / "outlines" / "detailed-segments.jsonl"
    detailed_outline_path = project_root / "大纲" / "细纲.md"

    split_map = json.loads(split_map_path.read_text(encoding="utf-8"))
    assert len(split_map["records"]) == 1
    assert split_map["records"][0]["target_segment_ids"] == [item.id for item in record.segments]

    segment_entries = [
        json.loads(line)
        for line in detailed_segments_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert [entry["order_index"] for entry in segment_entries] == [0, 1]
    assert segment_entries[0]["source_anchor"]["paragraph_index"] == 0
    assert segment_entries[1]["source_anchor"]["paragraph_index"] == 1

    detailed_outline = detailed_outline_path.read_text(encoding="utf-8")
    assert "### [0000] Scene 1" in detailed_outline
    assert "### [0001] Scene 2" in detailed_outline

    return {
        "project_root": str(project_root),
        "split_map": str(split_map_path),
        "segments_jsonl": str(detailed_segments_path),
        "detailed_outline": str(detailed_outline_path),
    }


if __name__ == "__main__":
    artifacts = run_smoke()
    print("[AC-004] PASS split apply writes new detailed scenes")
    print("[AC-005] PASS split output normalized to plain paragraph content")
    print("[AC-006] PASS anchors and order_index stay consistent and traceable")
    print(json.dumps(artifacts, ensure_ascii=False))
