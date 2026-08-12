#!/usr/bin/env bash

set -u

BASE_DIR="$HOME/repos/site-mon"
LOG_FILE="$BASE_DIR/logs/health.log"
R2_SCRIPT="$BASE_DIR/scripts/r2-storage.py"
WEB_SCRIPT="$BASE_DIR/scripts/web-analytics.py"

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


# ------------------------------------------------------------
# Extract today's checks
# ------------------------------------------------------------

TODAY_LOG=$(mktemp)
trap 'rm -f "$TODAY_LOG"' EXIT

grep "^$TODAY " "$LOG_FILE" > "$TODAY_LOG" || true


# ------------------------------------------------------------
# Statistics
# ------------------------------------------------------------

get_stats() {
    local service="$1"

    local total
    local up
    local unstable
    local down
    local available
    local uptime
    local avg_ms
    local worst_ms

    total=$(awk -F'|' -v s="$service" '
        {
            gsub(/^ +| +$/, "", $2)
            if ($2 == s) count++
        }
        END {
            print count+0
        }
    ' "$TODAY_LOG")

    up=$(awk -F'|' -v s="$service" '
        {
            gsub(/^ +| +$/, "", $2)
            gsub(/^ +| +$/, "", $3)
            if ($2 == s && $3 == "UP") count++
        }
        END {
            print count+0
        }
    ' "$TODAY_LOG")

    unstable=$(awk -F'|' -v s="$service" '
        {
            gsub(/^ +| +$/, "", $2)
            gsub(/^ +| +$/, "", $3)
            if ($2 == s && $3 == "UNSTABLE") count++
        }
        END {
            print count+0
        }
    ' "$TODAY_LOG")

    down=$(awk -F'|' -v s="$service" '
        {
            gsub(/^ +| +$/, "", $2)
            gsub(/^ +| +$/, "", $3)
            if ($2 == s && $3 == "DOWN") count++
        }
        END {
            print count+0
        }
    ' "$TODAY_LOG")

    available=$((up + unstable))

    if [[ "$total" -gt 0 ]]; then
        uptime=$(awk -v ok="$available" -v total="$total" '
            BEGIN {
                printf "%.2f", (ok / total) * 100
            }
        ')
    else
        uptime="0.00"
    fi

    avg_ms=$(awk -F'|' -v s="$service" '
        {
            gsub(/^ +| +$/, "", $2)
            gsub(/^ +| +$/, "", $3)
            gsub(/^ +| +$/, "", $5)

            if ($2 == s && ($3 == "UP" || $3 == "UNSTABLE") && $5 ~ /^[0-9]+ms$/) {
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

    worst_ms=$(awk -F'|' -v s="$service" '
        {
            gsub(/^ +| +$/, "", $2)

            if ($2 == s && NF >= 6) {
                field=$6

                gsub(/^ +| +$/, "", field)
                gsub(/^worst=/, "", field)
                gsub(/ms$/, "", field)

                if (field ~ /^[0-9]+$/ && field > worst)
                    worst=field
            }
        }

        END {
            print worst+0
        }
    ' "$TODAY_LOG")

    echo "$total|$up|$unstable|$down|$uptime|$avg_ms|$worst_ms"
}


# ------------------------------------------------------------
# Read statistics
# ------------------------------------------------------------

IFS='|' read -r \
    FRONT_TOTAL FRONT_UP FRONT_UNSTABLE FRONT_DOWN \
    FRONT_UPTIME FRONT_AVG FRONT_WORST \
    <<< "$(get_stats frontend)"

IFS='|' read -r \
    APP_TOTAL APP_UP APP_UNSTABLE APP_DOWN \
    APP_UPTIME APP_AVG APP_WORST \
    <<< "$(get_stats appwrite)"

IFS='|' read -r \
    R2_TOTAL R2_UP R2_UNSTABLE R2_DOWN \
    R2_UPTIME R2_AVG R2_WORST \
    <<< "$(get_stats r2-media)"


# ------------------------------------------------------------
# R2 storage
# ------------------------------------------------------------

R2_RESULT=$("$R2_SCRIPT" 2>/dev/null)
R2_EXIT=$?

if [[ $R2_EXIT -eq 0 ]]; then
    R2_OBJECTS=$(awk -F= '/^objects=/ {print $2}' <<< "$R2_RESULT")
    R2_GB=$(awk -F= '/^gb=/ {print $2}' <<< "$R2_RESULT")
else
    R2_OBJECTS="Unknown"
    R2_GB="Unknown"
fi



# ------------------------------------------------------------
# Web Analytics
# ------------------------------------------------------------

WEB_RESULT=$("$WEB_SCRIPT" 2>/dev/null)
WEB_EXIT=$?

if [[ $WEB_EXIT -eq 0 ]]; then

    WEB_VISITS=$(awk -F= \
        '/^visits=/ {print $2}' <<< "$WEB_RESULT")

    WEB_LOAD_MS=$(awk -F= \
        '/^page_load_ms=/ {print $2}' <<< "$WEB_RESULT")

else

    WEB_VISITS="Unknown"
    WEB_LOAD_MS="Unknown"

fi



# ------------------------------------------------------------
# Overall status
# ------------------------------------------------------------

OVERALL="HEALTHY"

if (( FRONT_DOWN > 0 || APP_DOWN > 0 || R2_DOWN > 0 || R2_UNSTABLE > 0 )); then
    OVERALL="UNSTABLE"
fi

if (( FRONT_UP == 0 || APP_UP == 0 || (R2_UP + R2_UNSTABLE) == 0 )); then
    OVERALL="DOWN"
fi


# ------------------------------------------------------------
# Incidents
# ------------------------------------------------------------

INCIDENTS=$(awk -F'|' '
    {
        time=$1
        service=$2
        status=$3
        detail=$4

        gsub(/^ +| +$/, "", time)
        gsub(/^ +| +$/, "", service)
        gsub(/^ +| +$/, "", status)
        gsub(/^ +| +$/, "", detail)

        split(time, t, " ")

        if (status == "DOWN") {
            printf "  %s - %s DOWN (%s)\n", t[2], service, detail
        }
        else if (status == "UNSTABLE") {
            avg=$5
            worst=$6

            gsub(/^ +| +$/, "", avg)
            gsub(/^ +| +$/, "", worst)

            printf "  %s - %s UNSTABLE (%s, avg %s, %s)\n", \
                t[2], service, detail, avg, worst
        }
    }
' "$TODAY_LOG")

if [[ -z "$INCIDENTS" ]]; then
    INCIDENTS="  None"
fi


# ------------------------------------------------------------
# Generate report
# ------------------------------------------------------------

cat > "$REPORT_FILE" <<EOF
W41IT DAILY REPORT
Date: $TODAY
Week: $YEAR-$WEEK
==========================================

OVERALL STATUS
  Status             : $OVERALL

FRONTEND
  Uptime             : ${FRONT_UPTIME}%
  Successful checks  : $FRONT_UP / $FRONT_TOTAL
  Average response   : ${FRONT_AVG} ms

DATABASE
  Uptime             : ${APP_UPTIME}%
  Successful checks  : $APP_UP / $APP_TOTAL
  Average response   : ${APP_AVG} ms

STORAGE
  Data stored        : ${R2_GB} GB 
  Object count       : $R2_OBJECTS
  Media availability : ${R2_UPTIME}%
  Average response   : ${R2_AVG} ms
  Worst response     : ${R2_WORST} ms

ANALYTICS
  Visits             : $WEB_VISITS
  Average load time  : ${WEB_LOAD_MS} ms

INCIDENTS
$INCIDENTS

==========================================
Generated: $(date '+%Y-%m-%d %H:%M:%S')
EOF


# ------------------------------------------------------------
# Keep only seven days of raw health data
# ------------------------------------------------------------


CUTOFF_DATE=$(date -d '6 days ago' +%F)

awk -v cutoff="$CUTOFF_DATE" '
    /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] / {
        keep = (substr($0, 1, 10) >= cutoff)
        if (keep)
            print
        next
    }

    keep && /^[-=]+$/ {
        print
    }
' "$LOG_FILE" > "${LOG_FILE}.tmp"

mv "${LOG_FILE}.tmp" "$LOG_FILE"



echo "Report created:"
echo "$REPORT_FILE"
