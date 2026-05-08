#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
API Client tests
"""

import asyncio
import json
import pytest

from data_modules.config import DataModulesConfig
from data_modules.api_client import (
    EmbeddingAPIClient,
    RerankAPIClient,
    ModalAPIClient,
    get_client,
)


class FakeResponse:
    def __init__(self, status, json_data=None, text_data=""):
        self.status = status
        self._json = json_data
        if text_data:
            self._text = text_data
        elif json_data is not None:
            self._text = json.dumps(json_data, ensure_ascii=False)
        else:
            self._text = ""

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def json(self):
        return self._json

    async def text(self):
        return self._text


class FakeSession:
    def __init__(self, responses):
        self._responses = list(responses)
        self.closed = False

    def post(self, *args, **kwargs):
        if not self._responses:
            raise AssertionError("No more responses")
        resp = self._responses.pop(0)
        if isinstance(resp, Exception):
            raise resp
        return resp

    async def close(self):
        self.closed = True


@pytest.mark.asyncio
async def test_embedding_client_success_and_retry(tmp_path, monkeypatch):
    config = DataModulesConfig.from_project_root(tmp_path)
    config.embed_api_type = "openai"
    config.api_max_retries = 2
    client = EmbeddingAPIClient(config)

    responses = [
        FakeResponse(500, text_data="err"),
        FakeResponse(
            200,
            json_data={
                "data": [
                    {"embedding": [0.1, 0.2], "index": 1},
                    {"embedding": [0.3, 0.4], "index": 0},
                ]
            },
        ),
    ]
    fake_session = FakeSession(responses)

    async def fake_get_session():
        return fake_session

    monkeypatch.setattr(client, "_get_session", fake_get_session)
    result = await client.embed(["a", "b"])
    assert result == [[0.3, 0.4], [0.1, 0.2]]
    assert client.stats.total_calls == 1
    assert client.stats.errors == 0


@pytest.mark.asyncio
async def test_embedding_client_timeout_and_error(tmp_path, monkeypatch):
    config = DataModulesConfig.from_project_root(tmp_path)
    config.embed_api_type = "openai"
    config.api_max_retries = 1
    client = EmbeddingAPIClient(config)

    responses = [asyncio.TimeoutError()]
    fake_session = FakeSession(responses)

    async def fake_get_session():
        return fake_session

    monkeypatch.setattr(client, "_get_session", fake_get_session)
    result = await client.embed(["x"])
    assert result is None
    assert client.stats.errors == 1


@pytest.mark.asyncio
async def test_embedding_batch(tmp_path, monkeypatch):
    config = DataModulesConfig.from_project_root(tmp_path)
    config.embed_batch_size = 2
    client = EmbeddingAPIClient(config)

    async def fake_embed(texts):
        if len(texts) == 2:
            return [[1.0, 0.0], [0.0, 1.0]]
        return None

    monkeypatch.setattr(client, "embed", fake_embed)
    result = await client.embed_batch(["a", "b", "c"], skip_failures=True)
    assert result[0] is not None
    assert result[2] is None

    result_fail = await client.embed_batch(["a", "b", "c"], skip_failures=False)
    assert result_fail == []


def test_embedding_build_url_and_payload(tmp_path):
    config = DataModulesConfig.from_project_root(tmp_path)
    config.embed_api_type = "openai"
    config.embed_base_url = "https://api.example.com"
    client = EmbeddingAPIClient(config)
    assert client._build_url().endswith("/v1/embeddings")
    payload = client._build_payload(["hi"])
    assert payload["model"] == config.embed_model

    config.embed_base_url = "https://api.example.com/v1"
    assert client._build_url().endswith("/v1/embeddings")

    config.embed_base_url = "https://api.example.com/v1/embeddings"
    assert client._build_url().endswith("/v1/embeddings")

    config.embed_api_type = "modal"
    config.embed_base_url = "https://modal.example.com/embed"
    assert client._build_url() == "https://modal.example.com/embed"
    payload = client._build_payload(["hi"])
    assert "encoding_format" not in payload


@pytest.mark.asyncio
async def test_rerank_client_success(tmp_path, monkeypatch):
    config = DataModulesConfig.from_project_root(tmp_path)
    config.rerank_api_type = "openai"
    config.api_max_retries = 1
    client = RerankAPIClient(config)

    responses = [
        FakeResponse(
            200,
            json_data={"results": [{"index": 0, "relevance_score": 0.9}]},
        )
    ]
    fake_session = FakeSession(responses)

    async def fake_get_session():
        return fake_session

    monkeypatch.setattr(client, "_get_session", fake_get_session)
    result = await client.rerank("q", ["doc1"], top_n=1)
    assert result[0]["index"] == 0
    assert client.stats.total_calls == 1


@pytest.mark.asyncio
async def test_rerank_retry_and_empty(tmp_path, monkeypatch):
    config = DataModulesConfig.from_project_root(tmp_path)
    config.rerank_api_type = "openai"
    config.api_max_retries = 2
    client = RerankAPIClient(config)

    responses = [
        FakeResponse(503, text_data="err"),
        FakeResponse(
            200,
            json_data={"results": [{"index": 0, "relevance_score": 0.8}]},
        ),
    ]
    fake_session = FakeSession(responses)

    async def fake_get_session():
        return fake_session

    monkeypatch.setattr(client, "_get_session", fake_get_session)
    result = await client.rerank("q", ["doc1"], top_n=1)
    assert result[0]["relevance_score"] == 0.8

    assert await client.rerank("q", []) == []


@pytest.mark.asyncio
async def test_modal_client_warmup_and_passthrough(tmp_path, monkeypatch):
    config = DataModulesConfig.from_project_root(tmp_path)
    client = ModalAPIClient(config)

    async def fake_warmup():
        return None

    async def fake_embed(texts):
        return [[0.1, 0.2] for _ in texts]

    async def fake_rerank(query, documents, top_n=None):
        return [{"index": 0, "relevance_score": 1.0}]

    monkeypatch.setattr(client._embed_client, "warmup", fake_warmup)
    monkeypatch.setattr(client._rerank_client, "warmup", fake_warmup)
    monkeypatch.setattr(client._embed_client, "embed", fake_embed)
    monkeypatch.setattr(client._rerank_client, "rerank", fake_rerank)

    await client.warmup()
    assert client._warmed_up["embed"] is True
    assert client._warmed_up["rerank"] is True

    emb = await client.embed(["hi"])
    assert emb[0] == [0.1, 0.2]
    rr = await client.rerank("q", ["doc"])
    assert rr[0]["index"] == 0


def test_get_client_singleton(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    client1 = get_client(cfg)
    client2 = get_client()
    assert client1 is client2
    client3 = get_client(cfg)
    assert client3 is not client1


@pytest.mark.asyncio
async def test_embedding_empty_and_error_paths(tmp_path, monkeypatch):
    config = DataModulesConfig.from_project_root(tmp_path)
    config.embed_api_key = "sk-test"
    config.api_max_retries = 1
    client = EmbeddingAPIClient(config)

    assert await client.embed([]) == []

    headers = client._build_headers()
    assert headers["Authorization"] == "Bearer sk-test"

    fake_session = FakeSession([FakeResponse(400, text_data="bad request")])

    async def fake_get_session():
        return fake_session

    monkeypatch.setattr(client, "_get_session", fake_get_session)
    result = await client.embed(["x"])
    assert result is None
    assert client.stats.errors == 1


@pytest.mark.asyncio
async def test_embedding_exception_and_close(tmp_path, monkeypatch):
    config = DataModulesConfig.from_project_root(tmp_path)
    config.api_max_retries = 1
    client = EmbeddingAPIClient(config)

    class BoomSession:
        def __init__(self):
            self.closed = False

        def post(self, *args, **kwargs):
            raise RuntimeError("boom")

        async def close(self):
            self.closed = True

    session = BoomSession()

    async def fake_get_session():
        return session

    monkeypatch.setattr(client, "_get_session", fake_get_session)
    result = await client.embed(["x"])
    assert result is None
    assert client.stats.errors == 1

    client._session = session
    await client.close()
    assert session.closed is True


def test_rerank_headers_payload_and_stats(tmp_path, capsys):
    config = DataModulesConfig.from_project_root(tmp_path)
    config.rerank_api_key = "rk-test"
    client = RerankAPIClient(config)

    headers = client._build_headers()
    assert headers["Authorization"] == "Bearer rk-test"

    payload = client._build_payload("q", ["doc"], top_n=2)
    assert payload["top_n"] == 2

    modal = ModalAPIClient(config)
    modal._embed_client.stats.total_calls = 1
    modal._embed_client.stats.total_time = 2.0
    modal.print_stats()
    output = capsys.readouterr().out
    assert "EMBED" in output


@pytest.mark.asyncio
async def test_rerank_non_retry_error(tmp_path, monkeypatch):
    config = DataModulesConfig.from_project_root(tmp_path)
    config.api_max_retries = 1
    client = RerankAPIClient(config)

    fake_session = FakeSession([FakeResponse(400, text_data="bad request")])

    async def fake_get_session():
        return fake_session

    monkeypatch.setattr(client, "_get_session", fake_get_session)
    result = await client.rerank("q", ["doc"])
    assert result is None
    assert client.stats.errors == 1


@pytest.mark.asyncio
async def test_embedding_session_parse_and_retry_paths(tmp_path, monkeypatch):
    config = DataModulesConfig.from_project_root(tmp_path)
    config.embed_api_type = "modal"
    config.api_max_retries = 2
    config.api_retry_delay = 0
    client = EmbeddingAPIClient(config)

    session = await client._get_session()
    assert session is not None
    await client.close()

    assert client._parse_response({}) is None
    parsed = client._parse_response({"data": [{"embedding": [1.0, 2.0]}]})
    assert parsed == [[1.0, 2.0]]

    responses = [
        asyncio.TimeoutError(),
        FakeResponse(200, text_data=json.dumps({"data": [{"embedding": [0.1], "index": 0}]})),
    ]
    fake_session = FakeSession(responses)

    async def fake_get_session():
        return fake_session

    monkeypatch.setattr(client, "_get_session", fake_get_session)
    result = await client.embed(["x"])
    assert result == [[0.1]]


@pytest.mark.asyncio
async def test_embedding_exception_retry_and_batch(tmp_path, monkeypatch):
    config = DataModulesConfig.from_project_root(tmp_path)
    config.api_max_retries = 2
    config.api_retry_delay = 0
    client = EmbeddingAPIClient(config)

    responses = [
        RuntimeError("boom"),
        FakeResponse(200, text_data=json.dumps({"data": [{"embedding": [0.2], "index": 0}]})),
    ]
    fake_session = FakeSession(responses)

    async def fake_get_session():
        return fake_session

    monkeypatch.setattr(client, "_get_session", fake_get_session)
    result = await client.embed(["x"])
    assert result == [[0.2]]

    assert await client.embed_batch([]) == []

    async def fake_embed(texts):
        return [[0.0] for _ in texts]

    monkeypatch.setattr(client, "embed", fake_embed)
    await client.warmup()
    assert client._warmed_up is True


@pytest.mark.asyncio
async def test_rerank_modal_retry_and_warmup(tmp_path, monkeypatch):
    config = DataModulesConfig.from_project_root(tmp_path)
    config.rerank_api_type = "modal"
    config.rerank_base_url = "https://modal.example.com/rerank"
    config.api_max_retries = 2
    config.api_retry_delay = 0
    client = RerankAPIClient(config)

    session = await client._get_session()
    assert session is not None
    await client.close()

    payload = client._build_payload("q", ["doc"], top_n=1)
    assert payload["top_n"] == 1
    assert client._build_url() == "https://modal.example.com/rerank"
    assert client._parse_response({"results": [{"index": 0}]}) == [{"index": 0}]

    responses = [
        asyncio.TimeoutError(),
        FakeResponse(200, json_data={"results": [{"index": 0, "relevance_score": 1.0}]}),
    ]
    fake_session = FakeSession(responses)

    async def fake_get_session():
        return fake_session

    monkeypatch.setattr(client, "_get_session", fake_get_session)
    result = await client.rerank("q", ["doc"])
    assert result[0]["index"] == 0

    responses = [
        RuntimeError("boom"),
        FakeResponse(200, json_data={"results": [{"index": 0, "relevance_score": 0.5}]}),
    ]
    fake_session = FakeSession(responses)

    async def fake_get_session2():
        return fake_session

    monkeypatch.setattr(client, "_get_session", fake_get_session2)
    result = await client.rerank("q", ["doc"])
    assert result[0]["relevance_score"] == 0.5

    async def fake_rerank(query, docs, top_n=None):
        return [{"index": 0, "relevance_score": 1.0}]

    monkeypatch.setattr(client, "rerank", fake_rerank)
    await client.warmup()
    assert client._warmed_up is True


@pytest.mark.asyncio
async def test_modal_client_helpers(tmp_path, monkeypatch, capsys):
    config = DataModulesConfig.from_project_root(tmp_path)
    client = ModalAPIClient(config)

    async def fake_embed_batch(texts, skip_failures=True):
        return [[0.1] for _ in texts]

    monkeypatch.setattr(client._embed_client, "embed_batch", fake_embed_batch)
    result = await client.embed_batch(["a", "b"])
    assert result[0] == [0.1]

    async def fail_warmup():
        raise RuntimeError("fail")

    async def ok_warmup():
        return None

    monkeypatch.setattr(client, "_warmup_embed", fail_warmup)
    monkeypatch.setattr(client, "_warmup_rerank", ok_warmup)
    await client.warmup()
    output = capsys.readouterr().out
    assert "[FAIL]" in output

    async def fake_get_session():
        return FakeSession([])

    monkeypatch.setattr(client._embed_client, "_get_session", fake_get_session)
    session = await client._get_session()
    assert session is not None

    closed = {"embed": False, "rerank": False}

    async def close_embed():
        closed["embed"] = True

    async def close_rerank():
        closed["rerank"] = True

    monkeypatch.setattr(client._embed_client, "close", close_embed)
    monkeypatch.setattr(client._rerank_client, "close", close_rerank)
    await client.close()
    assert closed["embed"] and closed["rerank"]
