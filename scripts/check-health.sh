#!/usr/bin/env bash
set -u
set -o pipefail

BASE_DIR="$HOME/repos/site-mon"
LOG_FILE="$BASE_DIR/logs/health.log"
CONFIG="$HOME/.config/mediser-monitor/config.env"
PUBLISHER="$BASE_DIR/scripts/publish-dashboard.py"

source "$CONFIG"

R2_SLOW_MS="${R2_SLOW_MS:-1500}"

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


if [[ "$(date +%M)" == "00" ]]; then
    echo "====================================================================================================" \
        >> "$LOG_FILE"
fi


check_url \
    "frontend" \
    "$FRONTEND_URL"

check_appwrite

check_r2_media


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
