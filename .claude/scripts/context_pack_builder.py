#!/usr/bin/env python3
"""
Context Pack Builder v5.2

为章节写作生成结构化上下文包，取代直接读取 state.json。

v5.2 变更:
- 使用 v5.1 index_manager schema (entities.id, aliases, current_json)
- 移除对 entity_kv 表的依赖，改用 current_json 字段
- 移除对 entity_aliases 表的依赖，改用 aliases 表
- 章节摘要改为读取 .webnovel/summaries/chNNNN.md

输出 Schema:
{
  "core": {
    "chapter_outline": "本章大纲内容",
    "protagonist_snapshot": {...},
    "recent_summaries": [{...}, ...],
    "recent_meta": [{...}, ...]
  },
  "scene": {
    "location_context": {...},
    "appearing_characters": [{entity_id, name, snapshot}, ...],
    "urgent_foreshadowing": [{...}, ...]
  },
  "global": {
    "worldview_skeleton": "...",
    "power_system_skeleton": "...",
    "style_contract_ref": "..."
  }
}

使用方式:
  python context_pack_builder.py --chapter 45 --project-root /path/to/project
  python context_pack_builder.py --chapter 45 --output /tmp/context_pack.json
"""

import json
import os
import sys
import argparse
import re
import sqlite3
from pathlib import Path
from typing import Optional, Dict, List, Any

# 导入项目工具
from project_locator import resolve_project_root
from chapter_paths import find_chapter_file

# 导入配置
try:
    from data_modules.config import get_config, DataModulesConfig
except ImportError:
    from scripts.data_modules.config import get_config, DataModulesConfig


class ContextPackBuilder:
    """上下文包构建器"""

    def __init__(self, project_root: Path = None):
        if project_root is None:
            try:
                project_root = resolve_project_root()
            except FileNotFoundError:
                project_root = Path.cwd()
        else:
            project_root = Path(project_root)

        self.project_root = project_root
        self.config = get_config(project_root)
        self.state_file = project_root / ".webnovel" / "state.json"
        self.index_db = project_root / ".webnovel" / "index.db"
        self.summaries_dir = project_root / ".webnovel" / "summaries"
        self.outline_dir = project_root / "大纲"
        self.settings_dir = project_root / "设定集"
        self.chapters_dir = project_root / "正文"

        self._conn: Optional[sqlite3.Connection] = None

    def _conn_index(self) -> Optional[sqlite3.Connection]:
        if self._conn is not None:
            return self._conn
        if not self.index_db.exists():
            return None
        conn = sqlite3.connect(str(self.index_db))
        conn.row_factory = sqlite3.Row
        self._conn = conn
        return conn

    def build(self, chapter_num: int) -> Dict[str, Any]:
        """构建完整上下文包"""
        state = self._load_state()

        return {
            "meta": {
                "chapter": chapter_num,
                "project_root": str(self.project_root),
                "version": "5.2"
            },
            "core": self._build_core(chapter_num),
            "scene": self._build_scene(chapter_num),
            "global": self._build_global(),
            "alerts": self._build_alerts(state)
        }

    def _build_core(self, chapter_num: int) -> Dict[str, Any]:
        """核心上下文：大纲、主角状态、近期摘要"""
        state = self._load_state()

        return {
            "chapter_outline": self._get_chapter_outline(chapter_num),
            "protagonist_snapshot": self._get_protagonist_snapshot(state),
            "recent_summaries": self._get_recent_summaries(
                chapter_num, window=self.config.context_recent_summaries_window
            ),
            "recent_meta": self._get_recent_chapter_meta(chapter_num, window=3),
        }

    def _build_scene(self, chapter_num: int) -> Dict[str, Any]:
        """场景上下文：地点、出场角色、紧急伏笔"""
        state = self._load_state()

        # 从大纲推断本章地点和角色
        outline = self._get_chapter_outline(chapter_num)
        predicted_location = self._predict_location(outline, state)
        predicted_characters = self._predict_characters(outline, state)

        return {
            "location_context": predicted_location,
            "appearing_characters": predicted_characters,
            "urgent_foreshadowing": self._get_urgent_foreshadowing(state, chapter_num)
        }

    def _build_global(self) -> Dict[str, Any]:
        """全局上下文：世界观、力量体系、风格契约"""
        return {
            "worldview_skeleton": self._load_skeleton("世界观"),
            "power_system_skeleton": self._load_skeleton("力量体系"),
            "style_contract_ref": self._get_style_contract_ref()
        }

    def _build_alerts(self, state: Dict) -> Dict[str, Any]:
        """风险提示：消歧警告、待确认项（v5.0）"""
        slice_size = self.config.context_alerts_slice
        return {
            "disambiguation_warnings": state.get("disambiguation_warnings", [])[-slice_size:],
            "disambiguation_pending": state.get("disambiguation_pending", [])[-slice_size:]
        }

    # ================== 辅助方法 ==================

    def _load_state(self) -> Dict:
        """加载 state.json"""
        if not self.state_file.exists():
            return {}
        with open(self.state_file, 'r', encoding='utf-8') as f:
            return json.load(f)

    def _get_chapter_outline(self, chapter_num: int) -> str:
        """获取本章大纲"""
        # 尝试多种大纲文件格式
        patterns = [
            f"第{chapter_num}章*.md",
            f"第{chapter_num:02d}章*.md",
            f"第{chapter_num:03d}章*.md",
            f"第{chapter_num:04d}章*.md",
            f"章纲/第{chapter_num}章*.md",
            f"章纲/第{chapter_num:02d}章*.md",
        ]

        for pattern in patterns:
            matches = list(self.outline_dir.glob(pattern))
            if matches:
                with open(matches[0], 'r', encoding='utf-8') as f:
                    return f.read()

        # 尝试从卷纲中提取
        volume_outline = self._extract_from_volume_outline(chapter_num)
        if volume_outline:
            return volume_outline

        return f"[大纲未找到: 第{chapter_num}章]"

    def _extract_from_volume_outline(self, chapter_num: int) -> Optional[str]:
        """从卷纲中提取章节大纲"""
        volume_files = list(self.outline_dir.glob("卷纲*.md")) + list(self.outline_dir.glob("*卷*.md"))

        for vf in volume_files:
            with open(vf, 'r', encoding='utf-8') as f:
                content = f.read()

            # 查找章节标记（兼容空格/中英文冒号/不同标题级别）
            # 常见格式：### 第 1 章：标题 或 ### 第1章: 标题
            heading_pattern = (
                rf"(?m)^#+\s*第\s*{chapter_num}\s*章[：:][^\n]*\n"
                rf".*?(?=^#+\s*第\s*\d+\s*章|^##\s|\Z)"
            )
            match = re.search(heading_pattern, content, re.DOTALL)
            if match:
                return match.group(0).strip()

            # 兼容无标题级别的格式：第 1 章 标题
            plain_pattern = (
                rf"(?m)^第\s*{chapter_num}\s*章[^\n]*\n"
                rf".*?(?=^第\s*\d+\s*章|\Z)"
            )
            match = re.search(plain_pattern, content, re.DOTALL)
            if match:
                return match.group(0).strip()

        return None

    def _get_protagonist_snapshot(self, state: Dict) -> Dict:
        """获取主角状态快照"""
        protagonist = state.get("protagonist_state", {}) or {}
        power = protagonist.get("power", {}) or {}
        location = protagonist.get("location", {}) or {}

        snapshot: Dict[str, Any] = {
            "entity_id": str(protagonist.get("entity_id", "") or "").strip(),
            "name": str(protagonist.get("name", "") or "").strip() or "主角",
            "realm": str(power.get("realm", "") or "").strip(),
            "layer": power.get("layer", 0),
            "bottleneck": str(power.get("bottleneck", "") or "").strip(),
            "golden_finger": protagonist.get("golden_finger", {}) or {},
            "location": str(location.get("current", "") or "").strip(),
        }

        # 可选：从 index.db 补齐（以 entity_id 为准）
        protagonist_id = snapshot.get("entity_id", "")
        conn = self._conn_index()
        if protagonist_id and conn is not None:
            # v5.1 schema: entities 表使用 id 字段，current_json 存储状态
            row = conn.execute(
                "SELECT canonical_name, current_json FROM entities WHERE id = ? LIMIT 1",
                (protagonist_id,),
            ).fetchone()
            if row:
                if row["canonical_name"]:
                    snapshot["name"] = row["canonical_name"]
                # 从 current_json 解析状态
                if row["current_json"]:
                    try:
                        current = json.loads(row["current_json"])
                        if isinstance(current.get("realm"), str) and current.get("realm"):
                            snapshot["realm"] = current["realm"]
                        if current.get("layer") is not None and current.get("layer") != "":
                            snapshot["layer"] = current["layer"]
                        if isinstance(current.get("bottleneck"), str) and current.get("bottleneck"):
                            snapshot["bottleneck"] = current["bottleneck"]
                        if isinstance(current.get("location"), str) and current.get("location"):
                            snapshot["location"] = current["location"]
                    except (json.JSONDecodeError, TypeError):
                        pass

        return snapshot

    def _get_recent_summaries(self, chapter_num: int, window: int = 3) -> List[Dict]:
        """获取最近 N 章的摘要"""
        summaries = []
        start = max(1, chapter_num - window)

        for ch in range(start, chapter_num):
            summary = self._load_summary_file(ch)
            if summary:
                summaries.append(summary)
                continue

            # 兼容降级：若摘要文件不存在，尝试从章节正文提取
            chapter_file = find_chapter_file(self.project_root, ch)
            if chapter_file and chapter_file.exists():
                fallback = self._extract_summary_from_chapter(chapter_file, ch)
                if fallback:
                    summaries.append(fallback)

        return summaries

    def _extract_summary_from_chapter(self, chapter_file: Path, chapter_num: int) -> Optional[Dict]:
        """从章节文件中提取摘要"""
        with open(chapter_file, 'r', encoding='utf-8') as f:
            content = f.read()

        # 查找摘要区块
        summary_match = re.search(r'## 本章摘要\s*\r?\n(.*?)(?=\r?\n##|$)', content, re.DOTALL)
        if summary_match:
            summary_text = summary_match.group(1).strip()
            return {
                "chapter": chapter_num,
                "summary": summary_text
            }

        # 没有摘要，返回章节标题
        title_match = re.match(r'^#\s*(.+)', content)
        title = title_match.group(1).strip() if title_match else f"第{chapter_num}章"

        return {
            "chapter": chapter_num,
            "title": title,
            "summary": None
        }

    def _load_summary_file(self, chapter_num: int) -> Optional[Dict]:
        """从 .webnovel/summaries/chNNNN.md 读取摘要"""
        summary_path = self.summaries_dir / f"ch{chapter_num:04d}.md"
        if not summary_path.exists():
            return None

        text = summary_path.read_text(encoding="utf-8")

        # 解析 YAML 头部（--- ... ---）
        meta: Dict[str, Any] = {}
        fm_match = re.match(r"^---\s*\r?\n(.*?)\r?\n---\s*\r?\n", text, re.DOTALL)
        if fm_match:
            fm = fm_match.group(1)
            for line in fm.splitlines():
                if ":" not in line:
                    continue
                key, _, value = line.partition(":")
                key = key.strip()
                value = value.strip()
                if not key:
                    continue
                # 简单解析列表
                if value.startswith("[") and value.endswith("]"):
                    items = [v.strip().strip('\"').strip("'") for v in value[1:-1].split(",") if v.strip()]
                    meta[key] = items
                else:
                    meta[key] = value.strip('\"').strip("'")

        # 提取剧情摘要段落
        summary_match = re.search(r"##\s*剧情摘要\s*\r?\n(.*?)(?=\r?\n##|\Z)", text, re.DOTALL)
        summary_text = summary_match.group(1).strip() if summary_match else ""

        result = {
            "chapter": chapter_num,
            "summary": summary_text
        }
        # 附加部分元数据（可选）
        for k in ["hook_type", "hook_strength", "time", "location"]:
            if k in meta:
                result[k] = meta[k]
        return result

    def _get_recent_chapter_meta(self, chapter_num: int, window: int = 3) -> List[Dict[str, Any]]:
        """读取最近 N 章的 chapter_meta（用于模式重复检查）"""
        state = self._load_state()
        meta = state.get("chapter_meta", {}) or {}
        items: List[Dict[str, Any]] = []
        for ch in range(max(1, chapter_num - window), chapter_num):
            key_candidates = [f"{ch:04d}", str(ch)]
            entry = None
            for key in key_candidates:
                if key in meta:
                    entry = meta.get(key)
                    break
            if entry:
                items.append({"chapter": ch, **entry})
        return items

    def _predict_location(self, outline: str, state: Dict) -> Dict:
        """从大纲推断地点（优先使用 index.db 别名表）"""
        conn = self._conn_index()
        if conn is None:
            return {"name": "未知地点", "desc": ""}

        # v5.1 schema: 使用 aliases 表（替代 entity_aliases）
        rows = conn.execute(
            "SELECT alias, entity_id FROM aliases WHERE entity_type = ?",
            ("地点",),
        ).fetchall()
        if not rows:
            return {"name": "未知地点", "desc": ""}

        # 先匹配更长的别名，降低误命中
        candidates = sorted(
            ((r["alias"], r["entity_id"]) for r in rows if r["alias"]),
            key=lambda x: len(x[0]),
            reverse=True,
        )
        for alias, entity_id in candidates:
            if len(alias) < 2:
                continue
            if alias not in outline:
                continue

            # v5.1 schema: entities 表使用 id 字段
            e = conn.execute(
                "SELECT canonical_name, desc FROM entities WHERE id = ? LIMIT 1",
                (entity_id,),
            ).fetchone()
            return {
                "entity_id": entity_id,
                "name": (e["canonical_name"] if e else "") or alias,
                "desc": (e["desc"] if e else "") or "",
                "match": alias,
            }

        return {"name": "未知地点", "desc": ""}

    def _predict_characters(self, outline: str, state: Dict) -> List[Dict]:
        """从大纲推断出场角色（优先使用 index.db 别名表）"""
        conn = self._conn_index()
        if conn is None:
            return []

        # v5.1 schema: 使用 aliases 表（替代 entity_aliases）
        rows = conn.execute(
            "SELECT alias, entity_id FROM aliases WHERE entity_type = ?",
            ("角色",),
        ).fetchall()
        if not rows:
            return []

        matched_ids: set[str] = set()
        for r in rows:
            alias = r["alias"] or ""
            if len(alias) < 2:
                continue
            if alias in outline:
                matched_ids.add(r["entity_id"])

        if not matched_ids:
            return []

        tier_order = {"核心": 0, "支线": 1, "装饰": 2, "": 3}
        matched: List[Dict[str, Any]] = []
        for entity_id in matched_ids:
            # v5.1 schema: entities 表使用 id 字段，current_json 存储状态
            e = conn.execute(
                "SELECT canonical_name, tier, current_json FROM entities WHERE id = ? LIMIT 1",
                (entity_id,),
            ).fetchone()
            if not e:
                continue

            # 从 current_json 解析快照
            snapshot = {}
            if e["current_json"]:
                try:
                    snapshot = json.loads(e["current_json"])
                except (json.JSONDecodeError, TypeError):
                    pass

            matched.append(
                {
                    "entity_id": entity_id,
                    "name": e["canonical_name"] or entity_id,
                    "tier": e["tier"] or "",
                    "snapshot": snapshot,
                }
            )

        matched.sort(key=lambda x: tier_order.get(x.get("tier", ""), 3))
        return matched[:self.config.context_max_appearing_characters]

    def _get_urgent_foreshadowing(self, state: Dict, chapter_num: int) -> List[Dict]:
        """获取紧急伏笔（优先使用 index.db 伏笔索引）"""
        conn = self._conn_index()
        if conn is not None:
            try:
                rows = conn.execute(
                    "SELECT content, introduced_chapter, resolved_chapter, status, urgency, location "
                    "FROM foreshadowing_index WHERE status = '未回收' ORDER BY urgency DESC LIMIT 5"
                ).fetchall()
                return [dict(r) for r in rows] if rows else []
            except sqlite3.Error:
                pass

        # fallback：项目未建索引时直接读取 state.json
        plot_threads = state.get("plot_threads", {}) or {}
        items = plot_threads.get("foreshadowing", []) or []
        urgent: List[Dict[str, Any]] = []

        for fs in items:
            if not isinstance(fs, dict):
                continue
            status = str(fs.get("status", "")).strip()
            if status in {"已回收"}:
                continue

            planted_chapter = fs.get("planted_chapter") or fs.get("introduced_chapter") or 0
            target_chapter = fs.get("target_chapter") or fs.get("target") or 0
            try:
                planted_chapter = int(planted_chapter)
            except (TypeError, ValueError):
                planted_chapter = 0
            try:
                target_chapter = int(target_chapter) if target_chapter else 0
            except (TypeError, ValueError):
                target_chapter = 0

            chapters_pending = chapter_num - planted_chapter if planted_chapter else 0

            # 使用配置的紧急度阈值
            cfg = self.config
            if chapters_pending > cfg.foreshadowing_urgency_pending_high:
                urgency = cfg.foreshadowing_urgency_score_high
            elif chapters_pending > cfg.foreshadowing_urgency_pending_medium:
                urgency = cfg.foreshadowing_urgency_score_medium
            elif target_chapter and chapter_num >= target_chapter - cfg.foreshadowing_urgency_target_proximity:
                urgency = cfg.foreshadowing_urgency_score_target
            else:
                urgency = cfg.foreshadowing_urgency_score_low

            if urgency >= cfg.foreshadowing_urgency_threshold_show:
                urgent.append(
                    {
                        "content": fs.get("content") or fs.get("description") or "",
                        "planted_chapter": planted_chapter,
                        "target_chapter": target_chapter,
                        "tier": fs.get("tier", ""),
                        "urgency": urgency,
                    }
                )

        urgent.sort(key=lambda x: x.get("urgency", 0), reverse=True)
        return urgent[:self.config.context_max_urgent_foreshadowing]

    def _load_skeleton(self, setting_type: str) -> str:
        """加载设定骨架"""
        patterns = [
            f"{setting_type}.md",
            f"{setting_type}/*.md",
            f"*{setting_type}*.md"
        ]

        for pattern in patterns:
            matches = list(self.settings_dir.glob(pattern))
            if matches:
                # 如果是目录，合并所有文件
                if matches[0].is_dir():
                    content = []
                    for f in sorted(matches[0].glob("*.md")):
                        with open(f, 'r', encoding='utf-8') as file:
                            content.append(f"## {f.stem}\n{file.read()}")
                    return "\n\n".join(content)
                else:
                    with open(matches[0], 'r', encoding='utf-8') as f:
                        return f.read()

        return f"[{setting_type}设定未找到]"

    def _get_style_contract_ref(self) -> str:
        """获取风格契约引用"""
        style_file = self.settings_dir / "风格契约.md"
        if style_file.exists():
            with open(style_file, 'r', encoding='utf-8') as f:
                return f.read()

        # 检查其他可能的位置
        for pattern in ["风格*.md", "写作风格*.md", "style*.md"]:
            matches = list(self.settings_dir.glob(pattern))
            if matches:
                with open(matches[0], 'r', encoding='utf-8') as f:
                    return f.read()

        return "[风格契约未定义]"


def main():
    parser = argparse.ArgumentParser(description="Context Pack Builder v5.2")
    parser.add_argument("--chapter", type=int, required=True, help="章节编号")
    parser.add_argument("--project-root", metavar="PATH", help="项目根目录")
    parser.add_argument("--output", metavar="FILE", help="输出文件路径（默认输出到 stdout）")
    parser.add_argument("--pretty", action="store_true", help="格式化 JSON 输出")

    args = parser.parse_args()

    # 构建上下文包
    builder = ContextPackBuilder(project_root=args.project_root)
    context_pack = builder.build(args.chapter)

    # 输出
    if args.pretty:
        output = json.dumps(context_pack, ensure_ascii=False, indent=2)
    else:
        output = json.dumps(context_pack, ensure_ascii=False)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(output)
        print(f"✅ 上下文包已保存到: {args.output}")
    else:
        print(output)


if __name__ == "__main__":
    # Windows UTF-8 编码修复
    if sys.platform == 'win32':
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

    main()
