#!/usr/bin/env bash
set -euo pipefail

raw=$(cat)
if [ -z "${raw// /}" ]; then
  exit 0
fi

plugin_data="${CLAUDE_PLUGIN_DATA:-}"
if [ -z "$plugin_data" ]; then
  plugin_root="${CLAUDE_PLUGIN_ROOT:-}"
  if [ -z "$plugin_root" ]; then
    exit 0
  fi
  plugin_data="$plugin_root/.tmp_plugin_data"
fi

log_dir="$plugin_data/logs"
mkdir -p "$log_dir"

event_name=$(echo "$raw" | jq -r '.hook_event_name // "unknown"')

if [ "$event_name" = "unknown" ]; then
  json=$(jq -n \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg raw "$raw" \
    '{observed_at: $at, event: "invalid_json", raw: $raw}')
else
  json=$(echo "$raw" | jq -c \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg ev "$event_name" \
    '{observed_at: $at, event: $ev, session_id: .session_id, cwd: .cwd, transcript_path: .transcript_path, payload: .}')
fi

echo "$json" >> "$log_dir/hook-events.jsonl"
echo "$json" >> "$log_dir/$event_name.jsonl"
