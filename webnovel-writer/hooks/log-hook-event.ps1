$ErrorActionPreference = "Stop"

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) {
    exit 0
}

$pluginData = $env:CLAUDE_PLUGIN_DATA
if ([string]::IsNullOrWhiteSpace($pluginData)) {
    $pluginRoot = $env:CLAUDE_PLUGIN_ROOT
    if ([string]::IsNullOrWhiteSpace($pluginRoot)) {
        exit 0
    }
    $pluginData = Join-Path $pluginRoot ".tmp_plugin_data"
}

$logDir = Join-Path $pluginData "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$payload = $null
try {
    $payload = $raw | ConvertFrom-Json -Depth 100
} catch {
    $payload = $null
}

if ($null -ne $payload) {
    $eventName = [string]$payload.hook_event_name
    if ([string]::IsNullOrWhiteSpace($eventName)) {
        $eventName = "unknown"
    }

    $record = [ordered]@{
        observed_at = (Get-Date).ToString("o")
        event = $eventName
        session_id = [string]$payload.session_id
        cwd = [string]$payload.cwd
        transcript_path = [string]$payload.transcript_path
        payload = $payload
    }
} else {
    $record = [ordered]@{
        observed_at = (Get-Date).ToString("o")
        event = "invalid_json"
        raw = $raw
    }
    $eventName = "invalid_json"
}

$json = $record | ConvertTo-Json -Depth 100 -Compress
Add-Content -LiteralPath (Join-Path $logDir "hook-events.jsonl") -Value $json
Add-Content -LiteralPath (Join-Path $logDir ("{0}.jsonl" -f $eventName)) -Value $json
