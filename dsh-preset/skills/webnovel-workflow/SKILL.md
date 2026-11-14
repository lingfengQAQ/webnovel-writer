---
name: webnovel-workflow
description: 长篇网文创作工作流。用 webnovel MCP 工具建书、规划卷纲章纲、写作章节、处理审查阻断。当用户要求写小说/网文、续写章节、规划剧情、查询故事设定或伏笔时使用。
---

# 网文创作工作流

本会话挂载了 `webnovel` MCP 工具（前缀 `novel_`）。它是一套长篇网文创作引擎，
负责设定、大纲、正文、事实一致性、伏笔追踪与检索。

## 最关键的一条：必须先规划才能写作

上游建书**只产出总纲，没有章纲**。而写章第一步就要从章纲解析「本章目标」——
**跳过规划，写章必然失败**。

```
novel_init  →  novel_plan  →  novel_write
  建书          规划卷/章纲      写章
```

不要在建完书后直接调 `novel_write`。

## 标准流程

### 1. 建书（已有项目则跳过）

```
novel_init(project_dir, title, genre)
```

- `genre` 必须是**中文题材名**，上游用硬匹配路由。常用：玄幻、仙侠、都市、
  规则怪谈、历史古代、悬疑灵异、科幻、无限流、末世。
- 建书后立刻调 `novel_plan`，不要直接写章。

### 2. 规划（写作前置，必做）

```
novel_plan(project_root, volume=1, chapter_end=<本卷章数>)
```

产出卷节拍表、卷时间线、章纲，并刷新写作合同。

- `genre` 留空会自动从 `state.json` 读。
- 章纲按批生成，可先小范围试跑（如 `chapter_end=10`）确认质量再扩。
- **已存在的章纲不会被重写**，只增量补齐缺失章节，可安全重复调用。
- 耗时约 30 秒–2 分钟。

### 3. 写作

```
novel_write(chapter, project_root, title?, chapter_goal?)
```

`title` 与 `chapter_goal` 都可留空——会从章纲自动解析。

写章内部是一条带关卡的流水线：
预检 → 合同 → 上下文 → 起草 → **五维审查** → 润色 → 事实提取 → 提交 → 备份

- 耗时数分钟（审查阶段最慢），属正常。
- 正文已存在时**默认沿用不覆盖**，保护作者手改。确实要覆盖才传
  `override_existing=true`。

### 4. 处理阻断（重要）

`novel_write` 返回 `needs_user_action` 表示审查发现了阻断问题，流程**已停在安全位置**。
这不是失败，是等你裁决。

```
novel_blocking(project_root)     # 看具体卡在哪、有哪些续跑方式
novel_resume(chapter, from_stage, accept_blocking)
```

三种续跑方式：

| 意图 | 参数 |
|---|---|
| 重新起草 | `from_stage="draft"` |
| 接受现状，继续提交 | `from_stage="polish", accept_blocking=true` |
| 已自己改好正文，直接提交 | `from_stage="commit", accept_blocking=true` |

**遇到阻断时应当问用户怎么处理，不要自行 `accept_blocking=true` 放行**——
那等于替作者接受了一个事实性错误。

## 读取类工具

| 工具 | 用途 |
|---|---|
| `novel_status` | 项目阶段、写到第几章、下一步建议 |
| `novel_doctor` | 体检：目录、文件、数据库、RAG、依赖 |
| `novel_read_chapter` | 读某章正文 |
| `novel_outline` | 读章纲 / 卷大纲 / 总纲 |
| `novel_context` | 某章写作上下文（合同、近期摘要、未回收伏笔、角色状态） |
| `novel_events` | 故事事件链（状态变更、伏笔、关系变化） |

**开工前先 `novel_status`**，按返回的 `phase` 与 `next_action` 决定下一步。

## 配置

首次使用若提示 LLM 未配置：

```
novel_config_get()                                    # 看当前配置（密钥只显示末四位）
novel_config_set(base_url, model, api_key)            # 配置
```

`api_key` 传空表示**不改动**已保存的密钥。

Embedding 可不配（`embed_base_url`/`embed_model`/`embed_api_key`）——不配时检索
自动退回 BM25 关键词模式，语义召回略弱，但功能完整。

## 常见错误

| 现象 | 原因与处理 |
|---|---|
| `无法确定题材` | genre 缺失或不是中文题材名。调 `novel_init` 时传对，或 `novel_plan` 里显式传 |
| `无法确定第 N 章的目标` | 还没规划出章纲。先 `novel_plan` |
| `存在占位符` | 大纲/设定集有未补齐的占位。用 `novel_doctor` 定位后补齐 |
| 写章报 LLM 未配置 | 先 `novel_config_set` |

## 注意

- 写一章要几分钟，期间不要重复调用同一个 `novel_write`。
- 一个项目一次只写一章；**章节必须按顺序写**，不要跳章。
- 工具返回的 JSON 里 `problems` / `needs_user_action` / `auto_handled` 都要看，
  不要只看 `status`。
