# 命令详解

统一入口：

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py <tool> ...
```

## 核心命令

### 项目与工作区

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py init ./webnovel-project "你的书名" "题材"
python -X utf8 webnovel-writer/scripts/webnovel.py use "<PROJECT_ROOT>" --workspace-root "<WORKSPACE_ROOT>"
python -X utf8 webnovel-writer/scripts/webnovel.py where
```

### 预检与迁移

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT_OR_WORKSPACE_ROOT>" preflight --format json
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT_OR_WORKSPACE_ROOT>" migrate codex --dry-run
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT_OR_WORKSPACE_ROOT>" migrate codex
```

### 内容与状态

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" extract-context --chapter 1 --format text
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" status -- --focus all
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" index -- stats
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" rag -- stats
```

说明：`status/index/rag/workflow` 为透传命令，参数写在 `--` 之后。

### Dashboard

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" dashboard
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" dashboard --port 8765 --no-browser
```

## 常用帮助命令

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py --help
python -X utf8 webnovel-writer/scripts/webnovel.py preflight --help
python -X utf8 webnovel-writer/scripts/webnovel.py workflow -- --help
python -X utf8 webnovel-writer/scripts/webnovel.py init -- --help
```

## 历史 Slash 迁移提示

- 旧 `/webnovel-*` Slash 命令不再作为主文档入口。
- 迁移方式：统一改为 `webnovel.py` CLI；历史 `.claude` 指针仅通过 `migrate codex` 一次性迁移处理。
