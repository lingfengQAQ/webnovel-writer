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

from runtime_compat import normalize_windows_path

from .context_weights import TEMPLATE_WEIGHTS_DYNAMIC_DEFAULT

def _get_user_claude_root() -> Path:
    raw = os.environ.get("WEBNOVEL_CLAUDE_HOME") or os.environ.get("CLAUDE_HOME")
    if raw:
        try:
            return normalize_windows_path(raw).expanduser().resolve()
        except Exception:
            return normalize_windows_path(raw).expanduser()
    return (Path.home() / ".claude").resolve()


def _load_dotenv_file(env_path: Path, *, override: bool = False) -> bool:
    if not env_path.exists():
        return False
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip()
                    if not key:
                        continue
                    # 默认不覆盖已有环境变量（保持“显式 > .env”优先级）
                    if override or key not in os.environ:
                        os.environ[key] = value
        return True
    except Exception:
        return False


def _load_dotenv():
    """
    加载 .env 文件（best-effort）。

    约定：
    - 项目级 `.env`（当前工作目录下）优先；
    - 全局 `.env` 作为兜底：`~/.claude/webnovel-writer/.env`
    """
    # 1) 当前目录（常见：用户从项目根目录执行）
    _load_dotenv_file(Path.cwd() / ".env", override=False)

    # 2) 用户级全局（常见：skills/agents 全局安装，API key 放这里最省心）
    global_env = _get_user_claude_root() / "webnovel-writer" / ".env"
    _load_dotenv_file(global_env, override=False)


def _load_project_dotenv(project_root: Path) -> None:
    """
    加载某个项目根目录下的 `.env`（best-effort）。
    注意：不覆盖已存在环境变量，避免意外串台。
    """
    try:
        _load_dotenv_file(Path(project_root) / ".env", override=False)
    except Exception:
        return

_load_dotenv()


def _default_context_template_weights_dynamic() -> dict[str, dict[str, dict[str, float]]]:
    return {
        stage: {
            template: dict(weights)
            for template, weights in templates.items()
        }
        for stage, templates in TEMPLATE_WEIGHTS_DYNAMIC_DEFAULT.items()
    }


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
    def scratchpad_file(self) -> Path:
        return self.webnovel_dir / "memory_scratchpad.json"

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

    @property
    def story_system_dir(self) -> Path:
        return self.project_root / ".story-system"

    @property
    def story_system_chapters_dir(self) -> Path:
        return self.story_system_dir / "chapters"

    @property
    def story_system_master_json(self) -> Path:
        return self.story_system_dir / "MASTER_SETTING.json"

    @property
    def story_system_anti_patterns_json(self) -> Path:
        return self.story_system_dir / "anti_patterns.json"


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

    # ================= Graph-RAG 配置 =================
    graph_rag_enabled: bool = False
    graph_rag_expand_hops: int = 1
    graph_rag_max_expanded_entities: int = 30
    graph_rag_candidate_limit: int = 150
    graph_rag_boost_same_entity: float = 0.2
    graph_rag_boost_related_entity: float = 0.1
    graph_rag_boost_recency: float = 0.05

    relationship_graph_from_index_enabled: bool = True

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
    context_ranker_enabled: bool = True
    context_ranker_recency_weight: float = 0.7
    context_ranker_frequency_weight: float = 0.3
    context_ranker_hook_bonus: float = 0.2
    context_ranker_length_bonus_cap: float = 0.2
    context_ranker_alert_critical_keywords: tuple[str, ...] = (
        "冲突",
        "矛盾",
        "critical",
        "break",
        "违规",
        "断裂",
    )
    context_ranker_debug: bool = False
    context_reader_signal_enabled: bool = True
    context_reader_signal_recent_limit: int = 5
    context_reader_signal_window_chapters: int = 20
    context_reader_signal_review_window: int = 5
    context_reader_signal_include_debt: bool = False
    context_genre_profile_enabled: bool = True
    context_genre_profile_max_refs: int = 8
    context_genre_profile_fallback: str = "shuangwen"
    context_compact_text_enabled: bool = True
    context_compact_min_budget: int = 120
    context_compact_head_ratio: float = 0.65
    context_writing_guidance_enabled: bool = True
    context_writing_guidance_max_items: int = 6
    context_writing_guidance_low_score_threshold: float = 75.0
    context_writing_guidance_hook_diversify: bool = True
    context_methodology_enabled: bool = True
    context_methodology_genre_whitelist: tuple[str, ...] = ("*",)
    context_methodology_label: str = "digital-serial-v1"
    context_writing_checklist_enabled: bool = True
    context_writing_checklist_min_items: int = 3
    context_writing_checklist_max_items: int = 6
    context_writing_checklist_default_weight: float = 1.0
    context_writing_score_persist_enabled: bool = True
    context_writing_score_include_reader_trend: bool = True
    context_writing_score_trend_window: int = 10
    context_rag_assist_enabled: bool = True
    context_rag_assist_top_k: int = 4
    context_rag_assist_min_outline_chars: int = 40
    context_rag_assist_max_query_chars: int = 120
    context_dynamic_budget_enabled: bool = True
    context_dynamic_budget_early_chapter: int = 30
    context_dynamic_budget_late_chapter: int = 120
    context_dynamic_budget_early_core_bonus: float = 0.08
    context_dynamic_budget_early_scene_bonus: float = 0.04
    context_dynamic_budget_late_global_bonus: float = 0.08
    context_dynamic_budget_late_scene_penalty: float = 0.06
    context_template_weights_dynamic: dict[str, dict[str, dict[str, float]]] = field(
        default_factory=_default_context_template_weights_dynamic
    )
    context_genre_profile_support_composite: bool = True
    context_genre_profile_max_genres: int = 2
    context_genre_profile_separators: tuple[str, ...] = (
        "+",
        "/",
        "|",
        ",",
        "，",
        "、",
    )
    context_use_memory_orchestrator: bool = False
    memory_orchestrator_max_items: int = 30
    memory_orchestrator_recent_changes_limit: int = 10
    memory_orchestrator_source_window: int = 20
    memory_compactor_enabled: bool = True
    memory_compactor_threshold: int = 500

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
        root = normalize_windows_path(project_root).expanduser().resolve()
        # 在构造配置前加载项目级 `.env`，以确保 EMBED_*/RERANK_* 等字段可生效
        _load_project_dotenv(root)
        return cls(project_root=root)


_default_config: Optional[DataModulesConfig] = None


def get_config(project_root: Optional[Path] = None) -> DataModulesConfig:
    global _default_config
    if project_root is not None:
        return DataModulesConfig.from_project_root(project_root)
    if _default_config is None:
        # 默认不要盲目以 CWD 作为 project_root（很容易写到错误目录）。
        # 使用统一的 project_locator 自动探测：
        # - 支持 WEBNOVEL_PROJECT_ROOT
        # - 支持 `.claude/.webnovel-current-project` 指针文件
        # - 支持从当前目录/父目录寻找 `.webnovel/state.json`
        from project_locator import resolve_project_root

        root = resolve_project_root()
        _default_config = DataModulesConfig.from_project_root(root)
    return _default_config


def set_project_root(project_root: str | Path):
    global _default_config
    _default_config = DataModulesConfig.from_project_root(project_root)
