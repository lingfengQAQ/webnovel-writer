#!/usr/bin/env python3
"""
可视化状态报告系统 (Status Reporter)

核心理念：面对 1000 个章节，作者会迷失。需要"宏观俯瞰"能力。

功能：
1. 角色活跃度分析：哪些角色太久没出场（掉线统计）
2. 伏笔深度分析：哪些坑挖得太久了（超过 20 万字未收）+ 紧急度排序
3. 爽点节奏分布：全书高潮点的分布频率（热力图）
4. 字数分布统计：各卷、各篇的字数分布
5. 人际关系图谱：好感度/仇恨度趋势
6. Strand Weave 节奏分析：Quest/Fire/Constellation 三线占比统计
7. 伏笔紧急度排序：基于三层级系统（核心/支线/装饰）的优先级计算

输出格式：
  - Markdown 报告（.webnovel/health_report.md）
  - 包含 Mermaid 图表（角色关系图、爽点热力图）

使用方式：
  # 生成完整健康报告
  python status_reporter.py --output .webnovel/health_report.md

  # 仅分析角色活跃度
  python status_reporter.py --focus characters

  # 仅分析伏笔
  python status_reporter.py --focus foreshadowing

  # 仅分析爽点节奏
  python status_reporter.py --focus pacing

  # 分析 Strand Weave 节奏
  python status_reporter.py --focus strand

报告示例：
  # 全书健康报告

  ## 📊 基本数据

  - **总章节数**: 450 章
  - **总字数**: 1,985,432 字
  - **平均章节字数**: 4,412 字
  - **创作进度**: 99.3%（目标 200万字）

  ## ⚠️ 角色掉线（3人）

  | 角色 | 最后出场 | 缺席章节 | 状态 |
  |------|---------|---------|------|
  | 李雪 | 第 350 章 | 100 章 | 🔴 严重掉线 |
  | 血煞门主 | 第 300 章 | 150 章 | 🔴 严重掉线 |
  | 天云宗宗主 | 第 400 章 | 50 章 | 🟡 轻度掉线 |

  ## ⚠️ 伏笔超时（2条）

  | 伏笔内容 | 埋设章节 | 已过章节 | 状态 |
  |---------|---------|---------|------|
  | "林家宝库铭文的秘密" | 第 200 章 | 250 章 | 🔴 严重超时 |
  | "神秘玉佩的来历" | 第 270 章 | 180 章 | 🟡 轻度超时 |

  ## 📈 爽点节奏分布

  ```
  第 1-100 章   ████████████ 优秀（1200字/爽点）
  第 101-200章  ██████████ 良好（1500字/爽点）
  第 201-300章  ████████ 良好（1600字/爽点）
  第 301-400章  ████ 偏低（2200字/爽点）⚠️
  第 401-450章  ██████ 良好（1550字/爽点）
  ```

  ## 💑 人际关系趋势

  ```mermaid
  graph LR
    主角 -->|好感度95| 李雪
    主角 -->|好感度60| 慕容雪
    主角 -->|仇恨度100| 血煞门
  ```
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from chapter_paths import extract_chapter_num_from_filename
from project_locator import resolve_project_root
from runtime_compat import enable_windows_utf8_stdio

# 导入配置
try:
    from data_modules.config import get_config
    from data_modules.index_manager import IndexManager
    from data_modules.state_validator import (
        get_chapter_meta_entry,
        is_resolved_foreshadowing_status,
        normalize_foreshadowing_tier,
        normalize_state_runtime_sections,
        resolve_chapter_field,
        to_positive_int,
    )
except ImportError:
    from scripts.data_modules.config import get_config
    from scripts.data_modules.index_manager import IndexManager
    from scripts.data_modules.state_validator import (
        get_chapter_meta_entry,
        is_resolved_foreshadowing_status,
        normalize_foreshadowing_tier,
        normalize_state_runtime_sections,
        resolve_chapter_field,
        to_positive_int,
    )

def _is_resolved_foreshadowing_status(raw_status: Any) -> bool:
    """判断伏笔是否已回收（兼容历史字段与同义词）。"""
    return is_resolved_foreshadowing_status(raw_status)

def _enable_windows_utf8_stdio() -> None:
    """在 Windows 下启用 UTF-8 输出；pytest 环境跳过以避免捕获冲突。"""
    enable_windows_utf8_stdio(skip_in_pytest=True)


class StatusReporter:
    """状态报告生成器"""

    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.config = get_config(self.project_root)
        self.state_file = self.project_root / ".webnovel/state.json"
        self.chapters_dir = self.project_root / "正文"

        self.state = None
        self.chapters_data = []
        self._reading_power_cache: dict[int, dict[str, Any] | None] = {}

        # v5.1 引入: 使用 IndexManager 读取实体
        self._index_manager = IndexManager(self.config)

    def _now(self) -> datetime:
        """返回带本地时区的当前时间。"""
        return datetime.now().astimezone()

    def _to_iso8601(self, dt: datetime) -> str:
        """统一时间格式，避免 JSON schema 漂移。"""
        return dt.isoformat(timespec="seconds")

    def _format_age(self, age_seconds: int | None) -> str:
        """将秒数转成易读延迟文本。"""
        if age_seconds is None:
            return "未知"

        if age_seconds < 60:
            return f"{age_seconds}s"
        minutes, seconds = divmod(age_seconds, 60)
        if minutes < 60:
            return f"{minutes}m{seconds}s"
        hours, minutes = divmod(minutes, 60)
        if hours < 24:
            return f"{hours}h{minutes}m"
        days, hours = divmod(hours, 24)
        return f"{days}d{hours}h"

    def _collect_source_freshness(self, generated_at: datetime | None = None) -> dict[str, dict[str, Any]]:
        """收集 state/index 数据源更新时间与新鲜度。"""
        now = generated_at or self._now()

        def _file_status(source: str, path: Path) -> dict[str, Any]:
            status: dict[str, Any] = {
                "source": source,
                "path": str(path),
                "exists": path.exists(),
                "updated_at": None,
                "age_seconds": None,
                "delay": "未知",
                "freshness": "missing",
            }
            if not path.exists():
                return status

            try:
                mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=now.tzinfo)
            except OSError:
                return status

            age_seconds = max(0, int((now - mtime).total_seconds()))
            stale_after_seconds = max(
                1,
                int(getattr(self.config, "status_data_freshness_warn_hours", 24) * 3600),
            )

            status["updated_at"] = self._to_iso8601(mtime)
            status["age_seconds"] = age_seconds
            status["delay"] = self._format_age(age_seconds)
            status["freshness"] = "fresh" if age_seconds <= stale_after_seconds else "stale"
            return status

        return {
            "state": _file_status("state", self.state_file),
            "index": _file_status("index", self.config.index_db),
        }

    def _worst_freshness(self, freshness_values: list[str]) -> str:
        rank = {"fresh": 0, "stale": 1, "missing": 2}
        worst = "fresh"
        worst_rank = -1
        for value in freshness_values:
            current_rank = rank.get(value, 2)
            if current_rank > worst_rank:
                worst_rank = current_rank
                worst = value
        return worst

    def _build_metric_sources(self, source_status: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
        """输出每类指标的数据来源与整体延迟。"""
        metric_mapping = {
            "basic": ["state"],
            "characters": ["index", "state"],
            "foreshadowing": ["state"],
            "urgency": ["state"],
            "pacing": ["index", "state"],
            "strand": ["state"],
            "relationships": ["index", "state"],
        }

        result: dict[str, dict[str, Any]] = {}
        for metric, dependencies in metric_mapping.items():
            entries = [source_status[name] for name in dependencies if name in source_status]
            ages = [entry["age_seconds"] for entry in entries if isinstance(entry.get("age_seconds"), int)]
            freshness_values = [str(entry.get("freshness", "missing")) for entry in entries]
            result[metric] = {
                "depends_on": dependencies,
                "freshness": self._worst_freshness(freshness_values),
                "max_age_seconds": max(ages) if ages else None,
                "entries": entries,
            }
        return result

    def _extract_stats_field(self, content: str, field_name: str) -> str:
        """
        从“本章统计”区块提取字段值，例如：
        - **主导Strand**: quest
        """
        pattern = rf"^\s*-\s*\*\*{re.escape(field_name)}\*\*\s*:\s*(.+?)\s*$"
        for line in content.splitlines():
            m = re.match(pattern, line)
            if m:
                return m.group(1).strip()
        return ""

    def load_state(self) -> bool:
        """加载 state.json"""
        if not self.state_file.exists():
            print(f"❌ 状态文件不存在: {self.state_file}")
            return False

        with open(self.state_file, encoding='utf-8') as f:
            self.state = json.load(f)

        if isinstance(self.state, dict):
            self.state = normalize_state_runtime_sections(self.state)

        return True

    def _to_positive_int(self, value: Any) -> int | None:
        """将输入解析为正整数；解析失败返回 None。"""
        return to_positive_int(value)

    def _normalize_foreshadowing_tier(self, raw_tier: Any) -> tuple[str, float]:
        """标准化伏笔层级并返回对应权重。"""
        tier = normalize_foreshadowing_tier(raw_tier)

        if tier == "核心":
            return "核心", self.config.foreshadowing_tier_weight_core
        if tier == "装饰":
            return "装饰", self.config.foreshadowing_tier_weight_decor
        return "支线", self.config.foreshadowing_tier_weight_sub

    def _resolve_chapter_field(self, item: dict[str, Any], keys: list[str]) -> int | None:
        """按候选键顺序读取章节号。"""
        return resolve_chapter_field(item, keys)

    def _collect_foreshadowing_records(self) -> list[dict[str, Any]]:
        """收集未回收伏笔，并基于真实字段构建分析记录。"""
        if not self.state:
            return []

        current_chapter = self.state.get("progress", {}).get("current_chapter", 0)
        plot_threads = self.state.get("plot_threads", {}) if isinstance(self.state.get("plot_threads"), dict) else {}
        foreshadowing = plot_threads.get("foreshadowing", [])
        if not isinstance(foreshadowing, list):
            return []

        records: list[dict[str, Any]] = []
        for item in foreshadowing:
            if not isinstance(item, dict):
                continue
            if _is_resolved_foreshadowing_status(item.get("status")):
                continue

            content = str(item.get("content") or "").strip() or "[未命名伏笔]"
            tier, weight = self._normalize_foreshadowing_tier(item.get("tier"))

            planted_chapter = self._resolve_chapter_field(
                item,
                [
                    "planted_chapter",
                    "added_chapter",
                    "source_chapter",
                    "start_chapter",
                    "chapter",
                ],
            )
            target_chapter = self._resolve_chapter_field(
                item,
                [
                    "target_chapter",
                    "due_chapter",
                    "deadline_chapter",
                    "resolve_by_chapter",
                    "target",
                ],
            )

            elapsed = None
            if planted_chapter is not None:
                elapsed = max(0, current_chapter - planted_chapter)

            remaining = None
            if target_chapter is not None:
                remaining = target_chapter - current_chapter

            if remaining is not None and remaining < 0:
                overtime_status = "🔴 已超期"
            elif elapsed is None:
                overtime_status = "⚪ 数据不足"
            else:
                overtime_status = self._get_foreshadowing_status(elapsed)

            urgency: float | None = None
            if (
                planted_chapter is not None
                and target_chapter is not None
                and target_chapter > planted_chapter
                and elapsed is not None
            ):
                urgency = round((elapsed / (target_chapter - planted_chapter)) * weight, 2)
            elif (
                planted_chapter is not None
                and target_chapter is not None
                and target_chapter <= planted_chapter
                and elapsed is not None
            ):
                urgency = round(weight * 2.0, 2)

            if remaining is not None and remaining < 0:
                urgency_status = "🔴 已超期"
            elif urgency is None:
                urgency_status = "⚪ 数据不足"
            else:
                urgency_status = self._get_urgency_status(urgency, remaining if remaining is not None else 0)

            records.append(
                {
                    "content": content,
                    "tier": tier,
                    "weight": weight,
                    "planted_chapter": planted_chapter,
                    "target_chapter": target_chapter,
                    "elapsed": elapsed,
                    "remaining": remaining,
                    "status": overtime_status,
                    "urgency": urgency,
                    "urgency_status": urgency_status,
                }
            )

        return records

    def _get_chapter_meta(self, chapter: int) -> dict[str, Any]:
        """读取指定章节的 chapter_meta（支持 0001/1 两种键）。"""
        if not self.state:
            return {}
        return get_chapter_meta_entry(self.state, chapter)

    def _parse_pattern_count(self, raw_value: Any) -> int | None:
        """解析爽点模式数量，解析失败返回 None。"""
        if raw_value is None:
            return None

        if isinstance(raw_value, list):
            patterns = [str(x).strip() for x in raw_value if str(x).strip()]
            return len(set(patterns))

        if isinstance(raw_value, str):
            text = raw_value.strip()
            if not text:
                return None
            parts = [p.strip() for p in re.split(r"[、,，/|+；;]+", text) if p.strip()]
            if parts:
                return len(set(parts))
            return 1

        return None

    def _get_chapter_reading_power_cached(self, chapter: int) -> dict[str, Any] | None:
        """读取并缓存 chapter_reading_power。"""
        if chapter in self._reading_power_cache:
            return self._reading_power_cache[chapter]

        try:
            record = self._index_manager.get_chapter_reading_power(chapter)
        except Exception:
            record = None

        self._reading_power_cache[chapter] = record
        return record

    def _get_chapter_cool_points(self, chapter: int, chapter_data: dict[str, Any]) -> tuple[int | None, str]:
        """获取单章爽点数量（真实元数据优先）。"""
        reading_power = self._get_chapter_reading_power_cached(chapter)
        if isinstance(reading_power, dict):
            count = self._parse_pattern_count(reading_power.get("coolpoint_patterns"))
            if count is not None:
                return count, "chapter_reading_power"

        chapter_meta = self._get_chapter_meta(chapter)
        for key in ("coolpoint_patterns", "coolpoint_pattern", "cool_point_patterns", "cool_point_pattern", "patterns", "pattern"):
            count = self._parse_pattern_count(chapter_meta.get(key))
            if count is not None:
                return count, "chapter_meta"

        count = self._parse_pattern_count(chapter_data.get("cool_point"))
        if count is not None:
            return count, "chapter_stats"

        return None, "none"

    def scan_chapters(self):
        """扫描所有章节文件"""
        if not self.chapters_dir.exists():
            print(f"⚠️  正文目录不存在: {self.chapters_dir}")
            return

        # 支持两种目录结构：
        # 1) 正文/第0001章.md
        # 2) 正文/第1卷/第001章-标题.md
        chapter_files = sorted(self.chapters_dir.rglob("第*.md"))

        # v5.1 引入: 从 SQLite 获取已知角色名
        known_character_names: list[str] = []
        protagonist_name = ""
        if self.state:
            protagonist_name = self.state.get("protagonist_state", {}).get("name", "") or ""

        # 从 SQLite 获取所有角色的 canonical_name
        try:
            characters_from_db = self._index_manager.get_entities_by_type("角色")
            known_character_names = [
                c.get("canonical_name", c.get("id", ""))
                for c in characters_from_db
                if c.get("canonical_name")
            ]
        except Exception:
            known_character_names = []

        for chapter_file in chapter_files:
            chapter_num = extract_chapter_num_from_filename(chapter_file.name)
            if not chapter_num:
                continue

            # 读取章节内容
            with open(chapter_file, encoding='utf-8') as f:
                content = f.read()

            # 统计字数（去除 Markdown 标记）
            text = re.sub(r'```[\s\S]*?```', '', content)  # 去除代码块
            text = re.sub(r'#+ .+', '', text)  # 去除标题
            text = re.sub(r'---', '', text)  # 去除分隔线
            word_count = len(text.strip())

            # 主导 Strand / 爽点类型（优先从"本章统计"解析）
            dominant_strand = (self._extract_stats_field(content, "主导Strand") or "").lower()
            cool_point_type = self._extract_stats_field(content, "爽点")

            # v5.1 引入: 角色提取从 SQLite chapters 表读取
            characters: list[str] = []
            try:
                chapter_info = self._index_manager.get_chapter(chapter_num)
                if chapter_info and chapter_info.get("characters"):
                    stored = chapter_info["characters"]
                    if isinstance(stored, str):
                        stored = json.loads(stored)
                    if isinstance(stored, list):
                        for entity_id in stored:
                            entity_id = str(entity_id).strip()
                            if not entity_id:
                                continue
                            # 尝试获取 canonical_name
                            entity = self._index_manager.get_entity(entity_id)
                            name = entity.get("canonical_name", entity_id) if entity else entity_id
                            characters.append(name)
            except Exception:
                characters = []

            if not characters and (protagonist_name or known_character_names):
                # 限制候选规模，避免在超大角色库下过慢
                candidates = []
                if protagonist_name:
                    candidates.append(protagonist_name)
                candidates.extend(known_character_names[:self.config.character_candidates_limit])

                seen = set()
                for name in candidates:
                    if not name or name in seen:
                        continue
                    if name in content:
                        characters.append(name)
                        seen.add(name)

            self.chapters_data.append({
                "chapter": chapter_num,
                "file": chapter_file,
                "word_count": word_count,
                "characters": characters,
                "dominant": dominant_strand,
                "cool_point": cool_point_type,
            })

    def analyze_characters(self) -> dict:
        """分析角色活跃度（v5.1 引入，v5.4 沿用）"""
        if not self.state:
            return {}

        current_chapter = self.state.get("progress", {}).get("current_chapter", 0)

        # v5.1 引入: 从 SQLite 获取所有角色
        try:
            characters_list = self._index_manager.get_entities_by_type("角色")
        except Exception:
            characters_list = []

        # 统计每个角色的最后出场章节
        character_activity = {}

        for char in characters_list:
            char_name = char.get("canonical_name", char.get("id", ""))
            if not char_name:
                continue

            # 查找最后出场章节
            last_appearance = char.get("last_appearance", 0) or 0

            # 也从 chapters_data 中检查
            for ch_data in self.chapters_data:
                if char_name in ch_data.get("characters", []):
                    last_appearance = max(last_appearance, ch_data["chapter"])

            absence = current_chapter - last_appearance

            character_activity[char_name] = {
                "last_appearance": last_appearance,
                "absence": absence,
                "status": self._get_absence_status(absence)
            }

        return character_activity

    def _get_absence_status(self, absence: int) -> str:
        """判断掉线状态"""
        if absence == 0:
            return "✅ 活跃"
        elif absence < self.config.character_absence_warning:
            return "🟢 正常"
        elif absence < self.config.character_absence_critical:
            return "🟡 轻度掉线"
        else:
            return "🔴 严重掉线"

    def analyze_foreshadowing(self) -> list[dict]:
        """分析伏笔深度"""
        records = self._collect_foreshadowing_records()
        return [
            {
                "content": item["content"],
                "planted_chapter": item["planted_chapter"],
                "estimated_chapter": item["planted_chapter"],
                "target_chapter": item["target_chapter"],
                "elapsed": item["elapsed"],
                "status": item["status"],
            }
            for item in records
        ]

    def _get_foreshadowing_status(self, elapsed: int) -> str:
        """判断伏笔超时状态"""
        if elapsed < self.config.foreshadowing_urgency_pending_medium:
            return "🟢 正常"
        elif elapsed < self.config.foreshadowing_urgency_pending_high + 50:
            return "🟡 轻度超时"
        else:
            return "🔴 严重超时"

    def analyze_foreshadowing_urgency(self) -> list[dict]:
        """
        分析伏笔紧急度（基于三层级系统）

        三层级权重：
        - 核心(Core): 权重 3.0 - 必须回收，否则剧情崩塌
        - 支线(Sub): 权重 2.0 - 应该回收，否则显得作者健忘
        - 装饰(Decor): 权重 1.0 - 可回收可不回收，仅增加真实感

        紧急度计算公式：
        urgency = (已过章节 / 目标回收章节) × 层级权重
        """
        records = self._collect_foreshadowing_records()
        urgency_list = [
            {
                "content": item["content"],
                "tier": item["tier"],
                "weight": item["weight"],
                "planted_chapter": item["planted_chapter"],
                "target_chapter": item["target_chapter"],
                "elapsed": item["elapsed"],
                "remaining": item["remaining"],
                "urgency": item["urgency"],
                "status": item["urgency_status"],
            }
            for item in records
        ]

        # 先按“是否可计算”，再按紧急度降序
        return sorted(
            urgency_list,
            key=lambda x: (x["urgency"] is None, -(x["urgency"] if x["urgency"] is not None else -1)),
        )

    def _get_urgency_status(self, urgency: float, remaining: int) -> str:
        """判断紧急度状态"""
        if remaining < 0:
            return "🔴 已超期"
        elif urgency >= self.config.foreshadowing_tier_weight_sub:
            return "🔴 紧急"
        elif urgency >= 1.0:
            return "🟡 警告"
        else:
            return "🟢 正常"

    def analyze_strand_weave(self) -> dict:
        """
        分析 Strand Weave 节奏分布

        三线定义：
        - Quest（主线）: 战斗、任务、升级 - 目标 55-65%
        - Fire（感情）: 感情线、人际互动 - 目标 20-30%
        - Constellation（世界观）: 世界观展开、势力背景 - 目标 10-20%

        检查规则：
        - Quest 线连续不超过 5 章
        - Fire 线缺失不超过 10 章
        - Constellation 线缺失不超过 15 章
        """
        if not self.state:
            return {}

        strand_tracker = self.state.get("strand_tracker", {})
        history = strand_tracker.get("history", [])

        if not history:
            return {
                "has_data": False,
                "message": "暂无 Strand Weave 数据"
            }

        # 统计各线占比
        quest_count = 0
        fire_count = 0
        constellation_count = 0
        total = len(history)

        for entry in history:
            strand = (entry.get("strand") or entry.get("dominant") or "").lower()
            if strand in ["quest", "主线", "战斗", "任务"]:
                quest_count += 1
            elif strand in ["fire", "感情", "感情线", "互动"]:
                fire_count += 1
            elif strand in ["constellation", "世界观", "背景", "势力"]:
                constellation_count += 1

        # 计算占比
        quest_ratio = (quest_count / total * 100) if total > 0 else 0
        fire_ratio = (fire_count / total * 100) if total > 0 else 0
        constellation_ratio = (constellation_count / total * 100) if total > 0 else 0

        # 检查违规
        violations = []

        # 检查 Quest 连续超过 5 章
        quest_streak = 0
        max_quest_streak = 0
        for entry in history:
            strand = (entry.get("strand") or entry.get("dominant") or "").lower()
            if strand in ["quest", "主线", "战斗", "任务"]:
                quest_streak += 1
                max_quest_streak = max(max_quest_streak, quest_streak)
            else:
                quest_streak = 0

        if max_quest_streak > self.config.strand_quest_max_consecutive:
            violations.append(f"Quest 线连续 {max_quest_streak} 章（超过 {self.config.strand_quest_max_consecutive} 章限制）")

        # 检查 Fire 缺失超过 10 章
        fire_gap = 0
        max_fire_gap = 0
        for entry in history:
            strand = (entry.get("strand") or entry.get("dominant") or "").lower()
            if strand in ["fire", "感情", "感情线", "互动"]:
                max_fire_gap = max(max_fire_gap, fire_gap)
                fire_gap = 0
            else:
                fire_gap += 1
        max_fire_gap = max(max_fire_gap, fire_gap)

        if max_fire_gap > self.config.strand_fire_max_gap:
            violations.append(f"Fire 线缺失 {max_fire_gap} 章（超过 {self.config.strand_fire_max_gap} 章限制）")

        # 检查 Constellation 缺失超过 15 章
        const_gap = 0
        max_const_gap = 0
        for entry in history:
            strand = (entry.get("strand") or entry.get("dominant") or "").lower()
            if strand in ["constellation", "世界观", "背景", "势力"]:
                max_const_gap = max(max_const_gap, const_gap)
                const_gap = 0
            else:
                const_gap += 1
        max_const_gap = max(max_const_gap, const_gap)

        if max_const_gap > self.config.strand_constellation_max_gap:
            violations.append(f"Constellation 线缺失 {max_const_gap} 章（超过 {self.config.strand_constellation_max_gap} 章限制）")

        # 检查占比是否在合理范围
        cfg = self.config
        if quest_ratio < cfg.strand_quest_ratio_min:
            violations.append(f"Quest 占比 {quest_ratio:.1f}% 偏低（目标 {cfg.strand_quest_ratio_min}-{cfg.strand_quest_ratio_max}%）")
        elif quest_ratio > cfg.strand_quest_ratio_max:
            violations.append(f"Quest 占比 {quest_ratio:.1f}% 偏高（目标 {cfg.strand_quest_ratio_min}-{cfg.strand_quest_ratio_max}%）")

        if fire_ratio < cfg.strand_fire_ratio_min:
            violations.append(f"Fire 占比 {fire_ratio:.1f}% 偏低（目标 {cfg.strand_fire_ratio_min}-{cfg.strand_fire_ratio_max}%）")
        elif fire_ratio > cfg.strand_fire_ratio_max:
            violations.append(f"Fire 占比 {fire_ratio:.1f}% 偏高（目标 {cfg.strand_fire_ratio_min}-{cfg.strand_fire_ratio_max}%）")

        if constellation_ratio < cfg.strand_constellation_ratio_min:
            violations.append(f"Constellation 占比 {constellation_ratio:.1f}% 偏低（目标 {cfg.strand_constellation_ratio_min}-{cfg.strand_constellation_ratio_max}%）")
        elif constellation_ratio > cfg.strand_constellation_ratio_max:
            violations.append(f"Constellation 占比 {constellation_ratio:.1f}% 偏高（目标 {cfg.strand_constellation_ratio_min}-{cfg.strand_constellation_ratio_max}%）")

        return {
            "has_data": True,
            "total_chapters": total,
            "quest": {"count": quest_count, "ratio": quest_ratio},
            "fire": {"count": fire_count, "ratio": fire_ratio},
            "constellation": {"count": constellation_count, "ratio": constellation_ratio},
            "violations": violations,
            "max_quest_streak": max_quest_streak,
            "max_fire_gap": max_fire_gap,
            "max_const_gap": max_const_gap,
            "health": "✅ 健康" if not violations else f"⚠️ {len(violations)} 个问题"
        }

    def analyze_pacing(self) -> list[dict]:
        """分析爽点节奏分布（每 N 章为一段）"""
        segment_size = self.config.pacing_segment_size
        segments = []

        for i in range(0, len(self.chapters_data), segment_size):
            segment_chapters = self.chapters_data[i:i+segment_size]

            if not segment_chapters:
                continue

            start_ch = segment_chapters[0]["chapter"]
            end_ch = segment_chapters[-1]["chapter"]
            total_words = sum(ch["word_count"] for ch in segment_chapters)

            cool_points = 0
            chapters_with_data = 0
            source_counter: dict[str, int] = {}

            for chapter_data in segment_chapters:
                chapter = chapter_data["chapter"]
                count, source = self._get_chapter_cool_points(chapter, chapter_data)
                source_counter[source] = source_counter.get(source, 0) + 1
                if count is None:
                    continue
                chapters_with_data += 1
                cool_points += count

            words_per_point = None
            if cool_points > 0:
                words_per_point = total_words / cool_points

            rating = self._get_pacing_rating(words_per_point)
            missing_chapters = len(segment_chapters) - chapters_with_data
            dominant_source = "none"
            if source_counter:
                dominant_source = max(source_counter.items(), key=lambda x: x[1])[0]

            segments.append({
                "start": start_ch,
                "end": end_ch,
                "total_words": total_words,
                "cool_points": cool_points,
                "words_per_point": words_per_point,
                "rating": rating,
                "missing_chapters": missing_chapters,
                "data_coverage": (chapters_with_data / len(segment_chapters)) if segment_chapters else 0.0,
                "dominant_source": dominant_source,
            })

        return segments

    def _get_pacing_rating(self, words_per_point: float | None) -> str:
        """判断节奏评级"""
        if words_per_point is None:
            return "数据不足"
        if words_per_point < self.config.pacing_words_per_point_excellent:
            return "优秀"
        elif words_per_point < self.config.pacing_words_per_point_good:
            return "良好"
        elif words_per_point < self.config.pacing_words_per_point_acceptable:
            return "及格"
        else:
            return "偏低⚠️"

    def _resolve_protagonist_entity_id(self) -> str | None:
        """解析主角实体 ID（优先 index.db）。"""
        protagonist = self._index_manager.get_protagonist()
        if protagonist and protagonist.get("id"):
            return str(protagonist["id"])

        if not self.state:
            return None
        name = str(self.state.get("protagonist_state", {}).get("name", "") or "").strip()
        if not name:
            return None
        hits = self._index_manager.get_entities_by_alias(name)
        if hits:
            return str(hits[0].get("id") or "")
        return None

    def _generate_relationship_graph_from_index(self) -> str:
        """基于 index.db 生成关系图。"""
        protagonist_id = self._resolve_protagonist_entity_id()
        if not protagonist_id:
            return ""

        current_chapter = 0
        if self.state:
            current_chapter = int(self.state.get("progress", {}).get("current_chapter", 0) or 0)
        chapter = current_chapter if current_chapter > 0 else None

        graph = self._index_manager.build_relationship_subgraph(
            center_entity=protagonist_id,
            depth=2,
            chapter=chapter,
            top_edges=40,
        )
        if not graph.get("nodes"):
            return ""
        return self._index_manager.render_relationship_subgraph_mermaid(graph)

    def generate_relationship_graph(self) -> str:
        """生成人际关系 Mermaid 图"""
        if not self.state:
            return ""

        # v5.5: 优先使用 index.db 关系图谱（可通过配置关闭）
        if bool(getattr(self.config, "relationship_graph_from_index_enabled", True)):
            try:
                graph = self._generate_relationship_graph_from_index()
                if graph:
                    return graph
            except Exception:
                # 回退老逻辑，避免报告生成中断
                pass

        # 兼容旧版 state.json relationships 结构
        relationships = self.state.get("relationships", {})
        protagonist_name = self.state.get("protagonist_state", {}).get("name", "主角")

        lines = ["```mermaid", "graph LR"]

        # 支持两种格式：
        # 格式1（新）: {"allies": [...], "enemies": [...]}
        # 格式2（旧）: {"角色名": {"affection": X, "hatred": Y}}

        allies = relationships.get("allies", [])
        enemies = relationships.get("enemies", [])

        if allies or enemies:
            # 新格式
            for ally in allies:
                if isinstance(ally, dict):
                    name = ally.get("name", "未知")
                    relation = ally.get("relation", "友好")
                    lines.append(f"    {protagonist_name} -->|{relation}| {name}")

            for enemy in enemies:
                if isinstance(enemy, dict):
                    name = enemy.get("name", "未知")
                    relation = enemy.get("relation", "敌对")
                    lines.append(f"    {protagonist_name} -.->|{relation}| {name}")
        else:
            # 旧格式兼容
            for char_name, rel_data in relationships.items():
                if isinstance(rel_data, dict):
                    affection = rel_data.get("affection", 0)
                    hatred = rel_data.get("hatred", 0)

                    if affection > 0:
                        lines.append(f"    {protagonist_name} -->|好感度{affection}| {char_name}")

                    if hatred > 0:
                        lines.append(f"    {protagonist_name} -.->|仇恨度{hatred}| {char_name}")

        lines.append("```")

        return "\n".join(lines)

    def _collect_basic_stats_payload(self) -> dict[str, Any]:
        if not self.state:
            return {}

        progress = self.state.get("progress", {})
        current_chapter = int(progress.get("current_chapter", 0) or 0)
        total_words = int(progress.get("total_words", 0) or 0)
        target_words = int(self.state.get("project_info", {}).get("target_words", 2000000) or 2000000)

        avg_words = (total_words / current_chapter) if current_chapter > 0 else 0.0
        completion = (total_words / target_words * 100) if target_words > 0 else 0.0

        return {
            "total_chapters": current_chapter,
            "total_words": total_words,
            "avg_words_per_chapter": round(avg_words, 2),
            "target_words": target_words,
            "completion_pct": round(completion, 2),
        }

    def _count_state_relationship_edges(self) -> int:
        if not self.state:
            return 0
        relationships = self.state.get("relationships", {})
        if not isinstance(relationships, dict):
            return 0

        allies = relationships.get("allies", [])
        enemies = relationships.get("enemies", [])
        count = 0

        if isinstance(allies, list):
            count += sum(1 for item in allies if isinstance(item, dict) and str(item.get("name") or "").strip())
        if isinstance(enemies, list):
            count += sum(1 for item in enemies if isinstance(item, dict) and str(item.get("name") or "").strip())
        if count > 0:
            return count

        for rel_data in relationships.values():
            if not isinstance(rel_data, dict):
                continue
            affection = self._to_positive_int(rel_data.get("affection")) or 0
            hatred = self._to_positive_int(rel_data.get("hatred")) or 0
            if affection > 0:
                count += 1
            if hatred > 0:
                count += 1
        return count

    def _summarize_relationship_data(self) -> dict[str, Any]:
        has_index_data = False
        index_error = ""

        if bool(getattr(self.config, "relationship_graph_from_index_enabled", True)):
            try:
                has_index_data = bool(self._generate_relationship_graph_from_index())
            except Exception as exc:
                index_error = exc.__class__.__name__

        state_edge_count = self._count_state_relationship_edges()
        has_state_data = state_edge_count > 0

        source = "none"
        if has_index_data:
            source = "index"
        elif has_state_data:
            source = "state"

        return {
            "has_data": bool(has_index_data or has_state_data),
            "source": source,
            "index_graph_available": has_index_data,
            "state_edge_count": state_edge_count,
            "index_error": index_error,
        }

    def _detect_chapter_gaps(self) -> dict[str, Any]:
        chapter_numbers = sorted(
            {
                chapter
                for item in self.chapters_data
                if (chapter := self._to_positive_int(item.get("chapter"))) is not None
            }
        )

        if not chapter_numbers:
            return {
                "has_data": False,
                "has_gap": False,
                "first_chapter": None,
                "last_chapter": None,
                "missing_chapters": 0,
                "gaps": [],
            }

        gaps: list[dict[str, Any]] = []
        missing_chapters = 0
        for prev, current in zip(chapter_numbers, chapter_numbers[1:], strict=False):
            if current <= prev + 1:
                continue
            start = prev + 1
            end = current - 1
            count = end - start + 1
            missing_chapters += count
            gaps.append({"start": start, "end": end, "count": count})

        return {
            "has_data": True,
            "has_gap": missing_chapters > 0,
            "first_chapter": chapter_numbers[0],
            "last_chapter": chapter_numbers[-1],
            "missing_chapters": missing_chapters,
            "gaps": gaps,
        }

    def evaluate_health_gate(
        self,
        focus: str = "all",
        *,
        source_status: dict[str, dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        enabled = bool(getattr(self.config, "status_gate_enabled", True))
        if not enabled:
            return {
                "enabled": False,
                "passed": True,
                "error_count": 0,
                "warning_count": 0,
                "anomalies": [],
            }

        anomalies: list[dict[str, Any]] = []

        chapter_gap = self._detect_chapter_gaps()
        allowed_missing = int(getattr(self.config, "status_gate_chapter_gap_max_missing", 0))
        if chapter_gap["missing_chapters"] > allowed_missing:
            preview = chapter_gap["gaps"][:3]
            anomalies.append(
                {
                    "code": "chapter_gap_detected",
                    "severity": "error",
                    "message": (
                        f"章节存在断档，缺失 {chapter_gap['missing_chapters']} 章，"
                        f"超过允许阈值 {allowed_missing} 章"
                    ),
                    "detail": {"allowed_missing": allowed_missing, "gaps_preview": preview},
                }
            )

        if focus in {"all", "relationships"} and bool(getattr(self.config, "status_gate_relationship_required", True)):
            relation_summary = self._summarize_relationship_data()
            if not relation_summary["has_data"]:
                anomalies.append(
                    {
                        "code": "relationship_missing",
                        "severity": "error",
                        "message": "关系数据为空，无法评估人物关系健康度",
                        "detail": relation_summary,
                    }
                )

        if source_status is None:
            source_status = self._collect_source_freshness()

        if bool(getattr(self.config, "status_gate_fail_on_stale_data", False)):
            for source_name, source in source_status.items():
                freshness = str(source.get("freshness") or "missing")
                if freshness not in {"stale", "missing"}:
                    continue
                anomalies.append(
                    {
                        "code": "stale_source",
                        "severity": "error",
                        "message": f"{source_name} 数据源已过旧或缺失",
                        "detail": {"source": source_name, "freshness": freshness},
                    }
                )

        errors = [item for item in anomalies if item.get("severity") == "error"]
        warnings = [item for item in anomalies if item.get("severity") == "warning"]
        return {
            "enabled": True,
            "passed": len(errors) == 0,
            "error_count": len(errors),
            "warning_count": len(warnings),
            "anomalies": anomalies,
            "chapter_gaps": chapter_gap,
        }

    def generate_json_report(
        self,
        focus: str = "all",
        *,
        generated_at: datetime | None = None,
    ) -> dict[str, Any]:
        generated_time = generated_at or self._now()
        source_status = self._collect_source_freshness(generated_time)
        metric_sources = self._build_metric_sources(source_status)

        focus_enabled = {
            "basic": focus in {"all", "basic"},
            "characters": focus in {"all", "characters"},
            "foreshadowing": focus in {"all", "foreshadowing"},
            "urgency": focus in {"all", "foreshadowing", "urgency"},
            "pacing": focus in {"all", "pacing"},
            "strand": focus in {"all", "strand", "pacing"},
            "relationships": focus in {"all", "relationships"},
        }

        sections: dict[str, Any] = {}

        if focus_enabled["basic"]:
            sections["basic"] = self._collect_basic_stats_payload()

        if focus_enabled["characters"]:
            activity = self.analyze_characters()
            dropped = [
                {"name": name, **data}
                for name, data in activity.items()
                if "掉线" in str(data.get("status", ""))
            ]
            dropped = sorted(dropped, key=lambda item: int(item.get("absence", 0)), reverse=True)
            sections["characters"] = {
                "total": len(activity),
                "dropped_count": len(dropped),
                "dropped": dropped,
            }

        if focus_enabled["foreshadowing"]:
            foreshadowing = self.analyze_foreshadowing()
            overdue = [item for item in foreshadowing if "超时" in item["status"] or "超期" in item["status"]]
            unknown = [item for item in foreshadowing if item["status"] == "⚪ 数据不足"]
            sections["foreshadowing"] = {
                "total": len(foreshadowing),
                "overdue_count": len(overdue),
                "unknown_count": len(unknown),
                "items": foreshadowing,
            }

        if focus_enabled["urgency"]:
            urgency = self.analyze_foreshadowing_urgency()
            urgent = [
                item
                for item in urgency
                if (item["urgency"] is not None and item["urgency"] >= 1.0) or item["status"] == "🔴 已超期"
            ]
            sections["urgency"] = {
                "total": len(urgency),
                "urgent_count": len(urgent),
                "items": urgency,
            }

        if focus_enabled["pacing"]:
            sections["pacing"] = {
                "segment_size": int(getattr(self.config, "pacing_segment_size", 100)),
                "segments": self.analyze_pacing(),
            }

        if focus_enabled["strand"]:
            sections["strand"] = self.analyze_strand_weave()

        if focus_enabled["relationships"]:
            sections["relationships"] = self._summarize_relationship_data()

        gate_result = self.evaluate_health_gate(focus, source_status=source_status)

        return {
            "schema_version": int(getattr(self.config, "status_report_schema_version", 1)),
            "generated_at": self._to_iso8601(generated_time),
            "project_root": str(self.project_root),
            "focus": focus,
            "sources": source_status,
            "metric_sources": {key: metric_sources[key] for key in sections if key in metric_sources},
            "sections": sections,
            "health_gate": gate_result,
        }

    def _generate_source_freshness_section(self, source_status: dict[str, dict[str, Any]]) -> list[str]:
        lines = [
            "## 🧭 数据来源与新鲜度",
            "",
            "| 来源 | 文件 | 更新时间 | 延迟 | 新鲜度 |",
            "|------|------|----------|------|--------|",
        ]

        freshness_label = {"fresh": "🟢 fresh", "stale": "🟡 stale", "missing": "🔴 missing"}
        for key in ("state", "index"):
            item = source_status.get(key, {})
            path = str(item.get("path") or "")
            updated_at = str(item.get("updated_at") or "N/A")
            delay = str(item.get("delay") or "未知")
            freshness = freshness_label.get(str(item.get("freshness") or "missing"), "🔴 missing")
            lines.append(f"| {key} | {path} | {updated_at} | {delay} | {freshness} |")

        lines.extend(["", "---", ""])
        return lines

    def _generate_health_gate_section(self, gate_result: dict[str, Any]) -> list[str]:
        lines = ["## 🚦 健康门禁结果", ""]

        if gate_result.get("passed"):
            lines.append("✅ 门禁通过")
        else:
            lines.append(f"❌ 门禁失败（error={gate_result.get('error_count', 0)}）")

        chapter_gap = gate_result.get("chapter_gaps", {})
        if isinstance(chapter_gap, dict) and chapter_gap.get("has_data"):
            lines.append(
                f"- 章节断档: 缺失 {chapter_gap.get('missing_chapters', 0)} 章"
            )

        anomalies = gate_result.get("anomalies", [])
        if anomalies:
            lines.append("")
            lines.append("| 严重级别 | 代码 | 说明 |")
            lines.append("|----------|------|------|")
            for item in anomalies:
                lines.append(
                    f"| {item.get('severity', '')} | {item.get('code', '')} | {item.get('message', '')} |"
                )

        lines.extend(["", "---", ""])
        return lines

    def generate_report(
        self,
        focus: str = "all",
        *,
        generated_at: datetime | None = None,
        source_status: dict[str, dict[str, Any]] | None = None,
        gate_result: dict[str, Any] | None = None,
    ) -> str:
        """生成健康报告（Markdown 格式）"""
        generated_time = generated_at or self._now()
        effective_source_status = source_status or self._collect_source_freshness(generated_time)
        effective_gate_result = gate_result or self.evaluate_health_gate(focus, source_status=effective_source_status)

        report_lines = [
            "# 全书健康报告",
            "",
            f"> **生成时间**: {generated_time.strftime('%Y-%m-%d %H:%M:%S')}",
            "",
            "---",
            ""
        ]

        report_lines.extend(self._generate_source_freshness_section(effective_source_status))

        # 基本数据
        if focus in ["all", "basic"]:
            report_lines.extend(self._generate_basic_stats())

        # 角色活跃度
        if focus in ["all", "characters"]:
            report_lines.extend(self._generate_character_section())

        # 伏笔深度
        if focus in ["all", "foreshadowing"]:
            report_lines.extend(self._generate_foreshadowing_section())

        # 伏笔紧急度（新增）
        if focus in ["all", "foreshadowing", "urgency"]:
            report_lines.extend(self._generate_urgency_section())

        # 爽点节奏
        if focus in ["all", "pacing"]:
            report_lines.extend(self._generate_pacing_section())

        # Strand Weave 节奏（新增）
        if focus in ["all", "strand", "pacing"]:
            report_lines.extend(self._generate_strand_section())

        # 人际关系
        if focus in ["all", "relationships"]:
            report_lines.extend(self._generate_relationship_section())

        report_lines.extend(self._generate_health_gate_section(effective_gate_result))

        return "\n".join(report_lines)

    def _generate_basic_stats(self) -> list[str]:
        """生成基本统计"""
        stats = self._collect_basic_stats_payload()
        if not stats:
            return []

        return [
            "## 📊 基本数据",
            "",
            f"- **总章节数**: {stats['total_chapters']} 章",
            f"- **总字数**: {stats['total_words']:,} 字",
            f"- **平均章节字数**: {stats['avg_words_per_chapter']:,.0f} 字",
            f"- **创作进度**: {stats['completion_pct']:.1f}%（目标 {stats['target_words']:,} 字）",
            "",
            "---",
            ""
        ]

    def _generate_character_section(self) -> list[str]:
        """生成角色分析章节"""
        activity = self.analyze_characters()

        if not activity:
            return []

        # 筛选掉线角色
        dropped = {name: data for name, data in activity.items()
                  if "掉线" in data["status"]}

        lines = [
            f"## ⚠️ 角色掉线（{len(dropped)}人）",
            ""
        ]

        if dropped:
            lines.extend([
                "| 角色 | 最后出场 | 缺席章节 | 状态 |",
                "|------|---------|---------|------|"
            ])

            for char_name, data in sorted(dropped.items(),
                                         key=lambda x: x[1]["absence"],
                                         reverse=True):
                lines.append(
                    f"| {char_name} | 第 {data['last_appearance']} 章 | "
                    f"{data['absence']} 章 | {data['status']} |"
                )
        else:
            lines.append("✅ 所有角色活跃度正常")

        lines.extend(["", "---", ""])

        return lines

    def _generate_foreshadowing_section(self) -> list[str]:
        """生成伏笔分析章节"""
        overdue = self.analyze_foreshadowing()

        # 筛选超时伏笔
        overdue_items = [
            item for item in overdue if "超时" in item["status"] or "超期" in item["status"]
        ]
        unknown_items = [item for item in overdue if item["status"] == "⚪ 数据不足"]

        lines = [
            f"## ⚠️ 伏笔超时（{len(overdue_items)}条）",
            ""
        ]

        if overdue_items:
            lines.extend([
                "| 伏笔内容 | 埋设章节 | 已过章节 | 状态 |",
                "|---------|---------|---------|------|"
            ])

            for item in sorted(overdue_items, key=lambda x: (x["elapsed"] if x["elapsed"] is not None else -1), reverse=True):
                planted = item["planted_chapter"] if item["planted_chapter"] is not None else "未知"
                elapsed = item["elapsed"] if item["elapsed"] is not None else "未知"
                lines.append(
                    f"| {item['content'][:30]}... | 第 {planted} 章 | "
                    f"{elapsed} 章 | {item['status']} |"
                )
        else:
            lines.append("✅ 所有伏笔进度正常")

        if unknown_items:
            lines.append("")
            lines.append(f"⚪ 另有 {len(unknown_items)} 条伏笔缺少章节信息，无法判断是否超时")

        lines.extend(["", "---", ""])

        return lines

    def _generate_urgency_section(self) -> list[str]:
        """生成伏笔紧急度章节（基于三层级系统）"""
        urgency_list = self.analyze_foreshadowing_urgency()

        # 筛选紧急伏笔
        urgent_items = [
            item
            for item in urgency_list
            if (item["urgency"] is not None and item["urgency"] >= 1.0) or item["status"] == "🔴 已超期"
        ]

        lines = [
            f"## 🚨 伏笔紧急度排序（{len(urgent_items)}条需关注）",
            "",
            "> 基于三层级系统：核心(×3) / 支线(×2) / 装饰(×1)",
            "> 紧急度 = (已过章节 / (目标章节-埋设章节)) × 层级权重",
            ""
        ]

        unknown_items = [item for item in urgency_list if item["urgency"] is None]
        if unknown_items:
            lines.append(f"> {len(unknown_items)} 条伏笔缺少埋设/目标章节，紧急度记为 N/A")
            lines.append("")

        if urgency_list:
            lines.extend([
                "| 伏笔内容 | 层级 | 埋设 | 目标 | 紧急度 | 状态 |",
                "|---------|------|------|------|--------|------|"
            ])

            for item in urgency_list[:10]:  # 只显示前10条
                planted = f"第{item['planted_chapter']}章" if item["planted_chapter"] is not None else "未知"
                target = f"第{item['target_chapter']}章" if item["target_chapter"] is not None else "未知"
                urgency_text = f"{item['urgency']:.2f}" if item["urgency"] is not None else "N/A"
                lines.append(
                    f"| {item['content'][:20]}... | {item['tier']} | "
                    f"{planted} | {target} | "
                    f"{urgency_text} | {item['status']} |"
                )
        else:
            lines.append("✅ 暂无伏笔数据")

        lines.extend(["", "---", ""])

        return lines

    def _generate_strand_section(self) -> list[str]:
        """生成 Strand Weave 节奏章节"""
        strand_data = self.analyze_strand_weave()

        lines = [
            "## 🎭 Strand Weave 节奏分析",
            ""
        ]

        if not strand_data.get("has_data"):
            lines.append(f"⚠️ {strand_data.get('message', '暂无数据')}")
            lines.extend(["", "---", ""])
            return lines

        # 占比统计
        cfg = self.config
        lines.extend([
            "### 三线占比",
            "",
            "| Strand | 章节数 | 占比 | 目标范围 | 状态 |",
            "|--------|--------|------|----------|------|"
        ])

        q = strand_data["quest"]
        q_status = "✅" if cfg.strand_quest_ratio_min <= q["ratio"] <= cfg.strand_quest_ratio_max else "⚠️"
        lines.append(f"| Quest（主线） | {q['count']} | {q['ratio']:.1f}% | {cfg.strand_quest_ratio_min}-{cfg.strand_quest_ratio_max}% | {q_status} |")

        f = strand_data["fire"]
        f_status = "✅" if cfg.strand_fire_ratio_min <= f["ratio"] <= cfg.strand_fire_ratio_max else "⚠️"
        lines.append(f"| Fire（感情） | {f['count']} | {f['ratio']:.1f}% | {cfg.strand_fire_ratio_min}-{cfg.strand_fire_ratio_max}% | {f_status} |")

        c = strand_data["constellation"]
        c_status = "✅" if cfg.strand_constellation_ratio_min <= c["ratio"] <= cfg.strand_constellation_ratio_max else "⚠️"
        lines.append(f"| Constellation（世界观） | {c['count']} | {c['ratio']:.1f}% | {cfg.strand_constellation_ratio_min}-{cfg.strand_constellation_ratio_max}% | {c_status} |")

        lines.append("")

        # 连续性检查
        lines.extend([
            "### 连续性检查",
            "",
            f"- Quest 最大连续: {strand_data['max_quest_streak']} 章（限制 ≤5）",
            f"- Fire 最大缺失: {strand_data['max_fire_gap']} 章（限制 ≤10）",
            f"- Constellation 最大缺失: {strand_data['max_const_gap']} 章（限制 ≤15）",
            ""
        ])

        # 违规清单
        if strand_data["violations"]:
            lines.extend([
                "### ⚠️ 违规清单",
                ""
            ])
            for v in strand_data["violations"]:
                lines.append(f"- {v}")
        else:
            lines.append("### ✅ 无违规")

        lines.extend(["", f"**综合健康度**: {strand_data['health']}", "", "---", ""])

        return lines

    def _generate_pacing_section(self) -> list[str]:
        """生成节奏分析章节"""
        segments = self.analyze_pacing()

        lines = [
            "## 📈 爽点节奏分布",
            "",
            "```"
        ]

        for seg in segments:
            words_per_point = seg["words_per_point"]
            if words_per_point is None:
                lines.append(
                    f"第 {seg['start']}-{seg['end']}章   ░ 数据不足"
                    f"（缺少爽点数据 {seg['missing_chapters']} 章）"
                )
                continue

            bar_length = int(12 - (words_per_point / 2000 * 12))
            bar_length = max(1, min(12, bar_length))
            bar = "█" * bar_length

            suffix = ""
            if seg["missing_chapters"] > 0:
                suffix = f"，缺少爽点数据 {seg['missing_chapters']} 章"

            lines.append(
                f"第 {seg['start']}-{seg['end']}章   {bar} {seg['rating']}"
                f"（{words_per_point:.0f}字/爽点，记录 {seg['cool_points']} 个爽点{suffix}）"
            )

        lines.extend(["```", "", "---", ""])

        return lines

    def _generate_relationship_section(self) -> list[str]:
        """生成人际关系章节"""
        graph = self.generate_relationship_graph()

        lines = [
            "## 💑 人际关系趋势",
            "",
            graph,
            "",
            "---",
            ""
        ]

        return lines

def main(argv: list[str] | None = None) -> int:
    import argparse

    _enable_windows_utf8_stdio()

    parser = argparse.ArgumentParser(
        description="可视化状态报告生成器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  # 生成完整健康报告
  python status_reporter.py --output .webnovel/health_report.md

  # 仅分析角色活跃度
  python status_reporter.py --focus characters

  # 仅分析伏笔
  python status_reporter.py --focus foreshadowing

  # 仅分析爽点节奏
  python status_reporter.py --focus pacing

  # 输出 JSON（用于 CI / Dashboard）
  python status_reporter.py --format json
        """
    )

    parser.add_argument('--output', default='.webnovel/health_report.md',
                       help='输出文件路径')
    parser.add_argument('--format', choices=['text', 'json'], default='text',
                       help='输出格式（text=Markdown, json=结构化报告）')
    parser.add_argument('--focus', choices=['all', 'basic', 'characters',
                                            'foreshadowing', 'urgency', 'pacing',
                                            'strand', 'relationships'],
                       default='all', help='分析焦点（新增 urgency, strand）')
    parser.add_argument('--project-root', default='.', help='项目根目录')

    args = parser.parse_args(argv)

    # 解析项目根目录（允许传入“工作区根目录”，统一解析到真正的 book project_root）
    try:
        project_root = str(resolve_project_root(args.project_root))
    except FileNotFoundError as exc:
        print(f"❌ 无法定位项目根目录（需要包含 .webnovel/state.json）: {exc}", file=sys.stderr)
        return 1

    # 创建报告生成器
    reporter = StatusReporter(project_root)

    # 加载状态
    if not reporter.load_state():
        return 1

    if args.format == "text":
        print("📖 正在扫描章节文件...")
    reporter.scan_chapters()

    if args.format == "text":
        print(f"✅ 已扫描 {len(reporter.chapters_data)} 个章节")
        print("\n📊 正在分析...")

    generated_at = reporter._now()
    source_status = reporter._collect_source_freshness(generated_at)
    gate_result = reporter.evaluate_health_gate(args.focus, source_status=source_status)

    if args.format == "json":
        payload = reporter.generate_json_report(args.focus, generated_at=generated_at)
        payload["health_gate"] = gate_result
        output_text = json.dumps(payload, ensure_ascii=False, indent=2)
    else:
        output_text = reporter.generate_report(
            args.focus,
            generated_at=generated_at,
            source_status=source_status,
            gate_result=gate_result,
        )

    # 保存报告
    output_file = Path(args.output)
    if args.output == '.webnovel/health_report.md':
        suffix = "json" if args.format == "json" else "md"
        output_file = Path(project_root) / '.webnovel' / f'health_report.{suffix}'
    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(output_text)

    if args.format == "json":
        print(output_text)
    else:
        print(f"\n✅ 健康报告已生成: {output_file}")

        # 预览报告（前 30 行）
        print("\n" + "="*60)
        print("📄 报告预览：\n")
        print("\n".join(output_text.split("\n")[:30]))
        print("\n...")
        print("="*60)

    if not gate_result.get("passed", True):
        if args.format == "text":
            print("\n❌ 健康门禁未通过，请处理异常后重试。", file=sys.stderr)
        return int(getattr(reporter.config, "status_gate_exit_code", 2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
