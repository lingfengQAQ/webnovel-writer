# Webnovel Writer Service

把上游 [webnovel-writer](https://github.com/lingfengQAQ/webnovel-writer) 的 Python 数据链，
包装成一个**可配置 LLM API 的 Web 服务**。

上游是 Claude Code 插件——写作智能全在 8 个 `SKILL.md` 的提示词里，由 Claude Code 这个 agent 执行。
本项目把那套提示词搬到服务端，改成直接调用你配置的任意 LLM API，于是它不再依赖 Claude Code。

## 它和上游的关系

```
webnovel-writer/       上游原样保留，不修改一行（数据引擎：state / Story System / RAG / 审查评分）
service/               本项目新增（LLM 编排 + Web API + 配置）
```

上游作为引擎原地复用，通过子进程调用它的 CLI。这样 `git merge upstream` 的冲突面被压到最小。

## 快速开始

```bash
pip install -r service/requirements.txt
pip install -r webnovel-writer/scripts/requirements.txt
pip install -r webnovel-writer/dashboard/requirements.txt

# 1. 建一本书
python -m service.server --init ./我的小说 --title "书名"

# 2. 配置 LLM（也可通过 PUT /service/config 或 .env）
#    见下方"配置"一节

# 3. 启动服务
python -m service.server --project-root ./我的小说 --port 8770
```

打开 `http://127.0.0.1:8770/docs` 看写操作 API；
打开 `http://127.0.0.1:8770/` 看只读可视化面板（复用上游 Dashboard 前端）。

### 完整创作流程

```bash
# 第一步：规划（必需！新项目只有总纲，没有章纲，不规划无法写作）
curl -X POST http://127.0.0.1:8770/service/plan \
  -H 'Content-Type: application/json' \
  -d '{"volume":1,"chapter_start":1,"chapter_end":10,"genre":"玄幻"}'

# 第二步：写第一章
curl -X POST http://127.0.0.1:8770/service/write/stream \
  -H 'Content-Type: application/json' \
  -d '{"chapter":1}'
```

> **注意**：上游 `init` 只生成 `大纲/总纲.md`，**没有任何章纲**。
> 而写章第一步就要从章纲解析本章目标。所以 `plan` 不是可选项——
> 跳过它，`write` 会在 contract 阶段直接失败。

## 配置

三种方式，优先级由低到高：**代码默认 → `.env` → 环境变量 → `PUT /service/config`**。

### 方式一：.env

服务根目录或书项目根目录放 `.env`：

```bash
LLM_BASE_URL=https://api.example.com/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=deepseek-v4.1-flash
LLM_API=openai-completions        # 或 anthropic-messages

# 按角色分别指定模型（可选，未指定则回退到上面的 default）
CONTEXT_MODEL=...
DRAFT_MODEL=...
REVIEW_MODEL=...
DATA_MODEL=...

# 检索（可选；不填则自动退回 BM25 关键词检索）
EMBED_BASE_URL=...
EMBED_MODEL=...
EMBED_API_KEY=...
RERANK_BASE_URL=...
RERANK_MODEL=...
RERANK_API_KEY=...
```

### 方式二：HTTP 接口

```bash
# 读配置（api_key 只回显是否已设置与末四位，绝不回显明文）
curl http://127.0.0.1:8770/service/config

# 写配置（合并语义；api_key 传空字符串表示不改动）
curl -X PUT http://127.0.0.1:8770/service/config \
  -H 'Content-Type: application/json' \
  -d '{"llm":{"base_url":"https://api.example.com/v1","model":"deepseek-v4.1-flash","api_key":"sk-xxx"}}'

# 连通性测试（真实发一次最小请求）
curl -X POST http://127.0.0.1:8770/service/config/test \
  -H 'Content-Type: application/json' -d '{"role":"draft"}'
```

运行时配置写入 `service/storages/settings.json`（已 gitignore）。

## API

### 配置
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/service/config` | 读生效配置（密钥掩码） |
| PUT | `/service/config` | 写配置 |
| POST | `/service/config/test` | LLM 连通性测试 |

### 项目
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/service/projects` | 初始化新书 |
| GET | `/service/projects/status` | 项目短状态 |
| GET | `/service/projects/doctor` | 项目体检 |
| GET | `/service/projects/resume` | 断点续跑建议 |

### 写作
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/service/write` | 同步写一章 |
| POST | `/service/write/stream` | SSE 流式写章（推荐） |
| POST | `/service/write/resume` | **从指定阶段续跑**（解决阻断后继续） |
| GET | `/service/write/blocking` | 读当前阻断状态与续跑选项 |

### 规划
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/service/plan` | 规划一卷（节拍表 + 时间线 + 章纲） |
| POST | `/service/plan/stream` | SSE 流式规划（按批次推送进度） |
| GET | `/service/plan/outline` | 读章纲 / 卷大纲 / 总纲 |

`/service/write/stream` 会推送 `progress` 事件（每个阶段的 running/ok/failed），
最后推 `final`（完整结果）或 `error`。

请求体（两者相同）：

```json
{
  "chapter": 1,
  "title": "绝境觉醒",
  "chapter_goal": "主角在家族试炼中被废去修为，绝境中觉醒金手指",
  "genre": "玄幻",
  "mode": "default",
  "target_words": 2500,
  "override_existing": false,
  "stop_after_review": false,
  "accept_blocking": false
}
```

- `mode`：`default` / `fast` / `minimal`
- `chapter_goal`：**可省略**，会自动从章纲解析
- `override_existing`：正文已存在时是否覆盖（默认 false，即沿用现有正文，不覆盖作者手改）
- `stop_after_review`：只跑到审查就停，方便先看审查结果再决定
- `accept_blocking`：是否接受阻断问题继续（默认 false，见下）

### 阻断问题怎么处理

审查发现 `blocking=true` 的问题时，流程会停在 `needs_user_action`，
不会静默放过。此时有三种继续方式：

```bash
# 看当前阻断内容与可选续跑方式
curl "http://127.0.0.1:8770/service/write/blocking"

# 方式 A：重新起草
curl -X POST http://127.0.0.1:8770/service/write/resume \
  -H 'Content-Type: application/json' \
  -d '{"chapter":1,"from_stage":"draft"}'

# 方式 B：接受现状，继续润色→提交
curl -X POST http://127.0.0.1:8770/service/write/resume \
  -H 'Content-Type: application/json' \
  -d '{"chapter":1,"from_stage":"polish","accept_blocking":true}'

# 方式 C：自己改好正文后直接提交
curl -X POST http://127.0.0.1:8770/service/write/resume \
  -H 'Content-Type: application/json' \
  -d '{"chapter":1,"from_stage":"commit","accept_blocking":true}'
```

`accept_blocking=true` 时，裁决会被**写进 `review_results.json`**：
每个阻断项的 `blocking` 降为 false，原始记录保存在 `adjudicated_blocking_issues`，
并附 `adjudication` 元信息。这是必需的——上游 `precommit` gate 直接读该文件的
`blocking_count`，只设内存标志位 gate 仍会拒绝提交。

### 只读
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/service/chapters/{n}` | 读章节正文 |
| GET | `/service/context/{n}` | 读本章上下文包 |
| GET | `/service/events` | 故事事件链 |

上游 Dashboard 的 30 个只读端点（`/api/project/info`、`/api/entities`、`/api/chapters`、
`/api/reading-power` …）与前端页面也一并可用。

## 写章流程

对应上游 `/webnovel-write` 的六步，逐步可观测：

```
preflight → contract → context → draft → review → polish → data → commit → backup
                                                                  └─ projection
```

各阶段做的事：

| 阶段 | 说明 |
|---|---|
| `preflight` | 校验项目根、占位符、Story System 健康 |
| `contract` | 刷新本章写作合同（题材自动从 state.json 解析，目标自动从章纲解析） |
| `context` | context-agent 生成五段写作任务书 |
| `draft` | 按任务书起草正文 |
| `review` | reviewer 做五维事实审查（设定/时间线/连贯/角色/逻辑） |
| `polish` | 修非阻断问题 + 风格适配 + Anti-AI 终检 |
| `data` | data-agent 提取事实，产出三份 commit artifact |
| `commit` | 提交 CHAPTER_COMMIT，驱动 5 项投影 |
| `backup` | 章节级 git 备份 |

每个阶段都可以作为 `from_stage` 续跑起点。

## 规划流程

对应上游 `/webnovel-plan`：

| 阶段 | 产出 |
|---|---|
| `preflight` | 校验项目、解析题材 |
| `volume` | `大纲/第N卷-节拍表.md`、`大纲/第N卷-时间线.md` |
| `chapters` | `大纲/第N卷-详细大纲.md`（章纲按 `### 第N章：标题` 分节，默认 10 章/批） |
| `finalize` | 刷新写作合同、更新项目状态 |

章纲是增量补齐的：已存在的章节不会重写，只补缺失的。
每批生成后会记住上一批末章的 `CEN`，供下一批首章的 `CBN` 承接。

### 硬规则（继承自上游，未放宽）

- **阻断问题不静默放过**：审查出 `blocking=true` 时流程停在 `needs_user_action`，等裁决。
- **不覆盖作者手改**：正文已存在且 `override_existing=false` 时沿用现有文件。
- **投影失败要暴露**：非 vector 投影失败会自动补跑一次，仍失败则记入 `problems`。
- **vector 投影降级不算失败**：未配 Embedding Key 时上游会跳过向量投影、退回 BM25，这记入 `auto_handled`。

### 结果状态

| 状态 | 含义 |
|---|---|
| `completed` | 全部产物生成、校验通过 |
| `partial` | 主产物在，但有跳过项或待确认项 |
| `needs_user_action` | 停在安全位置，等你裁决（如阻断问题） |
| `failed` | 关键产物没生成 |

## 设计说明

### 与上游 Agent 的三处有意差异

1. 上游 Agent 用 `Read`/`Grep`/`Bash` 自己取数据；服务端没有这些工具，改由 pipeline 预取数据注入 prompt。
2. 上游靠 `Agent` 工具调度命名 subagent；这里改为直接的一次 LLM 调用。
3. 上游的 schema / 边界 / 禁区规则**逐字保留**——那是数据链的契约，改了会被 `chapter-commit` 拒收。

### 为什么用子进程调上游而不是 import

上游 `data_modules` 内部结构会随版本变化。子进程调用只依赖 CLI 这一层稳定契约，
上游重构不影响我们。代价是每次调用有进程启动开销（实测约 0.5-3 秒）。

## 已知限制

- **耗时**：写一章约 2-5 分钟（审查阶段最慢，取决于模型速度）；规划一卷约 30 秒-2 分钟。
- **RAG 需自行配置**：不配 Embedding Key 时检索退回 BM25，语义召回会弱一些。
- **未移植交互式问答**：上游 `/webnovel-init` 与 `/webnovel-plan` 有多轮追问；
  服务端是参数化的（`POST /service/projects`、`POST /service/plan`），不做多轮对话。
  需要补设定的地方，直接改设定集文件后重跑。
- **未移植 `/webnovel-review` 独立入口**：审查目前内嵌在写章流程里。
- **`stop_after_review` 与 `accept_blocking` 需显式传**：默认行为是遇阻断即停。

## 许可

上游 webnovel-writer 为 **GPL-3.0**。本项目是其衍生作品，同样以 **GPL-3.0** 分发。
