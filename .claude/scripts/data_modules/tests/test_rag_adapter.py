#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RAGAdapter tests
"""

import sys
import json
import asyncio

import pytest

import data_modules.rag_adapter as rag_module
from data_modules.rag_adapter import RAGAdapter
from data_modules.config import DataModulesConfig


class StubClient:
    async def embed(self, texts):
        return [[1.0, 0.0] for _ in texts]

    async def embed_batch(self, texts, skip_failures=True):
        return [[1.0, 0.0] for _ in texts]

    async def rerank(self, query, documents, top_n=None):
        top_n = top_n or len(documents)
        return [{"index": i, "relevance_score": 1.0 / (i + 1)} for i in range(min(top_n, len(documents)))]


class StubClientWithFailures(StubClient):
    async def embed_batch(self, texts, skip_failures=True):
        if len(texts) == 1:
            return [None]
        return [None, [1.0, 0.0]]


@pytest.fixture
def temp_project(tmp_path, monkeypatch):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    monkeypatch.setattr(rag_module, "get_client", lambda config: StubClient())
    return cfg


@pytest.mark.asyncio
async def test_store_and_search(temp_project):
    adapter = RAGAdapter(temp_project)
    chunks = [
        {"chapter": 1, "scene_index": 1, "content": "萧炎在天云宗修炼斗气"},
        {"chapter": 1, "scene_index": 2, "content": "药老传授炼药技巧"},
    ]
    stored = await adapter.store_chunks(chunks)
    assert stored == 2

    vec_results = await adapter.vector_search("萧炎", top_k=2)
    assert len(vec_results) == 2

    bm25_results = adapter.bm25_search("萧炎", top_k=2)
    assert len(bm25_results) >= 1

    stats = adapter.get_stats()
    assert stats["vectors"] == 2


@pytest.mark.asyncio
async def test_store_chunks_with_embedding_failure(tmp_path, monkeypatch):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    monkeypatch.setattr(rag_module, "get_client", lambda config: StubClientWithFailures())

    adapter = RAGAdapter(cfg)
    chunks = [
        {"chapter": 1, "scene_index": 1, "content": "短内容"},
        {"chapter": 1, "scene_index": 2, "content": "稍长内容用于索引"},
    ]
    stored = await adapter.store_chunks(chunks)
    assert stored == 1


@pytest.mark.asyncio
async def test_hybrid_search_full_scan(temp_project):
    adapter = RAGAdapter(temp_project)
    await adapter.store_chunks(
        [{"chapter": 1, "scene_index": 1, "content": "萧炎修炼"}]
    )
    results = await adapter.hybrid_search("萧炎", vector_top_k=5, bm25_top_k=5, rerank_top_n=1)
    assert results
    assert results[0].source == "hybrid"


@pytest.mark.asyncio
async def test_hybrid_search_prefilter(tmp_path, monkeypatch):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    cfg.vector_full_scan_max_vectors = 0
    monkeypatch.setattr(rag_module, "get_client", lambda config: StubClient())
    adapter = RAGAdapter(cfg)
    await adapter.store_chunks(
        [
            {"chapter": 1, "scene_index": 1, "content": "萧炎修炼"},
            {"chapter": 2, "scene_index": 1, "content": "药老出场"},
        ]
    )
    results = await adapter.hybrid_search("药老", vector_top_k=2, bm25_top_k=2, rerank_top_n=1)
    assert results


def test_vector_helpers(temp_project):
    adapter = RAGAdapter(temp_project)
    emb = [1.0, 0.0]
    data = adapter._serialize_embedding(emb)
    assert adapter._deserialize_embedding(data) == emb

    assert adapter._cosine_similarity([0.0, 0.0], [1.0, 0.0]) == 0.0


def test_recent_and_fetch_vectors(temp_project):
    adapter = RAGAdapter(temp_project)
    with adapter._get_conn() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO vectors (chunk_id, chapter, scene_index, content, embedding) VALUES (?, ?, ?, ?, ?)",
            ("ch1_s1", 1, 1, "内容", b""),
        )
        conn.commit()

    assert adapter._get_vectors_count() == 1
    assert adapter._get_recent_chunk_ids(1) == ["ch1_s1"]
    rows = adapter._fetch_vectors_by_chunk_ids(["ch1_s1"])
    assert len(rows) == 1


def test_rag_adapter_cli(temp_project, monkeypatch, capsys):
    # stats
    def run_cli(args):
        monkeypatch.setattr(sys, "argv", ["rag_adapter"] + args)
        rag_module.main()

    root = str(temp_project.project_root)
    run_cli(["--project-root", root, "stats"])

    # index-chapter
    run_cli(
        [
            "--project-root",
            root,
            "index-chapter",
            "--chapter",
            "1",
            "--scenes",
            json.dumps([{"index": 1, "summary": "摘要", "content": "内容"}], ensure_ascii=False),
        ]
    )

    # search
    run_cli(["--project-root", root, "search", "--query", "内容", "--mode", "bm25", "--top-k", "5"])
    run_cli(["--project-root", root, "search", "--query", "内容", "--mode", "vector", "--top-k", "5"])
    run_cli(["--project-root", root, "search", "--query", "内容", "--mode", "hybrid", "--top-k", "5"])

    capsys.readouterr()
