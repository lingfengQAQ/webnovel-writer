#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""urgency_utils.coerce_urgency 单元测试。"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import pytest

# 确保 scripts/ 在 sys.path 中
_scripts_dir = str(Path(__file__).resolve().parent.parent.parent)
if _scripts_dir not in sys.path:
    sys.path.insert(0, _scripts_dir)

from data_modules.urgency_utils import coerce_urgency


class TestCoerceUrgencyNumeric:
    """数值输入直接通过。"""

    def test_int_input(self):
        assert coerce_urgency(80) == 80.0

    def test_float_input(self):
        assert coerce_urgency(0.9) == pytest.approx(0.9)

    def test_zero(self):
        assert coerce_urgency(0) == 0.0

    def test_large_number_not_clamped(self):
        # 当前实现不夹紧上界，仅做规范化；如果将来需要 clamp，再单独加。
        assert coerce_urgency(150) == 150.0

    def test_negative_number_preserved(self):
        # 负数语义虽然不常用，但 coerce 不应该静默修改它。
        assert coerce_urgency(-5) == -5.0


class TestCoerceUrgencyString:
    """字符串输入被映射或解析。"""

    @pytest.mark.parametrize(
        "label,expected",
        [
            ("high", 100.0),
            ("HIGH", 100.0),
            ("  High  ", 100.0),
            ("medium", 60.0),
            ("Medium", 60.0),
            ("low", 20.0),
        ],
    )
    def test_natural_language_label(self, label, expected):
        assert coerce_urgency(label) == expected

    @pytest.mark.parametrize(
        "numeric_str,expected",
        [
            ("100", 100.0),
            ("3.14", 3.14),
            ("1e2", 100.0),
            (" 42 ", 42.0),
        ],
    )
    def test_numeric_string(self, numeric_str, expected):
        assert coerce_urgency(numeric_str) == pytest.approx(expected)

    def test_unknown_label_returns_default(self):
        # "critical"/"urgent" 等未在映射表里 → 走 default
        assert coerce_urgency("critical") == 0.0
        assert coerce_urgency("critical", default=50.0) == 50.0

    def test_empty_string_returns_default(self):
        assert coerce_urgency("") == 0.0
        assert coerce_urgency("   ") == 0.0

    def test_invalid_string_does_not_raise(self):
        """关键：旧版本会 raise，新版本必须安全返回 default。"""
        try:
            result = coerce_urgency("not-a-number")
        except Exception as e:  # pragma: no cover - regression guard
            pytest.fail(f"coerce_urgency should not raise on invalid string: {e}")
        assert result == 0.0


class TestCoerceUrgencyOther:
    """其他类型/边界情况。"""

    def test_none(self):
        assert coerce_urgency(None) == 0.0

    def test_none_with_custom_default(self):
        assert coerce_urgency(None, default=42.0) == 42.0

    def test_bool_returns_default(self):
        # bool 是 int 子类，但语义不是 urgency；显式返回 default。
        assert coerce_urgency(True) == 0.0
        assert coerce_urgency(False) == 0.0

    def test_list_returns_default(self):
        assert coerce_urgency([100]) == 0.0

    def test_dict_returns_default(self):
        assert coerce_urgency({"urgency": 100}) == 0.0


class TestRegressionOriginalBug:
    """复现 Issue：data-agent 输出字符串 urgency 导致下游 ValueError。"""

    def test_high_no_longer_raises(self):
        """旧代码 float("high") 抛 ValueError，新代码必须正常返回。"""
        result = coerce_urgency("high")
        assert math.isfinite(result)
        assert result > 0
