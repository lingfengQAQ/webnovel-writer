#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""urgency 字段类型规范化工具。

LLM 生成 commit 时可能把 ``urgency`` 写成自然语言字符串
（``"high"``/``"medium"``/``"low"``），而消费端（``MemoryContractAdapter``、
``status_reporter`` 等）一律按 0-100 数值处理。本模块提供统一入口，
避免 ``float("high")`` 这类 ``ValueError`` 散落各处导致 ``get_open_loops()``
之类调用因 ``except`` 兜底而静默返回空列表。

约定的字符串→数值映射与 ``DataModulesConfig.foreshadowing_urgency_score_*``
对齐：``high≈100``、``medium≈60``、``low≈20``。
"""
from __future__ import annotations

from typing import Any


# 字符串→数值映射；与 config.foreshadowing_urgency_score_* 对齐。
# 留作模块常量是为了让调用方在需要时也能直接引用语义。
_URGENCY_STRING_MAP = {
    "high": 100.0,
    "medium": 60.0,
    "low": 20.0,
}


def coerce_urgency(value: Any, default: float = 0.0) -> float:
    """把任意输入规范化为 0-100 浮点数。

    支持的输入：

    - ``int`` / ``float``：原样转 ``float``。
    - 数字字面量字符串（如 ``"100"``、``"3.14"``、``"1e2"``）：``float()`` 解析后返回。
    - 自然语言字符串（``"high"``/``"medium"``/``"low"``，大小写、空白无关）：
      映射为预设数值。
    - ``None``、空字符串、其他无法解析的值：返回 ``default``。

    设计目标：让消费端不会因为单条字段类型异常而整体崩溃。
    """
    if value is None:
        return default
    if isinstance(value, bool):
        # bool 是 int 的子类，单独排除避免 True→1.0 / False→0.0 这种语义噪声。
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        s = value.strip().lower()
        if not s:
            return default
        if s in _URGENCY_STRING_MAP:
            return _URGENCY_STRING_MAP[s]
        try:
            return float(s)
        except ValueError:
            return default
    return default
