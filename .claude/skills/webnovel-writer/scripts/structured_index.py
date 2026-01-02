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
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Tuple


class StructuredIndex:
    """结构化索引管理器（取代向量化检索）"""

    def __init__(self, project_root=None):
        if project_root is None:
            project_root = Path.cwd()
        else:
            project_root = Path(project_root)

        self.project_root = project_root
        self.state_file = project_root / ".webnovel" / "state.json"
        self.chapters_dir = project_root / "正文"
        self.index_db = project_root / ".webnovel" / "index.db"

        # 确保数据库目录存在
        self.index_db.parent.mkdir(parents=True, exist_ok=True)

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
        chapter_file = self.chapters_dir / f"第{chapter_num:04d}章.md"

        if not chapter_file.exists():
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

        # 同步活跃伏笔（未回收）
        active_plots = state.get('plot_threads', {}).get('active', [])
        for plot in active_plots:
            self._index_foreshadowing(plot, current_chapter, status="未回收")

        # 同步已回收伏笔
        resolved_plots = state.get('plot_threads', {}).get('resolved', [])
        for plot in resolved_plots:
            self._index_foreshadowing(plot, current_chapter, status="已回收")

        self.conn.commit()
        print(f"✅ 伏笔索引已同步：{len(active_plots)} 条活跃 + {len(resolved_plots)} 条已回收")

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
            plot['description'],  # 用于查重
            plot['description'],
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
        """模糊查询角色（支持多关键词）

        Args:
            keywords: 关键词列表，如 ["李", "女弟子"]

        Returns:
            [{'name': '李雪', 'description': '...', 'last_appearance_chapter': 45}, ...]

        示例：
            fuzzy_search_character(["李", "女弟子"])
            → 返回所有名字或描述包含"李"和"女弟子"的角色
        """
        if not self.state_file.exists():
            return []

        # 读取 state.json 中的角色数据
        with open(self.state_file, 'r', encoding='utf-8') as f:
            state = json.load(f)

        characters = state.get('entities', {}).get('characters', [])
        matched = []

        for char in characters:
            # 检查所有关键词是否都匹配
            name = char.get('name', '')
            description = char.get('description', '')
            personality = char.get('personality', '')

            # 组合文本
            combined_text = f"{name} {description} {personality}"

            # 检查所有关键词是否都在 combined_text 中
            if all(keyword in combined_text for keyword in keywords):
                matched.append({
                    'name': name,
                    'description': description,
                    'last_appearance_chapter': char.get('last_appearance_chapter', 0)
                })

        # 按最后出场章节排序
        matched.sort(key=lambda x: x['last_appearance_chapter'], reverse=True)

        return matched[:10]  # 最多返回 10 个

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
        chapter_files = sorted(self.chapters_dir.glob("第*.md"))

        print(f"🔍 发现 {len(chapter_files)} 个章节文件，开始重建索引...")

        for chapter_file in chapter_files:
            # 提取章节编号
            match = re.search(r'第(\d+)章', chapter_file.name)
            if not match:
                continue

            chapter_num = int(match.group(1))

            # 重建索引
            self._rebuild_chapter_index(chapter_num, chapter_file)

        # 同步伏笔索引
        self.sync_foreshadowing_from_state()

        print(f"✅ 批量重建完成：{len(chapter_files)} 章")

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
