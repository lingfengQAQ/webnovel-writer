#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genre profile parsing helpers for ContextManager.
"""

from __future__ import annotations

import re
from typing import List

from .genre_aliases import normalize_genre_token


def parse_genre_tokens(
    genre_raw: str,
    *,
    support_composite: bool,
    separators: tuple[str, ...],
) -> List[str]:
    text = str(genre_raw or "").strip()
    if not text:
        return []

    if not support_composite:
        normalized_single = normalize_genre_token(text)
        return [normalized_single] if normalized_single else [text]

    pattern = "|".join(re.escape(str(token)) for token in separators if str(token))
    if not pattern:
        normalized_single = normalize_genre_token(text)
        return [normalized_single] if normalized_single else [text]

    tokens = [chunk.strip() for chunk in re.split(pattern, text) if chunk and chunk.strip()]
    deduped: List[str] = []
    seen = set()
    for token in tokens:
        normalized_token = normalize_genre_token(token)
        if not normalized_token:
            continue
        lower = normalized_token.lower()
        if lower in seen:
            continue
        seen.add(lower)
        deduped.append(normalized_token)
    if deduped:
        return deduped

    fallback_token = normalize_genre_token(text)
    return [fallback_token] if fallback_token else [text]


def extract_genre_section(text: str, genre: str) -> str:
    if not text:
        return ""
    lines = text.splitlines()
    capture: List[str] = []
    active = False
    target = genre.strip().lower()

    for line in lines:
        normalized = line.strip().lower()
        if normalized.startswith("## ") or normalized.startswith("### "):
            if active:
                break
            active = target in normalized
            if active:
                capture.append(line)
            continue
        if active:
            capture.append(line)

    if capture:
        return "\n".join(capture).strip()

    return "\n".join(lines[:80]).strip()


def extract_markdown_refs(text: str, max_items: int = 8) -> List[str]:
    if not text:
        return []
    refs: List[str] = []
    for line in text.splitlines():
        row = line.strip().lstrip("-*").strip()
        if not row or row.startswith("#"):
            continue
        refs.append(row)
        if len(refs) >= max(1, max_items):
            break
    return refs


def build_composite_genre_hints(genres: List[str], refs: List[str]) -> List[str]:
    if len(genres) <= 1:
        return []

    primary = genres[0]
    secondaries = genres[1:]
    hints: List[str] = []
    hints.append(
        f"以“{primary}”作为主引擎推进主线，每章至少保留1处“{'/'.join(secondaries)}”特征表达。"
    )
    if refs:
        hints.append(f"复合题材执行参考：{refs[0]}")
    hints.append("主辅题材冲突时，优先保证主题材读者承诺，辅题材用于制造新鲜感。")
    return hints

