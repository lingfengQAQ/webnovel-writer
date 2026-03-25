# Webnovel Writer

[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![Runtime](https://img.shields.io/badge/Runtime-Codex-blue.svg)](#)

`Webnovel Writer` 是面向 Codex 的长篇网文创作系统，目标是降低 AI 写作中的“遗忘”和“幻觉”，支持长周期连载创作。

## 文档导航

- 架构与模块：`docs/architecture.md`
- 命令详解：`docs/commands.md`
- RAG 与配置：`docs/rag-and-config.md`
- 运维与恢复：`docs/operations.md`
- Codex 使用：`docs/codex.md`
- OpenSpec 执行计划：`docs/openspec-execution-plan.md`
- OpenSpec 接口冻结：`docs/openspec-interface-freeze.md`
- 文档索引：`docs/README.md`

## 快速开始

### 1) 安装依赖

```bash
python -m pip install -r requirements.txt
```

### 2) 初始化项目

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py init ./webnovel-project "你的书名" "题材"
```

### 3) 绑定工作区

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py use "<PROJECT_ROOT>" --workspace-root "<WORKSPACE_ROOT>"
```

说明：
- 工作区指针写入：`<WORKSPACE_ROOT>/.codex/.webnovel-current-project`
- 用户级 registry：`~/.codex/webnovel-writer/workspaces.json`

### 4) 运行预检（推荐 JSON）

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT_OR_WORKSPACE_ROOT>" preflight --format json
```

### 5) 常用命令

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py where
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" extract-context --chapter 1 --format text
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" status -- --focus all
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" dashboard
```

## 迁移说明（历史 Claude 痕迹）

- 运行时主链路已统一为 `.codex`。
- 若存在历史 `.claude` 指针，可执行一次性迁移：

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT_OR_WORKSPACE_ROOT>" migrate codex --dry-run
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT_OR_WORKSPACE_ROOT>" migrate codex
```

说明：`.claude` 仅用于迁移读取，不再作为日常运行路径。

## 开源协议

本项目使用 `GPL v3` 协议，详见 `LICENSE`。

## 贡献

欢迎提交 Issue 和 PR：

```bash
git checkout -b feature/your-feature
git commit -m "feat: add your feature"
git push origin feature/your-feature
```
