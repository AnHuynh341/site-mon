#!/usr/bin/env python3

import json
import os
import sys
import urllib.request
from pathlib import Path
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


CONFIG_FILE = Path.home() / ".config/mediser-monitor/config.env"


def load_env_file(path):
    if not path.exists():
        print(f"Missing config file: {path}", file=sys.stderr)
        sys.exit(1)

    for line in path.read_text().splitlines():
        line = line.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


load_env_file(CONFIG_FILE)

required = [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_ANALYTICS_TOKEN",
    "WEB_ANALYTICS_HOST",
]

missing = [x for x in required if not os.environ.get(x)]

if missing:
    print(
        "Missing config values: " + ", ".join(missing),
        file=sys.stderr,
    )
    sys.exit(1)


account_id = os.environ["CLOUDFLARE_ACCOUNT_ID"]
token = os.environ["CLOUDFLARE_ANALYTICS_TOKEN"]
host = os.environ["WEB_ANALYTICS_HOST"]


# ------------------------------------------------------------
# Today's boundaries in Vietnam time
# Then convert them to UTC for Cloudflare
# ------------------------------------------------------------

local_tz = ZoneInfo("Asia/Ho_Chi_Minh")

now_local = datetime.now(local_tz)

start_local = now_local.replace(
    hour=0,
    minute=0,
    second=0,
    microsecond=0,
)

start_utc = start_local.astimezone(timezone.utc)
end_utc = now_local.astimezone(timezone.utc)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


start = iso(start_utc)
end = iso(end_utc)


# ------------------------------------------------------------
# Cloudflare GraphQL query
# ------------------------------------------------------------

query = f"""
query {{
  viewer {{
    accounts(filter: {{accountTag: "{account_id}"}}) {{

      rumPageloadEventsAdaptiveGroups(
        limit: 1
        filter: {{
          datetime_geq: "{start}"
          datetime_lt: "{end}"
          requestHost: "{host}"
        }}
      ) {{
        sum {{
          visits
        }}
      }}

      rumPerformanceEventsAdaptiveGroups(
        limit: 1
        filter: {{
          datetime_geq: "{start}"
          datetime_lt: "{end}"
          requestHost: "{host}"
        }}
      ) {{
        avg {{
          pageLoadTime
        }}
      }}

    }}
  }}
}}
"""


payload = json.dumps({
    "query": query
}).encode("utf-8")


request = urllib.request.Request(
    "https://api.cloudflare.com/client/v4/graphql",
    data=payload,
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    },
)


try:
    with urllib.request.urlopen(request, timeout=20) as response:
        result = json.load(response)

except Exception as exc:
    print(f"ERROR: {exc}", file=sys.stderr)
    sys.exit(1)


if result.get("errors"):
    for error in result["errors"]:
        print(
            "ERROR: " + error.get("message", "Unknown GraphQL error"),
            file=sys.stderr,
        )

    sys.exit(1)


try:
    account = result["data"]["viewer"]["accounts"][0]

except (KeyError, IndexError, TypeError):
    print("ERROR: Invalid Cloudflare response", file=sys.stderr)
    sys.exit(1)


# ------------------------------------------------------------
# Visits
# ------------------------------------------------------------

pageload = account.get(
    "rumPageloadEventsAdaptiveGroups",
    []
)

if pageload:
    visits = pageload[0].get("sum", {}).get("visits", 0)
else:
    visits = 0


# ------------------------------------------------------------
# Average page load
# ------------------------------------------------------------

performance = account.get(
    "rumPerformanceEventsAdaptiveGroups",
    []
)

if performance:
    page_load = performance[0].get(
        "avg",
        {}
    ).get("pageLoadTime")
else:
    page_load = None


if page_load is None:
    page_load_output = "Unknown"
else:
    page_load_output = str(round(page_load / 1000))


print(f"visits={round(visits)}")
print(f"page_load_ms={page_load_output}")
