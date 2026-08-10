from __future__ import annotations

import argparse
import webbrowser
from pathlib import Path


def serve(project_root: str | Path, *, host: str = "127.0.0.1", port: int = 8765, no_browser: bool = False) -> None:
    if host not in {"127.0.0.1", "localhost"}:
        raise ValueError("Writer 客户端只允许监听本机回环地址")
    import uvicorn

    from .app import create_writer_app

    root = Path(project_root).expanduser().resolve()
    app = create_writer_app(root)
    url = f"http://{host}:{port}/writer"
    print(f"Webnovel Writer Client: {url}")
    print(f"Project: {root}")
    if not no_browser:
        webbrowser.open(url)
    uvicorn.run(app, host=host, port=port, log_level="info")


def main() -> None:
    parser = argparse.ArgumentParser(description="Webnovel Writer Client")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    serve(args.project_root, host=args.host, port=args.port, no_browser=args.no_browser)


if __name__ == "__main__":
    main()
