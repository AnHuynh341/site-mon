#!/usr/bin/env bash

set -u

BASE_DIR="$HOME/repos/site-mon"
LOG_FILE="$BASE_DIR/logs/health.log"
R2_SCRIPT="$BASE_DIR/scripts/r2-storage.py"

TODAY=$(date +%F)
YEAR=$(date +%G)
WEEK=$(date +W%V)

REPORT_DIR="$BASE_DIR/reports/$YEAR/$WEEK"
REPORT_FILE="$REPORT_DIR/$TODAY.txt"

mkdir -p "$REPORT_DIR"

if [[ ! -f "$LOG_FILE" ]]; then
    echo "Missing health log: $LOG_FILE" >&2
    exit 1
fi

#
# Extract only today's checks
#
TODAY_LOG=$(mktemp)
trap 'rm -f "$TODAY_LOG"' EXIT

grep "^$TODAY " "$LOG_FILE" > "$TODAY_LOG" || true


#
# Calculate statistics for one service
#
get_stats() {
    local service="$1"

    local total
    local successful
    local uptime
    local avg_ms

    total=$(awk -F'|' -v s="$service" '
        {
            gsub(/^ +| +$/, "", $2)
            if ($2 == s)
                count++
        }
        END { print count+0 }
    ' "$TODAY_LOG")

    successful=$(awk -F'|' -v s="$service" '
        {
            gsub(/^ +| +$/, "", $2)
            gsub(/^ +| +$/, "", $3)

            if ($2 == s && $3 == "UP")
                count++
        }
        END { print count+0 }
    ' "$TODAY_LOG")

    if [[ "$total" -gt 0 ]]; then
        uptime=$(awk \
            -v ok="$successful" \
            -v total="$total" \
            'BEGIN { printf "%.2f", (ok / total) * 100 }')
    else
        uptime="0.00"
    fi

    avg_ms=$(awk -F'|' -v s="$service" '
        {
            gsub(/^ +| +$/, "", $2)
            gsub(/^ +| +$/, "", $3)
            gsub(/^ +| +$/, "", $5)

            if ($2 == s && $3 == "UP" && $5 ~ /^[0-9]+ms$/) {
                gsub(/ms/, "", $5)
                total += $5
                count++
            }
        }

        END {
            if (count > 0)
                printf "%.0f", total / count
            else
                print 0
        }
    ' "$TODAY_LOG")

    echo "$total|$successful|$uptime|$avg_ms"
}


#
# Get stats
#
IFS='|' read -r FRONT_TOTAL FRONT_OK FRONT_UPTIME FRONT_AVG \
    <<< "$(get_stats frontend)"

IFS='|' read -r APP_TOTAL APP_OK APP_UPTIME APP_AVG \
    <<< "$(get_stats appwrite)"

IFS='|' read -r R2_TOTAL R2_OK R2_UPTIME R2_AVG \
    <<< "$(get_stats r2-media)"


#
# Query current R2 storage
#
R2_RESULT=$("$R2_SCRIPT" 2>/dev/null)

if [[ $? -eq 0 ]]; then
    R2_OBJECTS=$(awk -F= '/^objects=/ {print $2}' <<< "$R2_RESULT")
    R2_GB=$(awk -F= '/^gb=/ {print $2}' <<< "$R2_RESULT")
else
    R2_OBJECTS="Unknown"
    R2_GB="Unknown"
fi


#
# Determine overall status
#
OVERALL="HEALTHY"

if [[ "$FRONT_UPTIME" != "100.00" ]] || \
   [[ "$APP_UPTIME" != "100.00" ]] || \
   [[ "$R2_UPTIME" != "100.00" ]]; then
    OVERALL="DEGRADED"
fi

if [[ "$FRONT_OK" -eq 0 ]] || \
   [[ "$APP_OK" -eq 0 ]] || \
   [[ "$R2_OK" -eq 0 ]]; then
    OVERALL="DOWN"
fi


#
# Build incident list
#
INCIDENTS=$(awk -F'|' '
    {
        time=$1
        service=$2
        status=$3
        code=$4

        gsub(/^ +| +$/, "", time)
        gsub(/^ +| +$/, "", service)
        gsub(/^ +| +$/, "", status)
        gsub(/^ +| +$/, "", code)

        if (status == "DOWN") {
            split(time, t, " ")
            printf "  %s - %s failed (%s)\n", t[2], service, code
        }
    }
' "$TODAY_LOG")

if [[ -z "$INCIDENTS" ]]; then
    INCIDENTS="  None."
fi


#
# Write report
#
cat > "$REPORT_FILE" <<EOF
 DAILY REPORT
Date: $TODAY
Week: $YEAR-$WEEK
============================================================

OVERALL STATUS
  Status               : $OVERALL

FRONTEND
  Uptime               : ${FRONT_UPTIME}%
  Successful checks    : $FRONT_OK / $FRONT_TOTAL
  Average response     : ${FRONT_AVG} ms

APPWRITE
  Uptime               : ${APP_UPTIME}%
  Successful checks    : $APP_OK / $APP_TOTAL
  Average response     : ${APP_AVG} ms

CLOUDFLARE R2
  Media uptime         : ${R2_UPTIME}%
  Successful checks    : $R2_OK / $R2_TOTAL
  Average response     : ${R2_AVG} ms
  Storage used         : ${R2_GB} GB
  Object count         : $R2_OBJECTS

INCIDENTS
$INCIDENTS

============================================================
Generated: $(date '+%Y-%m-%d %H:%M:%S')
EOF



# Keep only the last 7 days of raw health checks
CUTOFF_DATE=$(date -d '6 days ago' +%F)

awk -v cutoff="$CUTOFF_DATE" '
    substr($0, 1, 10) >= cutoff
' "$LOG_FILE" > "${LOG_FILE}.tmp"

mv "${LOG_FILE}.tmp" "$LOG_FILE"


echo "Report created:"
echo "$REPORT_FILE"
