# syntax=docker/dockerfile:1
# =============================================================
# P2-A 修复：Webnovel Dashboard - 生产级 Docker 镜像
#
# 构建命令：
#   docker build -t webnovel-dashboard .
#
# 运行命令（最简）：
#   docker run -p 8765:8765 \
#     -v /path/to/your/novel:/project:ro \
#     webnovel-dashboard
#
# 运行命令（生产，含 CORS 和 JSON 日志）：
#   docker run -p 8765:8765 \
#     -v /path/to/your/novel:/project:ro \
#     webnovel-dashboard \
#     --log-json --cors-origin "https://yourdomain.com"
# =============================================================

# ---------- 阶段一：前端构建 ----------
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

# 利用 Docker 层缓存：先复制依赖文件
COPY webnovel-writer/dashboard/frontend/package*.json ./
RUN npm ci --prefer-offline

# 复制源码并构建
COPY webnovel-writer/dashboard/frontend/ ./
RUN npm run build

# ---------- 阶段二：Python 应用 ----------
FROM python:3.12-slim AS runtime

# 设置环境变量
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# 安装系统依赖（最小化）
RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 复制并安装 Python 依赖（生产层）
COPY webnovel-writer/dashboard/requirements.txt ./dashboard-requirements.txt
COPY webnovel-writer/scripts/requirements.txt ./scripts-requirements.txt
RUN pip install -r dashboard-requirements.txt -r scripts-requirements.txt

# 复制应用代码
COPY webnovel-writer/ ./webnovel-writer/

# 复制前端构建产物
COPY --from=frontend-builder /app/frontend/dist ./webnovel-writer/dashboard/frontend/dist

# 创建非 root 用户运行（安全最佳实践）
RUN groupadd --gid 1001 appgroup && \
    useradd --uid 1001 --gid appgroup --shell /sbin/nologin appuser

# 项目挂载点（只读，避免容器内修改小说文件）
VOLUME ["/project"]

# 切换到非 root 用户
USER appuser

# 默认端口
EXPOSE 8765

# 健康检查（使用 P1-F 修复的 /health 端点）
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8765/health')" || exit 1

# 入口点
ENTRYPOINT ["python", "-m", "dashboard.server", \
    "--project-root", "/project", \
    "--host", "0.0.0.0", \
    "--no-browser"]

# 默认参数（可在 docker run 时覆盖）
CMD []
