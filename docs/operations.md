# 项目结构与运维

## 目录层级（当前实现）

当前运行链路使用 3 层概念：

1. `WORKSPACE_ROOT`（工作区根，常见来自 `${CODEX_PROJECT_DIR}` 或当前目录）
2. `WORKSPACE_ROOT/.codex/`（主指针目录，当前实现仍兼容读取 `.claude/`）
3. `PROJECT_ROOT`（真实小说项目根，必须包含 `.webnovel/state.json`）

### A) Workspace 目录（含指针）

```text
workspace-root/
├── .codex/
│   └── .webnovel-current-project
├── .claude/                         # 兼容读取（未完全移除）
│   └── .webnovel-current-project
├── 小说A/
└── 小说B/
```

### B) 小说项目目录（`PROJECT_ROOT`）

```text
project-root/
├── .webnovel/
│   ├── state.json
│   ├── logs/skill-audit.jsonl
│   ├── skills/registry.json
│   ├── dictionaries/setting-dictionary.json
│   ├── outlines/split-map.json
│   ├── outlines/detailed-segments.jsonl
│   ├── edits/assist-log.jsonl
│   └── migrations/codex-migrate-*.json
├── 正文/
├── 大纲/细纲.md
└── 设定集/
```

## 安装部署

### Python 依赖安装

```bash
python -m pip install -r requirements.txt
```

`requirements.txt` 会引入：

1. `webnovel-writer/scripts/requirements.txt`
2. `webnovel-writer/dashboard/requirements.txt`

### Dashboard 前端构建

```bash
cd webnovel-writer/dashboard/frontend
npm install
npm run build
```

## 启停方式

### 运行预检

```bash
python webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT_OR_WORKSPACE_ROOT>" preflight --format json
```

### 启动 Dashboard

```bash
python webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" dashboard --host 127.0.0.1 --port 8765
```

可选参数：

1. `--no-browser`：不自动打开浏览器
2. `--no-bootstrap-index`：不自动初始化缺失的 `index.db`

停止方式：前台进程 `Ctrl+C`。

## 日常操作

### 统一 CLI 常用命令

```bash
python webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" where
python webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" status -- --focus all
python webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" index -- stats
python webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" rag -- stats
```

### Runtime 迁移

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT_OR_WORKSPACE_ROOT>" migrate codex --dry-run
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT_OR_WORKSPACE_ROOT>" migrate codex
```

### Skills 管理（当前已落地 CLI）

```bash
python webnovel-writer/scripts/data_modules/skill_manager.py --project-root "<PROJECT_ROOT>" list
python webnovel-writer/scripts/data_modules/skill_manager.py --project-root "<PROJECT_ROOT>" add --id outline.splitter --name "Outline Splitter" --desc "split helper"
python webnovel-writer/scripts/data_modules/skill_manager.py --project-root "<PROJECT_ROOT>" enable --id outline.splitter
python webnovel-writer/scripts/data_modules/skill_manager.py --project-root "<PROJECT_ROOT>" audit --limit 20
```

### 备份与归档/恢复

```bash
python webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" backup -- --list
python webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" backup -- --rollback 12
python webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" archive -- --stats
python webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" archive -- --restore-character "<角色名>"
```

## 日志与数据文件

| 文件 | 说明 |
|---|---|
| `.webnovel/logs/skill-audit.jsonl` | Skills 操作审计日志 |
| `.webnovel/dictionaries/setting-dictionary.json` | 设定词典与冲突状态 |
| `.webnovel/outlines/split-map.json` | 拆分/重拆映射、历史与幂等键 |
| `.webnovel/outlines/detailed-segments.jsonl` | 细纲片段流水 |
| `.webnovel/edits/assist-log.jsonl` | 协助修改 preview/apply 日志 |
| `.webnovel/migrations/codex-migrate-*.json` | 运行时迁移报告 |

## 常见排障

| 现象 | 排查点 |
|---|---|
| `403`（workspace 不匹配） | 检查请求中的 `workspace_id` 与 `project_root` 是否对应当前工作区 |
| `409 OUTLINE_*_LOCK_TIMEOUT` | 存在并发写冲突，稍后重试并检查是否有并行拆分/重拆任务 |
| `409 EDIT_ASSIST_SELECTION_VERSION_CONFLICT` | 文件版本已变化，先重新 preview 再 apply |
| `501 EDIT_ASSIST_UNAVAILABLE` | 编辑协助 provider 当前不可用，接口会拒绝写入并返回 501 |
| 设定页显示 mock 模式 | 非生产模式下 `settings.js` 默认允许 mock fallback，可通过全局开关关闭 |

### 测试入口

```bash
pwsh "./webnovel-writer/scripts/run_tests.ps1" -Mode smoke
pwsh "./webnovel-writer/scripts/run_tests.ps1" -Mode full
python -m pytest webnovel-writer/dashboard/tests -q
```

## 无法确认

1. 当前仓库未提供 `split/resplit` p95 性能实测报告，无法确认是否满足 `<=10s`。
