#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from runtime_compat import enable_windows_utf8_stdio

from data_modules.event_log_store import EventLogStore


def main() -> None:
    parser = argparse.ArgumentParser(description="Story events CLI")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--chapter", type=int, default=0)
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--health", action="store_true")
    args = parser.parse_args()

    store = EventLogStore(Path(args.project_root))

    if args.health:
        print(json.dumps(store.health(), ensure_ascii=False))
        return

    if args.chapter:
        print(
            json.dumps(
                {"chapter": args.chapter, "events": store.read_events(args.chapter)},
                ensure_ascii=False,
            )
        )
        return

    print(json.dumps({"events": store.list_recent(limit=args.limit)}, ensure_ascii=False))


if __name__ == "__main__":
    if sys.platform == "win32":
        enable_windows_utf8_stdio()
    main()
