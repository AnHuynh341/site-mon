#!/usr/bin/env bash
set -e

REPO="$HOME/repos/site-mon"

cd "$REPO"

# Generate/update today's report
"$REPO/scripts/daily-report.sh"

# Stage report + rolling health log
git add reports/ logs/health.log

# Commit only if something actually changed
if ! git diff --cached --quiet; then
    git commit -m "Daily report $(date +%F)"
fi

# ------------------------------------------------------------
# Push with automatic retry
# ------------------------------------------------------------

MAX_ATTEMPTS=5
DELAY=30

for ((attempt=1; attempt<=MAX_ATTEMPTS; attempt++)); do

    echo "Git push attempt $attempt/$MAX_ATTEMPTS..."

    if timeout 60s git push origin main; then
        echo "Git push successful."
        exit 0
    fi

    if (( attempt < MAX_ATTEMPTS )); then
        echo "Push failed. Retrying in ${DELAY}s..."
        sleep "$DELAY"
        DELAY=$((DELAY * 2))
    fi

done

echo "ERROR: Git push failed after $MAX_ATTEMPTS attempts." >&2
exit 1
