#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Data Modules - 配置文件
"""

import os
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class DataModulesConfig:
    """数据模块配置"""

    # ================= 项目路径 =================
    project_root: Path = field(default_factory=lambda: Path.cwd())

    @property
    def webnovel_dir(self) -> Path:
        return self.project_root / ".webnovel"

    @property
    def state_file(self) -> Path:
        return self.webnovel_dir / "state.json"

    @property
    def index_db(self) -> Path:
        return self.webnovel_dir / "index.db"

    @property
    def alias_index_file(self) -> Path:
        return self.webnovel_dir / "alias_index.json"

    @property
    def chapters_dir(self) -> Path:
        return self.project_root / "正文"

    @property
    def settings_dir(self) -> Path:
        return self.project_root / "设定集"

    @property
    def outline_dir(self) -> Path:
        return self.project_root / "大纲"

    # ================= Modal API Endpoints =================
    llm_base_url: str = "https://lingfengqaq--qwen3-30b-vllm-serve.modal.run/v1"
    llm_model: str = "Qwen/Qwen3-30B-A3B-Instruct-2507"

    embed_url: str = "https://lingfengqaq--qwen-embedding-server-qwenembedding-embeddings.modal.run"
    rerank_url: str = "https://lingfengqaq--qwen-reranker-server-qwenreranker-rerank.modal.run"

    # ================= 并发配置 =================
    llm_concurrency: int = 32
    embed_concurrency: int = 64
    rerank_concurrency: int = 32
    embed_batch_size: int = 64

    # ================= 超时配置 =================
    cold_start_timeout: int = 300  # 5 分钟
    normal_timeout: int = 180      # 3 分钟

    # ================= LLM 生成配置 =================
    llm_temperature: float = 0.1
    llm_max_tokens: int = 4096

    # ================= 检索配置 =================
    vector_top_k: int = 30
    bm25_top_k: int = 20
    rerank_top_n: int = 10
    rrf_k: int = 60

    # 向量检索性能开关
    # - 向量数量较少时（<= full_scan_max_vectors）可全表扫描，召回更稳
    # - 规模变大后默认走预筛选（BM25 + 最近片段），避免 O(n) 扫描拖慢 Context Agent
    vector_full_scan_max_vectors: int = 500
    vector_prefilter_bm25_candidates: int = 200
    vector_prefilter_recent_candidates: int = 200

    # ================= 实体提取配置 =================
    extraction_confidence_high: float = 0.8
    extraction_confidence_medium: float = 0.5

    # ================= RAG 存储 =================
    @property
    def rag_db(self) -> Path:
        return self.webnovel_dir / "rag.db"

    @property
    def vector_db(self) -> Path:
        return self.webnovel_dir / "vectors.db"

    def ensure_dirs(self):
        """确保必要目录存在"""
        self.webnovel_dir.mkdir(parents=True, exist_ok=True)

    @classmethod
    def from_project_root(cls, project_root: str | Path) -> "DataModulesConfig":
        """从项目根目录创建配置"""
        return cls(project_root=Path(project_root))


# 全局默认配置
_default_config: Optional[DataModulesConfig] = None


def get_config(project_root: Optional[Path] = None) -> DataModulesConfig:
    """获取配置实例"""
    global _default_config
    if project_root is not None:
        return DataModulesConfig.from_project_root(project_root)
    if _default_config is None:
        _default_config = DataModulesConfig()
    return _default_config


def set_project_root(project_root: str | Path):
    """设置项目根目录"""
    global _default_config
    _default_config = DataModulesConfig.from_project_root(project_root)
