#!/usr/bin/env python3

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


CONFIG = Path.home() / ".config/mediser-monitor/config.env"
GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql"
LOCAL_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def load_env(path):
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        value = value.strip()

        if (
            len(value) >= 2
            and value[0] == value[-1]
            and value[0] in "\"'"
        ):
            value = value[1:-1]

        os.environ.setdefault(key.strip(), value)


def required(name):
    value = os.environ.get(name)

    if not value:
        raise RuntimeError(f"Missing config value: {name}")

    return value


def iso_utc(value):
    return (
        value.astimezone(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def graphql(query, variables):
    token = required("CLOUDFLARE_ANALYTICS_TOKEN")

    payload = json.dumps(
        {
            "query": query,
            "variables": variables,
        }
    ).encode("utf-8")

    request = Request(
        GRAPHQL_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    try:
        with urlopen(request, timeout=30) as response:
            result = json.load(response)

    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Cloudflare GraphQL HTTP {exc.code}: {body}"
        ) from exc

    except URLError as exc:
        raise RuntimeError(
            f"Cloudflare GraphQL connection failed: {exc}"
        ) from exc

    if result.get("errors"):
        raise RuntimeError(
            "Cloudflare GraphQL error: "
            + json.dumps(result["errors"])
        )

    return result


SUMMARY_QUERY = """
query W41ITSummary(
  $accountTag: String!
  $start: Time!
  $end: Time!
  $host: String!
) {
  viewer {
    accounts(filter: {accountTag: $accountTag}) {
      pageload: rumPageloadEventsAdaptiveGroups(
        limit: 100
        filter: {
          datetime_geq: $start
          datetime_lt: $end
          requestHost: $host
        }
      ) {
        sum {
          visits
        }
      }

      performance: rumPerformanceEventsAdaptiveGroups(
        limit: 100
        filter: {
          datetime_geq: $start
          datetime_lt: $end
          requestHost: $host
        }
      ) {
        avg {
          pageLoadTime
        }
      }
    }
  }
}
"""


HOURLY_QUERY = """
query W41ITHourly(
  $accountTag: String!
  $start: Time!
  $end: Time!
  $host: String!
) {
  viewer {
    accounts(filter: {accountTag: $accountTag}) {
      pageload: rumPageloadEventsAdaptiveGroups(
        limit: 1000
        orderBy: [datetimeHour_ASC]
        filter: {
          datetime_geq: $start
          datetime_lt: $end
          requestHost: $host
        }
      ) {
        dimensions {
          datetimeHour
        }
        sum {
          visits
        }
      }

      performance: rumPerformanceEventsAdaptiveGroups(
        limit: 1000
        orderBy: [datetimeHour_ASC]
        filter: {
          datetime_geq: $start
          datetime_lt: $end
          requestHost: $host
        }
      ) {
        dimensions {
          datetimeHour
        }
        avg {
          pageLoadTime
        }
      }
    }
  }
}
"""


def get_account_block(result):
    accounts = (
        result.get("data", {})
        .get("viewer", {})
        .get("accounts", [])
    )

    if not accounts:
        raise RuntimeError(
            "Cloudflare GraphQL returned no account data"
        )

    return accounts[0]


def page_load_ms(raw):
    if raw is None:
        return None

    return round(float(raw) / 1000)


def get_today_summary(account_id, host, now_local):
    start_local = now_local.replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )

    result = graphql(
        SUMMARY_QUERY,
        {
            "accountTag": account_id,
            "start": iso_utc(start_local),
            "end": iso_utc(now_local),
            "host": host,
        },
    )

    account = get_account_block(result)

    visits = sum(
        int(group.get("sum", {}).get("visits") or 0)
        for group in account.get("pageload", [])
    )

    load_values = [
        group.get("avg", {}).get("pageLoadTime")
        for group in account.get("performance", [])
        if group.get("avg", {}).get("pageLoadTime") is not None
    ]

    if load_values:
        raw_page_load = (
            sum(float(value) for value in load_values)
            / len(load_values)
        )
        load_ms = page_load_ms(raw_page_load)
    else:
        load_ms = None

    return {
        "visits": visits,
        "pageLoad": load_ms,
    }


def get_hourly(account_id, host, now_local):
    current_hour = now_local.replace(
        minute=0,
        second=0,
        microsecond=0,
    )

    hours = [
        current_hour - timedelta(hours=offset)
        for offset in range(23, -1, -1)
    ]

    result = graphql(
        HOURLY_QUERY,
        {
            "accountTag": account_id,
            "start": iso_utc(hours[0]),
            "end": iso_utc(now_local),
            "host": host,
        },
    )

    account = get_account_block(result)

    visits_by_hour = {}
    load_by_hour = {}

    for group in account.get("pageload", []):
        stamp = group.get("dimensions", {}).get("datetimeHour")

        if not stamp:
            continue

        dt = datetime.fromisoformat(
            stamp.replace("Z", "+00:00")
        ).astimezone(LOCAL_TZ)

        key = dt.strftime("%Y-%m-%dT%H")

        visits_by_hour[key] = (
            visits_by_hour.get(key, 0)
            + int(group.get("sum", {}).get("visits") or 0)
        )

    for group in account.get("performance", []):
        stamp = group.get("dimensions", {}).get("datetimeHour")
        raw = group.get("avg", {}).get("pageLoadTime")

        if not stamp or raw is None:
            continue

        dt = datetime.fromisoformat(
            stamp.replace("Z", "+00:00")
        ).astimezone(LOCAL_TZ)

        key = dt.strftime("%Y-%m-%dT%H")
        load_by_hour[key] = page_load_ms(raw)

    labels = [
        hour.strftime("%H:%M")
        for hour in hours
    ]

    visit_values = [
        visits_by_hour.get(
            hour.strftime("%Y-%m-%dT%H"),
            0,
        )
        for hour in hours
    ]

    page_load_values = [
        load_by_hour.get(
            hour.strftime("%Y-%m-%dT%H")
        )
        for hour in hours
    ]

    return {
        "visits": {
            "labels": labels,
            "values": visit_values,
        },
        "pageLoad": {
            "labels": labels,
            "values": page_load_values,
        },
    }


def build_dashboard_payload():
    account_id = required("CLOUDFLARE_ACCOUNT_ID")
    host = required("WEB_ANALYTICS_HOST")

    now_local = datetime.now(LOCAL_TZ)

    summary = get_today_summary(
        account_id,
        host,
        now_local,
    )

    hourly = get_hourly(
        account_id,
        host,
        now_local,
    )

    return {
        "generated": now_local.isoformat(),
        "summary": summary,
        **hourly,
    }


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--dashboard-json",
        action="store_true",
    )

    args = parser.parse_args()

    load_env(CONFIG)

    try:
        payload = build_dashboard_payload()

    except Exception as exc:
        print(
            f"web analytics error: {exc}",
            file=sys.stderr,
        )
        return 1

    if args.dashboard_json:
        print(
            json.dumps(
                payload,
                indent=2,
                ensure_ascii=False,
            )
        )
        return 0

    print(
        f"visits={payload['summary']['visits']}"
    )

    page_load = payload["summary"]["pageLoad"]

    if page_load is None:
        print("page_load_ms=Unknown")
    else:
        print(f"page_load_ms={page_load}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
