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
        echo "$(timestamp) | $name | DOWN | curl_error | -" >> "$LOG_FILE"
        return
    fi

    local code time seconds ms
    code=$(awk '{print $1}' <<< "$result")
    time=$(awk '{print $2}' <<< "$result")

    ms=$(awk -v t="$time" 'BEGIN { printf "%.0f", t * 1000 }')

    if [[ "$code" =~ ^2|3 ]]; then
        echo "$(timestamp) | $name | UP | $code | ${ms}ms" >> "$LOG_FILE"
    else
        echo "$(timestamp) | $name | DOWN | $code | ${ms}ms" >> "$LOG_FILE"
    fi
}

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
        echo "$(timestamp) | appwrite | DOWN | curl_error | -" >> "$LOG_FILE"
        return
    fi

    local code time ms
    code=$(awk '{print $1}' <<< "$result")
    time=$(awk '{print $2}' <<< "$result")
    ms=$(awk -v t="$time" 'BEGIN { printf "%.0f", t * 1000 }')

    if [[ "$code" =~ ^2 ]]; then
        echo "$(timestamp) | appwrite | UP | $code | ${ms}ms" >> "$LOG_FILE"
    else
        echo "$(timestamp) | appwrite | DOWN | $code | ${ms}ms" >> "$LOG_FILE"
    fi
}

check_r2_media() {
    local result
    result=$(curl \
        --silent \
        --show-error \
        --location \
        --range 0-1023 \
        --output /dev/null \
        --max-time 15 \
        --write-out '%{http_code} %{time_total}' \
        "$R2_TEST_URL" 2>/dev/null)

    local curl_status=$?

    if [[ $curl_status -ne 0 ]]; then
        echo "$(timestamp) | r2-media | DOWN | curl_error | -" >> "$LOG_FILE"
        return
    fi

    local code time ms
    code=$(awk '{print $1}' <<< "$result")
    time=$(awk '{print $2}' <<< "$result")
    ms=$(awk -v t="$time" 'BEGIN { printf "%.0f", t * 1000 }')

    if [[ "$code" == "200" || "$code" == "206" ]]; then
        echo "$(timestamp) | r2-media | UP | $code | ${ms}ms" >> "$LOG_FILE"
    else
        echo "$(timestamp) | r2-media | DOWN | $code | ${ms}ms" >> "$LOG_FILE"
    fi
}

check_url "frontend" "$FRONTEND_URL"
check_appwrite
check_r2_media
