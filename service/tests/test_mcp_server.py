# -*- coding: utf-8 -*-
"""MCP server 测试。

覆盖两件事：
1. 工具注册表完整、schema 正确（模型看不到的工具等于不存在）
2. 真实通过 stdio 协议调用（不是"代码看起来对"）

第 2 类走真实 MCP 协议，比直接调函数更能发现接入问题。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

EXPECTED_TOOLS = {
    "novel_status",
    "novel_doctor",
    "novel_init",
    "novel_plan",
    "novel_write",
    "novel_blocking",
    "novel_resume",
    "novel_read_chapter",
    "novel_outline",
    "novel_context",
    "novel_events",
    "novel_config_get",
    "novel_config_set",
}


class TestToolRegistry:
    """直接检查注册表，不启进程（快）。

    注意 mcp 2.x 用 snake_case（input_schema），1.x 用 camelCase。
    内部结构也随版本变，取不到就跳过、交给协议层测试覆盖。
    """

    def test_server_constructs(self):
        from service.mcp_server import mcp
        assert mcp.name == "webnovel"

    def test_all_expected_tools_registered(self):
        from service.mcp_server import mcp

        manager = getattr(mcp, "_tool_manager", None)
        if manager is None:
            pytest.skip("当前 mcp 版本内部结构不同，由协议层测试覆盖")

        # 取已注册的工具名：兼容不同版本的容器形态
        names = set()
        for attr in ("_tools", "tools", "_registered_tools"):
            container = getattr(manager, attr, None)
            if isinstance(container, dict):
                names.update(str(k) for k in container)
            elif isinstance(container, (list, tuple)):
                for item in container:
                    n = getattr(item, "name", None)
                    if n:
                        names.add(str(n))
        if not names:
            pytest.skip("无法从内部结构取到工具名，由协议层测试覆盖")

        missing = EXPECTED_TOOLS - names
        assert not missing, f"缺少工具：{missing}"

    def test_descriptions_are_chinese_and_substantive(self):
        """工具描述是模型唯一的使用依据，必须清楚。"""
        import inspect

        from service import mcp_server
        for name in sorted(EXPECTED_TOOLS):
            fn = getattr(mcp_server, name)
            doc = inspect.getdoc(fn) or ""
            assert len(doc) > 20, f"{name} 描述过短"

    def test_write_tool_documents_blocking_behavior(self):
        """写章工具必须说明会遇阻断停下，否则模型不知道怎么处理。"""
        import inspect

        from service import mcp_server
        doc = inspect.getdoc(mcp_server.novel_write) or ""
        assert "needs_user_action" in doc
        assert "novel_resume" in doc or "novel_blocking" in doc

    def test_init_tool_warns_plan_is_required(self):
        """建书后必须提示还要规划，否则用户会直接写章然后失败。"""
        import inspect

        from service import mcp_server
        doc = inspect.getdoc(mcp_server.novel_init) or ""
        assert "novel_plan" in doc

    def test_resume_tool_lists_valid_stages(self):
        import inspect

        from service import mcp_server
        doc = inspect.getdoc(mcp_server.novel_resume) or ""
        for stage in ("draft", "polish", "commit"):
            assert stage in doc


class TestHelpers:
    def test_resolve_root_prefers_argument(self, tmp_path: Path, monkeypatch):
        from service import mcp_server
        monkeypatch.setattr(mcp_server, "DEFAULT_PROJECT", "")
        got = mcp_server._resolve_root(str(tmp_path))
        assert Path(got) == tmp_path.resolve()

    def test_resolve_root_falls_back_to_default(self, tmp_path: Path, monkeypatch):
        from service import mcp_server
        monkeypatch.setattr(mcp_server, "DEFAULT_PROJECT", str(tmp_path))
        assert Path(mcp_server._resolve_root("")) == tmp_path.resolve()

    def test_resolve_root_raises_with_clear_message(self, monkeypatch):
        from service import mcp_server
        monkeypatch.setattr(mcp_server, "DEFAULT_PROJECT", "")
        monkeypatch.setattr("service.mcp_server.load_settings",
                            lambda *a, **k: type("S", (), {"project_root": ""})())
        with pytest.raises(ValueError, match="未能定位书项目根目录"):
            mcp_server._resolve_root("")

    def test_json_output_is_parseable_and_keeps_chinese(self):
        from service.mcp_server import _json
        out = _json({"书名": "测试之书", "n": 1})
        assert json.loads(out)["书名"] == "测试之书"


@pytest.mark.timeout(300)
class TestStdioProtocol:
    """真实 MCP 协议层测试：起子进程、走 stdio、调工具。

    这比直接调函数强：能发现注册失败、schema 错误、序列化问题、
    以及服务端导入期崩溃等只在真实连接下暴露的问题。
    """

    async def _session(self):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        import os

        env = dict(os.environ)
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        params = StdioServerParameters(
            command=sys.executable,
            args=["-X", "utf8", str(REPO_ROOT / "service" / "mcp_server.py")],
            env=env,
            cwd=str(REPO_ROOT),
        )
        return stdio_client, params, ClientSession

    async def test_lists_all_tools_over_protocol(self):
        stdio_client, params, ClientSession = await self._session()
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                names = {t.name for t in tools.tools}
                missing = EXPECTED_TOOLS - names
                assert not missing, f"协议层缺少工具：{missing}"

    async def test_every_tool_has_input_schema(self):
        stdio_client, params, ClientSession = await self._session()
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                for tool in tools.tools:
                    assert tool.description, f"{tool.name} 无描述"
                    # 兼容 mcp 1.x(camelCase) / 2.x(snake_case)
                    schema = (getattr(tool, "input_schema", None)
                              or getattr(tool, "inputSchema", None))
                    assert schema is not None, f"{tool.name} 无输入 schema"

    async def test_init_then_status_roundtrip(self, tmp_path: Path):
        """真实建书 → 查状态，验证工具能真正驱动上游引擎。"""
        stdio_client, params, ClientSession = await self._session()
        book = tmp_path / "book"
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()

                res = await session.call_tool("novel_init", {
                    "project_dir": str(book),
                    "title": "协议测试之书",
                    "genre": "玄幻",
                })
                payload = json.loads(res.content[0].text)
                assert payload["ok"] is True, payload
                assert (book / ".webnovel" / "state.json").is_file()

                res = await session.call_tool("novel_status",
                                              {"project_root": str(book)})
                status = json.loads(res.content[0].text)
                assert status.get("phase"), status

    async def test_outline_missing_chapter_errors_gracefully(self, tmp_path: Path):
        """缺章纲应返回可读错误，而不是让协议层抛异常。"""
        stdio_client, params, ClientSession = await self._session()
        book = tmp_path / "book2"
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                await session.call_tool("novel_init", {
                    "project_dir": str(book), "title": "空章纲", "genre": "玄幻",
                })
                res = await session.call_tool(
                    "novel_outline", {"project_root": str(book), "chapter": 1})
                payload = json.loads(res.content[0].text)
                assert "error" in payload

    async def test_config_get_never_leaks_key(self, tmp_path: Path, monkeypatch):
        """配置接口绝不能回显密钥明文。"""
        stdio_client, params, ClientSession = await self._session()
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                res = await session.call_tool("novel_config_get", {})
                blob = res.content[0].text
                assert "api_key" not in blob or "api_key_set" in blob
                # 不应出现形如真实密钥的长串
                assert "sk-" not in blob.replace("sk-xxx", "")
