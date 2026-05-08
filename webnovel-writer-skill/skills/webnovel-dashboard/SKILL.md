---
name: webnovel-dashboard
description: 启动只读小说管理面板，查看项目状态、实体图谱与章节内容。
allowed-tools: Bash Read
---

# Webnovel Dashboard

## 目标

- 在本地启动只读 Web 面板。
- 实时查看创作进度、设定词典、关系图谱、章节内容与追读力数据。
- 显式查看 Story Runtime 主链状态，包括 `story-runtime/health`、latest commit 与 fallback 情况。
- 允许监听 `.webnovel/` 变化，但不得修改项目内容。

## 执行流程

### Step 1：确认环境与模块目录

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"

if [ -z "${CLAUDE_PLUGIN_ROOT}" ] || [ ! -d "${CLAUDE_PLUGIN_ROOT}/dashboard" ]; then
  echo "ERROR: 未找到 dashboard 模块: ${CLAUDE_PLUGIN_ROOT}/dashboard" >&2
  exit 1
fi

export DASHBOARD_DIR="${CLAUDE_PLUGIN_ROOT}/dashboard"
```

### Step 2：安装依赖并解析项目根目录

```bash
python -m pip install -r "${DASHBOARD_DIR}/requirements.txt" --quiet
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
export PROJECT_ROOT="$(python "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"
echo "项目路径: ${PROJECT_ROOT}"
```

补充要求：
- `PROJECT_ROOT` 必须解析成功
- 若依赖已安装，可重复执行，不视为错误

### Step 3：准备 Python 模块路径并校验前端产物

```bash
if [ -n "${PYTHONPATH:-}" ]; then
  export PYTHONPATH="${CLAUDE_PLUGIN_ROOT}:${PYTHONPATH}"
else
  export PYTHONPATH="${CLAUDE_PLUGIN_ROOT}"
fi

if [ ! -f "${DASHBOARD_DIR}/frontend/dist/index.html" ]; then
  echo "ERROR: 缺少前端构建产物 ${DASHBOARD_DIR}/frontend/dist/index.html" >&2
  exit 1
fi
```

### Step 4：启动 Dashboard

```bash
python -m dashboard.server --project-root "${PROJECT_ROOT}"
```

如不需要自动打开浏览器：

```bash
python -m dashboard.server --project-root "${PROJECT_ROOT}" --no-browser
```

启动后优先确认以下接口可用：
- `/api/story-runtime/health`
- `/api/preflight`

## 注意事项

- Dashboard 为纯只读面板，不提供修改接口。
- 文件读取必须限制在 `PROJECT_ROOT` 范围内。
- 如需自定义端口，使用 `--port 9000`。

## 成功标准

- Dashboard 进程已启动且输出了可访问的 URL
- 浏览器可正常打开页面（或 `--no-browser` 模式下 URL 可手动访问）
- 页面显示项目数据（章节列表、实体图谱等）

## 失败恢复

| 故障 | 恢复方式 |
|------|---------|
| 依赖安装失败 | 检查 Python 版本和网络，手动 `pip install -r requirements.txt` |
| 前端 `dist/` 缺失 | 确认插件完整安装，dist 应随插件打包 |
| 项目根解析失败 | 检查 `.webnovel/state.json` 是否存在，确认 `WORKSPACE_ROOT` 正确 |
| 端口占用 | 使用 `--port <其他端口>` 或关闭占用进程 |
| 页面空白/数据缺失 | 确认 `.webnovel/` 下有 state.json、index.db 等数据文件 |

## 安全边界

- 只读操作，不修改任何项目文件
- 文件访问限制在 `PROJECT_ROOT` 范围内
- 不暴露外部网络（默认 localhost）
