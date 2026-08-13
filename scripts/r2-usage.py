#!/usr/bin/env python3

import json
import os
import sys

from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


CONFIG = (
    Path.home()
    / ".config"
    / "mediser-monitor"
    / "config.env"
)

GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql"
LOCAL_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


CLASS_A = {
    "ListBuckets",
    "PutBucket",
    "ListObjects",
    "ListObjectsV2",
    "PutObject",
    "CopyObject",
    "CompleteMultipartUpload",
    "CreateMultipartUpload",
    "LifecycleStorageTierTransition",
    "ListMultipartUploads",
    "UploadPart",
    "UploadPartCopy",
    "ListParts",
    "PutBucketEncryption",
    "PutBucketCors",
    "PutBucketLifecycleConfiguration",
}


CLASS_B = {
    "HeadBucket",
    "HeadObject",
    "GetObject",
    "UsageSummary",
    "GetBucketEncryption",
    "GetBucketLocation",
    "GetBucketCors",
    "GetBucketLifecycleConfiguration",
}


FREE_OPERATIONS = {
    "DeleteObject",
    "DeleteBucket",
    "AbortMultipartUpload",
}


QUERY = """
query R2Operations(
  $accountTag: string!
  $startDate: Time!
  $endDate: Time!
) {
  viewer {
    accounts(
      filter: {
        accountTag: $accountTag
      }
    ) {
      operations: r2OperationsAdaptiveGroups(
        limit: 10000
        filter: {
          datetime_geq: $startDate
          datetime_leq: $endDate
        }
      ) {
        sum {
          requests
        }
        dimensions {
          actionType
        }
      }
    }
  }
}
"""


def load_env(path):
    for raw in path.read_text(
        encoding="utf-8"
    ).splitlines():

        line = raw.strip()

        if (
            not line
            or line.startswith("#")
            or "=" not in line
        ):
            continue

        key, value = line.split("=", 1)
        value = value.strip()

        if (
            len(value) >= 2
            and value[0] == value[-1]
            and value[0] in "\"'"
        ):
            value = value[1:-1]

        os.environ.setdefault(
            key.strip(),
            value,
        )


def required(name):
    value = os.environ.get(name)

    if not value:
        raise RuntimeError(
            f"Missing config value: {name}"
        )

    return value


def iso_utc(value):
    return (
        value
        .astimezone(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def graphql(query, variables):
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
            "Authorization":
                f"Bearer {required('CLOUDFLARE_ANALYTICS_TOKEN')}",
            "Content-Type":
                "application/json",
            "Accept":
                "application/json",
        },
    )

    try:
        with urlopen(
            request,
            timeout=30,
        ) as response:
            result = json.load(
                response
            )

    except HTTPError as exc:
        body = exc.read().decode(
            "utf-8",
            errors="replace",
        )

        raise RuntimeError(
            f"Cloudflare HTTP {exc.code}: {body}"
        ) from exc

    except URLError as exc:
        raise RuntimeError(
            f"Cloudflare connection failed: {exc}"
        ) from exc

    if result.get("errors"):
        raise RuntimeError(
            "Cloudflare GraphQL error: "
            + json.dumps(
                result["errors"]
            )
        )

    return result


def main():
    load_env(CONFIG)

    now = datetime.now(
        LOCAL_TZ
    )

    start = now.replace(
        day=1,
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )

    result = graphql(
        QUERY,
        {
            "accountTag":
                required(
                    "CLOUDFLARE_ACCOUNT_ID"
                ),
            "startDate":
                iso_utc(start),
            "endDate":
                iso_utc(now),
        },
    )

    accounts = (
        result
        .get("data", {})
        .get("viewer", {})
        .get("accounts", [])
    )

    if not accounts:
        raise RuntimeError(
            "No account data returned"
        )

    operations = accounts[0].get(
        "operations",
        [],
    )

    class_a = 0
    class_b = 0
    free = 0
    other = 0

    breakdown = {}

    for item in operations:
        action = (
            item
            .get("dimensions", {})
            .get("actionType")
        )

        requests = int(
            item
            .get("sum", {})
            .get("requests")
            or 0
        )

        if not action:
            continue

        breakdown[action] = (
            breakdown.get(
                action,
                0,
            )
            + requests
        )

        if action in CLASS_A:
            class_a += requests

        elif action in CLASS_B:
            class_b += requests

        elif action in FREE_OPERATIONS:
            free += requests

        else:
            other += requests

    payload = {
        "generated":
            now.isoformat(),

        "month":
            now.strftime(
                "%Y-%m"
            ),

        "classA":
            class_a,

        "classB":
            class_b,

        "freeOperations":
            free,

        "other":
            other,

        "breakdown":
            breakdown,
    }

    print(
        json.dumps(
            payload,
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    try:
        main()

    except Exception as exc:
        print(
            f"r2 usage error: {exc}",
            file=sys.stderr,
        )

        raise SystemExit(1)
