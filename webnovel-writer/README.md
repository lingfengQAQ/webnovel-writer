# Webnovel Writer（插件源目录）

长篇网文创作插件的 Claude Code 安装包。完整介绍、安装方式与文档导航见仓库根目录的 [README](../README.md)。

> 本文件面向「拿到插件包」的使用者与维护者，列出包内组件与最小验证方式。

## 包内组件

| 类型 | 数量 | 位置 |
|------|------|------|
| Skills（斜杠命令） | 7 | `skills/<name>/SKILL.md` |
| Agents（子代理） | 4 | `agents/*.md` |
| Python 工具 | 统一入口 | `scripts/webnovel.py` |
| 题材/写法数据 | 9 CSV | `references/csv/*.csv` |
| 题材模板 | 按题材 | `templates/genres/*.md` |
| Dashboard 前端 | 预打包 | `dashboard/frontend/dist/`（随包发布，无需本地构建） |
| DeepSeek Writer | 本地客户端 | `writer/`（FastAPI 编排、草稿、缓存和受控定稿） |

### 7 个 Skill

| 命令 | 用途 |
|------|------|
| `/webnovel-init` | 深度初始化项目骨架、设定集、总纲 |
| `/webnovel-plan` | 拆卷纲、时间线、章纲，并写回新增设定 |
| `/webnovel-write` | 一条龙写章：上下文 → 起草 → 审查 → 润色 → 提交 → 备份 |
| `/webnovel-review` | 多维度审查章节并把指标落库 |
| `/webnovel-query` | 查询设定、角色、伏笔、运行时信息（只读） |
| `/webnovel-learn` | 把有效写法沉淀进项目长期记忆 |
| `/webnovel-dashboard` | 启动只读可视化面板 |

### 4 个 Agent

| Agent | 职责 | 被谁调用 |
|-------|------|---------|
| `context-agent` | 写前 research，输出写作任务书 | `/webnovel-write` Step 1 |
| `reviewer` | 逐维度事实审查 | `/webnovel-write` Step 3、`/webnovel-review` |
| `data-agent` | 从正文提取事实，生成 commit artifacts | `/webnovel-write` Step 5 |
| `deconstruction-agent` | 参考书拆解，提炼可迁移写法 | `/webnovel-init` Step 1.5 |

## 依赖与安装

通过 Claude Code Marketplace 安装（推荐）：

```bash
claude plugin marketplace add lingfengQAQ/webnovel-writer --scope user
claude plugin install webnovel-writer@webnovel-writer-marketplace --scope user
```

Python 依赖：

```bash
python -m pip install -r scripts/requirements.txt
```

RAG 检索需在书项目根目录配置 `.env`（缺失时自动退回 BM25 关键词检索）。详见 [RAG 与配置](../docs/guides/rag-and-config.md)。

## 最小验证

启动 DeepSeek 写作客户端：

```bash
python -X utf8 scripts/webnovel.py --project-root "<书项目根目录>" client
```

Writer Client 会复用现有 runtime；原 Dashboard 继续保持只读。

```bash
# 路径 / 项目根 / Story System 健康预检
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" preflight

# 提示词与数据链测试
python -m pytest -q --no-cov
```

> clean-room 安装验证建议用 `git archive` 或干净克隆，避免把本地 `node_modules/`、`__pycache__/`、`.coverage` 等开发产物带进 `--plugin-dir` 测试。

## 协议

[GPL-3.0](LICENSE)。完整文档导航见根目录 [README](../README.md) 与 [docs/](../docs/README.md)。
