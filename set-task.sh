#!/usr/bin/env bash
# Usage: ./set-task.sh "task text" minutes
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: $0 \"task text\" minutes" >&2; exit 1; }
cd "$(dirname "$0")"
task=${1//\\/\\\\}; task=${task//\"/\\\"}
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{ "task": "%s", "minutes": %d, "set_at": "%s" }\n' "$task" "$2" "$now" > task.json
git add task.json
git commit -qm "task: $1 ($2m)"
git push -q
echo "set: $1 — $2 min — $now"
