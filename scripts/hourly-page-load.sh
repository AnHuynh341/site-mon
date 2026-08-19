#!/usr/bin/env bash

set -u

URL="https://anhuynh341.github.io/briansmediaserver/"
LOG="$HOME/repos/site-mon/logs/page-load-probe.log"

CHROMIUM="/usr/bin/chromium-browser"

mkdir -p "$(dirname "$LOG")"

timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}


# ------------------------------------------------------------
# Browser page-load probe
# ------------------------------------------------------------

if [[ ! -x "$CHROMIUM" ]]; then
    printf '%s | browser-probe | FAILED | chromium-browser not found\n' \
        "$(timestamp)" \
        >> "$LOG"

    exit 1
fi

PROFILE_DIR=$(mktemp -d)

cleanup() {
    rm -rf "$PROFILE_DIR"
}

trap cleanup EXIT

START_MS=$(date +%s%3N)

if timeout 45s "$CHROMIUM" \
    --headless=new \
    --disable-gpu \
    --disable-dev-shm-usage \
    --no-first-run \
    --no-default-browser-check \
    --user-data-dir="$PROFILE_DIR" \
    --virtual-time-budget=10000 \
    --dump-dom \
    "$URL" \
    >/dev/null 2>&1
then
    END_MS=$(date +%s%3N)
    DURATION_MS=$((END_MS - START_MS))

    printf '%s | browser-probe | OK | %dms\n' \
        "$(timestamp)" \
        "$DURATION_MS" \
        >> "$LOG"

    exit 0
else
    EXIT_CODE=$?

    END_MS=$(date +%s%3N)
    DURATION_MS=$((END_MS - START_MS))

    printf '%s | browser-probe | FAILED | exit=%d | %dms\n' \
        "$(timestamp)" \
        "$EXIT_CODE" \
        "$DURATION_MS" \
        >> "$LOG"

    exit "$EXIT_CODE"
fi
