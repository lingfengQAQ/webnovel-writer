#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Data Modules - 配置文件

API 配置通过环境变量读取（支持 .env 文件）：
- EMBED_BASE_URL, EMBED_MODEL, EMBED_API_KEY
- RERANK_BASE_URL, RERANK_MODEL, RERANK_API_KEY
"""

import os
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

# 加载 .env 文件
def _load_dotenv():
    """从项目根目录加载 .env 文件"""
    # 尝试多个可能的位置
    possible_paths = [
        Path.cwd() / ".env",
        Path(__file__).parent.parent.parent.parent / ".env",  # .claude/scripts/data_modules -> 项目根目录
    ]

    for env_path in possible_paths:
        if env_path.exists():
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, _, value = line.partition("=")
                        key = key.strip()
                        value = value.strip()
                        # 只在环境变量未设置时才从 .env 加载
                        if key and key not in os.environ:
                            os.environ[key] = value
            break

_load_dotenv()


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

    # v5.1 引入: alias_index_file 已废弃，别名存储在 index.db aliases 表

    @property
    def chapters_dir(self) -> Path:
        return self.project_root / "正文"

    @property
    def settings_dir(self) -> Path:
        return self.project_root / "设定集"

    @property
    def outline_dir(self) -> Path:
        return self.project_root / "大纲"


    # ================= Embedding API 配置 =================
    embed_api_type: str = "openai"
    embed_base_url: str = field(default_factory=lambda: os.getenv("EMBED_BASE_URL", "https://api-inference.modelscope.cn/v1"))
    embed_model: str = field(default_factory=lambda: os.getenv("EMBED_MODEL", "Qwen/Qwen3-Embedding-8B"))
    embed_api_key: str = field(default_factory=lambda: os.getenv("EMBED_API_KEY", ""))

    @property
    def embed_url(self) -> str:
        return self.embed_base_url

    # ================= Rerank API 配置 =================
    rerank_api_type: str = "openai"
    rerank_base_url: str = field(default_factory=lambda: os.getenv("RERANK_BASE_URL", "https://api.jina.ai/v1"))
    rerank_model: str = field(default_factory=lambda: os.getenv("RERANK_MODEL", "jina-reranker-v3"))
    rerank_api_key: str = field(default_factory=lambda: os.getenv("RERANK_API_KEY", ""))

    @property
    def rerank_url(self) -> str:
        return self.rerank_base_url

    # ================= 并发配置 =================
    embed_concurrency: int = 64
    rerank_concurrency: int = 32
    embed_batch_size: int = 64

    # ================= 超时配置 =================
    cold_start_timeout: int = 300
    normal_timeout: int = 180

    # ================= 重试配置 =================
    api_max_retries: int = 3  # 最大重试次数
    api_retry_delay: float = 1.0  # 初始重试延迟（秒），使用指数退避

    # ================= 检索配置 =================
    vector_top_k: int = 30
    bm25_top_k: int = 20
    rerank_top_n: int = 10
    rrf_k: int = 60

    vector_full_scan_max_vectors: int = 500
    vector_prefilter_bm25_candidates: int = 200
    vector_prefilter_recent_candidates: int = 200

    # ================= 实体提取配置 =================
    extraction_confidence_high: float = 0.8
    extraction_confidence_medium: float = 0.5

    # ================= 列表截断限制 =================
    max_disambiguation_warnings: int = 500
    max_disambiguation_pending: int = 1000
    max_state_changes: int = 2000

    context_recent_summaries_window: int = 3
    context_recent_meta_window: int = 3
    context_alerts_slice: int = 10
    context_max_appearing_characters: int = 10
    context_max_urgent_foreshadowing: int = 5
    context_story_skeleton_interval: int = 20
    context_story_skeleton_max_samples: int = 5
    context_story_skeleton_snippet_chars: int = 400
    context_extra_section_budget: int = 800

    export_recent_changes_slice: int = 20
    export_disambiguation_slice: int = 20

    # ================= 查询默认限制 =================
    query_recent_chapters_limit: int = 10
    query_scenes_by_location_limit: int = 20
    query_entity_appearances_limit: int = 50
    query_recent_appearances_limit: int = 20

    # ================= 伏笔紧急度 =================
    foreshadowing_urgency_pending_high: int = 100
    foreshadowing_urgency_pending_medium: int = 50
    foreshadowing_urgency_target_proximity: int = 5
    foreshadowing_urgency_score_high: int = 100
    foreshadowing_urgency_score_medium: int = 60
    foreshadowing_urgency_score_target: int = 80
    foreshadowing_urgency_score_low: int = 20
    foreshadowing_urgency_threshold_show: int = 60

    foreshadowing_tier_weight_core: float = 3.0
    foreshadowing_tier_weight_sub: float = 2.0
    foreshadowing_tier_weight_decor: float = 1.0

    # ================= 角色活跃度 =================
    character_absence_warning: int = 30
    character_absence_critical: int = 100
    character_candidates_limit: int = 800

    # ================= Strand Weave 节奏 =================
    strand_quest_max_consecutive: int = 5
    strand_fire_max_gap: int = 10
    strand_constellation_max_gap: int = 15

    strand_quest_ratio_min: int = 55
    strand_quest_ratio_max: int = 65
    strand_fire_ratio_min: int = 20
    strand_fire_ratio_max: int = 30
    strand_constellation_ratio_min: int = 10
    strand_constellation_ratio_max: int = 20

    # ================= 爽点节奏 =================
    pacing_segment_size: int = 100
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
        self.webnovel_dir.mkdir(parents=True, exist_ok=True)

    @classmethod
    def from_project_root(cls, project_root: str | Path) -> "DataModulesConfig":
        return cls(project_root=Path(project_root))


_default_config: Optional[DataModulesConfig] = None


def get_config(project_root: Optional[Path] = None) -> DataModulesConfig:
    global _default_config
    if project_root is not None:
        return DataModulesConfig.from_project_root(project_root)
    if _default_config is None:
        _default_config = DataModulesConfig()
    return _default_config


def set_project_root(project_root: str | Path):
    global _default_config
    _default_config = DataModulesConfig.from_project_root(project_root)
