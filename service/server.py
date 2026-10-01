# -*- coding: utf-8 -*-
"""服务启动入口。

用法：
    python -m service.server --project-root <书项目根> --port 8770
    python -m service.server --init <目录> --title "书名"   # 先建项目再启动
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def main() -> None:
    parser = argparse.ArgumentParser(description="Webnovel Writer Service")
    parser.add_argument("--project-root", default=None, help="书项目根目录")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址")
    parser.add_argument("--port", type=int, default=8770, help="监听端口")
    parser.add_argument("--reload", action="store_true", help="开发模式热重载")
    parser.add_argument("--init", default=None, help="初始化书项目到此目录后退出")
    parser.add_argument("--title", default="", help="配合 --init 使用的书名")
    args = parser.parse_args()

    from service.config import load_settings
    from service.engine import Engine

    if args.init:
        if not args.title:
            print("ERROR: --init 需要同时提供 --title", file=sys.stderr)
            raise SystemExit(2)
        settings = load_settings(None)
        engine = Engine(settings, project_root=None)
        res = engine.init_project(args.init, args.title)
        print(res.stdout)
        if not res.ok:
            print(res.stderr, file=sys.stderr)
            raise SystemExit(res.returncode or 1)
        print(f"项目已创建: {Path(args.init).resolve()}")
        raise SystemExit(0)

    import uvicorn

    from service.app import create_service_app

    app = create_service_app(args.project_root)
    url = f"http://{args.host}:{args.port}"
    print(f"Webnovel Writer Service: {url}")
    print(f"  写章 API 文档: {url}/docs")
    print(f"  只读面板/上游 API: {url}/api/project/info")
    print(f"  配置接口: {url}/service/config")

    if args.reload:
        uvicorn.run(
            "service.app:create_service_app",
            factory=True,
            host=args.host,
            port=args.port,
            reload=True,
        )
    else:
        uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
