#!/usr/bin/env bash

set -u

URL="https://anhuynh341.github.io/briansmediaserver/"
LOG="$HOME/repos/site-mon/logs/page-load-probe.log"
THROUGHPUT_LOG="$HOME/repos/site-mon/logs/video-throughput.log"
THROUGHPUT_SCRIPT="$HOME/repos/site-mon/scripts/video-throughput.py"

CHROMIUM="/usr/bin/chromium-browser"

mkdir -p "$(dirname "$LOG")"

timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}


# ------------------------------------------------------------
# Browser page-load probe
# ------------------------------------------------------------

BROWSER_EXIT=0

if [[ ! -x "$CHROMIUM" ]]; then
    printf '%s | browser-probe | FAILED | chromium-browser not found\n' \
        "$(timestamp)" \
        >> "$LOG"

    BROWSER_EXIT=1
else
    # Give every probe its own temporary browser profile. This avoids
    # Chromium profile-lock problems if another Chromium process exists.
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
    else
        BROWSER_EXIT=$?

        END_MS=$(date +%s%3N)
        DURATION_MS=$((END_MS - START_MS))

        printf '%s | browser-probe | FAILED | exit=%d | %dms\n' \
            "$(timestamp)" \
            "$BROWSER_EXIT" \
            "$DURATION_MS" \
            >> "$LOG"
    fi
fi


# ------------------------------------------------------------
# Hourly sustained video throughput probe
#
# This intentionally uses a much larger range than the five-minute
# latency checks. A Worker/R2 path can return the first 128 KiB quickly
# while the rest of a video arrives at dial-up speed; this catches that.
# ------------------------------------------------------------

if [[ -f "$THROUGHPUT_SCRIPT" ]]; then
    if ! python3 "$THROUGHPUT_SCRIPT" \
        >> "$THROUGHPUT_LOG" \
        2>&1
    then
        printf '%s | video-throughput | FAILED | probe script error\n' \
            "$(timestamp)" \
            >> "$THROUGHPUT_LOG"
    fi
else
    printf '%s | video-throughput | FAILED | script not found\n' \
        "$(timestamp)" \
        >> "$THROUGHPUT_LOG"
fi


exit "$BROWSER_EXIT"
