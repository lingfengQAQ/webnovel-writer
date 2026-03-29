#!/usr/bin/env python3
"""
Codex 统一命令入口 - M2 阶段实现

提供以下子命令：
  webnovel codex session start --profile <profile> --project-root <path>
  webnovel codex session stop --session-id <id>
  webnovel codex index status --project-root <path>
  webnovel codex rag verify --project-root <path> --report json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from .incremental_indexer import IncrementalIndexer
    from .rag_verifier import RAGVerifier
    from .session_manager import SessionManager
except ImportError:  # pragma: no cover - script mode fallback
    from incremental_indexer import IncrementalIndexer
    from rag_verifier import RAGVerifier
    from session_manager import SessionManager


def _resolve_project_root(explicit_root: str | None) -> Path:
    """解析项目根目录。"""
    if explicit_root:
        root = Path(explicit_root).expanduser().resolve()
        if not (root / ".webnovel" / "state.json").exists():
            raise FileNotFoundError(f"项目根目录无效（缺少 .webnovel/state.json）: {root}")
        return root

    # 尝试从当前目录向上查找
    cwd = Path.cwd()
    for candidate in (cwd, *cwd.parents):
        if (candidate / ".webnovel" / "state.json").exists():
            return candidate

    raise FileNotFoundError("无法找到项目根目录，请使用 --project-root 指定")


def cmd_session_start(args: argparse.Namespace) -> int:
    """启动会话并加载指定 profile 的 Skill。"""
    try:
        project_root = _resolve_project_root(args.project_root)
        profile = args.profile

        try:
            SessionManager.validate_profile(profile)
        except ValueError as e:
            print(json.dumps({
                "status": "error",
                "error_code": "invalid_profile",
                "message": str(e),
            }, ensure_ascii=False, indent=2), file=sys.stderr)
            return 1

        manager = SessionManager(project_root)
        session_id = manager.create_session(profile)

        result = {
            "status": "ok",
            "session_id": session_id,
            "profile": profile,
            "project_root": str(project_root),
            "message": f"会话已启动: {session_id}（profile: {profile}）",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(json.dumps({
            "status": "error",
            "error_code": "session_start_failed",
            "message": str(exc),
        }, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


def cmd_session_stop(args: argparse.Namespace) -> int:
    """停止会话并清理会话级 Skill。"""
    try:
        session_id = args.session_id
        manager = SessionManager()
        manager.destroy_session(session_id)

        result = {
            "status": "ok",
            "session_id": session_id,
            "message": f"会话已停止: {session_id}",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(json.dumps({
            "status": "error",
            "error_code": "session_stop_failed",
            "message": str(exc),
        }, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


def cmd_index_status(args: argparse.Namespace) -> int:
    """查询索引状态。"""
    try:
        project_root = _resolve_project_root(args.project_root)
        indexer = IncrementalIndexer(project_root)
        status = indexer.get_status()

        result = {
            "status": "ok",
            "project_root": str(project_root),
            "index": status,
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(json.dumps({
            "status": "error",
            "error_code": "index_status_failed",
            "message": str(exc),
        }, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


def cmd_index_watch(args: argparse.Namespace) -> int:
    """启动文件监听，自动触发增量索引。"""
    try:
        # Import guard - check if watchdog is available
        try:
            from .incremental_indexer import FileWatcher
        except ImportError:
            from incremental_indexer import FileWatcher

        if FileWatcher is None:
            print(json.dumps({
                "status": "error",
                "error_code": "watchdog_not_installed",
                "message": "watchdog 未安装。请运行: pip install watchdog",
            }, ensure_ascii=False, indent=2), file=sys.stderr)
            return 1

        project_root = _resolve_project_root(args.project_root)
        indexer = IncrementalIndexer(project_root)
        watcher = FileWatcher(project_root, indexer)

        import time

        watcher.start()

        result = {
            "status": "watching",
            "project_root": str(project_root),
            "watch_dir": str(project_root / "正文"),
            "message": "文件监听已启动，按 Ctrl+C 停止",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))

        try:
            while watcher.is_alive():
                time.sleep(1)
        except KeyboardInterrupt:
            watcher.stop()
            print(json.dumps({"status": "stopped", "message": "文件监听已停止"}, ensure_ascii=False))

        return 0
    except Exception as exc:
        print(json.dumps({
            "status": "error",
            "error_code": "index_watch_failed",
            "message": str(exc),
        }, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


def cmd_rag_verify(args: argparse.Namespace) -> int:
    """验证 RAG 13档指标。"""
    try:
        project_root = _resolve_project_root(args.project_root)
        report_format = args.report or "json"

        verifier = RAGVerifier(project_root)
        report = verifier.verify()

        if report_format == "json":
            print(json.dumps(report, ensure_ascii=False, indent=2))
        else:
            # 简单文本格式
            print(f"RAG 验证报告 - {project_root}")
            print(f"连通性: {report.get('connectivity', {}).get('status', 'unknown')}")
            print(f"正确性: {report.get('correctness', {}).get('status', 'unknown')}")
            print(f"性能: {report.get('performance', {}).get('status', 'unknown')}")

        # 如果任何指标失败，返回非零
        if not report.get("passed", False):
            return 1
        return 0
    except Exception as exc:
        print(json.dumps({
            "status": "error",
            "error_code": "rag_verify_failed",
            "message": str(exc),
        }, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


def main(argv: list[str] | None = None) -> int:
    """主入口。"""
    parser = argparse.ArgumentParser(
        prog="webnovel codex",
        description="Codex 统一命令入口（M2 阶段）",
    )

    subparsers = parser.add_subparsers(dest="command", help="子命令")

    # session start
    session_start_parser = subparsers.add_parser("session", help="会话管理")
    session_subparsers = session_start_parser.add_subparsers(dest="session_command")

    start_parser = session_subparsers.add_parser("start", help="启动会话")
    available_profiles = SessionManager.available_profiles()
    start_parser.add_argument("--profile", required=True, choices=available_profiles if available_profiles else None,
                             help="Skill profile（自动发现可用 profiles）")
    start_parser.add_argument("--project-root", help="项目根目录")
    start_parser.set_defaults(func=cmd_session_start)

    stop_parser = session_subparsers.add_parser("stop", help="停止会话")
    stop_parser.add_argument("--session-id", required=True, help="会话 ID")
    stop_parser.set_defaults(func=cmd_session_stop)

    # index status
    index_parser = subparsers.add_parser("index", help="索引管理")
    index_subparsers = index_parser.add_subparsers(dest="index_command")

    status_parser = index_subparsers.add_parser("status", help="查询索引状态")
    status_parser.add_argument("--project-root", help="项目根目录")
    status_parser.set_defaults(func=cmd_index_status)

    watch_parser = index_subparsers.add_parser("watch", help="监听文件变更并自动索引")
    watch_parser.add_argument("--project-root", help="项目根目录")
    watch_parser.set_defaults(func=cmd_index_watch)

    # rag verify
    rag_parser = subparsers.add_parser("rag", help="RAG 管理")
    rag_subparsers = rag_parser.add_subparsers(dest="rag_command")

    verify_parser = rag_subparsers.add_parser("verify", help="验证 RAG 13档指标")
    verify_parser.add_argument("--project-root", help="项目根目录")
    verify_parser.add_argument("--report", choices=["json", "text"], default="json", help="报告格式")
    verify_parser.set_defaults(func=cmd_rag_verify)

    args = parser.parse_args(argv)

    if not hasattr(args, "func"):
        parser.print_help()
        return 1

    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
