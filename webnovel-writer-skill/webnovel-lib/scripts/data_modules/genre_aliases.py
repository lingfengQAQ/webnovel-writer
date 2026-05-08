#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genre alias normalization and profile key mapping.
"""

from __future__ import annotations


GENRE_INPUT_ALIASES: dict[str, str] = {
    "修仙/玄幻": "修仙",
    "玄幻修仙": "修仙",
    "玄幻": "修仙",
    "修真": "修仙",
    "都市修真": "都市异能",
    "都市高武": "高武",
    "都市奇闻": "都市脑洞",
    "古言脑洞": "古言",
    "游戏电竞": "电竞",
    "电竞文": "电竞",
    "直播": "直播文",
    "直播带货": "直播文",
    "主播": "直播文",
    "克系": "克苏鲁",
    "克系悬疑": "克苏鲁",
}


GENRE_PROFILE_KEY_ALIASES: dict[str, str] = {
    "修仙": "xianxia",
    "修仙/玄幻": "xianxia",
    "玄幻": "xianxia",
    "爽文/系统流": "shuangwen",
    "高武": "xianxia",
    "西幻": "xianxia",
    "都市异能": "urban-power",
    "都市脑洞": "urban-power",
    "都市日常": "urban-power",
    "狗血言情": "romance",
    "古言": "romance",
    "青春甜宠": "romance",
    "替身文": "substitute",
    "规则怪谈": "rules-mystery",
    "悬疑脑洞": "mystery",
    "悬疑灵异": "mystery",
    "知乎短篇": "zhihu-short",
    "电竞": "esports",
    "直播文": "livestream",
    "克苏鲁": "cosmic-horror",
}


def normalize_genre_token(token: str) -> str:
    value = str(token or "").strip()
    if not value:
        return ""
    return GENRE_INPUT_ALIASES.get(value, value)


def to_profile_key(genre: str) -> str:
    value = str(genre or "").strip()
    if not value:
        return ""
    normalized = normalize_genre_token(value)
    return GENRE_PROFILE_KEY_ALIASES.get(normalized, normalized.lower())

