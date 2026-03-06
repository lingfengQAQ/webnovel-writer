# Webnovel Writer

[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-purple.svg)](https://claude.ai/claude-code)
[![OpenCode](https://img.shields.io/badge/OpenCode-Compatible-green.svg)](https://github.com/sst/opencode)

## 项目简单介绍

`Webnovel Writer` 是基于 Claude Code / OpenCode 的长篇网文创作系统，目标是降低 AI 写作中的"遗忘"和"幻觉"，支持长周期连载创作。

详细文档已拆分到 `docs/`：

- 架构与模块：`docs/architecture.md`
- 命令详解：`docs/commands.md`
- RAG 与配置：`docs/rag-and-config.md`
- 题材模板：`docs/genres.md`
- 运维与恢复：`docs/operations.md`
- 文档导航：`docs/README.md`

## 快速开始

### 1) 安装插件

#### Claude Code（官方 Marketplace）

```bash
claude plugin marketplace add lingfengQAQ/webnovel-writer --scope user
claude plugin install webnovel-writer@webnovel-writer-marketplace --scope user
```

> 仅当前项目生效时，将 `--scope user` 改为 `--scope project`。

#### OpenCode

```bash
# Clone the repository
git clone https://github.com/lingfengQAQ/webnovel-writer.git

# Copy skills to OpenCode config directory
cp -r webnovel-writer/webnovel-writer/opencode/skills/* ~/.config/opencode/skills/

# Set environment variable (add to ~/.bashrc or ~/.zshrc)
export OPENCODE_PLUGIN_ROOT="/path/to/webnovel-writer/webnovel-writer/opencode"
```

> 详细说明见 `webnovel-writer/opencode/README.md`。

### 2) 安装 Python 依赖

```bash
python -m pip install -r https://raw.githubusercontent.com/lingfengQAQ/webnovel-writer/HEAD/requirements.txt
```

说明：该入口会同时安装核心写作链路与 Dashboard 依赖。

### 3) 初始化小说项目

在 Claude Code 或 OpenCode 中执行：

```bash
/webnovel-init
```

说明：`/webnovel-init` 会在当前 Workspace 下按书名创建 `PROJECT_ROOT`（子目录），并写入当前项目指针。

### 4) 配置 RAG 环境（必做）

进入初始化后的书项目根目录，创建 `.env`：

```bash
cp .env.example .env
```

最小配置示例：

```bash
EMBED_BASE_URL=https://api-inference.modelscope.cn/v1
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
EMBED_API_KEY=your_embed_api_key

RERANK_BASE_URL=https://api.jina.ai/v1
RERANK_MODEL=jina-reranker-v3
RERANK_API_KEY=your_rerank_api_key
```

### 5) 开始使用

```bash
/webnovel-plan 1
/webnovel-write 1
/webnovel-review 1-5
```

### 6) 启动可视化面板（可选）

```bash
/webnovel-dashboard
```

说明：
- Dashboard 为只读面板（项目状态、实体图谱、章节/大纲浏览、追读力查看）。
- 前端构建产物已随插件发布，使用者无需本地 `npm build`。

### 7) Agent 模型设置（可选）

本项目所有内置 Agent 默认配置为：

```yaml
model: inherit
```

表示子 Agent 继承当前会话所用模型。

如果要单独给某个 Agent 指定模型，编辑对应文件的 frontmatter：

**Claude Code**: `webnovel-writer/agents/*.md`  
**OpenCode**: `webnovel-writer/opencode/agents/*.md`

```yaml
---
name: context-agent
description: ...
tools: Read, Grep, Bash
model: sonnet
---
```

常见可选值：`inherit` / `sonnet` / `opus` / `haiku`（以平台当前支持为准）。

## 更新简介

| 版本 | 说明 |
|------|------|
| **v5.5.1 (当前)** | 新增 OpenCode 兼容层，支持 Claude Code / OpenCode 双平台 |
| **v5.5.0** | 新增只读可视化 Dashboard Skill（`/webnovel-dashboard`）与实时刷新能力；支持插件目录启动与预构建前端分发 |
| **v5.4.4** | 引入官方 Plugin Marketplace 安装机制；统一修复 Skills/Agents/References 的 CLI 调用（`CLAUDE_PLUGIN_ROOT` 单路径，透传命令统一 `--`） |
| **v5.4.3** | 增强智能 RAG 上下文辅助（`auto/graph_hybrid` 回退 BM25） |
| **v5.3** | 引入追读力系统（Hook / Cool-point / 微兑现 / 债务追踪） |

## 开源协议

本项目使用 `GPL v3` 协议，详见 `LICENSE`。

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=lingfengQAQ/webnovel-writer&type=Date)](https://star-history.com/#lingfengQAQ/webnovel-writer&Date)

## 致谢

本项目使用 **Claude Code + Gemini CLI + Codex** 配合 Vibe Coding 方式开发。  
灵感来源：[Linux.do 帖子](https://linux.do/t/topic/1397944/49)

## 贡献

欢迎提交 Issue 和 PR：

```bash
git checkout -b feature/your-feature
git commit -m "feat: add your feature"
git push origin feature/your-feature
```
