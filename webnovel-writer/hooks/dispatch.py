import sys
import os
import json
import subprocess
from datetime import datetime, timezone

raw = sys.stdin.read()
if not raw.strip():
    sys.exit(0)

plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT", "")
hooks_dir = os.path.join(plugin_root, "hooks")

if sys.platform == "win32":
    script = os.path.join(hooks_dir, "log-hook-event.ps1")
    result = subprocess.run(
        ["powershell", "-File", script],
        input=raw,
        text=True,
    )
    sys.exit(result.returncode)

# macOS / Linux
plugin_data = os.environ.get("CLAUDE_PLUGIN_DATA", "")
if not plugin_data:
    if not plugin_root:
        sys.exit(0)
    plugin_data = os.path.join(plugin_root, ".tmp_plugin_data")

log_dir = os.path.join(plugin_data, "logs")
os.makedirs(log_dir, exist_ok=True)

try:
    payload = json.loads(raw)
    event_name = payload.get("hook_event_name") or "unknown"
    record = {
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "event": event_name,
        "session_id": payload.get("session_id", ""),
        "cwd": payload.get("cwd", ""),
        "transcript_path": payload.get("transcript_path", ""),
        "payload": payload,
    }
except json.JSONDecodeError:
    event_name = "invalid_json"
    record = {
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "event": event_name,
        "raw": raw,
    }

line = json.dumps(record, ensure_ascii=False)
for path in [
    os.path.join(log_dir, "hook-events.jsonl"),
    os.path.join(log_dir, f"{event_name}.jsonl"),
]:
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + "\n")
