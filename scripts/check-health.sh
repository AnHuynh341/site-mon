#!/usr/bin/env bash
set -u
set -o pipefail

BASE_DIR="$HOME/repos/site-mon"
LOG_FILE="$BASE_DIR/logs/health.log"
CONFIG="$HOME/.config/mediser-monitor/config.env"
PUBLISHER="$BASE_DIR/scripts/publish-dashboard.py"
VIDEO_INFO_PATCHER="$BASE_DIR/scripts/video-r2-info.py"
THROUGHPUT_RUNNER="$BASE_DIR/scripts/run-throughput.sh"
VIDEO_PROBE_CACHE="$BASE_DIR/data/video-probe-urls.txt"

source "$CONFIG"

R2_SLOW_MS="${R2_SLOW_MS:-1500}"
VIDEO_SLOW_MS="${VIDEO_SLOW_MS:-2500}"

# Fast probes only need to prove startup/range latency. Sustained speed is
# measured separately every 30 minutes, so keep these tiny by default.
LATENCY_RANGE_END="${LATENCY_RANGE_END:-32767}"
LATENCY_MAX_FILESIZE="${LATENCY_MAX_FILESIZE:-65536}"

VIDEO_R2_REMOTE="${VIDEO_R2_REMOTE:-r2:w41it-video}"
VIDEO_R2_BASE_URL="${VIDEO_R2_BASE_URL:-https://w41it-video-r2.meochon341.workers.dev}"
VIDEO_PROBE_CACHE_SECONDS="${VIDEO_PROBE_CACHE_SECONDS:-3600}"

mkdir -p "$BASE_DIR/logs" "$BASE_DIR/data"


timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}


to_ms() {
    awk -v seconds="$1" \
        'BEGIN { printf "%.0f", seconds * 1000 }'
}


check_url() {
    local name="$1"
    local url="$2"
    local result code seconds ms status

    result=$(
        curl \
            --silent \
            --show-error \
            --location \
            --output /dev/null \
            --max-time 15 \
            --write-out '%{http_code} %{time_total}' \
            "$url" \
            2>/dev/null
    ) || result="000 0"

    read -r code seconds <<< "$result"
    ms=$(to_ms "$seconds")

    if [[ "$code" =~ ^[23][0-9][0-9]$ ]]; then
        status="UP"
    else
        status="DOWN"
    fi

    printf '%s | %s | %s | %s | %sms\n' \
        "$(timestamp)" \
        "$name" \
        "$status" \
        "$code" \
        "$ms" \
        >> "$LOG_FILE"
}


check_appwrite() {
    local result code seconds ms status

    result=$(
        curl \
            --silent \
            --show-error \
            --location \
            --output /dev/null \
            --max-time 15 \
            --header "X-Appwrite-Project: $APPWRITE_PROJECT_ID" \
            --header "X-Appwrite-Key: $APPWRITE_API_KEY" \
            --write-out '%{http_code} %{time_total}' \
            "$APPWRITE_ENDPOINT/health" \
            2>/dev/null
    ) || result="000 0"

    read -r code seconds <<< "$result"
    ms=$(to_ms "$seconds")

    if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
        status="UP"
    else
        status="DOWN"
    fi

    printf '%s | appwrite | %s | %s | %sms\n' \
        "$(timestamp)" \
        "$status" \
        "$code" \
        "$ms" \
        >> "$LOG_FILE"
}


check_r2_media() {
    local urls=(
        "$R2_TEST_URL_1"
        "$R2_TEST_URL_2"
        "$R2_TEST_URL_3"
        "$R2_TEST_URL_4"
        "$R2_TEST_URL_5"
    )

    local total="${#urls[@]}"
    local success=0
    local sum=0
    local worst=0
    local result code seconds ms average status sample_csv
    local samples=()

    for url in "${urls[@]}"; do
        result=$(
            curl \
                --silent \
                --show-error \
                --location \
                --output /dev/null \
                --range "0-$LATENCY_RANGE_END" \
                --max-filesize "$LATENCY_MAX_FILESIZE" \
                --max-time 20 \
                --write-out '%{http_code} %{time_total}' \
                "$url" \
                2>/dev/null
        ) || result="000 0"

        read -r code seconds <<< "$result"
        ms=$(to_ms "$seconds")

        # Requiring 206 plus a hard size cap prevents a broken endpoint from
        # downloading a full audio file during every five-minute health run.
        if [[ "$code" == "206" ]]; then
            success=$((success + 1))
            sum=$((sum + ms))

            if (( ms > worst )); then
                worst="$ms"
            fi

            samples+=("$ms")
        else
            samples+=("FAIL")
        fi
    done

    if (( success > 0 )); then
        average=$((sum / success))
    else
        average=0
    fi

    if (( success == 0 )); then
        status="DOWN"
    elif (( success < total || worst >= R2_SLOW_MS )); then
        status="UNSTABLE"
    else
        status="UP"
    fi

    sample_csv=$(IFS=,; echo "${samples[*]}")

    printf '%s | r2-media | %s | %d/%d | %dms | worst=%dms | samples=%s\n' \
        "$(timestamp)" \
        "$status" \
        "$success" \
        "$total" \
        "$average" \
        "$worst" \
        "$sample_csv" \
        >> "$LOG_FILE"
}


video_sample_urls() {
    local variable url
    local configured=()

    # Explicit fixed URLs still win if the operator configures them.
    for variable in \
        VIDEO_R2_TEST_URL_1 \
        VIDEO_R2_TEST_URL_2 \
        VIDEO_R2_TEST_URL_3 \
        VIDEO_R2_TEST_URL_4 \
        VIDEO_R2_TEST_URL_5
    do
        url="${!variable-}"

        if [[ -n "$url" ]]; then
            configured+=("$url")
        fi
    done

    if (( ${#configured[@]} > 0 )); then
        printf '%s\n' "${configured[@]}"
        return
    fi

    # The video bucket is now authoritative. Build five representative probe
    # URLs from the real R2 inventory and cache them for an hour so the
    # five-minute latency loop does not list the whole bucket every time.
    python3 - \
        "$VIDEO_R2_REMOTE" \
        "$VIDEO_R2_BASE_URL" \
        "$VIDEO_PROBE_CACHE" \
        "$VIDEO_PROBE_CACHE_SECONDS" <<'PY'
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote

remote = sys.argv[1].rstrip("/")
base = sys.argv[2].rstrip("/")
cache = Path(sys.argv[3])
max_age = int(sys.argv[4])


def read_cache(require_fresh: bool):
    try:
        if not cache.is_file():
            return []
        age = time.time() - cache.stat().st_mtime
        if require_fresh and age > max_age:
            return []
        return [
            line.strip()
            for line in cache.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    except OSError:
        return []


cached = read_cache(require_fresh=True)
if cached:
    print("\n".join(cached))
    raise SystemExit(0)

try:
    result = subprocess.run(
        [
            "rclone",
            "lsjson",
            remote,
            "--recursive",
            "--files-only",
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )

    if result.returncode != 0:
        raise RuntimeError(
            result.stderr.strip()
            or result.stdout.strip()
            or "rclone lsjson failed"
        )

    entries = json.loads(result.stdout or "[]")
    keys = sorted({
        str(entry.get("Path") or entry.get("Name") or "").strip("/")
        for entry in entries
        if str(entry.get("Path") or entry.get("Name") or "").strip("/")
    })
    keys = [
        key
        for key in keys
        if key == "video.mp4" or key.endswith("/video.mp4")
    ]

    if not keys:
        raise RuntimeError("R2 video inventory contains no video.mp4 objects")

    if len(keys) <= 5:
        selected = keys
    else:
        last = len(keys) - 1
        selected = [
            keys[round(index * last / 4)]
            for index in range(5)
        ]

    urls = [
        f"{base}/{quote(key, safe='/')}"
        for key in selected
    ]

    cache.parent.mkdir(parents=True, exist_ok=True)
    temp = cache.with_suffix(cache.suffix + ".tmp")
    temp.write_text("\n".join(urls) + "\n", encoding="utf-8")
    os.replace(temp, cache)

    print("\n".join(urls))

except Exception as exc:
    # If R2 listing itself has a temporary problem, a stale cache is still
    # better than turning a healthy service into an artificial 0/0 result.
    stale = read_cache(require_fresh=False)
    if stale:
        print("\n".join(stale))
    else:
        print(f"video probe inventory error: {exc}", file=sys.stderr)
PY
}


check_video_media() {
    local urls=()
    local total success sum_fetch average_fetch
    local result code fetch_seconds fetch_ms status
    local sample_csv url
    local fetch_samples=()

    while IFS= read -r url; do
        [[ -n "$url" ]] && urls+=("$url")
    done < <(video_sample_urls)

    total="${#urls[@]}"
    success=0
    sum_fetch=0

    for url in "${urls[@]}"; do
        result=$(
            curl \
                --silent \
                --show-error \
                --location \
                --output /dev/null \
                --range "0-$LATENCY_RANGE_END" \
                --max-filesize "$LATENCY_MAX_FILESIZE" \
                --max-time 20 \
                --write-out '%{http_code} %{time_total}' \
                "$url" \
                2>/dev/null
        ) || result="000 0"

        read -r code fetch_seconds <<< "$result"
        fetch_ms=$(to_ms "$fetch_seconds")

        if [[ "$code" == "206" ]]; then
            success=$((success + 1))
            sum_fetch=$((sum_fetch + fetch_ms))
            fetch_samples+=("$fetch_ms")
        else
            fetch_samples+=("FAIL")
        fi
    done

    if (( success > 0 )); then
        average_fetch=$((sum_fetch / success))
    else
        average_fetch=0
    fi

    if (( total == 0 || success == 0 )); then
        status="DOWN"
    elif (( success < total || average_fetch >= VIDEO_SLOW_MS )); then
        status="UNSTABLE"
    else
        status="UP"
    fi

    sample_csv=$(IFS=,; echo "${fetch_samples[*]}")

    printf '%s | video-media | %s | %d/%d | %dms | samples=%s\n' \
        "$(timestamp)" \
        "$status" \
        "$success" \
        "$total" \
        "$average_fetch" \
        "$sample_csv" \
        >> "$LOG_FILE"
}


minute="$(date +%M)"

if [[ "$minute" == "00" ]]; then
    echo "====================================================================================================" \
        >> "$LOG_FILE"
fi

check_url \
    "frontend" \
    "$FRONTEND_URL"

check_appwrite
check_r2_media
check_video_media

echo "----------------------------------------------------------------------------------------------------" \
    >> "$LOG_FILE"


# Run two random sustained video samples and two audio samples at :00 and
# :30. The runner is detached and locked so bad transfers cannot stall or
# overlap the five-minute health loop.
if [[
    ( "$minute" == "00" || "$minute" == "30" )
    && -x "$THROUGHPUT_RUNNER"
]]; then
    nohup "$THROUGHPUT_RUNNER" \
        >/dev/null 2>&1 &
fi


if [[ -x "$PUBLISHER" ]]; then
    if "$PUBLISHER"; then

        # Authoritative video inventory changes far less often than latency.
        # Scan the full video R2 bucket hourly instead of every five minutes.
        if [[
            "$minute" == "00"
            && -f "$VIDEO_INFO_PATCHER"
        ]]; then
            if ! python3 "$VIDEO_INFO_PATCHER"; then
                printf '%s | publisher | ERROR | R2 video storage info update failed\n' \
                    "$(timestamp)" \
                    >&2
            fi
        fi

    else
        printf '%s | publisher | ERROR | dashboard publish failed\n' \
            "$(timestamp)" \
            >&2
    fi
fi
