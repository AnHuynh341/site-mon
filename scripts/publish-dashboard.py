#!/usr/bin/env python3

import json
import os
import re
import subprocess
import sys

from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import boto3


BASE = Path.home() / "repos" / "site-mon"

LOG = BASE / "logs" / "health.log"

OUT = BASE / "data" / "dashboard.json"

CONFIG = (
    Path.home()
    / ".config"
    / "mediser-monitor"
    / "config.env"
)

WEB_ANALYTICS = (
    BASE
    / "scripts"
    / "web-analytics.py"
)

TZ = ZoneInfo("Asia/Ho_Chi_Minh")

TIME_FMT = "%Y-%m-%d %H:%M:%S"


# ============================================================
# CONFIG
# ============================================================

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


# ============================================================
# LOG PARSING
# ============================================================

def parse_ms(value):
    match = re.search(
        r"(\d+(?:\.\d+)?)ms",
        value,
    )

    if not match:
        return None

    return round(
        float(match.group(1))
    )


def parse_sample_values(value):
    if not value.startswith("samples="):
        return []

    result = []

    for item in value.split(
        "=",
        1,
    )[1].split(","):

        item = item.strip()

        if (
            not item
            or item.upper() == "FAIL"
        ):
            result.append(None)
            continue

        try:
            result.append(
                int(item)
            )
        except ValueError:
            result.append(None)

    return result


def parse_health():
    latest = {
        "frontend": None,
        "database": None,
        "storage": None,
    }

    latest_time = {
        "frontend": None,
        "database": None,
        "storage": None,
    }

    latest_samples = []

    history = []

    now = datetime.now(TZ)

    cutoff = (
        now
        - timedelta(hours=24)
    )

    for line in LOG.read_text(
        encoding="utf-8",
        errors="replace",
    ).splitlines():

        if " | " not in line:
            continue

        parts = line.split(" | ")

        try:
            stamp = datetime.strptime(
                parts[0],
                TIME_FMT,
            ).replace(
                tzinfo=TZ
            )

        except (
            ValueError,
            IndexError,
        ):
            continue

        if len(parts) < 2:
            continue

        service = parts[1]

        # ----------------------------------------------------
        # Frontend
        # ----------------------------------------------------

        if (
            service == "frontend"
            and len(parts) >= 5
        ):
            latest["frontend"] = {
                "status": parts[2],
                "ms": parse_ms(
                    parts[4]
                ),
            }

            latest_time["frontend"] = (
                stamp
            )

        # ----------------------------------------------------
        # Appwrite
        # ----------------------------------------------------

        elif (
            service == "appwrite"
            and len(parts) >= 5
        ):
            latest["database"] = {
                "status": parts[2],
                "ms": parse_ms(
                    parts[4]
                ),
            }

            latest_time["database"] = (
                stamp
            )

        # ----------------------------------------------------
        # R2
        # ----------------------------------------------------

        elif (
            service == "r2-media"
            and len(parts) >= 6
        ):
            try:
                ok, total = (
                    int(x)
                    for x
                    in parts[3].split(
                        "/",
                        1,
                    )
                )

            except ValueError:
                ok = 0
                total = 5

            average = (
                parse_ms(parts[4])
                if ok
                else None
            )

            worst = (
                parse_ms(parts[5])
                if ok
                else None
            )

            latest["storage"] = {
                "status":
                    parts[2],

                "ms":
                    average,

                "worst":
                    worst,

                "successfulSamples":
                    ok,

                "totalSamples":
                    total,
            }

            latest_time["storage"] = (
                stamp
            )

            for extra in parts[6:]:
                if extra.startswith(
                    "samples="
                ):
                    latest_samples = (
                        parse_sample_values(
                            extra
                        )
                    )
                    break

            if stamp >= cutoff:
                history.append(
                    {
                        "stamp":
                            stamp,

                        "average":
                            average,

                        "worst":
                            worst,
                    }
                )

    # --------------------------------------------------------
    # Missing-data fallbacks
    # --------------------------------------------------------

    if latest["frontend"] is None:
        latest["frontend"] = {
            "status": "UNKNOWN",
            "ms": None,
        }

    if latest["database"] is None:
        latest["database"] = {
            "status": "UNKNOWN",
            "ms": None,
        }

    if latest["storage"] is None:
        latest["storage"] = {
            "status":
                "UNKNOWN",

            "ms":
                None,

            "worst":
                None,

            "successfulSamples":
                0,

            "totalSamples":
                5,
        }

    times = [
        value
        for value
        in latest_time.values()
        if value is not None
    ]

    generated = (
        max(times).isoformat()
        if times
        else None
    )

    history.sort(
        key=lambda item:
            item["stamp"]
    )

    samples = [
        {
            "name":
                f"Sample {i + 1}",

            "ms":
                (
                    latest_samples[i]
                    if i < len(
                        latest_samples
                    )
                    else None
                ),
        }

        for i in range(5)
    ]

    return (
        latest,
        samples,
        history,
        generated,
    )


# ============================================================
# CLOUDFLARE WEB ANALYTICS
# ============================================================

def get_web_analytics():
    result = subprocess.run(
        [
            str(WEB_ANALYTICS),
            "--dashboard-json",
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )

    if result.returncode != 0:
        error = (
            result.stderr.strip()
            or result.stdout.strip()
            or "unknown error"
        )

        raise RuntimeError(
            "web-analytics.py failed: "
            + error
        )

    try:
        payload = json.loads(
            result.stdout
        )

    except json.JSONDecodeError as exc:
        raise RuntimeError(
            "web-analytics.py returned "
            "invalid JSON"
        ) from exc

    return payload


# ============================================================
# R2 CLIENT
# ============================================================

def make_s3():
    return boto3.client(
        "s3",

        endpoint_url=required(
            "R2_ENDPOINT"
        ),

        aws_access_key_id=required(
            "R2_ACCESS_KEY_ID"
        ),

        aws_secret_access_key=required(
            "R2_SECRET_ACCESS_KEY"
        ),

        region_name="auto",
    )


# ============================================================
# R2 STORAGE INFORMATION
# ============================================================

def storage_info(
    s3,
    bucket,
):
    objects = 0
    total_bytes = 0

    paginator = (
        s3.get_paginator(
            "list_objects_v2"
        )
    )

    for page in paginator.paginate(
        Bucket=bucket
    ):
        for obj in page.get(
            "Contents",
            [],
        ):
            objects += 1

            total_bytes += obj.get(
                "Size",
                0,
            )

    return {
        "gb":
            round(
                total_bytes
                / 1_000_000_000,
                2,
            ),

        "objects":
            objects,
    }


# ============================================================
# MAIN
# ============================================================

def main():
    load_env(CONFIG)

    bucket = required(
        "R2_BUCKET"
    )

    key = os.environ.get(
        "R2_DASHBOARD_KEY",
        "site-monitor/live/dashboard.json",
    )

    (
        latest,
        samples,
        history,
        generated,
    ) = parse_health()

    # --------------------------------------------------------
    # Fetch analytics
    #
    # Analytics failure must NOT prevent health data
    # from being published.
    # --------------------------------------------------------

    analytics_summary = {
        "visits": None,
        "pageLoad": None,
    }

    visits = {
        "labels": [],
        "values": [],
    }

    page_load = {
        "labels": [],
        "values": [],
    }

    analytics_generated = None

    try:
        analytics = (
            get_web_analytics()
        )

        analytics_generated = (
            analytics.get(
                "generated"
            )
        )

        analytics_summary = (
            analytics.get(
                "summary",
                analytics_summary,
            )
        )

        visits = (
            analytics.get(
                "visits",
                visits,
            )
        )

        page_load = (
            analytics.get(
                "pageLoad",
                page_load,
            )
        )

    except Exception as exc:
        print(
            "WARNING: analytics unavailable; "
            "publishing health data anyway: "
            f"{exc}",
            file=sys.stderr,
        )

    # --------------------------------------------------------
    # R2
    # --------------------------------------------------------

    s3 = make_s3()

    latest["storageInfo"] = (
        storage_info(
            s3,
            bucket,
        )
    )

    # --------------------------------------------------------
    # Final dashboard payload
    # --------------------------------------------------------

    payload = {
        "generated":
            generated,

        "published":
            datetime.now(
                TZ
            ).isoformat(),

        "analyticsGenerated":
            analytics_generated,

        "latest": {
            **latest,

            "analytics":
                analytics_summary,
        },

        "visits":
            visits,

        "pageLoad":
            page_load,

        "r2History": {
            "labels": [
                item["stamp"].strftime(
                    "%H:%M"
                )
                for item
                in history
            ],

            "average": [
                item["average"]
                for item
                in history
            ],

            "worst": [
                item["worst"]
                for item
                in history
            ],
        },

        "samples":
            samples,
    }

    text = json.dumps(
        payload,
        indent=2,
        ensure_ascii=False,
    ) + "\n"

    # --------------------------------------------------------
    # Atomic local write
    # --------------------------------------------------------

    OUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp = OUT.with_suffix(
        ".json.tmp"
    )

    temp.write_text(
        text,
        encoding="utf-8",
    )

    temp.replace(
        OUT
    )

    # --------------------------------------------------------
    # Publish to R2
    # --------------------------------------------------------

    response = s3.put_object(
        Bucket=bucket,

        Key=key,

        Body=text.encode(
            "utf-8"
        ),

        ContentType=
            "application/json",
    )

    print(
        f"Published {key} "
        f"{response.get('ETag', '')}"
    )


if __name__ == "__main__":
    main()
