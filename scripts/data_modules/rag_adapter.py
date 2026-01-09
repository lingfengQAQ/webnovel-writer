#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RAG Adapter - RAG 检索适配模块

封装向量检索功能：
- 向量嵌入 (调用 Modal API)
- 语义搜索
- 重排序
- 混合检索 (向量 + BM25)
"""

import asyncio
import sqlite3
import json
import math
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from collections import Counter
import re
from contextlib import contextmanager
import itertools

from .config import get_config
from .api_client import get_client


@dataclass
class SearchResult:
    """搜索结果"""
    chunk_id: str
    chapter: int
    scene_index: int
    content: str
    score: float
    source: str  # "vector" | "bm25" | "hybrid"


class RAGAdapter:
    """RAG 检索适配器"""

    def __init__(self, config=None):
        self.config = config or get_config()
        self.api_client = get_client(config)
        self._init_db()

    def _init_db(self):
        """初始化向量数据库"""
        self.config.ensure_dirs()

        with self._get_conn() as conn:
            cursor = conn.cursor()

            # 向量存储表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS vectors (
                    chunk_id TEXT PRIMARY KEY,
                    chapter INTEGER,
                    scene_index INTEGER,
                    content TEXT,
                    embedding BLOB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # BM25 倒排索引表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS bm25_index (
                    term TEXT,
                    chunk_id TEXT,
                    tf REAL,
                    PRIMARY KEY (term, chunk_id)
                )
            """)

            # 文档统计表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS doc_stats (
                    chunk_id TEXT PRIMARY KEY,
                    doc_length INTEGER
                )
            """)

            # 创建索引
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_vectors_chapter ON vectors(chapter)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_bm25_term ON bm25_index(term)")

            conn.commit()

    @contextmanager
    def _get_conn(self):
        """获取数据库连接（确保关闭，避免 Windows 下文件句柄泄漏）"""
        conn = sqlite3.connect(str(self.config.vector_db))
        try:
            yield conn
        finally:
            conn.close()

    def _get_vectors_count(self) -> int:
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM vectors")
            row = cursor.fetchone()
            return int(row[0] or 0) if row else 0

    def _get_recent_chunk_ids(self, limit: int) -> List[str]:
        if limit <= 0:
            return []
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT chunk_id FROM vectors ORDER BY chapter DESC, scene_index DESC LIMIT ?",
                (int(limit),),
            )
            return [str(r[0]) for r in cursor.fetchall() if r and r[0]]

    def _fetch_vectors_by_chunk_ids(self, chunk_ids: List[str]) -> List[Tuple]:
        if not chunk_ids:
            return []

        # SQLite 参数数量限制（默认 999），这里做分片查询
        def _chunks(xs: List[str], size: int = 500):
            it = iter(xs)
            while True:
                batch = list(itertools.islice(it, size))
                if not batch:
                    break
                yield batch

        rows: List[Tuple] = []
        with self._get_conn() as conn:
            cursor = conn.cursor()
            for batch in _chunks(chunk_ids):
                placeholders = ",".join(["?"] * len(batch))
                cursor.execute(
                    f"SELECT chunk_id, chapter, scene_index, content, embedding FROM vectors WHERE chunk_id IN ({placeholders})",
                    tuple(batch),
                )
                rows.extend(cursor.fetchall())
        return rows

    def _vector_search_rows(
        self,
        query_embedding: List[float],
        rows: List[Tuple],
        *,
        top_k: int,
    ) -> List[SearchResult]:
        results: List[SearchResult] = []
        for row in rows:
            chunk_id, chapter, scene_index, content, embedding_bytes = row
            if not embedding_bytes:
                continue
            embedding = self._deserialize_embedding(embedding_bytes)
            score = self._cosine_similarity(query_embedding, embedding)
            results.append(
                SearchResult(
                    chunk_id=chunk_id,
                    chapter=chapter,
                    scene_index=scene_index,
                    content=content,
                    score=score,
                    source="vector",
                )
            )

        results.sort(key=lambda x: x.score, reverse=True)
        return results[:top_k]

    # ==================== 向量存储 ====================

    async def store_chunks(self, chunks: List[Dict]) -> int:
        """
        存储场景切片的向量

        chunks 格式:
        [
            {
                "chapter": 100,
                "scene_index": 1,
                "content": "场景内容..."
            }
        ]

        返回存储数量
        """
        if not chunks:
            return 0

        # 提取内容用于嵌入
        contents = [c["content"] for c in chunks]

        # 调用 API 获取嵌入向量
        embeddings = await self.api_client.embed_batch(contents)

        if not embeddings:
            return 0

        # 存储到数据库
        stored = 0
        with self._get_conn() as conn:
            cursor = conn.cursor()

            for chunk, embedding in zip(chunks, embeddings):
                chunk_id = f"ch{chunk['chapter']}_s{chunk['scene_index']}"

                # 将向量序列化为 bytes
                embedding_bytes = self._serialize_embedding(embedding)

                cursor.execute("""
                    INSERT OR REPLACE INTO vectors
                    (chunk_id, chapter, scene_index, content, embedding)
                    VALUES (?, ?, ?, ?, ?)
                """, (
                    chunk_id,
                    chunk["chapter"],
                    chunk["scene_index"],
                    chunk["content"],
                    embedding_bytes
                ))

                # 同时更新 BM25 索引
                self._update_bm25_index(cursor, chunk_id, chunk["content"])

                stored += 1

            conn.commit()

        return stored

    def _serialize_embedding(self, embedding: List[float]) -> bytes:
        """序列化向量"""
        import struct
        return struct.pack(f"{len(embedding)}f", *embedding)

    def _deserialize_embedding(self, data: bytes) -> List[float]:
        """反序列化向量"""
        import struct
        count = len(data) // 4
        return list(struct.unpack(f"{count}f", data))

    # ==================== BM25 索引 ====================

    def _tokenize(self, text: str) -> List[str]:
        """简单分词（中文按字符，英文按单词）"""
        # 中文字符
        chinese = re.findall(r'[\u4e00-\u9fff]+', text)
        chinese_chars = list("".join(chinese))

        # 英文单词
        english = re.findall(r'[a-zA-Z]+', text.lower())

        return chinese_chars + english

    def _update_bm25_index(self, cursor, chunk_id: str, content: str):
        """更新 BM25 索引"""
        # 删除旧索引
        cursor.execute("DELETE FROM bm25_index WHERE chunk_id = ?", (chunk_id,))
        cursor.execute("DELETE FROM doc_stats WHERE chunk_id = ?", (chunk_id,))

        # 分词
        tokens = self._tokenize(content)
        doc_length = len(tokens)

        # 计算词频
        tf_counter = Counter(tokens)

        # 插入倒排索引
        for term, count in tf_counter.items():
            tf = count / doc_length if doc_length > 0 else 0
            cursor.execute("""
                INSERT INTO bm25_index (term, chunk_id, tf)
                VALUES (?, ?, ?)
            """, (term, chunk_id, tf))

        # 更新文档统计
        cursor.execute("""
            INSERT INTO doc_stats (chunk_id, doc_length)
            VALUES (?, ?)
        """, (chunk_id, doc_length))

    # ==================== 向量检索 ====================

    async def vector_search(
        self,
        query: str,
        top_k: int = None
    ) -> List[SearchResult]:
        """向量相似度搜索"""
        top_k = top_k or self.config.vector_top_k

        # 获取查询向量
        query_embeddings = await self.api_client.embed([query])
        if not query_embeddings:
            return []

        query_embedding = query_embeddings[0]

        # 从数据库读取所有向量并计算相似度
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT chunk_id, chapter, scene_index, content, embedding FROM vectors")

            results = []
            for row in cursor.fetchall():
                chunk_id, chapter, scene_index, content, embedding_bytes = row
                embedding = self._deserialize_embedding(embedding_bytes)

                # 计算余弦相似度
                score = self._cosine_similarity(query_embedding, embedding)

                results.append(SearchResult(
                    chunk_id=chunk_id,
                    chapter=chapter,
                    scene_index=scene_index,
                    content=content,
                    score=score,
                    source="vector"
                ))

        # 排序并返回 top_k
        results.sort(key=lambda x: x.score, reverse=True)
        return results[:top_k]

    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        """计算余弦相似度"""
        dot_product = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(x * x for x in b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot_product / (norm_a * norm_b)

    # ==================== BM25 检索 ====================

    def bm25_search(
        self,
        query: str,
        top_k: int = None,
        k1: float = 1.5,
        b: float = 0.75
    ) -> List[SearchResult]:
        """BM25 关键词搜索"""
        top_k = top_k or self.config.bm25_top_k

        query_terms = self._tokenize(query)
        if not query_terms:
            return []

        with self._get_conn() as conn:
            cursor = conn.cursor()

            # 获取文档总数和平均长度
            cursor.execute("SELECT COUNT(*), AVG(doc_length) FROM doc_stats")
            row = cursor.fetchone()
            total_docs = row[0] or 1
            avg_doc_length = row[1] or 1

            # 计算每个文档的 BM25 分数
            doc_scores = {}

            for term in set(query_terms):
                # 获取包含该词的文档
                cursor.execute("""
                    SELECT b.chunk_id, b.tf, d.doc_length
                    FROM bm25_index b
                    JOIN doc_stats d ON b.chunk_id = d.chunk_id
                    WHERE b.term = ?
                """, (term,))

                docs_with_term = cursor.fetchall()
                df = len(docs_with_term)

                if df == 0:
                    continue

                # IDF
                idf = math.log((total_docs - df + 0.5) / (df + 0.5) + 1)

                for chunk_id, tf, doc_length in docs_with_term:
                    # BM25 公式
                    score = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc_length / avg_doc_length))

                    if chunk_id not in doc_scores:
                        doc_scores[chunk_id] = 0
                    doc_scores[chunk_id] += score

            # 获取文档内容
            results = []
            for chunk_id, score in doc_scores.items():
                cursor.execute("""
                    SELECT chapter, scene_index, content
                    FROM vectors
                    WHERE chunk_id = ?
                """, (chunk_id,))
                row = cursor.fetchone()
                if row:
                    results.append(SearchResult(
                        chunk_id=chunk_id,
                        chapter=row[0],
                        scene_index=row[1],
                        content=row[2],
                        score=score,
                        source="bm25"
                    ))

        results.sort(key=lambda x: x.score, reverse=True)
        return results[:top_k]

    # ==================== 混合检索 ====================

    async def hybrid_search(
        self,
        query: str,
        vector_top_k: int = None,
        bm25_top_k: int = None,
        rerank_top_n: int = None
    ) -> List[SearchResult]:
        """
        混合检索：向量 + BM25 + RRF 融合 + Rerank

        步骤:
        1. 向量检索 top_k
        2. BM25 检索 top_k
        3. RRF 融合
        4. Rerank 精排
        """
        vector_top_k = vector_top_k or self.config.vector_top_k
        bm25_top_k = bm25_top_k or self.config.bm25_top_k
        rerank_top_n = rerank_top_n or self.config.rerank_top_n

        # 小规模：全表向量扫描（召回更稳）；大规模：预筛选避免 O(n) 扫描拖慢
        vectors_count = await asyncio.to_thread(self._get_vectors_count)
        use_full_scan = vectors_count <= int(self.config.vector_full_scan_max_vectors)

        if use_full_scan:
            # 并行执行向量和 BM25 检索
            vector_results, bm25_results = await asyncio.gather(
                self.vector_search(query, vector_top_k),
                asyncio.to_thread(self.bm25_search, query, bm25_top_k)
            )
        else:
            bm25_candidates = max(
                int(self.config.vector_prefilter_bm25_candidates),
                int(bm25_top_k),
                int(vector_top_k) * 5,
                int(rerank_top_n) * 10,
            )
            recent_candidates = max(
                int(self.config.vector_prefilter_recent_candidates),
                int(vector_top_k) * 5,
                int(rerank_top_n) * 10,
            )

            bm25_task = asyncio.to_thread(self.bm25_search, query, bm25_candidates)
            recent_task = asyncio.to_thread(self._get_recent_chunk_ids, recent_candidates)
            embed_task = self.api_client.embed([query])

            bm25_candidates_results, recent_ids, query_embeddings = await asyncio.gather(
                bm25_task,
                recent_task,
                embed_task,
            )

            if not query_embeddings:
                return []
            query_embedding = query_embeddings[0]

            candidate_ids = {r.chunk_id for r in bm25_candidates_results}
            candidate_ids.update(recent_ids)

            rows = await asyncio.to_thread(self._fetch_vectors_by_chunk_ids, list(candidate_ids))
            vector_results = await asyncio.to_thread(
                self._vector_search_rows,
                query_embedding,
                rows,
                top_k=int(vector_top_k),
            )

            # BM25 结果用于融合时只取 top_k
            bm25_results = list(bm25_candidates_results)[: int(bm25_top_k)]

        # RRF 融合
        rrf_scores = {}
        k = self.config.rrf_k

        for rank, result in enumerate(vector_results):
            if result.chunk_id not in rrf_scores:
                rrf_scores[result.chunk_id] = {"result": result, "score": 0}
            rrf_scores[result.chunk_id]["score"] += 1 / (k + rank + 1)

        for rank, result in enumerate(bm25_results):
            if result.chunk_id not in rrf_scores:
                rrf_scores[result.chunk_id] = {"result": result, "score": 0}
            rrf_scores[result.chunk_id]["score"] += 1 / (k + rank + 1)

        # 按 RRF 分数排序
        sorted_results = sorted(
            rrf_scores.values(),
            key=lambda x: x["score"],
            reverse=True
        )

        # 取 top candidates 进行 rerank
        candidates = [item["result"] for item in sorted_results[:rerank_top_n * 2]]

        if not candidates:
            return []

        # 调用 Rerank API
        documents = [c.content for c in candidates]
        rerank_results = await self.api_client.rerank(query, documents, top_n=rerank_top_n)

        if not rerank_results:
            # Rerank 失败，返回 RRF 结果
            return [item["result"] for item in sorted_results[:rerank_top_n]]

        # 组装最终结果
        final_results = []
        for r in rerank_results:
            idx = r.get("index", 0)
            if idx < len(candidates):
                result = candidates[idx]
                result.score = r.get("relevance_score", 0)
                result.source = "hybrid"
                final_results.append(result)

        return final_results

    # ==================== 统计 ====================

    def get_stats(self) -> Dict[str, int]:
        """获取 RAG 统计"""
        with self._get_conn() as conn:
            cursor = conn.cursor()

            cursor.execute("SELECT COUNT(*) FROM vectors")
            vectors = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(DISTINCT term) FROM bm25_index")
            terms = cursor.fetchone()[0]

            cursor.execute("SELECT MAX(chapter) FROM vectors")
            max_chapter = cursor.fetchone()[0] or 0

            return {
                "vectors": vectors,
                "terms": terms,
                "max_chapter": max_chapter
            }


# ==================== CLI 接口 ====================

def main():
    import argparse

    parser = argparse.ArgumentParser(description="RAG Adapter CLI")
    parser.add_argument("--project-root", type=str, help="项目根目录")

    subparsers = parser.add_subparsers(dest="command")

    # 获取统计
    subparsers.add_parser("stats")

    # 搜索
    search_parser = subparsers.add_parser("search")
    search_parser.add_argument("--query", required=True, help="搜索查询")
    search_parser.add_argument("--mode", choices=["vector", "bm25", "hybrid"], default="hybrid")
    search_parser.add_argument("--top-k", type=int, default=10)

    # 索引章节
    index_parser = subparsers.add_parser("index-chapter")
    index_parser.add_argument("--chapter", type=int, required=True)
    index_parser.add_argument("--scenes", required=True, help="JSON 格式的场景列表")

    args = parser.parse_args()

    # 初始化
    config = None
    if args.project_root:
        from .config import DataModulesConfig
        config = DataModulesConfig.from_project_root(args.project_root)

    adapter = RAGAdapter(config)

    if args.command == "stats":
        stats = adapter.get_stats()
        print(json.dumps(stats, ensure_ascii=False, indent=2))

    elif args.command == "search":
        async def do_search():
            if args.mode == "vector":
                results = await adapter.vector_search(args.query, args.top_k)
            elif args.mode == "bm25":
                results = adapter.bm25_search(args.query, args.top_k)
            else:
                results = await adapter.hybrid_search(args.query)

            print(f"搜索结果 ({len(results)} 条):")
            for r in results:
                print(f"\n[{r.source}] 第 {r.chapter} 章 场景 {r.scene_index} (score: {r.score:.4f})")
                print(f"  {r.content[:100]}...")

        asyncio.run(do_search())

    elif args.command == "index-chapter":
        scenes = json.loads(args.scenes)
        chunks = [
            {
                "chapter": args.chapter,
                "scene_index": s.get("index", i),
                "content": s.get("summary", "") + "\n" + s.get("content", "")
            }
            for i, s in enumerate(scenes)
        ]

        async def do_index():
            stored = await adapter.store_chunks(chunks)
            print(f"✓ 已索引 {stored} 个场景")

        asyncio.run(do_index())


if __name__ == "__main__":
    main()
