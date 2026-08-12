#!/usr/bin/env bash

set -e

REPO="$HOME/repos/site-mon"

cd "$REPO"

# Generate today's report
"$REPO/scripts/daily-report.sh"

# Stage reports and logs
git add reports/   logs/health.log

# Don't create an empty commit
if git diff --cached --quiet; then
    exit 0
fi

git commit -m "Daily report $(date +%F)"
git push origin main
