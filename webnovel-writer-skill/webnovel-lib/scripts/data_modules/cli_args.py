#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CLI 参数兼容工具。

背景：
- data_modules 下的 CLI 普遍使用 argparse + subparsers。
- argparse 的全局参数（例如 --project-root）要求出现在子命令之前：
    python -m data_modules.index_manager --project-root X get-core-entities
  但实际写作流程里（skills/agents 文档、工具调用）经常把 --project-root 放在子命令之后：
    python -m data_modules.index_manager get-core-entities --project-root X
  这会直接报 "unrecognized arguments"（见 issues7 日志）。

这里提供一个轻量的 argv 预处理：把 --project-root 从任意位置提取出来并前置，
让原有 argparse 定义无需大改即可兼容两种写法。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any
from typing import List, Optional, Tuple


def _extract_flag_value(argv: List[str], flag: str) -> Tuple[Optional[str], List[str]]:
    """
    Extract a flag value from argv.

    Supports:
    - --flag VALUE
    - --flag=VALUE

    Returns:
    - (value, remaining_argv)
    - value uses the *last* occurrence when repeated.
    - if a dangling `--flag` has no value, it is kept in remaining_argv for argparse to raise.
    """
    value: Optional[str] = None
    rest: List[str] = []
    i = 0
    while i < len(argv):
        token = argv[i]
        if token == flag:
            if i + 1 < len(argv):
                value = argv[i + 1]
                i += 2
                continue
            # Dangling flag; keep it so argparse can error out properly.
            rest.append(token)
            i += 1
            continue
        if token.startswith(flag + "="):
            value = token.split("=", 1)[1]
            i += 1
            continue
        rest.append(token)
        i += 1
    return value, rest


def normalize_global_project_root(argv: List[str], *, flag: str = "--project-root") -> List[str]:
    """
    Normalize argv so a global `--project-root` (when present) is moved before subcommands.

    This makes argparse+subparsers accept both:
    - `... --project-root X cmd ...`
    - `... cmd ... --project-root X`
    """
    value, rest = _extract_flag_value(argv, flag)
    if value is None:
        return argv
    return [flag, value] + rest


def load_json_arg(raw: str) -> Any:
    """
    解析 CLI 传入的 JSON 参数，支持两种形式：
    - 直接 JSON 字符串：'{"a":1}'
    - @ 文件路径：'@data.json'（从文件读取 JSON，避免 shell 引号地狱）
      - 特例：'@-' 表示从 stdin 读取
    """
    if raw is None:
        raise ValueError("missing json arg")
    text = str(raw).strip()
    if text.startswith("@"):
        target = text[1:].strip()
        if not target:
            raise ValueError("invalid json arg: '@' without path")
        if target == "-":
            content = sys.stdin.read()
        else:
            content = Path(target).read_text(encoding="utf-8")
        return json.loads(content)
    return json.loads(text)
