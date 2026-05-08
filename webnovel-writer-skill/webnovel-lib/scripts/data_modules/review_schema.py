#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
审查结果 schema（v6）。

替代原 checker-output-schema.md 的评分制，改为结构化问题清单。
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from security_utils import atomic_write_json
except ImportError:  # pragma: no cover
    from scripts.security_utils import atomic_write_json

VALID_SEVERITIES = {"critical", "high", "medium", "low"}
VALID_CATEGORIES = {
    "continuity", "setting", "character", "timeline",
    "ai_flavor", "logic", "pacing", "other",
}
SCORE_CATEGORIES = (
    "continuity",
    "setting",
    "character",
    "timeline",
    "ai_flavor",
    "logic",
    "pacing",
    "other",
)
SEVERITY_PENALTIES = {
    "critical": 35.0,
    "high": 15.0,
    "medium": 6.0,
    "low": 2.0,
}


def _clamp_score(value: float) -> float:
    return round(max(0.0, min(100.0, value)), 2)


def _issue_penalty(issue: "ReviewIssue") -> float:
    return float(SEVERITY_PENALTIES.get(issue.severity, SEVERITY_PENALTIES["medium"]))


@dataclass
class ReviewIssue:
    severity: str
    category: str = "other"
    location: str = ""
    description: str = ""
    evidence: str = ""
    fix_hint: str = ""
    blocking: Optional[bool] = None

    def __post_init__(self):
        if self.severity not in VALID_SEVERITIES:
            self.severity = "medium"
        if self.category not in VALID_CATEGORIES:
            self.category = "other"
        if self.blocking is None:
            self.blocking = self.severity == "critical"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ReviewResult:
    chapter: int
    issues: List[ReviewIssue] = field(default_factory=list)
    summary: str = ""

    @property
    def issues_count(self) -> int:
        return len(self.issues)

    @property
    def blocking_count(self) -> int:
        return sum(1 for i in self.issues if i.blocking)

    @property
    def has_blocking(self) -> bool:
        return self.blocking_count > 0

    @property
    def severity_counts(self) -> Dict[str, int]:
        counts = {level: 0 for level in ("critical", "high", "medium", "low")}
        for issue in self.issues:
            severity = issue.severity if issue.severity in counts else "medium"
            counts[severity] += 1
        return counts

    @property
    def categories(self) -> List[str]:
        return sorted(set(i.category for i in self.issues))

    @property
    def critical_issues(self) -> List[str]:
        return [
            issue.description
            for issue in self.issues
            if issue.severity == "critical" and issue.description
        ]

    def _build_dimension_scores(self) -> Dict[str, float]:
        scores = {category: 100.0 for category in SCORE_CATEGORIES}
        for issue in self.issues:
            category = issue.category if issue.category in scores else "other"
            scores[category] = _clamp_score(scores[category] - _issue_penalty(issue))
        return scores

    def _build_notes(self, categories: List[str]) -> str:
        parts: List[str] = []
        if self.summary:
            parts.append(self.summary)
        parts.append(f"issues={self.issues_count}")
        parts.append(f"blocking={self.blocking_count}")
        if categories:
            parts.append("categories=" + ",".join(categories))
        return " | ".join(parts)

    def _calculate_overall_score(self) -> float:
        score = 100.0
        for issue in self.issues:
            score -= _issue_penalty(issue)
        return _clamp_score(score)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "chapter": self.chapter,
            "issues": [i.to_dict() for i in self.issues],
            "issues_count": self.issues_count,
            "blocking_count": self.blocking_count,
            "has_blocking": self.has_blocking,
            "summary": self.summary,
        }

    def to_metrics_dict(self, report_file: str = "") -> Dict[str, Any]:
        categories = self.categories
        severity_counts = self.severity_counts
        return {
            "chapter": self.chapter,
            "start_chapter": self.chapter,
            "end_chapter": self.chapter,
            "overall_score": self._calculate_overall_score(),
            "dimension_scores": self._build_dimension_scores(),
            "severity_counts": severity_counts,
            "critical_issues": self.critical_issues,
            "report_file": report_file,
            "notes": self._build_notes(categories),
            "issues_count": self.issues_count,
            "blocking_count": self.blocking_count,
            "categories": categories,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
        }


def parse_review_output(chapter: int, raw: Dict[str, Any]) -> ReviewResult:
    issues = []
    for item in raw.get("issues", []):
        if not isinstance(item, dict):
            continue
        issues.append(ReviewIssue(
            severity=str(item.get("severity", "medium")),
            category=str(item.get("category", "other")),
            location=str(item.get("location", "")),
            description=str(item.get("description", "")),
            evidence=str(item.get("evidence", "")),
            fix_hint=str(item.get("fix_hint", "")),
            blocking=item.get("blocking"),
        ))
    return ReviewResult(
        chapter=chapter,
        issues=issues,
        summary=str(raw.get("summary", "")),
    )


def _read_json_if_exists(path: Path) -> Any | None:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Bad JSON in {path}") from exc


def _write_json(path: Path, payload: Any) -> None:
    atomic_write_json(path, payload, backup=True)


def append_ai_flavor_anti_patterns(project_root: str | Path, result: ReviewResult) -> int:
    root = Path(project_root).expanduser().resolve()
    path = root / ".story-system" / "anti_patterns.json"
    existing = _read_json_if_exists(path) or []
    if not isinstance(existing, list):
        existing = []

    seen_texts = {str(item.get("text") or "").strip() for item in existing if isinstance(item, dict)}
    additions: List[Dict[str, Any]] = []
    for index, issue in enumerate(result.issues, start=1):
        if issue.category != "ai_flavor" or issue.severity not in {"medium", "high", "critical"}:
            continue
        text = (issue.evidence or issue.description or "").strip()[:200]
        if not text or text in seen_texts:
            continue
        seen_texts.add(text)
        additions.append(
            {
                "text": text,
                "source_table": "review_extracted",
                "source_id": f"ch{int(result.chapter):04d}_issue_{index}",
                "category": issue.category,
                "added_at": datetime.now().isoformat(timespec="seconds"),
            }
        )

    if additions:
        path.parent.mkdir(parents=True, exist_ok=True)
        _write_json(path, [*existing, *additions])
    return len(additions)
