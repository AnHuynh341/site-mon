#!/usr/bin/env bash
set -u
set -o pipefail

BASE_DIR="$HOME/repos/site-mon"
LOG_FILE="$BASE_DIR/logs/health.log"
CONFIG="$HOME/.config/mediser-monitor/config.env"
PUBLISHER="$BASE_DIR/scripts/publish-dashboard.py"

source "$CONFIG"

R2_SLOW_MS="${R2_SLOW_MS:-1500}"
VIDEO_SLOW_MS="${VIDEO_SLOW_MS:-2500}"
VIDEO_MEDIA_DIR="${VIDEO_MEDIA_DIR:-/srv/media/anime}"
VIDEO_MEDIA_BASE_URL="${VIDEO_MEDIA_BASE_URL:-https://media.anhuynh341.online/anime}"

mkdir -p "$BASE_DIR/logs"


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
                --range 0-131071 \
                --max-time 20 \
                --write-out '%{http_code} %{time_total}' \
                "$url" \
                2>/dev/null
        ) || result="000 0"

        read -r code seconds <<< "$result"

        ms=$(to_ms "$seconds")


        if [[ "$code" == "200" || "$code" == "206" ]]; then

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


    sample_csv=$(
        IFS=,
        echo "${samples[*]}"
    )


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

    for variable in \
        VIDEO_TEST_URL_1 \
        VIDEO_TEST_URL_2 \
        VIDEO_TEST_URL_3
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

    python3 - "$VIDEO_MEDIA_DIR" "$VIDEO_MEDIA_BASE_URL" <<'PY'
import sys
from pathlib import Path
from urllib.parse import quote

root = Path(sys.argv[1])
base = sys.argv[2].rstrip("/")

if not root.is_dir():
    raise SystemExit(0)

files = []

for path in root.rglob("video.mp4"):
    try:
        files.append((path.stat().st_mtime_ns, path))
    except OSError:
        continue

files.sort(key=lambda item: (item[0], str(item[1])))

if len(files) <= 3:
    selected = [item[1] for item in files]
else:
    selected = [
        files[0][1],
        files[len(files) // 2][1],
        files[-1][1],
    ]

for path in selected:
    relative = path.relative_to(root).as_posix()
    print(f"{base}/{quote(relative, safe='/')}")
PY
}


check_video_media() {
    local urls=()
    local total success sum_fetch sum_ttfb average_fetch average_ttfb
    local result code fetch_seconds ttfb_seconds fetch_ms ttfb_ms status
    local fetch_csv ttfb_csv url
    local fetch_samples=()
    local ttfb_samples=()

    while IFS= read -r url; do
        [[ -n "$url" ]] && urls+=("$url")
    done < <(video_sample_urls)

    total="${#urls[@]}"
    success=0
    sum_fetch=0
    sum_ttfb=0

    for url in "${urls[@]}"; do
        result=$(
            curl \
                --silent \
                --show-error \
                --location \
                --output /dev/null \
                --range 0-131071 \
                --max-filesize 262144 \
                --max-time 20 \
                --write-out '%{http_code} %{time_total} %{time_starttransfer}' \
                "$url" \
                2>/dev/null
        ) || result="000 0 0"

        read -r code fetch_seconds ttfb_seconds <<< "$result"

        fetch_ms=$(to_ms "$fetch_seconds")
        ttfb_ms=$(to_ms "$ttfb_seconds")

        # A proper video endpoint must honor byte ranges. Strictly
        # requiring 206 also prevents a broken server from making the
        # monitor download an entire episode during every health run.
        if [[ "$code" == "206" ]]; then
            success=$((success + 1))
            sum_fetch=$((sum_fetch + fetch_ms))
            sum_ttfb=$((sum_ttfb + ttfb_ms))
            fetch_samples+=("$fetch_ms")
            ttfb_samples+=("$ttfb_ms")
        else
            fetch_samples+=("FAIL")
            ttfb_samples+=("FAIL")
        fi
    done

    if (( success > 0 )); then
        average_fetch=$((sum_fetch / success))
        average_ttfb=$((sum_ttfb / success))
    else
        average_fetch=0
        average_ttfb=0
    fi

    if (( total == 0 || success == 0 )); then
        status="DOWN"
    elif (( success < total || average_fetch >= VIDEO_SLOW_MS )); then
        status="UNSTABLE"
    else
        status="UP"
    fi

    fetch_csv=$(IFS=,; echo "${fetch_samples[*]}")
    ttfb_csv=$(IFS=,; echo "${ttfb_samples[*]}")

    printf '%s | video-media | %s | %d/%d | %dms | ttfb=%dms | fetch=%s | ttfbSamples=%s\n' \
        "$(timestamp)" \
        "$status" \
        "$success" \
        "$total" \
        "$average_fetch" \
        "$average_ttfb" \
        "$fetch_csv" \
        "$ttfb_csv" \
        >> "$LOG_FILE"
}


if [[ "$(date +%M)" == "00" ]]; then
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


# Once publish-dashboard.py exists, every health run
# will also publish the latest dashboard JSON.
if [[ -x "$PUBLISHER" ]]; then

    if ! "$PUBLISHER"; then

        printf '%s | publisher | ERROR | dashboard publish failed\n' \
            "$(timestamp)" \
            >&2

    fi

fi
