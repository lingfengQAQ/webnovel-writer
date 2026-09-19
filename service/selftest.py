# -*- coding: utf-8 -*-
"""服务层自检：不依赖 LLM 的纯函数与路由检查。

运行： python service/selftest.py
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {name}" + (f" —— {detail}" if detail else ""))
    if not condition:
        failures.append(name)


# ── config ───────────────────────────────────────────────────────────────────
from service.config import LLMRoleConfig, load_settings, save_runtime_settings  # noqa: E402

s = load_settings()
check("config loads", s is not None)
check("default llm role resolvable", s.role("draft") is not None)

d = LLMRoleConfig(base_url="http://x/v1", api_key="k", model="m")
o = LLMRoleConfig(base_url="", api_key="", model="override")
merged = o.resolved(d)
check("role fallback keeps default base_url", merged.base_url == "http://x/v1")
check("role override wins for model", merged.model == "override")

pub = s.to_public_dict()
check("public dict masks api_key", "api_key" not in pub["llm"])
check("public dict reports api_key_set", "api_key_set" in pub["llm"])

# ── llm JSON 容错 ────────────────────────────────────────────────────────────
from service.llm import (  # noqa: E402
    LLMError,
    parse_json_response,
    _first_json_value,
    _strip_code_fence,
)

check("parse plain json", parse_json_response('{"a": 1}') == {"a": 1})
check("parse fenced json", parse_json_response('```json\n{"a": 1}\n```') == {"a": 1})
check("parse bare fence", parse_json_response('```\n{"a": 2}\n```') == {"a": 2})
check(
    "parse json with prose around it",
    parse_json_response('好的，结果如下：\n{"a": 3}\n以上。') == {"a": 3},
)
check(
    "parse nested json with braces in string",
    parse_json_response('prefix {"s": "a}b", "n": {"m": 1}} suffix')
    == {"s": "a}b", "n": {"m": 1}},
)
check(
    "parse array json",
    parse_json_response('[{"x": 1}]') == [{"x": 1}],
)
check(
    "repair trailing comma",
    parse_json_response('{"a": 1,}') == {"a": 1},
)
try:
    parse_json_response("完全不是 JSON")
    check("raise on unparseable", False)
except LLMError:
    check("raise on unparseable", True)

check("strip fence handles unclosed", _strip_code_fence('```json\n{"a":1}') == '{"a":1}')
check("first_json_value finds object", _first_json_value("x {\"a\":1} y") == '{"a":1}')

# ── prompts ──────────────────────────────────────────────────────────────────
from service import prompts  # noqa: E402

check("context system mentions five sections", "五段" in prompts.CONTEXT_SYSTEM)
check("reviewer declares 5 dimensions", prompts.REVIEW_SYSTEM.count("（category:") == 5)
check("reviewer schema has dimension_results", "dimension_results" in prompts.REVIEW_SYSTEM)
check("data system lists event_type enum", "open_loop_created" in prompts.DATA_SYSTEM)
check("data system forbids nesting", "禁止包在外层对象里" in prompts.DATA_SYSTEM)
check("polish system has anti-AI layers", "Anti-AI" in prompts.POLISH_SYSTEM)

cp = prompts.build_context_prompt(7, {"k": "v"}, "章纲内容")
check("context prompt embeds chapter number", "第 7 章" in cp)
check("context prompt embeds outline", "章纲内容" in cp)
check("context prompt handles missing outline",
      "未找到章纲文件" in prompts.build_context_prompt(7, None, None))

dp = prompts.build_data_prompt(7, "正文", {"e": 1})
check("data prompt embeds chapter", "第 7 章" in dp)

rp = prompts.build_review_prompt(7, "正文", {"c": 1})
check("review prompt embeds text", "正文" in rp)

# 截断保护
long_text = "字" * 50000
rendered = prompts._dump(long_text, 1000)
check("dump truncates long input", len(rendered) < 2000 and "已截断" in rendered)

# ── engine 路径解析（不调用上游） ────────────────────────────────────────────
from service.engine import Engine  # noqa: E402

try:
    eng = Engine(load_settings(), project_root=str(REPO_ROOT))
    check("engine constructs", True)
    check("engine finds upstream entry", eng.entry.is_file())
except Exception as exc:  # noqa: BLE001
    check("engine constructs", False, str(exc))

# ── pipeline 结构 ────────────────────────────────────────────────────────────
from service.pipeline import Stage, WritePipeline, WriteResult  # noqa: E402

check("all stages present", len(list(Stage)) == 11)
check("write result serializable", isinstance(WriteResult(1, "t", "failed").to_dict(), dict))

# ── app 路由 ─────────────────────────────────────────────────────────────────
from service.app import create_service_app  # noqa: E402

app = create_service_app(str(REPO_ROOT))
paths = {getattr(r, "path", "") for r in app.routes}
required = {
    "/service/health",
    "/service/config",
    "/service/config/test",
    "/service/projects",
    "/service/projects/status",
    "/service/projects/doctor",
    "/service/projects/resume",
    "/service/write",
    "/service/write/stream",
    "/service/chapters/{chapter}",
    "/service/context/{chapter}",
    "/service/events",
}
missing = sorted(required - paths)
check("all service routes registered", not missing, f"missing: {missing}")

# 关键：上游 SPA 兜底路由必须排在最后，否则会吞掉本层路由
mounts = [r for r in app.routes if r.__class__.__name__ == "Mount"]
check("upstream dashboard mounted", len(mounts) > 0)
if mounts:
    last_route = app.routes[-1]
    check("dashboard mount is the last route",
          last_route.__class__.__name__ == "Mount",
          f"last is {last_route.__class__.__name__}")

print()
if failures:
    print(f"FAILED: {len(failures)} 项 -> {failures}")
    raise SystemExit(1)
print("全部通过")
