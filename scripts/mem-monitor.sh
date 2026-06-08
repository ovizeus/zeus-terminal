#!/usr/bin/env bash
# [T2-2 2026-06-08] Zero-risk RSS growth monitor — logs the zeus node RSS so a
# real (slow) leak can be confirmed/located with evidence before any code fix.
PID=$(pgrep -f "node.*server.js" | head -1)
[ -z "$PID" ] && exit 0
RSS=$(ps -o rss= -p "$PID" 2>/dev/null | tr -d ' ')
ET=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ')
echo "$(date -u '+%Y-%m-%d %H:%M:%S') rss_mb=$((RSS/1024)) uptime_min=$((ET/60)) pid=$PID" >> /root/zeus-terminal/data/logs/mem-monitor.log
