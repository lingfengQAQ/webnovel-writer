#!/usr/bin/env python3
"""
结构化索引系统（Structured Index System）

目标：取代向量化检索，使用 SQLite 提供精确、快速的结构化查询

核心功能：
1. 章节元数据索引（location, characters, word_count）
2. 伏笔追踪索引（status, urgency calculation）
3. 文件 Hash 自愈机制（auto-rebuild on change）

性能目标：
- 查询速度：2-5ms（vs 文件遍历 500ms，提升 250x）
- 索引构建：10ms/章（增量更新）
- 存储开销：200 章 ≈ 100 KB

使用方式：
  # 更新单章索引
  python structured_index.py --update-chapter 7 --metadata "正文/第0007章.md"

  # 批量重建索引（历史章节）
  python structured_index.py --rebuild-index

  # 查询地点相关章节
  python structured_index.py --query-location "血煞秘境"

  # 查询紧急伏笔
  python structured_index.py --query-urgent-foreshadowing

  # 模糊查询角色
  python structured_index.py --fuzzy-search "姓李" "女弟子"

  # 导出关系图
  python structured_index.py --export-graph > relationships.md
"""

import json
import os
import sys
import argparse
import sqlite3
import hashlib
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Tuple

# ============================================================================
# 安全修复：导入安全工具函数（P1 MEDIUM）
# ============================================================================
from security_utils import create_secure_directory
from project_locator import resolve_project_root
from chapter_paths import find_chapter_file


class StructuredIndex:
    """结构化索引管理器（取代向量化检索）"""

    def __init__(self, project_root=None):
        if project_root is None:
            try:
                project_root = resolve_project_root()
            except FileNotFoundError:
                project_root = Path.cwd()
        else:
            project_root = Path(project_root)

        self.project_root = project_root
        self.state_file = project_root / ".webnovel" / "state.json"
        self.chapters_dir = project_root / "正文"
        self.index_db = project_root / ".webnovel" / "index.db"

        # ============================================================================
        # 安全修复：使用安全目录创建函数（P1 MEDIUM）
        # 原代码: self.index_db.parent.mkdir(parents=True, exist_ok=True)
        # 漏洞: 未设置权限，使用OS默认（可能为755，允许同组用户读取）
        # ============================================================================
        create_secure_directory(str(self.index_db.parent))

        # 连接数据库
        self.conn = sqlite3.connect(str(self.index_db))
        self.conn.row_factory = sqlite3.Row  # 返回字典式行

        # 创建表结构
        self._create_tables()

    def _create_tables(self):
        """创建索引表结构"""

        # 1. 章节元数据表
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS chapters (
                chapter_num INTEGER PRIMARY KEY,
                title TEXT,
                location TEXT,
                characters TEXT,  -- JSON: ["李雪", "主角"]
                word_count INTEGER,
                content_hash TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # 地点索引（加速查询）
        self.conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_location
            ON chapters(location)
        """)

        # 2. 伏笔追踪表
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS foreshadowing_index (
                id INTEGER PRIMARY KEY,
                content TEXT,
                location TEXT,
                characters TEXT,  -- JSON: ["李雪", "主角"]
                introduced_chapter INTEGER,
                resolved_chapter INTEGER,
                status TEXT,  -- '未回收' / '已回收'
                urgency INTEGER DEFAULT 0,  -- 0-100，自动计算
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # 状态索引
        self.conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_status
            ON foreshadowing_index(status)
        """)

        # 紧急度索引
        self.conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_urgency
            ON foreshadowing_index(urgency)
        """)

        # 3. 角色关系表
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS relationships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                char1 TEXT,
                char2 TEXT,
                relation_type TEXT,  -- 'ally', 'enemy', 'romance', 'mentor', 'debtor'
                intensity INTEGER,    -- 关系强度 0-100
                description TEXT,
                last_update_chapter INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(char1, char2, relation_type)  -- 防止重复
            )
        """)

        # 关系索引
        self.conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_char1_char2
            ON relationships(char1, char2)
        """)

        # 4. 角色索引表（优化模糊搜索性能）
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS characters (
                name TEXT PRIMARY KEY,
                description TEXT,
                personality TEXT,
                importance TEXT,  -- 'major' / 'minor'
                power_level TEXT,
                first_appearance INTEGER,
                last_appearance INTEGER,
                status TEXT DEFAULT 'active',  -- 'active' / 'archived'
                archived_at TEXT,  -- ISO timestamp
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # 角色名索引（加速模糊搜索）
        self.conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_character_name
            ON characters(name)
        """)

        # 状态索引
        self.conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_character_status
            ON characters(status)
        """)

        self.conn.commit()

    # ================== 核心功能 1：章节元数据索引 ==================

    def index_chapter(self, chapter_num: int, metadata: Dict):
        """为新章节建立索引（在 webnovel-write Step 4.6 调用）

        Args:
            chapter_num: 章节编号
            metadata: {
                'title': '章节标题',
                'location': '地点',
                'characters': ['李雪', '主角'],
                'word_count': 3500,
                'hash': 'md5_hash'
            }
        """
        self.conn.execute("""
            INSERT OR REPLACE INTO chapters
            (chapter_num, title, location, characters, word_count, content_hash, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (
            chapter_num,
            metadata['title'],
            metadata['location'],
            json.dumps(metadata['characters'], ensure_ascii=False),
            metadata['word_count'],
            metadata['hash']
        ))

        self.conn.commit()
        print(f"✅ 章节索引已更新：Ch{chapter_num} - {metadata['title']}")

    def bump_character_last_appearance_in_state(self, chapter_num: int, character_names: List[str]) -> int:
        """将本章出场角色同步回 state.json 的 last_appearance_chapter（轻量级）"""
        if not character_names:
            return 0
        if not self.state_file.exists():
            return 0

        try:
            with open(self.state_file, 'r', encoding='utf-8') as f:
                state = json.load(f)
        except json.JSONDecodeError:
            return 0

        entities = state.get("entities", {}) or {}
        characters = entities.get("characters", [])
        if not isinstance(characters, list):
            return 0

        name_set = {str(n).strip() for n in character_names if str(n).strip()}
        if not name_set:
            return 0

        updated = 0
        changed = False
        for char in characters:
            if not isinstance(char, dict):
                continue
            name = str(char.get("name", "")).strip()
            if not name or name not in name_set:
                continue

            tier = str(char.get("tier", "")).strip()
            if "importance" not in char:
                char["importance"] = "major" if tier == "核心" else "minor"
                changed = True

            if "description" not in char and isinstance(char.get("desc"), str):
                char["description"] = char.get("desc", "")
                changed = True

            prev = char.get("last_appearance_chapter")
            try:
                prev_int = int(prev)
            except (TypeError, ValueError):
                prev_int = 0

            new_last = max(prev_int, int(chapter_num))
            if new_last != prev_int:
                char["last_appearance_chapter"] = new_last
                updated += 1
                changed = True

            if not char.get("first_appearance_chapter"):
                char["first_appearance_chapter"] = int(chapter_num)
                changed = True

        if not changed:
            return 0

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                suffix=".tmp",
                delete=False,
                dir=str(self.state_file.parent),
            ) as tf:
                tmp_path = Path(tf.name)
                json.dump(state, tf, ensure_ascii=False, indent=2)
                tf.write("\n")
            os.replace(str(tmp_path), str(self.state_file))
        finally:
            if tmp_path and tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

        return updated

    def query_chapters_by_location(self, location: str, limit: int = 10) -> List[Tuple]:
        """O(log n) 查询：返回该地点的最近 N 章

        Args:
            location: 地点名称
            limit: 返回数量

        Returns:
            [(chapter_num, title, characters), ...]
        """
        cursor = self.conn.execute("""
            SELECT chapter_num, title, characters
            FROM chapters
            WHERE location = ?
            ORDER BY chapter_num DESC
            LIMIT ?
        """, (location, limit))

        return cursor.fetchall()

    def calculate_chapter_hash(self, chapter_file: Path) -> str:
        """计算章节文件 MD5 Hash（用于自愈机制）"""
        if not chapter_file.exists():
            return ""

        with open(chapter_file, 'rb') as f:
            return hashlib.md5(f.read()).hexdigest()

    def get_stored_hash(self, chapter_num: int) -> Optional[str]:
        """从索引中读取存储的 Hash"""
        cursor = self.conn.execute("""
            SELECT content_hash FROM chapters WHERE chapter_num = ?
        """, (chapter_num,))

        row = cursor.fetchone()
        return row['content_hash'] if row else None

    def validate_and_rebuild_if_needed(self, chapter_num: int):
        """校验章节 Hash，不一致则自动重建索引（Self-Healing Index）

        触发时机：
        - context_manager.py 查询章节前调用
        - 增加耗时：~5ms（Hash 计算 + 对比）
        - 仅当检测到变更时才重建（增量成本）
        """
        chapter_file = find_chapter_file(self.project_root, chapter_num)
        if chapter_file is None or not chapter_file.exists():
            return  # 文件不存在，跳过

        # 计算当前文件 Hash
        current_hash = self.calculate_chapter_hash(chapter_file)

        # 从索引中读取存储的 Hash
        stored_hash = self.get_stored_hash(chapter_num)

        if current_hash != stored_hash:
            print(f"⚠️ 检测到 Ch{chapter_num} 已修改，自动重建索引...")
            self._rebuild_chapter_index(chapter_num, chapter_file)
            print(f"✅ Ch{chapter_num} 索引已更新")

    def _rebuild_chapter_index(self, chapter_num: int, chapter_file: Path):
        """重建单章索引（自动提取元数据）"""

        # 读取章节内容
        with open(chapter_file, 'r', encoding='utf-8') as f:
            content = f.read()

        # 提取元数据
        metadata = self._extract_metadata_from_content(content, chapter_num)

        # 重建索引
        self.index_chapter(chapter_num, metadata)

    def _extract_metadata_from_content(self, content: str, chapter_num: int) -> Dict:
        """从章节内容中提取元数据"""

        # 提取标题（第一行）
        lines = content.split('\n')
        title = lines[0].strip('# ').strip() if lines else f"第{chapter_num}章"

        # 提取地点（在章节开头查找，通常格式为 **地点：XXX**）
        location_match = re.search(r'\*\*地点[：:]\s*(.+?)\*\*', content)
        location = location_match.group(1).strip() if location_match else "未知"

        # 提取角色（查找所有对话和描述中的角色名）
        # 简化实现：从 state.json 读取已知角色，匹配出现频率
        characters = self._extract_characters_from_content(content)

        # 计算字数
        word_count = len(content)

        # 计算 Hash
        content_hash = hashlib.md5(content.encode('utf-8')).hexdigest()

        return {
            'title': title,
            'location': location,
            'characters': characters[:5],  # 最多 5 个主要角色
            'word_count': word_count,
            'hash': content_hash
        }

    def _extract_characters_from_content(self, content: str) -> List[str]:
        """从内容中提取角色（简化实现：读取 state.json 已知角色）"""

        if not self.state_file.exists():
            return []

        # 读取 state.json
        with open(self.state_file, 'r', encoding='utf-8') as f:
            state = json.load(f)

        # 获取已知角色列表
        known_characters = [
            char['name']
            for char in state.get('entities', {}).get('characters', [])
        ]

        # 统计每个角色在内容中的出现次数
        char_counts = {}
        for char_name in known_characters:
            count = content.count(char_name)
            if count > 0:
                char_counts[char_name] = count

        # 按出现次数排序，返回前 5 个
        sorted_chars = sorted(char_counts.items(), key=lambda x: x[1], reverse=True)
        return [char for char, _ in sorted_chars[:5]]

    # ================== 核心功能 2：伏笔追踪索引 ==================

    def sync_foreshadowing_from_state(self):
        """从 state.json 同步伏笔数据到索引

        触发时机：
        - update_state.py 更新伏笔后调用
        - --rebuild-index 批量重建时调用
        """
        if not self.state_file.exists():
            print("❌ state.json 不存在，跳过伏笔同步")
            return

        # 读取 state.json
        with open(self.state_file, 'r', encoding='utf-8') as f:
            state = json.load(f)

        current_chapter = state.get('progress', {}).get('current_chapter', 0)

        plot_threads = state.get('plot_threads', {}) or {}

        # 兼容新格式：plot_threads.foreshadowing = [{"content": "...", "status": "active", ...}, ...]
        foreshadowing_items = plot_threads.get('foreshadowing', []) or []
        active_count = 0
        resolved_count = 0

        for item in foreshadowing_items:
            desc = item.get('description') or item.get('content') or ''
            if not desc:
                continue

            raw_status = (item.get('status') or '').strip()
            if raw_status in ['已回收', 'resolved']:
                status = '已回收'
                resolved_count += 1
            else:
                # 默认都视为未回收（兼容 active/未回收/pending/空）
                status = '未回收'
                active_count += 1

            normalized = {
                'description': desc,
                'location': item.get('location', ''),
                'characters': item.get('characters', []),
                # 如果没有明确记录，至少给一个可用的默认值（避免紧急度恒为0）
                'introduced_chapter': item.get('introduced_chapter') or item.get('planted_chapter') or 1,
                'resolved_chapter': item.get('resolved_chapter', None),
            }

            self._index_foreshadowing(normalized, current_chapter, status=status)

        self.conn.commit()
        print(f"✅ 伏笔索引已同步：{active_count} 条活跃 + {resolved_count} 条已回收")

    def _index_foreshadowing(self, plot: Dict, current_chapter: int, status: str):
        """为单个伏笔建立索引"""

        # 计算紧急度
        urgency = self._calculate_urgency(plot, current_chapter)

        # 提取地点和角色（如果有）
        location = plot.get('location', '')
        characters = plot.get('characters', [])

        self.conn.execute("""
            INSERT OR REPLACE INTO foreshadowing_index
            (id, content, location, characters, introduced_chapter, resolved_chapter, status, urgency, updated_at)
            VALUES ((SELECT id FROM foreshadowing_index WHERE content = ?), ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (
            plot.get('description', ''),  # 用于查重
            plot.get('description', ''),
            location,
            json.dumps(characters, ensure_ascii=False),
            plot.get('introduced_chapter', 0),
            plot.get('resolved_chapter', None),
            status,
            urgency
        ))

    def _calculate_urgency(self, plot: Dict, current_chapter: int) -> int:
        """计算伏笔紧急度（0-100）

        规则：
        - 超过 100 章未回收 → 极度紧急（100）
        - 超过 50 章未回收 → 中等紧急（60）
        - 其他 → 正常（20）
        """
        introduced_ch = plot.get('introduced_chapter', 0)
        chapters_pending = current_chapter - introduced_ch

        if chapters_pending > 100:
            return 100  # 极度紧急
        elif chapters_pending > 50:
            return 60   # 中等紧急
        else:
            return 20   # 正常

    def sync_characters_from_state(self):
        """从 state.json 同步角色数据到索引（优化模糊搜索性能）

        触发时机：
        - update_state.py 更新角色后调用
        - --rebuild-index 批量重建时调用
        """
        if not self.state_file.exists():
            print("❌ state.json 不存在，跳过角色同步")
            return

        # 读取 state.json
        with open(self.state_file, 'r', encoding='utf-8') as f:
            state = json.load(f)

        characters = state.get('entities', {}).get('characters', [])

        for char in characters:
            self._index_character(char, status='active')

        self.conn.commit()
        print(f"✅ 角色索引已同步：{len(characters)} 个角色")

    def _index_character(self, char: Dict, status: str = 'active'):
        """为单个角色建立索引"""
        description = char.get('description') or char.get('desc') or ''
        tier = str(char.get('tier', '') or '').strip()
        importance = char.get('importance') or ('major' if tier == '核心' else 'minor')

        first_appearance = char.get('first_appearance_chapter', 0) or 0
        try:
            first_appearance = int(first_appearance)
        except (TypeError, ValueError):
            first_appearance = 0

        if first_appearance == 0:
            src = char.get('first_appearance')
            if isinstance(src, str):
                m = re.search(r'第(\d+)章', src)
                if m:
                    try:
                        first_appearance = int(m.group(1))
                    except ValueError:
                        first_appearance = 0

        last_appearance = char.get('last_appearance_chapter', 0) or first_appearance
        try:
            last_appearance = int(last_appearance)
        except (TypeError, ValueError):
            last_appearance = first_appearance

        self.conn.execute("""
            INSERT OR REPLACE INTO characters
            (name, description, personality, importance, power_level,
             first_appearance, last_appearance, status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (
            char.get('name', ''),
            description,
            char.get('personality', ''),
            importance,
            char.get('power_level', ''),
            first_appearance,
            last_appearance,
            status
        ))

    def mark_character_archived(self, name: str, archived_at: str = None):
        """标记角色为已归档状态（Priority 2 修复）

        Args:
            name: 角色名
            archived_at: 归档时间戳（ISO格式），默认当前时间
        """
        if archived_at is None:
            from datetime import datetime
            archived_at = datetime.now().isoformat()

        self.conn.execute("""
            UPDATE characters
            SET status = 'archived', archived_at = ?, updated_at = CURRENT_TIMESTAMP
            WHERE name = ?
        """, (archived_at, name))
        self.conn.commit()

    def mark_character_active(self, name: str):
        """恢复角色为活跃状态（与 mark_character_archived 对应）"""
        self.conn.execute("""
            UPDATE characters
            SET status = 'active', archived_at = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE name = ?
        """, (name,))
        self.conn.commit()

    def query_urgent_foreshadowing(self, threshold: int = 60) -> List[Dict]:
        """查询紧急伏笔（urgency >= threshold）

        Args:
            threshold: 紧急度阈值（60=中等紧急，80=高度紧急，100=极度紧急）

        Returns:
            [{'content': '...', 'introduced_chapter': 45, 'urgency': 80}, ...]
        """
        cursor = self.conn.execute("""
            SELECT content, introduced_chapter, urgency
            FROM foreshadowing_index
            WHERE status = '未回收' AND urgency >= ?
            ORDER BY urgency DESC
        """, (threshold,))

        return [dict(row) for row in cursor.fetchall()]

    # ================== 核心功能 3：模糊查询（Fuzzy Search via SQL LIKE）==================

    def fuzzy_search_character(self, keywords: List[str]) -> List[Dict]:
        """模糊查询角色（支持多关键词）- O(log n) SQL查询

        Args:
            keywords: 关键词列表，如 ["李", "女弟子"]

        Returns:
            [{'name': '李雪', 'description': '...', 'last_appearance_chapter': 45, 'status': 'active'}, ...]

        示例：
            fuzzy_search_character(["李", "女弟子"])
            → 返回所有名字或描述包含"李"和"女弟子"的角色

        性能：
            - 旧版：O(n) 遍历 state.json 所有角色（210个角色 = ~500ms）
            - 新版：O(log n) SQL 索引查询（~10ms）
        """
        # 构建 WHERE 子句（每个关键词都必须匹配）
        conditions = []
        params = []

        for kw in keywords:
            # 每个关键词在 name/description/personality 任一字段中出现即可
            conditions.append("(name LIKE ? OR description LIKE ? OR personality LIKE ?)")
            params.extend([f'%{kw}%', f'%{kw}%', f'%{kw}%'])

        # AND 连接所有关键词条件（所有关键词都必须匹配）
        where_clause = " AND ".join(conditions)

        # 执行 SQL 查询
        query = f"""
            SELECT name, description, personality, importance, power_level,
                   first_appearance, last_appearance, status
            FROM characters
            WHERE {where_clause}
            ORDER BY
                status ASC,  -- 活跃角色优先
                last_appearance DESC  -- 最近出场优先
            LIMIT 10
        """

        cursor = self.conn.execute(query, params)
        rows = cursor.fetchall()

        # 转换为字典列表
        matched = []
        for row in rows:
            matched.append({
                'name': row[0],
                'description': row[1],
                'personality': row[2],
                'importance': row[3],
                'power_level': row[4],
                'first_appearance_chapter': row[5],
                'last_appearance_chapter': row[6],
                'status': row[7]  # 'active' / 'archived'
            })

        return matched

    # ================== 批量操作 ==================

    def rebuild_all_indexes(self):
        """批量重建所有历史章节的索引

        使用场景：
        - 索引系统首次上线
        - 索引数据库损坏
        """
        if not self.chapters_dir.exists():
            print("❌ 章节目录不存在")
            return

        # 获取所有章节文件
        chapter_files = sorted(self.chapters_dir.rglob("第*.md"))

        print(f"🔍 发现 {len(chapter_files)} 个章节文件，开始重建索引...")

        seen = set()
        for chapter_file in chapter_files:
            # 提取章节编号
            match = re.search(r'第(\d+)章', chapter_file.name)
            if not match:
                continue

            chapter_num = int(match.group(1))
            if chapter_num in seen:
                continue
            seen.add(chapter_num)

            # 重建索引
            self._rebuild_chapter_index(chapter_num, chapter_file)

        # 同步伏笔索引
        self.sync_foreshadowing_from_state()
        self.sync_characters_from_state()

        print(f"✅ 批量重建完成：{len(seen)} 章")

    # ================== 查询与统计 ==================

    def get_index_stats(self) -> Dict:
        """获取索引统计信息"""

        # 章节统计
        cursor = self.conn.execute("SELECT COUNT(*) as count FROM chapters")
        chapter_count = cursor.fetchone()['count']

        # 伏笔统计
        cursor = self.conn.execute("""
            SELECT status, COUNT(*) as count
            FROM foreshadowing_index
            GROUP BY status
        """)
        foreshadowing_stats = {row['status']: row['count'] for row in cursor.fetchall()}

        # 关系统计
        cursor = self.conn.execute("SELECT COUNT(*) as count FROM relationships")
        relationship_count = cursor.fetchone()['count']

        # 数据库大小
        db_size_kb = self.index_db.stat().st_size / 1024

        return {
            'chapter_count': chapter_count,
            'foreshadowing_active': foreshadowing_stats.get('未回收', 0),
            'foreshadowing_resolved': foreshadowing_stats.get('已回收', 0),
            'relationship_count': relationship_count,
            'db_size_kb': round(db_size_kb, 2)
        }

    def __del__(self):
        """析构函数：关闭数据库连接"""
        if hasattr(self, 'conn'):
            self.conn.close()


def main():
    parser = argparse.ArgumentParser(description="结构化索引系统（取代向量化检索）")

    # 更新操作
    parser.add_argument("--update-chapter", type=int, metavar="NUM", help="更新单章索引")
    parser.add_argument("--metadata", metavar="PATH", help="章节文件路径（配合 --update-chapter）")
    parser.add_argument("--metadata-json", metavar="JSON", help="元数据 JSON 字符串（配合 --update-chapter，由 metadata-extractor agent 提供）")
    parser.add_argument("--metadata-file", metavar="FILE", help="元数据 JSON 文件路径（配合 --update-chapter，Windows 推荐使用此参数）")

    # 批量操作
    parser.add_argument("--rebuild-index", action="store_true", help="批量重建所有索引")

    # 查询操作
    parser.add_argument("--query-location", metavar="LOCATION", help="查询地点相关章节")
    parser.add_argument("--query-urgent-foreshadowing", action="store_true", help="查询紧急伏笔")
    parser.add_argument("--fuzzy-search", nargs='+', metavar="KEYWORD", help="模糊查询角色（多个关键词）")

    # 统计信息
    parser.add_argument("--stats", action="store_true", help="显示索引统计信息")

    # 项目路径
    parser.add_argument("--project-root", metavar="PATH", help="项目根目录（默认为当前目录）")

    args = parser.parse_args()

    # 创建索引管理器
    index = StructuredIndex(project_root=args.project_root)

    # 执行操作
    if args.update_chapter:
        # 模式1：从 JSON 文件读取（Windows 推荐，避免 CLI 引号转义问题）
        if args.metadata_file:
            try:
                metadata_file = Path(args.metadata_file)
                if not metadata_file.exists():
                    print(f"❌ 元数据文件不存在: {metadata_file}")
                    return

                with open(metadata_file, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)

                # 验证必需字段
                required_fields = ['title', 'location', 'characters', 'word_count', 'hash']
                missing_fields = [f for f in required_fields if f not in metadata]

                if missing_fields:
                    print(f"❌ JSON 缺少必需字段: {', '.join(missing_fields)}")
                    return

                # 更新索引
                index.index_chapter(args.update_chapter, metadata)

                # 同步伏笔索引
                index.sync_foreshadowing_from_state()
                index.bump_character_last_appearance_in_state(args.update_chapter, metadata.get("characters", []))
                index.sync_characters_from_state()

            except json.JSONDecodeError as e:
                print(f"❌ JSON 解析失败: {e}")
                return

        # 模式2：直接接收 JSON 字符串（Linux/macOS，或测试时使用）
        elif args.metadata_json:
            try:
                metadata = json.loads(args.metadata_json)

                # 验证必需字段
                required_fields = ['title', 'location', 'characters', 'word_count', 'hash']
                missing_fields = [f for f in required_fields if f not in metadata]

                if missing_fields:
                    print(f"❌ JSON 缺少必需字段: {', '.join(missing_fields)}")
                    return

                # 更新索引
                index.index_chapter(args.update_chapter, metadata)

                # 同步伏笔索引
                index.sync_foreshadowing_from_state()
                index.bump_character_last_appearance_in_state(args.update_chapter, metadata.get("characters", []))
                index.sync_characters_from_state()

            except json.JSONDecodeError as e:
                print(f"❌ JSON 解析失败: {e}")
                return

        # 模式3：从章节文件提取元数据（旧模式，保持向后兼容）
        elif args.metadata:
            # 读取章节文件
            chapter_file = Path(args.metadata)
            if not chapter_file.exists():
                print(f"❌ 章节文件不存在: {chapter_file}")
                return

            # 提取元数据
            with open(chapter_file, 'r', encoding='utf-8') as f:
                content = f.read()

            metadata = index._extract_metadata_from_content(content, args.update_chapter)

            # 更新索引
            index.index_chapter(args.update_chapter, metadata)

            # 同步伏笔索引
            index.sync_foreshadowing_from_state()
            index.bump_character_last_appearance_in_state(args.update_chapter, metadata.get("characters", []))
            index.sync_characters_from_state()

        else:
            print("❌ 缺少参数：--metadata-file (推荐) / --metadata-json / --metadata")
            return

    elif args.rebuild_index:
        index.rebuild_all_indexes()

    elif args.query_location:
        results = index.query_chapters_by_location(args.query_location)

        if not results:
            print(f"未找到地点相关章节: {args.query_location}")
        else:
            print(f"找到 {len(results)} 个相关章节：")
            for chapter_num, title, characters in results:
                print(f"  Ch{chapter_num}: {title} - 角色: {characters}")

    elif args.query_urgent_foreshadowing:
        results = index.query_urgent_foreshadowing(threshold=60)

        if not results:
            print("✅ 无紧急伏笔")
        else:
            print(f"⚠️ 检测到 {len(results)} 条紧急伏笔：")
            for item in results:
                print(f"  - {item['content'][:30]}...（第 {item['introduced_chapter']} 章埋设，紧急度 {item['urgency']}/100）")

    elif args.fuzzy_search:
        results = index.fuzzy_search_character(args.fuzzy_search)

        if not results:
            print(f"未找到匹配角色: {' + '.join(args.fuzzy_search)}")
        else:
            print(f"找到 {len(results)} 个匹配角色：")
            for i, char in enumerate(results, 1):
                print(f"{i}. {char['name']} - {char['description'][:50]}...（最后出场：Ch {char['last_appearance_chapter']}）")

    elif args.stats:
        stats = index.get_index_stats()

        print("📊 索引统计信息：")
        print(f"   章节索引: {stats['chapter_count']}")
        print(f"   伏笔索引: {stats['foreshadowing_active']} 条活跃 + {stats['foreshadowing_resolved']} 条已回收")
        print(f"   关系索引: {stats['relationship_count']}")
        print(f"   数据库大小: {stats['db_size_kb']} KB")

    else:
        parser.print_help()


if __name__ == "__main__":
    # Windows UTF-8 编码修复（仅在脚本直接运行时）
    if sys.platform == 'win32':
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

    main()
