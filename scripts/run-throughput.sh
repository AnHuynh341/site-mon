#!/usr/bin/env bash
set -u
set -o pipefail

BASE_DIR="$HOME/repos/site-mon"
LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/w41it-throughput.lock"
LOG_FILE="$BASE_DIR/logs/throughput.log"

mkdir -p "$BASE_DIR/logs"

exec 9>"$LOCK_FILE"

if ! flock -n 9; then
    exit 0
fi

run_probe() {
    local kind="$1"

    if ! python3 \
        "$BASE_DIR/scripts/${kind}-throughput.py"
    then
        printf '%s | %s-throughput | FAILED | probe script error\n' \
            "$(date '+%Y-%m-%d %H:%M:%S')" \
            "$kind"
    fi
}

{
    run_probe video &
    video_pid=$!

    run_probe audio &
    audio_pid=$!

    wait "$video_pid"
    wait "$audio_pid"
} >> "$LOG_FILE" 2>&1
