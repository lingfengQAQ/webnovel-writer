#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Query router for RAG requests."""
from __future__ import annotations

import re
from typing import Any, Dict, List


class QueryRouter:
    def __init__(self):
        self.intent_patterns = {
            "relationship": [r"关系", r"图谱", r"时间线", r"谁和谁", r"敌对", r"盟友"],
            "entity": [r"人物", r"角色", r"谁", r"身份", r"别名"],
            "scene": [r"地点", r"场景", r"哪里", r"位置"],
            "setting": [r"设定", r"规则", r"体系", r"世界观"],
            "plot": [r"剧情", r"发生", r"事件", r"经过"],
        }
        self.patterns = {
            "entity": list(self.intent_patterns["entity"]),
            "scene": list(self.intent_patterns["scene"]),
            "setting": list(self.intent_patterns["setting"]),
            "plot": list(self.intent_patterns["plot"]),
        }

    def _extract_entities(self, query: str) -> List[str]:
        # 轻量启发式提取：提取长度 2-6 的中文短语，过滤常见查询词
        candidates = re.findall(r"[\u4e00-\u9fff]{2,6}", query)
        stopwords = {
            "关系",
            "图谱",
            "时间线",
            "剧情",
            "发生",
            "事件",
            "角色",
            "人物",
            "设定",
            "世界观",
            "地点",
            "场景",
        }
        entities: List[str] = []
        for c in candidates:
            if c in stopwords:
                continue
            if c not in entities:
                entities.append(c)
        return entities[:4]

    def _extract_time_scope(self, query: str) -> Dict[str, Any]:
        m_range = re.search(r"第?\s*(\d+)\s*[-~到]\s*(\d+)\s*章", query)
        if m_range:
            start = int(m_range.group(1))
            end = int(m_range.group(2))
            if start > end:
                start, end = end, start
            return {"from_chapter": start, "to_chapter": end}

        m_single = re.search(r"第?\s*(\d+)\s*章", query)
        if m_single:
            chapter = int(m_single.group(1))
            return {"from_chapter": chapter, "to_chapter": chapter}

        return {}

    def route_intent(self, query: str) -> Dict[str, Any]:
        query = str(query or "")
        intent = "plot"
        for intent_name, patterns in self.intent_patterns.items():
            if any(re.search(pat, query) for pat in patterns):
                intent = intent_name
                break

        time_scope = self._extract_time_scope(query)
        entities = self._extract_entities(query)
        needs_graph = intent == "relationship" or "关系" in query or "图谱" in query
        return {
            "intent": intent,
            "entities": entities,
            "time_scope": time_scope,
            "needs_graph": needs_graph,
            "raw_query": query,
        }

    def plan_subqueries(self, intent_payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        intent = str((intent_payload or {}).get("intent") or "plot")
        entities = list((intent_payload or {}).get("entities") or [])
        time_scope = dict((intent_payload or {}).get("time_scope") or {})
        needs_graph = bool((intent_payload or {}).get("needs_graph"))

        steps: List[Dict[str, Any]] = []
        if intent == "relationship":
            steps.append(
                {
                    "name": "relationship_graph",
                    "strategy": "graph_lookup",
                    "entities": entities,
                    "time_scope": time_scope,
                }
            )
            steps.append(
                {
                    "name": "relationship_evidence",
                    "strategy": "graph_hybrid",
                    "entities": entities,
                    "time_scope": time_scope,
                }
            )
            return steps

        if needs_graph and entities:
            steps.append(
                {
                    "name": "graph_enhanced_retrieval",
                    "strategy": "graph_hybrid",
                    "entities": entities,
                    "time_scope": time_scope,
                }
            )
            return steps

        strategy_map = {
            "entity": "hybrid",
            "scene": "bm25",
            "setting": "bm25",
            "plot": "hybrid",
        }
        steps.append(
            {
                "name": "default_retrieval",
                "strategy": strategy_map.get(intent, "hybrid"),
                "entities": entities,
                "time_scope": time_scope,
            }
        )
        return steps

    def route(self, query: str) -> str:
        return str(self.route_intent(query).get("intent") or "plot")

    def split(self, query: str) -> List[str]:
        parts = re.split(r"[，,；;以及和]\s*", query)
        return [p.strip() for p in parts if p.strip()]
