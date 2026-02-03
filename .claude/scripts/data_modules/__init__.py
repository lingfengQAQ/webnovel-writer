#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Data Modules - 数据链模块包

用于 webnovel-writer 的数据处理：
- 实体消歧 (entity_linker)
- 状态管理 (state_manager)
- 索引管理 (index_manager)
- RAG 检索 (rag_adapter)
- 风格样本 (style_sampler)
- API 客户端 (api_client) - 只有 Embed + Rerank
"""

from .config import DataModulesConfig, get_config, set_project_root
from .api_client import ModalAPIClient, get_client
from .entity_linker import EntityLinker, DisambiguationResult
from .state_manager import StateManager, EntityState, Relationship, StateChange
from .index_manager import IndexManager, ChapterMeta, SceneMeta, ReviewMetrics
from .rag_adapter import RAGAdapter, SearchResult
from .context_manager import ContextManager
from .snapshot_manager import SnapshotManager
from .query_router import QueryRouter
from .style_sampler import StyleSampler, StyleSample, SceneType

__all__ = [
    # Config
    "DataModulesConfig",
    "get_config",
    "set_project_root",
    # API Client
    "ModalAPIClient",
    "get_client",
    # Entity Linker
    "EntityLinker",
    "DisambiguationResult",
    # State Manager
    "StateManager",
    "EntityState",
    "Relationship",
    "StateChange",
    # Index Manager
    "IndexManager",
    "ChapterMeta",
    "SceneMeta",
    "ReviewMetrics",
    # RAG Adapter
    "RAGAdapter",
    "SearchResult",
    "ContextManager",
    "SnapshotManager",
    "QueryRouter",
    # Style Sampler
    "StyleSampler",
    "StyleSample",
    "SceneType",
]
