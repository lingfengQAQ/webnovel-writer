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
import logging
from pathlib import Path

from runtime_compat import enable_windows_utf8_stdio
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from collections import Counter
import re
from contextlib import contextmanager
import itertools
import time

from .config import get_config
from .api_client import get_client
from .index_manager import IndexManager
from .observability import safe_log_tool_call


logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """搜索结果"""
    chunk_id: str
    chapter: int
    scene_index: int
    content: str
    score: float
    source: str  # "vector" | "bm25" | "hybrid"
    parent_chunk_id: str | None = None
    chunk_type: str | None = None
    source_file: str | None = None


class RAGAdapter:
    """RAG 检索适配器"""

    def __init__(self, config=None):
        self.config = config or get_config()
        self.api_client = get_client(config)
        self.index_manager = IndexManager(self.config)
        self._init_db()

    def _init_db(self):
        """初始化向量数据库"""
        self.config.ensure_dirs()

        with self._get_conn() as conn:
            cursor = conn.cursor()

            def _table_columns(table_name: str) -> set[str]:
                cursor.execute(f"PRAGMA table_info({table_name})")
                return {row[1] for row in cursor.fetchall()}

            required_cols = {
                "chunk_id",
                "chapter",
                "scene_index",
                "content",
                "embedding",
                "parent_chunk_id",
                "chunk_type",
                "source_file",
                "created_at",
            }

            if "vectors" in {r[0] for r in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")}:  # type: ignore
                cols = _table_columns("vectors")
                if not required_cols.issubset(cols):
                    cursor.execute("DROP TABLE IF EXISTS vectors")
                    cursor.execute("DROP TABLE IF EXISTS bm25_index")
                    cursor.execute("DROP TABLE IF EXISTS doc_stats")

            # 向量存储表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS vectors (
                    chunk_id TEXT PRIMARY KEY,
                    chapter INTEGER,
                    scene_index INTEGER,
                    content TEXT,
                    embedding BLOB,
                    parent_chunk_id TEXT,
                    chunk_type TEXT DEFAULT 'scene',
                    source_file TEXT,
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
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_vectors_parent ON vectors(parent_chunk_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_vectors_type ON vectors(chunk_type)")
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

    def _get_recent_chunk_ids(self, limit: int, chunk_type: str | None = None) -> List[str]:
        if limit <= 0:
            return []
        with self._get_conn() as conn:
            cursor = conn.cursor()
            if chunk_type:
                cursor.execute(
                    "SELECT chunk_id FROM vectors WHERE chunk_type = ? ORDER BY chapter DESC, scene_index DESC LIMIT ?",
                    (chunk_type, int(limit)),
                )
            else:
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
                    f"SELECT chunk_id, chapter, scene_index, content, embedding, parent_chunk_id, chunk_type, source_file FROM vectors WHERE chunk_id IN ({placeholders})",
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
            (
                chunk_id,
                chapter,
                scene_index,
                content,
                embedding_bytes,
                parent_chunk_id,
                chunk_type,
                source_file,
            ) = row
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
                    parent_chunk_id=parent_chunk_id,
                    chunk_type=chunk_type,
                    source_file=source_file,
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
                "content": "场景内容...",
                "chunk_type": "scene",
                "parent_chunk_id": "ch0100_summary",
                "source_file": "正文/第0100章.md#scene_1"
            }
        ]

        返回存储数量
        """
        if not chunks:
            return 0

        # 提取内容用于嵌入
        contents = [c.get("content", "") for c in chunks]

        # 调用 API 获取嵌入向量（可能包含 None 表示失败）
        embeddings = await self.api_client.embed_batch(contents)

        if not embeddings:
            return 0

        # 存储到数据库（跳过嵌入失败的 chunk）
        stored = 0
        skipped = 0
        errors = []
        with self._get_conn() as conn:
            cursor = conn.cursor()

            for chunk, embedding in zip(chunks, embeddings):
                if embedding is None:
                    # 嵌入失败，跳过该 chunk（仅存储 BM25 索引供关键词检索）
                    skipped += 1
                    chunk_id = chunk.get("chunk_id")
                    if not chunk_id:
                        if chunk.get("chunk_type") == "summary":
                            chunk_id = f"ch{int(chunk['chapter']):04d}_summary"
                        else:
                            chunk_id = f"ch{int(chunk['chapter']):04d}_s{int(chunk['scene_index'])}"
                    try:
                        self._update_bm25_index(cursor, chunk_id, chunk.get("content", ""))
                    except Exception as e:
                        errors.append(f"BM25 index failed for {chunk_id}: {e}")
                    continue

                chunk_type = chunk.get("chunk_type") or "scene"
                chunk_id = chunk.get("chunk_id")
                if not chunk_id:
                    if chunk_type == "summary":
                        chunk_id = f"ch{int(chunk['chapter']):04d}_summary"
                    else:
                        chunk_id = f"ch{int(chunk['chapter']):04d}_s{int(chunk['scene_index'])}"

                # 将向量序列化为 bytes
                embedding_bytes = self._serialize_embedding(embedding)

                cursor.execute("""
                    INSERT OR REPLACE INTO vectors
                    (chunk_id, chapter, scene_index, content, embedding, parent_chunk_id, chunk_type, source_file)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    chunk_id,
                    chunk["chapter"],
                    chunk.get("scene_index", 0) if chunk_type == "scene" else 0,
                    chunk.get("content", ""),
                    embedding_bytes,
                    chunk.get("parent_chunk_id"),
                    chunk_type,
                    chunk.get("source_file"),
                ))

                # 同时更新 BM25 索引
                try:
                    self._update_bm25_index(cursor, chunk_id, chunk.get("content", ""))
                except Exception as e:
                    errors.append(f"BM25 index failed for {chunk_id}: {e}")

                stored += 1

            try:
                conn.commit()
            except Exception as e:
                logger.error("SQLite commit failed: %s", e)
                errors.append(f"SQLite commit failed: {e}")

        # 输出警告日志
        if skipped > 0:
            logger.warning(
                "Vector embedding: %s stored, %s skipped (embedding failed)",
                stored,
                skipped,
            )
        if errors:

            for err in errors[:5]:  # 最多显示5条
                logger.warning("%s", err)

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

    def _log_query(
        self,
        query: str,
        query_type: str,
        results: List[SearchResult],
        latency_ms: int,
        chapter: int | None = None,
    ) -> None:
        try:
            hit_sources = Counter([r.chunk_type or "unknown" for r in results])
            self.index_manager.log_rag_query(
                query=query,
                query_type=query_type,
                results_count=len(results),
                hit_sources=json.dumps(hit_sources, ensure_ascii=False),
                latency_ms=latency_ms,
                chapter=chapter,
            )
        except Exception as exc:
            logger.warning("failed to log rag query: %s", exc)

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
        top_k: int = None,
        chunk_type: str | None = None,
        log_query: bool = True,
        chapter: int | None = None,
    ) -> List[SearchResult]:
        """向量相似度搜索"""
        top_k = top_k or self.config.vector_top_k
        start_time = time.perf_counter()

        # 获取查询向量
        query_embeddings = await self.api_client.embed([query])
        if not query_embeddings:
            return []

        query_embedding = query_embeddings[0]

        # 从数据库读取所有向量并计算相似度
        with self._get_conn() as conn:
            cursor = conn.cursor()
            if chunk_type:
                cursor.execute(
                    "SELECT chunk_id, chapter, scene_index, content, embedding, parent_chunk_id, chunk_type, source_file FROM vectors WHERE chunk_type = ?",
                    (chunk_type,),
                )
            else:
                cursor.execute(
                    "SELECT chunk_id, chapter, scene_index, content, embedding, parent_chunk_id, chunk_type, source_file FROM vectors"
                )

            results = []
            for row in cursor.fetchall():
                (
                    chunk_id,
                    chapter,
                    scene_index,
                    content,
                    embedding_bytes,
                    parent_chunk_id,
                    chunk_type_value,
                    source_file,
                ) = row
                if not embedding_bytes:
                    continue
                embedding = self._deserialize_embedding(embedding_bytes)

                # 计算余弦相似度
                score = self._cosine_similarity(query_embedding, embedding)

                results.append(SearchResult(
                    chunk_id=chunk_id,
                    chapter=chapter,
                    scene_index=scene_index,
                    content=content,
                    score=score,
                    source="vector",
                    parent_chunk_id=parent_chunk_id,
                    chunk_type=chunk_type_value,
                    source_file=source_file,
                ))

        # 排序并返回 top_k
        results.sort(key=lambda x: x.score, reverse=True)
        results = results[:top_k]
        if log_query:
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            self._log_query(query, "vector", results, latency_ms, chapter=chapter)
        return results

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
        b: float = 0.75,
        chunk_type: str | None = None,
        log_query: bool = True,
        chapter: int | None = None,
    ) -> List[SearchResult]:
        """BM25 关键词搜索"""
        top_k = top_k or self.config.bm25_top_k
        start_time = time.perf_counter()

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
                if chunk_type:
                    cursor.execute(
                        """
                        SELECT chapter, scene_index, content, parent_chunk_id, chunk_type, source_file
                        FROM vectors
                        WHERE chunk_id = ? AND chunk_type = ?
                    """,
                        (chunk_id, chunk_type),
                    )
                else:
                    cursor.execute(
                        """
                        SELECT chapter, scene_index, content, parent_chunk_id, chunk_type, source_file
                        FROM vectors
                        WHERE chunk_id = ?
                    """,
                        (chunk_id,),
                    )
                row = cursor.fetchone()
                if row:
                    results.append(SearchResult(
                        chunk_id=chunk_id,
                        chapter=row[0],
                        scene_index=row[1],
                        content=row[2],
                        score=score,
                        source="bm25",
                        parent_chunk_id=row[3],
                        chunk_type=row[4],
                        source_file=row[5],
                    ))

        results.sort(key=lambda x: x.score, reverse=True)
        results = results[:top_k]
        if log_query:
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            self._log_query(query, "bm25", results, latency_ms, chapter=chapter)
        return results

    # ==================== 混合检索 ====================

    async def hybrid_search(
        self,
        query: str,
        vector_top_k: int = None,
        bm25_top_k: int = None,
        rerank_top_n: int = None,
        chunk_type: str | None = None,
        log_query: bool = True,
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
        start_time = time.perf_counter()

        # 小规模：全表向量扫描（召回更稳）；大规模：预筛选避免 O(n) 扫描拖慢
        vectors_count = await asyncio.to_thread(self._get_vectors_count)
        use_full_scan = vectors_count <= int(self.config.vector_full_scan_max_vectors)

        if use_full_scan:
            # 并行执行向量和 BM25 检索
            vector_results, bm25_results = await asyncio.gather(
                self.vector_search(query, vector_top_k, chunk_type=chunk_type, log_query=False),
                asyncio.to_thread(self.bm25_search, query, bm25_top_k, 1.5, 0.75, chunk_type, False),
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

            bm25_task = asyncio.to_thread(self.bm25_search, query, bm25_candidates, 1.5, 0.75, chunk_type, False)
            recent_task = asyncio.to_thread(self._get_recent_chunk_ids, recent_candidates, chunk_type)
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
            if chunk_type:
                rows = [r for r in rows if len(r) > 6 and r[6] == chunk_type]
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
            final_results: List[SearchResult] = []
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            if log_query:
                self._log_query(query, "hybrid", final_results, latency_ms)
            return final_results

        # 调用 Rerank API
        documents = [c.content for c in candidates]
        rerank_results = await self.api_client.rerank(query, documents, top_n=rerank_top_n)

        if not rerank_results:
            # Rerank 失败，返回 RRF 结果
            final_results = [item["result"] for item in sorted_results[:rerank_top_n]]
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            if log_query:
                self._log_query(query, "hybrid", final_results, latency_ms)
            return final_results

        # 组装最终结果
        final_results = []
        for r in rerank_results:
            idx = r.get("index", 0)
            if idx < len(candidates):
                result = candidates[idx]
                result.score = r.get("relevance_score", 0)
                result.source = "hybrid"
                final_results.append(result)

        latency_ms = int((time.perf_counter() - start_time) * 1000)
        if log_query:
            self._log_query(query, "hybrid", final_results, latency_ms)
        return final_results

    def _get_chunks_by_ids(self, chunk_ids: List[str]) -> List[SearchResult]:
        rows = self._fetch_vectors_by_chunk_ids(chunk_ids)
        results: List[SearchResult] = []
        for row in rows:
            (
                chunk_id,
                chapter,
                scene_index,
                content,
                _embedding_bytes,
                parent_chunk_id,
                chunk_type,
                source_file,
            ) = row
            results.append(
                SearchResult(
                    chunk_id=chunk_id,
                    chapter=chapter,
                    scene_index=scene_index,
                    content=content,
                    score=0.0,
                    source="parent",
                    parent_chunk_id=parent_chunk_id,
                    chunk_type=chunk_type,
                    source_file=source_file,
                )
            )
        return results

    def _merge_results(
        self,
        parents: List[SearchResult],
        children: List[SearchResult],
    ) -> List[SearchResult]:
        parent_map = {p.chunk_id: p for p in parents}
        merged: List[SearchResult] = []
        seen = set()
        for child in children:
            parent_id = child.parent_chunk_id
            if parent_id and parent_id in parent_map and parent_id not in seen:
                merged.append(parent_map[parent_id])
                seen.add(parent_id)
            merged.append(child)
        return merged

    async def search_with_backtrack(self, query: str, top_k: int = 5) -> List[SearchResult]:
        start_time = time.perf_counter()
        child_results = await self.hybrid_search(
            query,
            vector_top_k=top_k * 2,
            bm25_top_k=top_k * 2,
            rerank_top_n=top_k,
            chunk_type="scene",
            log_query=False,
        )
        parent_ids = sorted({r.parent_chunk_id for r in child_results if r.parent_chunk_id})
        parents = self._get_chunks_by_ids(parent_ids) if parent_ids else []
        merged = self._merge_results(parents, child_results[:top_k])
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        self._log_query(query, "backtrack", merged, latency_ms)
        return merged

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
    from .cli_output import print_success, print_error

    parser = argparse.ArgumentParser(description="RAG Adapter CLI")
    parser.add_argument("--project-root", type=str, help="项目根目录")

    subparsers = parser.add_subparsers(dest="command")

    # 获取统计
    subparsers.add_parser("stats")

    # 写入索引
    index_parser = subparsers.add_parser("index-chapter")
    index_parser.add_argument("--chapter", type=int, required=True)
    index_parser.add_argument("--scenes", required=True, help="JSON 格式的场景列表")
    index_parser.add_argument("--summary", required=False, help="章节摘要文本")

    # 搜索
    search_parser = subparsers.add_parser("search")
    search_parser.add_argument("--query", required=True)
    search_parser.add_argument("--mode", choices=["vector", "bm25", "hybrid", "backtrack"], default="hybrid")
    search_parser.add_argument("--top-k", type=int, default=5)
    search_parser.add_argument("--chunk-type", choices=["scene", "summary"], default=None)

    args = parser.parse_args()

    # 初始化
    config = None
    if args.project_root:
        from .config import DataModulesConfig

        config = DataModulesConfig.from_project_root(args.project_root)

    adapter = RAGAdapter(config)
    tool_name = f"rag_adapter:{args.command or 'unknown'}"

    def emit_success(data=None, message: str = "ok"):
        print_success(data, message=message)
        safe_log_tool_call(adapter.index_manager, tool_name=tool_name, success=True)

    def emit_error(code: str, message: str, suggestion: str | None = None):
        print_error(code, message, suggestion=suggestion)
        safe_log_tool_call(
            adapter.index_manager,
            tool_name=tool_name,
            success=False,
            error_code=code,
            error_message=message,
        )

    if args.command == "stats":
        stats = adapter.get_stats()
        emit_success(stats, message="stats")

    elif args.command == "index-chapter":
        scenes = json.loads(args.scenes)
        chunks = []

        # summary chunk
        summary_text = args.summary
        if not summary_text and config:
            summary_path = config.webnovel_dir / "summaries" / f"ch{args.chapter:04d}.md"
            if summary_path.exists():
                summary_text = summary_path.read_text(encoding="utf-8")

        parent_chunk_id = None
        if summary_text:
            parent_chunk_id = f"ch{args.chapter:04d}_summary"
            chunks.append(
                {
                    "chapter": args.chapter,
                    "scene_index": 0,
                    "content": summary_text,
                    "chunk_type": "summary",
                    "chunk_id": parent_chunk_id,
                    "source_file": f"summaries/ch{args.chapter:04d}.md",
                }
            )

        for s in scenes:
            scene_index = s.get("index", 0)
            chunk_id = f"ch{args.chapter:04d}_s{int(scene_index)}"
            chunks.append(
                {
                    "chapter": args.chapter,
                    "scene_index": scene_index,
                    "content": s.get("content", ""),
                    "chunk_type": "scene",
                    "parent_chunk_id": parent_chunk_id,
                    "chunk_id": chunk_id,
                    "source_file": f"正文/第{args.chapter:04d}章.md#scene_{int(scene_index)}",
                }
            )

        stored = asyncio.run(adapter.store_chunks(chunks))
        skipped = len(chunks) - stored
        result = {"stored": stored, "skipped": skipped, "total": len(chunks)}
        if skipped > 0:
            emit_success(result, message="indexed_with_warnings")
        else:
            emit_success(result, message="indexed")

    elif args.command == "search":
        if args.mode == "vector":
            results = asyncio.run(adapter.vector_search(args.query, args.top_k, chunk_type=args.chunk_type))
        elif args.mode == "bm25":
            results = adapter.bm25_search(args.query, args.top_k, chunk_type=args.chunk_type)
        elif args.mode == "backtrack":
            results = asyncio.run(adapter.search_with_backtrack(args.query, args.top_k))
        else:
            results = asyncio.run(adapter.hybrid_search(args.query, args.top_k, args.top_k, args.top_k, chunk_type=args.chunk_type))

        payload = [r.__dict__ for r in results]
        emit_success(payload, message="search_results")

    else:
        emit_error("UNKNOWN_COMMAND", "未指定有效命令", suggestion="请查看 --help")


if __name__ == "__main__":
    import sys
    if sys.platform == "win32":
        enable_windows_utf8_stdio()
    main()
