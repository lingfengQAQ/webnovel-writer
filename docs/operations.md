# 项目结构与运维

## 目录层级（Codex 主链路）

当前运行链路使用 3 层概念：

1. `WORKSPACE_ROOT`（工作区根，常见来自 `${CODEX_PROJECT_DIR}` 或当前目录）
2. `WORKSPACE_ROOT/.codex/`（工作区指针与配置）
3. `PROJECT_ROOT`（真实小说项目根，包含 `.webnovel/state.json`）

### A) Workspace 目录（含指针）

```text
workspace-root/
├── .codex/
│   ├── .webnovel-current-project   # 指向当前小说项目根
│   └── settings.json
├── 小说A/
├── 小说B/
└── ...
```

### B) 小说项目目录（`PROJECT_ROOT`）

```text
project-root/
├── .webnovel/            # 运行时数据（state/index/vectors/summaries）
├── 正文/                  # 正文章节
├── 大纲/                  # 总纲与卷纲
└── 设定集/                # 世界观、角色、力量体系
```

## 用户级全局映射（兜底）

当工作区没有可用指针时，会使用用户级 registry 做 `workspace -> current_project_root` 映射：

```text
${WEBNOVEL_HOME:-${CODEX_HOME:-~/.codex}}/webnovel-writer/workspaces.json
```

## 常用运维命令

统一前置（手动 CLI 场景）：

```bash
export WORKSPACE_ROOT="${CODEX_PROJECT_DIR:-$PWD}"
export SCRIPTS_DIR="${SCRIPTS_DIR:-./webnovel-writer/scripts}"
export PROJECT_ROOT="$(python "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"
```

### 运行预检

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" preflight --format json
```

### 索引重建

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" index -- process-chapter --chapter 1
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" index -- stats
```

### 健康报告

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" status -- --focus all
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" status -- --focus urgency
```

### 向量重建

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" rag -- index-chapter --chapter 1
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" rag -- stats
```

### Dashboard 启动

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" dashboard --port 8765
```

### 测试入口

```bash
pwsh "./webnovel-writer/scripts/run_tests.ps1" -Mode smoke
pwsh "./webnovel-writer/scripts/run_tests.ps1" -Mode full
```

## 历史迁移说明

- 历史 `.claude` 路径不再作为运行主链路。
- 若旧工作区仍保留 `.claude` 指针，可执行：

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT_OR_WORKSPACE_ROOT>" migrate codex --dry-run
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT_OR_WORKSPACE_ROOT>" migrate codex
```
