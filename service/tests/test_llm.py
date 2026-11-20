# -*- coding: utf-8 -*-
"""LLM 层测试：JSON 容错解析、双协议分发、URL 拼接、错误处理。"""

from __future__ import annotations

import json

import pytest

from service.config import LLMRoleConfig
from service.llm import (
    LLMClient,
    LLMError,
    _first_json_value,
    _join_url,
    _strip_code_fence,
    build_clients,
    parse_json_response,
)


class TestJsonParsing:
    """reviewer / data-agent 依赖严格 JSON，这里是最容易出问题的环节。"""

    def test_plain(self):
        assert parse_json_response('{"a": 1}') == {"a": 1}

    def test_fenced_with_language(self):
        assert parse_json_response('```json\n{"a": 1}\n```') == {"a": 1}

    def test_fenced_without_language(self):
        assert parse_json_response('```\n{"a": 2}\n```') == {"a": 2}

    def test_unclosed_fence(self):
        assert parse_json_response('```json\n{"a": 3}') == {"a": 3}

    def test_surrounded_by_prose(self):
        raw = '好的，审查结果如下：\n{"issues": []}\n以上是全部内容。'
        assert parse_json_response(raw) == {"issues": []}

    def test_braces_inside_string(self):
        raw = 'prefix {"s": "a}b{c", "n": {"m": 1}} suffix'
        assert parse_json_response(raw) == {"s": "a}b{c", "n": {"m": 1}}

    def test_escaped_quote_in_string(self):
        raw = r'{"s": "he said \"hi\"}", "x": 1}'
        assert parse_json_response(raw)["x"] == 1

    def test_array(self):
        assert parse_json_response('[{"x": 1}]') == [{"x": 1}]

    def test_trailing_comma_repaired(self):
        assert parse_json_response('{"a": 1,}') == {"a": 1}

    def test_nested_objects(self):
        raw = '{"a": {"b": {"c": [1, 2, {"d": 3}]}}}'
        assert parse_json_response(raw)["a"]["b"]["c"][2]["d"] == 3

    def test_chinese_content_preserved(self):
        raw = '{"summary": "主角在绝境中觉醒"}'
        assert parse_json_response(raw)["summary"] == "主角在绝境中觉醒"

    def test_unparseable_raises(self):
        with pytest.raises(LLMError):
            parse_json_response("完全不是 JSON 的一段话")

    def test_error_message_includes_snippet(self):
        with pytest.raises(LLMError) as exc:
            parse_json_response("这是错误输出 abcdef")
        assert "abcdef" in str(exc.value)

    def test_strip_fence_plain_text_unchanged(self):
        assert _strip_code_fence("hello") == "hello"

    def test_first_json_value_prefers_object(self):
        assert _first_json_value('x {"a":1} y') == '{"a":1}'

    def test_first_json_value_array(self):
        assert _first_json_value("x [1,2] y") == "[1,2]"

    def test_first_json_value_none(self):
        assert _first_json_value("no json here") is None


class TestUrlJoining:
    def test_appends_suffix(self):
        assert _join_url("http://x/v1", "/chat/completions") == \
            "http://x/v1/chat/completions"

    def test_strips_trailing_slash(self):
        assert _join_url("http://x/v1/", "/chat/completions") == \
            "http://x/v1/chat/completions"

    def test_no_duplicate_suffix(self):
        url = "http://x/v1/chat/completions"
        assert _join_url(url, "/chat/completions") == url

    def test_messages_suffix(self):
        assert _join_url("http://x/v1", "/messages") == "http://x/v1/messages"

    def test_empty_base_raises(self):
        with pytest.raises(LLMError):
            _join_url("", "/chat/completions")


class TestClientConstruction:
    def test_requires_base_url(self):
        with pytest.raises(LLMError, match="base_url"):
            LLMClient(LLMRoleConfig(model="m"), role_name="draft")

    def test_requires_model(self):
        with pytest.raises(LLMError, match="model"):
            LLMClient(LLMRoleConfig(base_url="http://x/v1"), role_name="draft")

    def test_error_names_role(self):
        with pytest.raises(LLMError, match="review"):
            LLMClient(LLMRoleConfig(), role_name="review")


class TestBuildClients:
    def test_only_configured_roles(self, settings):
        settings.llm = LLMRoleConfig(base_url="http://x/v1", model="m")
        clients = build_clients(settings)
        assert set(clients) == {"context", "draft", "review", "data"}

    def test_unconfigured_yields_empty(self, settings):
        settings.llm = LLMRoleConfig()
        assert build_clients(settings) == {}

    def test_role_specific_model_used(self, settings):
        from service.config import LLMRoleConfig as C
        settings.llm = C(base_url="http://x/v1", model="default")
        settings.llm_roles["review"] = C(model="review-model")
        clients = build_clients(settings)
        assert clients["review"].config.model == "review-model"
        assert clients["draft"].config.model == "default"


class TestHttpDispatch:
    """用 httpx MockTransport 验证两种协议的请求形状与响应解析。"""

    @staticmethod
    def _patch(monkeypatch, handler):
        """把 service.llm 里的 AsyncClient 换成挂了 MockTransport 的实例工厂。

        注意：不能写成 lambda 里再传 transport=，因为调用方也会传 transport，
        会撞成 "multiple values for keyword argument"。
        """
        import httpx

        real = httpx.AsyncClient

        def factory(**kw):
            kw.pop("transport", None)
            return real(transport=httpx.MockTransport(handler), **kw)

        monkeypatch.setattr("service.llm.httpx.AsyncClient", factory)

    async def test_openai_protocol_success(self, monkeypatch):
        import httpx

        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["auth"] = request.headers.get("authorization")
            captured["body"] = json.loads(request.content)
            return httpx.Response(200, json={
                "model": "m",
                "choices": [{"message": {"content": "hello"}, "finish_reason": "stop"}],
                "usage": {"total_tokens": 5},
            })

        self._patch(monkeypatch, handler)

        c = LLMClient(LLMRoleConfig(base_url="http://x/v1", api_key="k", model="m"))
        r = await c.complete("sys", "user")
        assert r.text == "hello"
        assert captured["url"] == "http://x/v1/chat/completions"
        assert captured["auth"] == "Bearer k"
        assert captured["body"]["messages"][0]["role"] == "system"

    async def test_anthropic_protocol_success(self, monkeypatch):
        import httpx

        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["key"] = request.headers.get("x-api-key")
            captured["body"] = json.loads(request.content)
            return httpx.Response(200, json={
                "model": "m",
                "content": [{"type": "text", "text": "world"}],
                "stop_reason": "end_turn",
            })

        self._patch(monkeypatch, handler)

        c = LLMClient(LLMRoleConfig(base_url="http://x/v1", api_key="k",
                                    model="m", api="anthropic-messages"))
        r = await c.complete("sys", "user")
        assert r.text == "world"
        assert captured["url"] == "http://x/v1/messages"
        assert captured["key"] == "k"
        assert captured["body"]["system"] == "sys"

    async def test_http_error_raises_with_status(self, monkeypatch):
        import httpx

        self._patch(monkeypatch,
                    lambda req: httpx.Response(401, json={"error": "bad key"}))
        c = LLMClient(LLMRoleConfig(base_url="http://x/v1", api_key="k", model="m"))
        with pytest.raises(LLMError) as exc:
            await c.complete("s", "u")
        assert "401" in str(exc.value)

    async def test_empty_content_raises(self, monkeypatch):
        import httpx

        self._patch(monkeypatch, lambda req: httpx.Response(200, json={
            "choices": [{"message": {"content": "   "}}]}))
        c = LLMClient(LLMRoleConfig(base_url="http://x/v1", api_key="k", model="m"))
        with pytest.raises(LLMError, match="空"):
            await c.complete("s", "u")

    async def test_missing_choices_raises(self, monkeypatch):
        import httpx

        self._patch(monkeypatch,
                    lambda req: httpx.Response(200, json={"ok": True}))
        c = LLMClient(LLMRoleConfig(base_url="http://x/v1", api_key="k", model="m"))
        with pytest.raises(LLMError, match="choices"):
            await c.complete("s", "u")

    async def test_complete_json_falls_back_when_json_mode_unsupported(self, monkeypatch):
        """部分端点不支持 response_format，应去掉后重试一次。"""
        import httpx

        seen = []

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            seen.append("response_format" in body)
            if "response_format" in body:
                return httpx.Response(400, json={"error": "unsupported"})
            return httpx.Response(200, json={
                "choices": [{"message": {"content": '{"ok": true}'}}]})

        self._patch(monkeypatch, handler)

        c = LLMClient(LLMRoleConfig(base_url="http://x/v1", api_key="k", model="m"))
        out = await c.complete_json("s", "u")
        assert out == {"ok": True}
        assert seen == [True, False]  # 先带 json_mode，再降级

    async def test_content_as_list_of_blocks(self, monkeypatch):
        import httpx

        self._patch(monkeypatch, lambda req: httpx.Response(200, json={
            "choices": [{"message": {"content": [
                {"type": "text", "text": "part1"},
                {"type": "text", "text": "part2"},
            ]}}]}))
        c = LLMClient(LLMRoleConfig(base_url="http://x/v1", api_key="k", model="m"))
        assert (await c.complete("s", "u")).text == "part1part2"
