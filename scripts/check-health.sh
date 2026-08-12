#!/usr/bin/env bash

set -u

BASE_DIR="$HOME/repos/site-mon"
LOG_FILE="$BASE_DIR/logs/health.log"
CONFIG="$HOME/.config/mediser-monitor/config.env"

if [[ ! -f "$CONFIG" ]]; then
    echo "Missing config: $CONFIG" >&2
    exit 1
fi

source "$CONFIG"

mkdir -p "$BASE_DIR/logs"


timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}


# ------------------------------------------------------------
# Generic URL check
# ------------------------------------------------------------

check_url() {
    local name="$1"
    local url="$2"

    local result
    result=$(curl \
        --silent \
        --show-error \
        --location \
        --output /dev/null \
        --max-time 15 \
        --write-out '%{http_code} %{time_total}' \
        "$url" 2>/dev/null)

    local curl_status=$?

    if [[ $curl_status -ne 0 ]]; then
        echo "$(timestamp) | $name | DOWN | curl_error | -" \
            >> "$LOG_FILE"
        return
    fi

    local code
    local time
    local ms

    code=$(awk '{print $1}' <<< "$result")
    time=$(awk '{print $2}' <<< "$result")

    ms=$(awk -v t="$time" \
        'BEGIN { printf "%.0f", t * 1000 }')

    if [[ "$code" =~ ^[23] ]]; then
        echo "$(timestamp) | $name | UP | $code | ${ms}ms" \
            >> "$LOG_FILE"
    else
        echo "$(timestamp) | $name | DOWN | $code | ${ms}ms" \
            >> "$LOG_FILE"
    fi
}


# ------------------------------------------------------------
# Appwrite health check
# ------------------------------------------------------------

check_appwrite() {
    local result

    result=$(curl \
        --silent \
        --show-error \
        --output /dev/null \
        --max-time 15 \
        --header "X-Appwrite-Project: $APPWRITE_PROJECT_ID" \
        --header "X-Appwrite-Key: $APPWRITE_API_KEY" \
        --write-out '%{http_code} %{time_total}' \
        "$APPWRITE_ENDPOINT/health" 2>/dev/null)

    local curl_status=$?

    if [[ $curl_status -ne 0 ]]; then
        echo "$(timestamp) | appwrite | DOWN | curl_error | -" \
            >> "$LOG_FILE"
        return
    fi

    local code
    local time
    local ms

    code=$(awk '{print $1}' <<< "$result")
    time=$(awk '{print $2}' <<< "$result")

    ms=$(awk -v t="$time" \
        'BEGIN { printf "%.0f", t * 1000 }')

    if [[ "$code" =~ ^2 ]]; then
        echo "$(timestamp) | appwrite | UP | $code | ${ms}ms" \
            >> "$LOG_FILE"
    else
        echo "$(timestamp) | appwrite | DOWN | $code | ${ms}ms" \
            >> "$LOG_FILE"
    fi
}


# ------------------------------------------------------------
# R2 media delivery test
#
# Tests:
#   3 different objects
#   128 KiB from each
#
# Status:
#   UP       = all files succeeded within latency threshold
#   UNSTABLE = at least one failure OR slow successful request
#   DOWN     = every file failed
# ------------------------------------------------------------

check_r2_media() {

    local urls=(
        "$R2_TEST_URL_1"
        "$R2_TEST_URL_2"
        "$R2_TEST_URL_3"
    )

    local success=0
    local failures=0
    local slow_count=0

    local total_ms=0
    local worst_ms=0

    local total_files=${#urls[@]}
    local slow_limit="${R2_SLOW_MS:-1500}"

    for url in "${urls[@]}"; do

        local result
        local curl_status
        local code
        local time
        local ms

        result=$(curl \
            --silent \
            --show-error \
            --location \
            --range 0-131071 \
            --output /dev/null \
            --max-time 20 \
            --write-out '%{http_code} %{time_total}' \
            "$url" 2>/dev/null)

        curl_status=$?

        if [[ $curl_status -ne 0 ]]; then
            ((failures++))
            continue
        fi

        code=$(awk '{print $1}' <<< "$result")
        time=$(awk '{print $2}' <<< "$result")

        ms=$(awk -v t="$time" \
            'BEGIN { printf "%.0f", t * 1000 }')

        if [[ "$code" == "200" || "$code" == "206" ]]; then

            ((success++))

            total_ms=$((total_ms + ms))

            if (( ms > worst_ms )); then
                worst_ms=$ms
            fi

            if (( ms >= slow_limit )); then
                ((slow_count++))
            fi

        else
            ((failures++))
        fi
    done


    local avg_ms=0
    local status

    if (( success > 0 )); then
        avg_ms=$((total_ms / success))
    fi


    if (( success == 0 )); then

        status="DOWN"

    elif (( failures > 0 || slow_count > 0 )); then

        status="UNSTABLE"

    else

        status="UP"

    fi


    echo "$(timestamp) | r2-media | $status | ${success}/${total_files} | ${avg_ms}ms | worst=${worst_ms}ms" \
        >> "$LOG_FILE"
}


# ------------------------------------------------------------
# Run checks
# ------------------------------------------------------------

check_url "frontend" "$FRONTEND_URL"
check_appwrite
check_r2_media
