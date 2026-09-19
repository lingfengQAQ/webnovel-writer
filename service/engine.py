# -*- coding: utf-8 -*-
"""Engine：与上游数据链的唯一接触面。

上游 `webnovel-writer/scripts/webnovel.py` 是一个稳定的 CLI。本层只通过
子进程调用它，不 import 上游模块——这样上游包内部怎么重构都不影响我们，
`git merge upstream` 的冲突面也被压到最小。

所有方法都返回结构化结果（dict / list / str），把 stderr 与退出码收进异常。
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from .config import UPSTREAM_ROOT, Settings, rag_env


class EngineError(RuntimeError):
    """上游 CLI 调用失败。"""

    def __init__(self, message: str, *, returncode: int = -1, stderr: str = "") -> None:
        super().__init__(message)
        self.returncode = returncode
        self.stderr = stderr


@dataclass
class CommandResult:
    returncode: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.returncode == 0

    def json(self) -> Any:
        text = self.stdout.strip()
        if not text:
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise EngineError(
                f"上游输出不是合法 JSON: {exc}", returncode=self.returncode,
                stderr=self.stderr,
            ) from exc

    def text(self) -> str:
        return self.stdout.strip()


class Engine:
    """包装上游 CLI。project_root 为 None 时表示"尚未建项目"。"""

    def __init__(self, settings: Settings, project_root: Optional[str] = None) -> None:
        self.settings = settings
        self.project_root = project_root or settings.project_root or ""
        self.scripts_dir = UPSTREAM_ROOT / "scripts"
        self.entry = self.scripts_dir / "webnovel.py"
        if not self.entry.is_file():
            raise EngineError(f"未找到上游入口脚本: {self.entry}")

    # ---- 底层执行 ----

    def _env(self) -> Dict[str, str]:
        env = dict(os.environ)
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        # 上游 project_locator 会读这些来定位项目
        env["CLAUDE_PLUGIN_ROOT"] = str(UPSTREAM_ROOT)
        if self.project_root:
            env["CLAUDE_PROJECT_DIR"] = self.project_root
        env.update(rag_env(self.settings))
        return env

    def run(
        self,
        args: Sequence[str],
        *,
        timeout: int = 600,
        need_project: bool = True,
        check: bool = False,
    ) -> CommandResult:
        """执行上游 CLI。need_project=False 用于 init 这类创建项目的命令。"""
        cmd: List[str] = [sys.executable, "-X", "utf8", str(self.entry)]
        if need_project:
            if not self.project_root:
                raise EngineError("project_root 未设置")
            cmd += ["--project-root", self.project_root]
        cmd += list(args)

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                env=self._env(),
                cwd=self.project_root or str(UPSTREAM_ROOT),
            )
        except subprocess.TimeoutExpired as exc:
            raise EngineError(
                f"上游命令超时（{timeout}s）: {' '.join(args)}"
            ) from exc

        result = CommandResult(
            returncode=proc.returncode,
            stdout=proc.stdout or "",
            stderr=proc.stderr or "",
        )
        if check and not result.ok:
            raise EngineError(
                f"上游命令失败（exit {result.returncode}）: {' '.join(args)}\n"
                f"{result.stderr.strip()[:1500]}",
                returncode=result.returncode,
                stderr=result.stderr,
            )
        return result

    # ---- 项目生命周期 ----

    def preflight(self) -> Dict[str, Any]:
        res = self.run(["preflight", "--format", "json"], need_project=False)
        return res.json() or {}

    def where(self) -> Optional[str]:
        """解析真实书项目根（含 .webnovel/state.json 的目录）。"""
        res = self.run(["where"], need_project=False)
        if not res.ok:
            return None
        out = res.text()
        return out or None

    def init_project(
        self, project_dir: str, title: str, genre: str = "", **options: Any
    ) -> CommandResult:
        """创建书项目。

        need_project=False —— init 不依赖已存在的 project_root。
        注意：上游 init_project.py 把 `genre` 定为必填位置参数，缺失会直接
        argparse 报错退出，所以这里显式补默认值。
        """
        args = ["init", project_dir, title, genre or "玄幻"]
        for key, value in options.items():
            if value in (None, "", 0):
                continue
            flag = "--" + key.replace("_", "-")
            args += [flag, str(value)]
        return self.run(args, need_project=False, timeout=300)

    def project_status(self, chapter: Optional[int] = None) -> Any:
        args = ["project-status", "--format", "json"]
        if chapter:
            args += ["--chapter", str(chapter)]
        return self.run(args).json()

    def doctor(self, chapter: Optional[int] = None, deep: bool = False) -> Any:
        args = ["doctor", "--format", "json"]
        if chapter:
            args += ["--chapter", str(chapter)]
        if deep:
            args.append("--deep")
        return self.run(args).json()

    # ---- 写章链路 ----

    def placeholder_scan(self) -> Any:
        return self.run(["placeholder-scan", "--format", "json"]).json()

    def story_system(
        self, chapter_goal: str, genre: str, chapter: int, persist: bool = True
    ) -> CommandResult:
        """生成/刷新本章 runtime contract。"""
        args = [
            "story-system", chapter_goal,
            "--genre", genre or "",
            "--chapter", str(chapter),
            "--emit-runtime-contracts",
            "--format", "json",
        ]
        if persist:
            args.append("--persist")
        return self.run(args, timeout=300)

    def write_gate(self, chapter: int, stage: str) -> Dict[str, Any]:
        """stage: prewrite | precommit | postcommit。"""
        res = self.run(
            ["write-gate", "--chapter", str(chapter), "--stage", stage,
             "--format", "json"],
            timeout=300,
        )
        data = res.json()
        return data if isinstance(data, dict) else {"ok": res.ok, "raw": data}

    def load_context(self, chapter: int) -> Any:
        """一次性基础包：story_contracts / recent_summaries / urgent_loops / ..."""
        res = self.run(
            ["memory-contract", "load-context", "--chapter", str(chapter)],
            timeout=300,
        )
        if not res.ok:
            # 降级：extract-context
            fallback = self.run(
                ["extract-context", "--chapter", str(chapter), "--format", "json"],
                timeout=300,
            )
            return fallback.json()
        return res.json()

    def extract_context(self, chapter: int) -> Any:
        res = self.run(
            ["extract-context", "--chapter", str(chapter), "--format", "json"],
            timeout=300,
        )
        return res.json()

    def chapter_outline(self, chapter: int, max_chars: Optional[int] = None) -> Any:
        """读本章章纲。

        上游有两种存放约定（见 chapter_outline_loader.py）：
        1. 单章文件：`大纲/第{1,2,3,4 位}章*.md`
        2. 卷级大纲：`大纲/第{N}卷-详细大纲.md`，章纲是其中 `### 第N章：标题` 分节

        第 2 种是 `/webnovel-plan` 的实际产出位置，所以必须支持从卷大纲里
        抽取本章那一段。优先单章文件（更精确），回退卷大纲。
        """
        if not self.project_root:
            return None
        outline_dir = Path(self.project_root) / "大纲"
        if not outline_dir.is_dir():
            return None

        # 1) 单章文件
        for pattern in (
            f"第{chapter}章*.md",
            f"第{chapter:02d}章*.md",
            f"第{chapter:03d}章*.md",
            f"第{chapter:04d}章*.md",
        ):
            matches = sorted(outline_dir.glob(pattern))
            if matches:
                return matches[0].read_text(encoding="utf-8")

        # 2) 卷大纲：解析出本章分节
        volume_num = self.volume_for_chapter(chapter)
        for name in (
            f"第{volume_num}卷-详细大纲.md",
            f"第{volume_num}卷 - 详细大纲.md",
            f"第{volume_num}卷 详细大纲.md",
        ):
            path = outline_dir / name
            if not path.is_file():
                continue
            section = self._extract_chapter_section(
                path.read_text(encoding="utf-8"), chapter
            )
            if section:
                if max_chars and len(section) > max_chars:
                    return section[:max_chars]
                return section
        return None

    @staticmethod
    def _extract_chapter_section(content: str, chapter: int) -> Optional[str]:
        """从卷大纲里抽出 `### 第N章：标题` 到下一个章标题之间的内容。

        标题里的章号可能是阿拉伯数字，也可能是中文数字（第一章）。
        """
        heading = re.compile(
            r"^#{1,6}\s*第\s*(?P<num>[0-9]+|[一二三四五六七八九十百]+)\s*章[：:].*$",
            re.MULTILINE,
        )
        matches = list(heading.finditer(content))
        for index, match in enumerate(matches):
            if Engine._parse_chapter_num(match.group("num")) != chapter:
                continue
            end = matches[index + 1].start() if index + 1 < len(matches) else len(content)
            return content[match.start():end].strip()
        return None

    _CN_DIGITS = {
        "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
        "六": 6, "七": 7, "八": 8, "九": 9,
    }

    @staticmethod
    def _parse_chapter_num(value: str) -> Optional[int]:
        text = str(value or "").strip()
        if not text:
            return None
        if text.isdigit():
            return int(text)
        if text == "十":
            return 10
        if "十" in text:
            left, _, right = text.partition("十")
            tens = Engine._CN_DIGITS.get(left, 1 if not left else 0)
            ones = Engine._CN_DIGITS.get(right, 0) if right else 0
            parsed = tens * 10 + ones
            return parsed or None
        parsed = 0
        for char in text:
            digit = Engine._CN_DIGITS.get(char)
            if digit is None:
                return None
            parsed = parsed * 10 + digit
        return parsed or None

    def volume_for_chapter(self, chapter: int) -> int:
        """章节归属的卷号。优先 state.json 的卷规划，回退默认 50 章/卷。"""
        state = self.state_payload()
        progress = state.get("progress")
        if isinstance(progress, dict):
            volumes = progress.get("volumes") or progress.get("volume_plans")
            if isinstance(volumes, list):
                for entry in volumes:
                    if not isinstance(entry, dict):
                        continue
                    rng = entry.get("chapters_range") or entry.get("range")
                    parsed = self._parse_range(rng)
                    if parsed and parsed[0] <= chapter <= parsed[1]:
                        try:
                            return int(entry.get("volume") or entry.get("volume_id") or 1)
                        except (TypeError, ValueError):
                            break
        return (max(1, chapter) - 1) // 50 + 1

    @staticmethod
    def _parse_range(value: Any) -> Optional[tuple]:
        match = re.match(r"^\s*(\d+)\s*-\s*(\d+)\s*$", str(value or ""))
        if not match:
            return None
        start, end = int(match.group(1)), int(match.group(2))
        return (start, end) if start <= end else None

    def save_outline(self, relative_path: str, content: str) -> Path:
        """写入大纲文件（相对项目根）。"""
        if not self.project_root:
            raise EngineError("project_root 未设置")
        path = Path(self.project_root) / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def read_outline(self, relative_path: str) -> Optional[str]:
        return self.read_text(relative_path)

    def master_outline(self) -> Optional[str]:
        return self.read_text("大纲/总纲.md")

    def settings_digest(self) -> Dict[str, str]:
        """读设定集（规划阶段需要）。"""
        out: Dict[str, str] = {}
        if not self.project_root:
            return out
        base = Path(self.project_root) / "设定集"
        if not base.is_dir():
            return out
        for path in sorted(base.glob("*.md")):
            try:
                out[path.name] = path.read_text(encoding="utf-8")
            except OSError:
                continue
        return out

    def update_state(self, *args: str) -> CommandResult:
        return self.run(["update-state", "--", *args], timeout=300)

    def master_outline_sync(self, volume: int, writeback_file: str = "") -> CommandResult:
        argv = ["master-outline-sync", "--volume", str(volume), "--format", "json"]
        if writeback_file:
            argv += ["--writeback-file", writeback_file]
        return self.run(argv, timeout=300)

    def state_payload(self) -> Dict[str, Any]:
        """读 .webnovel/state.json（projection/read-model）。"""
        if not self.project_root:
            return {}
        path = Path(self.project_root) / ".webnovel" / "state.json"
        if not path.is_file():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def resolve_genre(self) -> str:
        """从 state.json 的初始化快照解析题材。

        上游 story-system 的题材路由是硬匹配：genre 为空或非中文题材名会直接
        拒绝生成合同，阻断整个写章链路。所以这里要尽力挖出来。
        """
        state = self.state_payload()
        for container in (
            state.get("project_info"),
            state.get("project"),
            state.get("init_config"),
            state.get("config"),
            state,
        ):
            if not isinstance(container, dict):
                continue
            for key in ("genre", "primary_genre", "题材", "novel_genre"):
                value = container.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
                # 可能是 {"primary_genre": ...} 这类嵌套
                if isinstance(value, dict):
                    inner = value.get("primary_genre") or value.get("genre")
                    if isinstance(inner, str) and inner.strip():
                        return inner.strip()
        return ""

    def review_pipeline(
        self, chapter: int, review_results_path: str,
        metrics_out: str = "", report_file: str = "",
    ) -> CommandResult:
        args = [
            "review-pipeline",
            "--chapter", str(chapter),
            "--review-results", review_results_path,
        ]
        if metrics_out:
            args += ["--metrics-out", metrics_out]
        if report_file:
            args += ["--report-file", report_file]
        args.append("--save-metrics")
        return self.run(args, timeout=300)

    def chapter_commit(
        self, chapter: int, review_result: str,
        fulfillment_result: str = "", disambiguation_result: str = "",
        extraction_result: str = "",
    ) -> CommandResult:
        args = ["chapter-commit", "--chapter", str(chapter),
                "--review-result", review_result]
        if fulfillment_result:
            args += ["--fulfillment-result", fulfillment_result]
        if disambiguation_result:
            args += ["--disambiguation-result", disambiguation_result]
        if extraction_result:
            args += ["--extraction-result", extraction_result]
        return self.run(args, timeout=600)

    def projections_retry(self, chapter: int) -> CommandResult:
        return self.run(
            ["projections", "retry", "--chapter", str(chapter), "--format", "json"],
            timeout=600,
        )

    def backup(self, chapter: int, chapter_title: str = "") -> CommandResult:
        args = ["backup", "--chapter", str(chapter)]
        if chapter_title:
            args += ["--chapter-title", chapter_title]
        return self.run(args, timeout=300)

    def write_resume(self, chapter: int, mode: str = "default") -> Any:
        res = self.run(
            ["run-ledger", "write-resume", "--chapter", str(chapter),
             "--mode", mode, "--format", "json"],
            timeout=180,
        )
        return res.json()

    def record_write_step(
        self, chapter: int, step: str, status: str, mode: str = "default",
        inputs: Optional[Dict[str, str]] = None,
        outputs: Optional[Dict[str, str]] = None,
        problems: Optional[List[str]] = None,
        auto_handled: Optional[List[str]] = None,
        duration_ms: int = 0,
    ) -> CommandResult:
        args = [
            "run-ledger", "record-write-step",
            "--chapter", str(chapter),
            "--step", step,
            "--status", status,
            "--mode", mode,
            "--inputs-json", json.dumps(inputs or {}, ensure_ascii=False),
            "--outputs-json", json.dumps(outputs or {}, ensure_ascii=False),
            "--problems-json", json.dumps(problems or [], ensure_ascii=False),
            "--auto-handled-json", json.dumps(auto_handled or [], ensure_ascii=False),
            "--duration-ms", str(duration_ms),
            "--format", "json",
        ]
        return self.run(args, timeout=120)

    def run_log(self, event: str, payload: Dict[str, Any]) -> CommandResult:
        return self.run(
            ["run-log", "--event", event,
             "--payload-json", json.dumps(payload, ensure_ascii=False),
             "--format", "text"],
            timeout=120,
        )

    def user_report(self, stage: str, chapter: Optional[int] = None,
                    volume: Optional[int] = None) -> str:
        args = ["user-report", "--stage", stage, "--format", "text"]
        if chapter:
            args += ["--chapter", str(chapter)]
        if volume:
            args += ["--volume", str(volume)]
        res = self.run(args, timeout=180)
        return res.text()

    def story_events(self, chapter: int = 0, limit: int = 200,
                     health: bool = False) -> Any:
        args = ["story-events", "--limit", str(limit)]
        if chapter:
            args += ["--chapter", str(chapter)]
        if health:
            args.append("--health")
        return self.run(args, timeout=180).json()

    # ---- 只读查询（给 API 层与 reviewer/data-agent 用）----

    def get_entity(self, entity_id: str) -> Any:
        return self.run(["state", "get-entity", "--id", entity_id],
                        timeout=120).json()

    def get_state_changes(self, limit: int = 20) -> Any:
        return self.run(["index", "get-state-changes", "--limit", str(limit)],
                        timeout=120).json()

    def get_core_entities(self) -> Any:
        return self.run(["index", "get-core-entities"], timeout=120).json()

    def recent_appearances(self, limit: int = 20) -> Any:
        return self.run(["index", "recent-appearances", "--limit", str(limit)],
                        timeout=120).json()

    def get_aliases(self, entity_id: str) -> Any:
        return self.run(["index", "get-aliases", "--entity", entity_id],
                        timeout=120).json()

    # ---- 文件与正文 ----

    def chapter_file(self, chapter: int) -> Optional[Path]:
        """定位正文文件。上游命名是 `正文/第{NNNN}章-{title}.md`。"""
        if not self.project_root:
            return None
        body_dir = Path(self.project_root) / "正文"
        if not body_dir.is_dir():
            return None
        padded = f"{chapter:04d}"
        for pattern in (f"第{padded}章*.md", f"第{chapter}章*.md"):
            hits = sorted(body_dir.glob(pattern))
            if hits:
                return hits[0]
        return None

    def write_chapter_file(self, chapter: int, title: str, content: str) -> Path:
        """写入正文。已存在同名文件时覆盖（上层负责判断是否该覆盖）。"""
        if not self.project_root:
            raise EngineError("project_root 未设置")
        body_dir = Path(self.project_root) / "正文"
        body_dir.mkdir(parents=True, exist_ok=True)
        padded = f"{chapter:04d}"
        safe_title = (title or "").strip().replace("/", "_").replace("\\", "_")
        name = f"第{padded}章-{safe_title}.md" if safe_title else f"第{padded}章.md"
        path = body_dir / name
        path.write_text(content, encoding="utf-8")
        return path

    def read_text(self, relative: str) -> Optional[str]:
        if not self.project_root:
            return None
        path = Path(self.project_root) / relative
        if not path.is_file():
            return None
        return path.read_text(encoding="utf-8")

    def tmp_dir(self) -> Path:
        if not self.project_root:
            raise EngineError("project_root 未设置")
        path = Path(self.project_root) / ".webnovel" / "tmp"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def write_tmp_json(self, name: str, data: Any) -> Path:
        path = self.tmp_dir() / name
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2),
                        encoding="utf-8")
        return path
