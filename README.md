# Webnovel Writer

[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/)

基于 Claude Code 的长篇网文辅助创作工具，解决 AI 写作中的"遗忘"和"幻觉"问题，支持 200 万字量级连载。

## 核心特性

| 特性 | 说明 |
|------|------|
| **防幻觉三定律** | 大纲即法律 / 设定即物理 / 发明需识别 |
| **双 Agent 架构** | Context Agent (读) + Data Agent (写) |
| **纯正文写作** | 无需 XML 标签，AI 自动提取实体 |
| **5 维并行审查** | 爽点、一致性、节奏、人设、连贯性 |
| **Strand Weave 节奏** | Quest/Fire/Constellation 三线平衡 |
| **Git 原子备份** | 每章自动提交，支持按章回滚 |

## 快速开始

```bash
# 1. 安装到项目
cd your-novel-project
git clone https://github.com/xxx/webnovel-writer.git .claude

# 2. 初始化项目
/webnovel-init

# 3. 规划大纲
/webnovel-plan 1

# 4. 开始创作
/webnovel-write 1
```

## 命令速查

| 命令 | 说明 |
|------|------|
| `/webnovel-init` | 初始化项目结构 |
| `/webnovel-plan [卷号]` | 生成详细大纲 |
| `/webnovel-write [章号]` | 创作章节 (3000-5000字) |
| `/webnovel-review [范围]` | 质量审查 |
| `/webnovel-query [关键词]` | 检索设定 |
| `/webnovel-resume` | 恢复中断任务 |

## 项目结构

```
your-novel-project/
├── .claude/                    # 插件目录
│   ├── agents/                 # 8 个专职 Agent
│   ├── skills/                 # 6 个 Skill
│   │   ├── webnovel-init/
│   │   ├── webnovel-plan/
│   │   ├── webnovel-write/
│   │   ├── webnovel-review/
│   │   ├── webnovel-query/
│   │   └── webnovel-resume/
│   ├── scripts/                # Python 脚本
│   ├── references/             # 写作指南
│   ├── genres/                 # 题材参考
│   └── templates/              # 题材模板
├── .webnovel/                  # 运行时数据
│   ├── state.json              # 权威状态
│   ├── index.db                # 索引数据库
│   └── vectors.db              # RAG 向量库
├── 正文/                       # 章节文件
├── 大纲/                       # 卷纲/章纲
└── 设定集/                     # 世界观/角色/力量体系
```

## RAG 系统

混合检索系统，支持语义搜索历史场景：

| 组件 | 提供商 | 模型 |
|-----|-------|------|
| Embedding | ModelScope | Qwen/Qwen3-Embedding-8B |
| Rerank | Jina AI | jina-reranker-v3 |

**配置环境变量**：
```bash
export EMBED_API_KEY="your-modelscope-token"
export RERANK_API_KEY="your-jina-api-key"
```

**使用方式**：
- Context Agent 自动调用 RAG 检索相关历史场景
- Data Agent 自动将章节场景向量化存入数据库

## License

GPL v3 - 详见 [LICENSE](LICENSE)

## 致谢

本项目使用 **Claude Code + Gemini CLI + Codex** 配合 Vibe Coding 方式开发。

灵感来源：[Linux.do 帖子](https://linux.do/t/topic/1397944/49)
