# Webnovel Writer

[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![Runtime](https://img.shields.io/badge/Runtime-Codex-blue.svg)](#)

`Webnovel Writer` 是面向 Codex 的长篇网文创作系统，目标是降低 AI 写作中的"遗忘"和"幻觉"，支持长周期连载创作。

## 环境要求

> [!IMPORTANT]
> - **Python ≥ 3.10**（使用 `X | Y` union 类型语法，低版本会抛 SyntaxError）
> - **Node.js ≥ 18**（仅在本地构建前端时需要）
> - Windows / macOS / Linux 均支持

## 文档导航

- 架构与模块：`docs/architecture.md`
- 命令详解：`docs/commands.md`
- RAG 与配置：`docs/rag-and-config.md`
- 运维与恢复：`docs/operations.md`
- Codex 使用：`docs/codex.md`
- Dashboard 开发：`webnovel-writer/DEVELOPMENT.md`

## 快速开始

### 1) 安装依赖

```bash
# 生产依赖
pip install -r webnovel-writer/dashboard/requirements.txt
pip install -r webnovel-writer/scripts/requirements.txt

# 开发 / 测试依赖（额外安装）
pip install -r webnovel-writer/dashboard/requirements-dev.txt
pip install -r webnovel-writer/scripts/requirements-dev.txt
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
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" preflight --format json
```

### 5) 常用命令

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py where
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" extract-context --chapter 1 --format text
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" status -- --focus all
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" dashboard
```

## 启动 Dashboard

### 本地开发（仅本机访问）

```bash
python -m dashboard.server --project-root /path/to/your/novel
```

Dashboard 将监听 `127.0.0.1:8765`（默认仅本机可访问）。

### 局域网访问

> [!WARNING]
> 监听 `0.0.0.0` 会使服务对局域网所有设备可见。请确保在受信任的内网环境中使用，并配置 CORS 来源。

```bash
python -m dashboard.server \
  --project-root /path/to/novel \
  --host 0.0.0.0 \
  --cors-origin "http://192.168.1.100:8765"
```

### Docker 部署（推荐生产）

```bash
# 构建镜像
docker build -t webnovel-dashboard .

# 运行（将 /path/to/novel 替换为你的项目路径）
docker run -d \
  --name webnovel-dashboard \
  -p 8765:8765 \
  -v /path/to/novel:/project:ro \
  webnovel-dashboard \
  --log-json \
  --cors-origin "http://localhost:8765"
```

或使用 Docker Compose：

```bash
NOVEL_PROJECT_PATH=/path/to/novel docker compose up -d
docker compose logs -f
```

## 安全注意事项

> [!CAUTION]
> 当前 Dashboard 无内置认证层，请勿将其直接暴露于公网。如需公网部署，应在前置 Nginx/Caddy 等反向代理上添加 Basic Auth 或 OAuth2 认证。

- 生产环境必须通过 `--cors-origin` 指定精确来源，禁用 CORS 全开放
- 使用 Docker 时建议以只读卷挂载（`:ro`）防止容器意外修改小说文件
- 推荐使用 `--log-json` 输出结构化日志，对接日志收集系统（如 Loki、Datadog）

## 迁移说明（历史 Claude 痕迹）

- 运行时主链路已统一为 `.codex`。
- 若存在历史 `.claude` 指针，可执行一次性迁移：

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" migrate codex --dry-run
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<PROJECT_ROOT>" migrate codex
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
