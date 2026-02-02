#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Query router for RAG requests."""
from __future__ import annotations

import re
from typing import List


class QueryRouter:
    def __init__(self):
        self.patterns = {
            "entity": [r"人物", r"角色", r"谁", r"身份", r"别名"],
            "scene": [r"地点", r"场景", r"哪里", r"位置"],
            "setting": [r"设定", r"规则", r"体系", r"世界观"],
            "plot": [r"剧情", r"发生", r"事件", r"经过"],
        }

    def route(self, query: str) -> str:
        for qtype, patterns in self.patterns.items():
            for pat in patterns:
                if re.search(pat, query):
                    return qtype
        return "plot"

    def split(self, query: str) -> List[str]:
        parts = re.split(r"[，,；;以及和]\s*", query)
        return [p.strip() for p in parts if p.strip()]
