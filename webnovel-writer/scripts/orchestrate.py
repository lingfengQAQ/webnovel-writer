#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List


@dataclass
class ChapterResult:
    chapter: int
    status: str
    steps: List[Dict[str, Any]]
    errors: List[str]


def _run(cmd: List[str]) -> tuple[int, str]:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    out = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
    return int(proc.returncode or 0), out.strip()


def _parse_range(raw: str) -> List[int]:
    values: List[int] = []
    for part in str(raw).split(","):
        token = part.strip()
        if not token:
            continue
        if "-" in token:
            a, b = token.split("-", 1)
            start, end = int(a), int(b)
            if start > end:
                start, end = end, start
            values.extend(range(start, end + 1))
        else:
            values.append(int(token))
    return sorted(set(values))


def _load_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _has_blocking(review_json: Path) -> bool:
    data = _load_json(review_json)
    if isinstance(data.get("blocking_count"), int):
        return data.get("blocking_count", 0) > 0
    issues = data.get("issues") or []
    return any(bool(item.get("blocking")) for item in issues if isinstance(item, dict))


def _chapter_commit_status(project_root: Path, chapter: int) -> str:
    p = project_root / ".story-system" / "commits" / f"chapter_{chapter:03d}.commit.json"
    data = _load_json(p)
    return str(((data.get("meta") or {}).get("status")) or "unknown")


def _projection_state(project_root: Path, chapter: int) -> Dict[str, str]:
    p = project_root / ".story-system" / "commits" / f"chapter_{chapter:03d}.commit.json"
    data = _load_json(p)
    return dict(data.get("projection_status") or {})


def run_orchestrate(args: argparse.Namespace) -> Dict[str, Any]:
    chapters = _parse_range(args.bad_chapters or args.chapters)
    script = Path(__file__).resolve().parent / "webnovel.py"
    report: Dict[str, Any] = {
        "mode": args.mode,
        "chapters": args.chapters,
        "results": [],
        "summary": {"success": 0, "degraded": 0, "failed": 0},
    }

    for ch in chapters:
        steps: List[Dict[str, Any]] = []
        errors: List[str] = []

        code, out = _run([sys.executable, str(script), "--project-root", str(args.project_root), "preflight", "--format", "json"])
        steps.append({"name": "preflight", "code": code, "output": out[-1000:]})
        if code != 0:
            errors.append("preflight_failed")

        review_results = args.tmp_dir / f"review_results_ch{ch}.json"
        if not review_results.exists():
            review_results = args.tmp_dir / "review_results.json"
        if args.mode in {"write", "nightly"} and review_results.exists():
            code, out = _run([
                sys.executable, str(script), "--project-root", str(args.project_root),
                "review-pipeline", "--chapter", str(ch), "--review-results", str(review_results), "--save-metrics",
            ])
            steps.append({"name": "review-pipeline", "code": code, "output": out[-1000:]})
            if code != 0:
                errors.append("review_pipeline_failed")
            elif _has_blocking(review_results):
                errors.append("review_blocking")

        if "review_blocking" not in errors and args.mode in {"write", "nightly"}:
            fulfillment_result = args.tmp_dir / f"fulfillment_result_ch{ch}.json"
            if not fulfillment_result.exists():
                fulfillment_result = args.tmp_dir / "fulfillment_result.json"
            disambiguation_result = args.tmp_dir / f"disambiguation_result_ch{ch}.json"
            if not disambiguation_result.exists():
                disambiguation_result = args.tmp_dir / "disambiguation_result.json"
            extraction_result = args.tmp_dir / f"extraction_result_ch{ch}.json"
            if not extraction_result.exists():
                extraction_result = args.tmp_dir / "extraction_result.json"
            commit_cmd = [
                sys.executable, str(script), "--project-root", str(args.project_root), "chapter-commit",
                "--chapter", str(ch),
                "--review-result", str(review_results),
                "--fulfillment-result", str(fulfillment_result),
                "--disambiguation-result", str(disambiguation_result),
                "--extraction-result", str(extraction_result),
            ]
            code, out = _run(commit_cmd)
            steps.append({"name": "chapter-commit", "code": code, "output": out[-1000:]})
            if code != 0:
                errors.append("chapter_commit_failed")

        if args.auto_vector_heal and args.mode in {"write", "heal", "nightly"}:
            proj = _projection_state(args.project_root, ch)
            vector_state = str(proj.get("vector", ""))
            if (not vector_state) or vector_state.startswith("failed") or vector_state == "pending":
                code, out = _run([
                    sys.executable, str(script), "--project-root", str(args.project_root),
                    "rag", "index-chapter", "--chapter", str(ch)
                ])
                steps.append({"name": "vector-heal", "code": code, "output": out[-1000:]})
                if code != 0:
                    errors.append("vector_heal_failed")

        commit_status = _chapter_commit_status(args.project_root, ch)
        proj = _projection_state(args.project_root, ch)
        degraded = any(str(v).startswith("failed") for v in proj.values()) if proj else False
        if errors:
            status = "failed"
            report["summary"]["failed"] += 1
        elif degraded:
            status = "degraded"
            report["summary"]["degraded"] += 1
        else:
            status = "success"
            report["summary"]["success"] += 1

        report["results"].append({
            "chapter": ch,
            "status": status,
            "errors": errors,
            "commit_status": commit_status,
            "projection_status": proj,
            "steps": steps,
        })

        if args.fail_fast and errors:
            break

    # one-click continuity pass for future generation stability
    if args.mode == "autofix":
        pass_steps: List[Dict[str, Any]] = []
        code, out = _run([
            sys.executable, str(script), "--project-root", str(args.project_root), "story-events", "--health"
        ])
        pass_steps.append({"name": "story-events-health", "code": code, "output": out[-1000:]})
        if args.entity_clean:
            code2, out2 = _run([
                sys.executable, str(script), "--project-root", str(args.project_root),
                "entity-clean", "--mark-invalid", "--format", "json"
            ])
            pass_steps.append({"name": "entity-clean", "code": code2, "output": out2[-1000:]})
        if args.sync_outline_volumes:
            for v in _parse_range(args.sync_outline_volumes):
                c3, o3 = _run([
                    sys.executable, str(script), "--project-root", str(args.project_root),
                    "master-outline-sync", "--volume", str(v), "--format", "json"
                ])
                pass_steps.append({"name": f"master-outline-sync-v{v}", "code": c3, "output": o3[-1000:]})
        report["continuity_pass"] = pass_steps

    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Batch orchestrator for webnovel pipeline")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("mode", choices=["write", "heal", "nightly", "autofix"])
    parser.add_argument("--chapters", default="1")
    parser.add_argument("--bad-chapters", default="", help="坏章列表，如 15,91,92,94")
    parser.add_argument("--tmp-dir", default=".webnovel/tmp")
    parser.add_argument("--fail-fast", action="store_true")
    parser.add_argument("--auto-vector-heal", action="store_true")
    parser.add_argument("--entity-clean", action="store_true", help="autofix 收尾时自动扫描脏实体")
    parser.add_argument("--sync-outline-volumes", default="", help="autofix 后回写总纲卷号，如 2,3")
    parser.add_argument("--json-report-out", default="")

    args = parser.parse_args()
    args.project_root = Path(args.project_root).resolve()
    args.tmp_dir = (args.project_root / args.tmp_dir).resolve()

    payload = run_orchestrate(args)
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    print(text)

    if args.json_report_out:
        out = Path(args.json_report_out)
        if not out.is_absolute():
            out = args.project_root / out
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
