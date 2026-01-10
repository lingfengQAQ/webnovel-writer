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
    # 注意：以下为默认 Modal 端点，可通过环境变量或显式传参覆盖
    llm_base_url: str = "https://lingfengqaq--qwen3-30b-vllm-serve.modal.run/v1"
    llm_model: str = "Qwen/Qwen3-30B-A3B-Instruct-2507"

    # ================= Embedding API 配置 =================
    # api_type: "openai" (通用 OpenAI 兼容接口) | "modal" (Modal 自定义接口)
    embed_api_type: str = "openai"
    embed_base_url: str = "https://lingfengqaq--qwen-embedding-server-qwenembedding-embeddings.modal.run"
    embed_model: str = "qwen-embedding"
    embed_api_key: str = ""  # OpenAI 兼容接口需要 API Key

    # 保留旧字段兼容
    @property
    def embed_url(self) -> str:
        """兼容旧代码：返回 embed_base_url"""
        return self.embed_base_url

    # ================= Rerank API 配置 =================
    # api_type: "openai" (如 Jina/Cohere 兼容接口) | "modal" (Modal 自定义接口)
    rerank_api_type: str = "modal"
    rerank_base_url: str = "https://lingfengqaq--qwen-reranker-server-qwenreranker-rerank.modal.run"
    rerank_model: str = "qwen-reranker"
    rerank_api_key: str = ""  # Jina/Cohere 等需要 API Key

    # 保留旧字段兼容
    @property
    def rerank_url(self) -> str:
        """兼容旧代码：返回 rerank_base_url"""
        return self.rerank_base_url

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

    # ================= 列表截断限制 =================
    # state.json 列表最大保留条数
    max_disambiguation_warnings: int = 500
    max_disambiguation_pending: int = 1000
    max_state_changes: int = 2000

    # Context Pack 输出切片
    context_recent_summaries_window: int = 5
    context_alerts_slice: int = 10
    context_max_appearing_characters: int = 10
    context_max_urgent_foreshadowing: int = 5

    # 导出上下文时的列表截断
    export_recent_changes_slice: int = 20
    export_disambiguation_slice: int = 20

    # ================= 查询默认限制 =================
    query_recent_chapters_limit: int = 10
    query_scenes_by_location_limit: int = 20
    query_entity_appearances_limit: int = 50
    query_recent_appearances_limit: int = 20

    # ================= 伏笔紧急度 =================
    # 紧急度阈值（基于 章节差 / 目标差 × 权重）
    foreshadowing_urgency_pending_high: int = 100  # 超过 100 章未回收
    foreshadowing_urgency_pending_medium: int = 50  # 超过 50 章
    foreshadowing_urgency_target_proximity: int = 5  # 距目标章节 5 章内
    foreshadowing_urgency_score_high: int = 100
    foreshadowing_urgency_score_medium: int = 60
    foreshadowing_urgency_score_target: int = 80
    foreshadowing_urgency_score_low: int = 20
    foreshadowing_urgency_threshold_show: int = 60  # >= 此值才显示

    # 层级权重
    foreshadowing_tier_weight_core: float = 3.0
    foreshadowing_tier_weight_sub: float = 2.0
    foreshadowing_tier_weight_decor: float = 1.0

    # ================= 角色活跃度 =================
    character_absence_warning: int = 30  # 轻度掉线阈值
    character_absence_critical: int = 100  # 严重掉线阈值
    character_candidates_limit: int = 800  # 扫描时候选角色上限

    # ================= Strand Weave 节奏 =================
    strand_quest_max_consecutive: int = 5  # Quest 线最大连续章数
    strand_fire_max_gap: int = 10  # Fire 线最大缺失章数
    strand_constellation_max_gap: int = 15  # Constellation 线最大缺失章数

    # 目标占比范围 (%)
    strand_quest_ratio_min: int = 55
    strand_quest_ratio_max: int = 65
    strand_fire_ratio_min: int = 20
    strand_fire_ratio_max: int = 30
    strand_constellation_ratio_min: int = 10
    strand_constellation_ratio_max: int = 20

    # ================= 爽点节奏 =================
    pacing_segment_size: int = 100  # 每段分析的章节数
    pacing_words_per_point_excellent: int = 1000
    pacing_words_per_point_good: int = 1500
    pacing_words_per_point_acceptable: int = 2000

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
