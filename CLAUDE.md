# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

`webnovel-writer` 是基于 Claude Code 的**长篇网文辅助创作系统**，解决 AI 写作中的「遗忘」和「幻觉」问题，支持 200 万字量级连载创作。

## 架构概览

```
Claude Code → Skills (7个) → Agents (8个) → Data Layer (state.json / index.db / vectors.db)
```

### 双 Agent 架构

| Agent | 职责 |
|-------|------|
| **Context Agent** | 写作前构建"创作任务书"，提供本章上下文、约束和追读力策略 |
| **Data Agent** | 从正文提取实体与状态变化，更新 state.json、index.db、vectors.db |

### 防幻觉三定律

| 定律 | 说明 | 执行方式 |
|------|------|---------|
| 大纲即法律 | 遵循大纲，不擅自发挥 | Context Agent 强制加载章节大纲 |
| 设定即物理 | 遵守设定，不自相矛盾 | Consistency Checker 实时校验 |
| 发明需识别 | 新实体必须入库管理 | Data Agent 自动提取并消歧 |

### 六维并行审查

- High-point Checker（爽点密度与质量）
- Consistency Checker（设定一致性：战力/地点/时间线）
- Pacing Checker（Strand 比例与断档）
- OOC Checker（人物行为是否偏离人设）
- Continuity Checker（场景与叙事连贯性）
- Reader-pull Checker（钩子强度、期待管理、追读力）

### Strand Weave 节奏系统

| Strand | 含义 | 理想占比 | 断档红线 |
|--------|------|---------|---------|
| Quest | 主线剧情 | 60% | ≤5章 |
| Fire | 感情线 | 20% | ≤10章 |
| Constellation | 世界观扩展 | 20% | ≤15章 |

## 目录结构

```
WORKSPACE_ROOT/
├── .claude/
│   └── .webnovel-current-project   → 指向当前小说 PROJECT_ROOT
└── {小说名}/                       ← /webnovel-init 按书名创建
    ├── .webnovel/                 # 运行时数据（state/index/vectors）
    ├── 正文/                       # 正文章节
    ├── 大纲/                       # 总纲与卷纲
    └── 设定集/                     # 世界观、角色、力量体系
```

**注意**：插件本身不在项目目录内，而在 `CLAUDE_PLUGIN_ROOT`（插件缓存目录），运行时统一用该变量引用。

## 核心命令

| 命令 | 用途 |
|------|------|
| `/webnovel-init` | 初始化小说项目（目录、设定模板、状态文件） |
| `/webnovel-plan [卷号]` | 生成卷级规划与章节大纲 |
| `/webnovel-write [章号]` | 执行完整章节创作流程（上下文→草稿→审查→润色→数据落盘） |
| `/webnovel-review [范围]` | 对历史章节做多维质量审查（如 `1-5`、`45`） |
| `/webnovel-query [关键词]` | 查询角色、伏笔、节奏、状态等运行时信息 |
| `/webnovel-resume` | 任务中断后自动识别断点并恢复 |
| `/webnovel-dashboard` | 启动只读可视化面板 |
| `/webnovel-learn [内容]` | 从当前会话提取可复用写作模式到 project_memory.json |

## RAG 配置

在 `PROJECT_ROOT/.env` 配置（从 `.env.example` 复制）：

```bash
EMBED_BASE_URL=https://api-inference.modelscope.cn/v1
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
EMBED_API_KEY=your_embed_api_key
RERANK_BASE_URL=https://api.jina.ai/v1
RERANK_MODEL=jina-reranker-v3
RERANK_API_KEY=your_rerank_api_key
```

未配置 Embedding Key 时，语义检索会回退到 BM25。

## 题材模板

支持 37+ 网文题材，单题材或复合题材（最多 2 个，建议比例 7:3）：
- 玄幻修仙类：修仙、系统流、高武、西幻、无限流、末世
- 都市现代类：都市异能、都市日常、都市脑洞、电竞、直播文
- 言情类：古言、宫斗宅斗、青春甜宠、豪门总裁、种田、年代

## 运维命令

```bash
# 预检（排查 CLI/插件目录/项目根解析问题）
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<WORKSPACE_ROOT>" preflight

# 索引重建
python "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" index process-chapter --chapter 1

# 向量重建
python "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" rag index-chapter --chapter 1

# 健康报告
python "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" status -- --focus all
```

## 参考文档

- 架构详解：`docs/architecture.md`
- 命令详解：`docs/commands.md`
- RAG 与配置：`docs/rag-and-config.md`
- 题材模板：`docs/genres.md`
- 运维与恢复：`docs/operations.md`
