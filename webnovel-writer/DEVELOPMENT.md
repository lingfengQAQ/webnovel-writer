# Webnovel Writer Dashboard - 开发文档

## 技术栈

- **后端**：FastAPI + uvicorn + watchdog + SQLite
- **前端**：React 19 + Vite 6 + react-force-graph-3d
- **Python**：>= 3.10（使用 `X | Y` union 类型语法）

---

## 启动方式

```bash
# 激活虚拟环境
.venv\Scripts\activate

# 启动 Dashboard（自动检测项目路径）
python -m dashboard.server

# 指定项目路径启动
python -m dashboard.server --project-root D:\path\to\novel-project

# 生产部署（指定 CORS 来源）
python -m dashboard.server --project-root /path/to/project --cors-origin "https://yourdomain.com"

# 不自动打开浏览器
python -m dashboard.server --no-browser
```

### 前端构建

```bash
cd dashboard/frontend
npm install
npm run build          # ✅ 跨平台（vite build）
npm run build:ps       # Windows 专用 PowerShell 脚本（可选）
```

---

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `WEBNOVEL_PROJECT_ROOT` | 项目根目录路径 | 无 |

---

## API 接口

| 端点 | 方法 | 描述 |
|------|------|------|
| `/health` | GET | 健康检查（始终 200，无依赖） |
| `/api/project/root` | GET | 项目状态检查 |
| `/api/project/info` | GET | state.json 内容 |
| `/api/entities` | GET | 实体列表 |
| `/api/relationships` | GET | 关系列表 |
| `/api/chapters` | GET | 章节列表 |
| `/api/scenes` | GET | 场景列表 |
| `/api/graph` | GET | 关系图谱数据 |
| `/api/dashboard/overview` | GET | 总览统计 |
| `/api/files/tree` | GET | 文件树（正文/大纲/设定集） |
| `/api/files/read` | GET | 读取文件内容（只读） |
| `/api/events` | GET | SSE 实时推送 |
| `/api/skills` | GET/POST/PATCH/DELETE | 技能管理 |
| `/api/settings/files/tree` | GET | 设定集文件树 |
| `/api/settings/dictionary` | GET/POST | 词典管理 |
| `/api/outlines` | GET | 大纲数据 |
| `/api/runtime/profile` | GET | Runtime 状态 |

---

## 变更历史

### 2026-03-26 - 第一阶段商业级安全修复

**P0-A：修复 CORS 全开放安全漏洞**
- `dashboard/app.py`：`create_app()` 新增 `allowed_origins` 参数，不再硬编码 `"*"`
- `dashboard/server.py`：新增 `--cors-origin` CLI 参数，默认为 `http://localhost:{port}`
- 生产部署时应通过 `--cors-origin` 明确指定允许的来源

**P0-B：`_project_root` 改用 `app.state` 传递**
- 移除模块级全局变量 `_project_root`
- 所有路由通过 `app.state.project_root` 访问（线程安全，多 worker 友好）
- `dashboard/routers/skills.py`：消除通过 `sys.modules` 反射读取私有变量的脆弱实现

**P0-C：`_walk_tree` 添加递归深度限制**
- `dashboard/app.py`：`_walk_tree()` 新增 `max_depth=20` 参数
- 超出深度时截断并标记 `"truncated": true`，防止 `RecursionError`

**P0-D：`subprocess.run` 添加超时保护**
- `dashboard/server.py`：`_bootstrap_index_if_needed()` 中添加 `timeout=30`
- 捕获 `subprocess.TimeoutExpired`，超时后打印 WARNING 并继续启动

**P1-B：修复 npm build 仅限 Windows 的问题**
- `dashboard/frontend/package.json`：`build` 脚本改为 `vite build`（跨平台）
- 原 PowerShell 脚本保留为 `build:ps`（Windows 专用可选脚本）

**P1-F：添加 `/health` 健康检查端点**
- `dashboard/app.py`：新增 `GET /health`，始终返回 `{"status": "ok", "version": "0.1.0"}`
- 无需项目根目录即可响应，适用于 Docker/Kubernetes 存活探针

### 2026-03-26 - 第二阶段商业级稳定性修复

**P1-A：测试 / 生产依赖分离**
- `scripts/requirements.txt`：只保留生产依赖（aiohttp, filelock, pydantic）
- 新建 `scripts/requirements-dev.txt`：测试依赖（pytest, pytest-cov, pytest-asyncio 等）
- 新建 `dashboard/requirements-dev.txt`：Dashboard 开发依赖（包含 httpx 用于集成测试）

**P1-C：SSE 连接数限制（DoS 防护）**
- `dashboard/watcher.py`：`FileWatcher.subscribe()` 新增 `max_clients` 参数（默认 50）
  - 添加 `subscriber_count` 属性
  - 超限时返回 `None` 而非直接创建队列
- `dashboard/app.py`：SSE 端点 `/api/events` 检查连接数，超限返回 503

**P1-E：补充关键路径测试**
- 新建 `dashboard/tests/test_phase2_coverage.py`（**8 个测试，全部通过**）
  - `/health` 端点（含无项目根目录场景）
  - CORS 来源允许/拒绝
  - `_walk_tree()` 递归截断
  - SSE 连接数限制和 `subscriber_count`

**P1-G：React ErrorBoundary（防白屏崩溃）**
- 新建 `dashboard/frontend/src/components/ErrorBoundary.jsx`
  - 捕获子组件运行时错误，展示友好错误页面
  - 提供"重试当前页面"和"刷新整页"操作
  - 使用 `key={routeId}` 自动随路由切换重置状态
- `dashboard/frontend/src/App.jsx`：`<ActivePage />` 外包裹 `<ErrorBoundary>`
- `dashboard/frontend/src/index.css`：添加配套样式

**P2-C：结构化日志（替代 print）**
- 新建 `dashboard/logging_config.py`：
  - `setup_logging(level, json_output)` — 初始化 logger
  - `_JsonFormatter` — JSON 格式化器（适合生产日志收集）
  - `get_logger(name)` — 获取命名 logger
- `dashboard/server.py`：集成日志，新增 CLI 参数：
  - `--log-level DEBUG|INFO|WARNING|ERROR`（默认 INFO）
  - `--log-json`（生产环境建议启用）
  - uvicorn 日志级别随 `--log-level` 联动

### 2026-03-26 - 第三阶段持续改进

**P2-A：Docker 和生产部署支持**
- 新建 `Dockerfile`（根目录）：多阶段构建，阶段一 Node.js 构建前端，阶段二 Python 运行时
  - 非 root 用户运行（UID 1001）
  - 只读卷挂载设计，PROJECT_ROOT 挂载于 `/project`
  - `HEALTHCHECK` 使用 `/health` 端点（30s 间隔）
- 新建 `docker-compose.yml`（根目录）：含环境变量配置、资源限制（512m 内存）、健康检查

**P2-E：SVG 图标替换（专业视觉）**
- `dashboard/frontend/src/App.jsx`：所有 9 个导航项从字母占位符改为内联 SVG 图标（Lucide 风格）
  - 图标含 `aria-hidden="true"`，无障碍友好
  - 按钮添加 `title` 和 `aria-current` 属性

**P3-A：品牌标题国际化**
- `dashboard/frontend/src/App.jsx`：sidebar 标题从 `PIXEL WRITER HUB` / `Frontend Dashboard` 改为 `网文创作台` / `Webnovel Dashboard`

**P3-B/C：README.md 全面完善**
- `README.md`（根目录，**重写**）：
  - 添加 Python ≥ 3.10 / Node.js ≥ 18 环境要求（使用 GitHub 告警块）
  - 添加 `--host 0.0.0.0` 局域网访问说明和安全警告
  - 添加 Docker / Docker Compose 完整部署步骤
  - 添加安全注意事项（无认证层警告、只读卷、JSON 日志）
  - 更新依赖安装命令（含 dev 分离）

**P3-D：前端 ErrorBoundary 测试**
- 新建 `dashboard/frontend/src/components/ErrorBoundary.test.jsx`（**4 个测试，全部通过**）
  - 正常渲染、错误捕获、空 message 回退、重试按钮
  - 同时修复了 ErrorBoundary.jsx 中空字符串 message 无法触发"发生未知错误"的 bug

---

## 安装命令参考

```bash
# 生产环境
pip install -r dashboard/requirements.txt
pip install -r scripts/requirements.txt

# 开发和测试环境（额外安装）
pip install -r dashboard/requirements-dev.txt
pip install -r scripts/requirements-dev.txt
```
