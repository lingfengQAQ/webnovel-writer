# DSH 预设：让 DSH 直接使用网文创作引擎

这个目录是 **DSH（DeepSeek Harness）集成**的完整配置，包含：

```
dsh-preset/
├── preset.yml                       预设元数据（名称/描述/排序）
├── agent.cordis.yml                 agent 组成：persona + MCP 工具 + 技能目录
└── skills/webnovel-workflow/
    └── SKILL.md                     教模型正确使用 novel_* 工具的技能
```

## 这是什么

上游 webnovel-writer 是 Claude Code 插件；`service/` 把它的能力包成了
**MCP server**（`service/mcp_server.py`），于是任何 MCP 客户端——包括 DSH——
都能直接调用网文创作工具，不需要额外跑一个 Web 服务。

本目录的预设把这些工具挂到 DSH 的一个 agent 上，并附上使用技能。

## 安装

### 1. 装依赖

```bash
pip install -r service/requirements.txt   # 服务层
pip install "mcp>=1.2.0"                  # MCP SDK
pip install -r webnovel-writer/scripts/requirements.txt
pip install -r webnovel-writer/dashboard/requirements.txt
```

### 2. 把仓库放到约定位置

预设按下面的顺序找引擎，**不写死任何用户名**：

1. 环境变量 `WEBNOVEL_HOME` / `WEBNOVEL_MCP_SERVER`
2. 回退到 `~/tools/webnovel-writer-dsh`

所以最省事的做法就是 clone 到 `~/tools/webnovel-writer-dsh`：

```bash
git clone https://github.com/<you>/webnovel-writer-dsh ~/tools/webnovel-writer-dsh
```

装在别处就设环境变量（DSH 启动前设置）：

| 环境变量 | 用途 | 默认 |
|---|---|---|
| `WEBNOVEL_HOME` | 仓库根目录（也作为子进程 cwd） | `~/tools/webnovel-writer-dsh` |
| `WEBNOVEL_MCP_SERVER` | `mcp_server.py` 绝对路径 | `<WEBNOVEL_HOME>/service/mcp_server.py` |
| `WEBNOVEL_PYTHON` | Python 解释器 | `python` |

### 3. 复制预设

```bash
# 用户预设目录
cp -r dsh-preset ~/.dsh/.agent-presets/webnovel
```

Windows：
```powershell
Copy-Item dsh-preset "$env:USERPROFILE\.dsh\.agent-presets\webnovel" -Recurse
```

### 4. 在 DSH 里选用

重启 DSH（或新建会话），在预设选择器里选「网文创作」。

## 配置 LLM

首次使用前配好 API。两种方式：

**A. 通过工具对话配置**（推荐，会话内就能做）

```
novel_config_set(base_url="https://api.example.com/v1", model="...", api_key="...")
```

**B. 写 .env**（仓库根或书项目根）

```bash
LLM_BASE_URL=https://api.example.com/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=your-model
```

Embedding 可不配——不配时检索自动退回 BM25 关键词模式。

## 用法

装好后直接对话即可，例如：

- 「帮我建一本玄幻小说，叫《XXX》」
- 「规划第一卷，先来 10 章」
- 「写第 1 章」
- 「第 3 章审查出了什么问题？」

模型会按 `webnovel-workflow` 技能里的流程调用工具。

**关键顺序**：建书（`novel_init`）→ **规划（`novel_plan`）** → 写作（`novel_write`）。
中间那步不能跳：上游建书只产出总纲、没有章纲，而写章第一步就要从章纲解析
「本章目标」，跳过规划写章必然失败。

## 设计要点

### 为什么放在预设（而不是 host 组成）

`dsh-mcp-client` 只向 `ctx.tools` 注册工具、`inject: ["tools"]`，**不发布任何服务**，
所以它属于「这一会话贡献给注册表的东西」——正是 agent 预设的职责范围。
（如果它发布服务，就必须放进 host 组成或 isolate realm。）

### toolCallTimeoutMs 必须调大

MCP 客户端默认工具超时是 **60 秒**，而写一章要 **3-5 分钟**（审查阶段最慢）。
预设里显式设成 `1800000`（30 分钟），否则 `novel_write` 会在中途被超时掐断。

### failOnStartupError: false

引擎起不来时不让整个预设挂掉：`novel_*` 工具不出现、错误进日志，
会话的其余工具照常可用。排查时看 DSH 日志里 `webnovel` 的启动记录。

### 技能随预设走

`skill-filesystem` 行用 `customSkillDirs` + `baseUrl` 指向预设自己的 `skills/` 目录，
所以技能跟着预设走，不管它被安装到哪个根。

## 验证

```bash
# MCP server 自检（15 项，含真实 stdio 协议层）
python -m pytest -c service/pytest.ini service/tests/test_mcp_server.py -v

# 手动冒烟：确认 13 个工具都注册出来
python -c "import asyncio,os,sys; sys.path.insert(0,'.'); ..."   # 见 tests/test_mcp_server.py
```

预设本身的组成正确性由 DSH 的 `standingKeyFor` 在挂载时校验。

## 已知限制

- 一个项目一次写一章，**章节必须按顺序写**，不要跳章。
- 写章耗时数分钟，期间不要重复调用同一个 `novel_write`。
- 上游的交互式问答（`/webnovel-init` 的多轮追问）在服务端是参数化的，
  需要补设定时直接改设定集文件后重跑。
