#!/usr/bin/env python3

import json
import os
import re
import subprocess
import sys
import time

from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import boto3


BASE = Path.home() / "repos" / "site-mon"
LOG = BASE / "logs" / "health.log"
OUT = BASE / "data" / "dashboard.json"
CONFIG = Path.home() / ".config" / "mediser-monitor" / "config.env"
WEB_ANALYTICS = BASE / "scripts" / "web-analytics.py"
R2_USAGE = BASE / "scripts" / "r2-usage.py"
TZ = ZoneInfo("Asia/Ho_Chi_Minh")
TIME_FMT = "%Y-%m-%d %H:%M:%S"
FALLBACK_MAX_AGE = timedelta(hours=2)


# ============================================================
# CONFIG
# ============================================================

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


# ============================================================
# LAST-KNOWN-GOOD FALLBACK HELPERS
# ============================================================

def load_previous_dashboard():
    if not OUT.exists():
        return {}

    try:
        payload = json.loads(OUT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

    return payload if isinstance(payload, dict) else {}


def parse_iso(value):
    if not value:
        return None

    try:
        stamp = datetime.fromisoformat(
            str(value).replace("Z", "+00:00")
        )
    except ValueError:
        return None

    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=TZ)

    return stamp.astimezone(TZ)


def recent_enough(value):
    stamp = parse_iso(value)

    if stamp is None:
        return False

    age = datetime.now(TZ) - stamp
    return timedelta(0) <= age <= FALLBACK_MAX_AGE


def finite_number(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
    )


def has_positive_values(chart):
    if not isinstance(chart, dict):
        return False

    return any(
        finite_number(value) and value > 0
        for value in chart.get("values", [])
    )


def has_useful_analytics_history(visits, page_load):
    # The headless browser normally gives the performance chart
    # samples even during hours with no human visits. If BOTH
    # rolling datasets suddenly go empty, treat it as a transient
    # Cloudflare analytics gap rather than overwriting good data.
    return (
        has_positive_values(visits)
        or has_positive_values(page_load)
    )


def r2_operation_total(payload):
    if not isinstance(payload, dict):
        return 0

    total = 0

    for key in (
        "classA",
        "classB",
        "freeOperations",
        "other",
    ):
        value = payload.get(key)

        if finite_number(value):
            total += value

    return total


# ============================================================
# HEALTH LOG PARSING
# ============================================================

def parse_ms(value):
    match = re.search(r"(\d+(?:\.\d+)?)ms", value)

    if not match:
        return None

    return round(float(match.group(1)))


def parse_sample_values(value, prefix="samples="):
    if not value.startswith(prefix):
        return []

    result = []

    for item in value[len(prefix):].split(","):
        item = item.strip()

        if not item or item.upper() == "FAIL":
            result.append(None)
            continue

        try:
            result.append(int(item))
        except ValueError:
            result.append(None)

    return result


def parse_health():
    latest = {
        "frontend": None,
        "database": None,
        "storage": None,
        "video": None,
    }

    latest_time = {
        "frontend": None,
        "database": None,
        "storage": None,
        "video": None,
    }

    latest_samples = []
    latest_video_fetch_samples = []
    history = []
    video_history = []
    now = datetime.now(TZ)
    cutoff = now - timedelta(hours=24)

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
            ).replace(tzinfo=TZ)
        except (ValueError, IndexError):
            continue

        if len(parts) < 2:
            continue

        service = parts[1]

        if service == "frontend" and len(parts) >= 5:
            latest["frontend"] = {
                "status": parts[2],
                "ms": parse_ms(parts[4]),
            }
            latest_time["frontend"] = stamp

        elif service == "appwrite" and len(parts) >= 5:
            latest["database"] = {
                "status": parts[2],
                "ms": parse_ms(parts[4]),
            }
            latest_time["database"] = stamp

        elif service == "r2-media" and len(parts) >= 6:
            try:
                ok, total = (
                    int(x)
                    for x in parts[3].split("/", 1)
                )
            except ValueError:
                ok = 0
                total = 5

            average = parse_ms(parts[4]) if ok else None
            worst = parse_ms(parts[5]) if ok else None

            latest["storage"] = {
                "status": parts[2],
                "ms": average,
                "worst": worst,
                "successfulSamples": ok,
                "totalSamples": total,
            }
            latest_time["storage"] = stamp

            for extra in parts[6:]:
                if extra.startswith("samples="):
                    latest_samples = parse_sample_values(extra)
                    break

            if stamp >= cutoff:
                history.append(
                    {
                        "stamp": stamp,
                        "average": average,
                        "worst": worst,
                    }
                )

        elif service == "video-media" and len(parts) >= 5:
            try:
                ok, total = (
                    int(x)
                    for x in parts[3].split("/", 1)
                )
            except ValueError:
                ok = 0
                total = 5

            average_fetch = parse_ms(parts[4]) if ok else None
            fetch_samples = []

            for extra in parts[5:]:
                if extra.startswith("samples="):
                    fetch_samples = parse_sample_values(extra)
                elif extra.startswith("fetch="):
                    # Backward-compatible with the first draft format.
                    fetch_samples = parse_sample_values(
                        extra,
                        "fetch=",
                    )

            latest["video"] = {
                "status": parts[2],
                "ms": average_fetch,
                "successfulSamples": ok,
                "totalSamples": total,
            }
            latest_time["video"] = stamp
            latest_video_fetch_samples = fetch_samples

            if stamp >= cutoff:
                video_history.append(
                    {
                        "stamp": stamp,
                        "average": average_fetch,
                    }
                )

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
            "status": "UNKNOWN",
            "ms": None,
            "worst": None,
            "successfulSamples": 0,
            "totalSamples": 5,
        }

    if latest["video"] is None:
        latest["video"] = {
            "status": "UNKNOWN",
            "ms": None,
            "successfulSamples": 0,
            "totalSamples": 5,
        }

    times = [
        value
        for value in latest_time.values()
        if value is not None
    ]

    generated = max(times).isoformat() if times else None

    history.sort(key=lambda item: item["stamp"])
    video_history.sort(key=lambda item: item["stamp"])

    samples = [
        {
            "name": f"Sample {i + 1}",
            "ms": (
                latest_samples[i]
                if i < len(latest_samples)
                else None
            ),
        }
        for i in range(5)
    ]

    video_samples = [
        {
            "name": f"Sample {i + 1}",
            "ms": (
                latest_video_fetch_samples[i]
                if i < len(latest_video_fetch_samples)
                else None
            ),
        }
        for i in range(5)
    ]

    return (
        latest,
        samples,
        history,
        video_history,
        video_samples,
        generated,
    )


# ============================================================
# EXTERNAL DATA SCRIPTS
# ============================================================

def run_json_script(command, label, attempts=3):
    last_error = None

    for attempt in range(1, attempts + 1):
        try:
            result = subprocess.run(
                command,
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
                raise RuntimeError(f"{label} failed: {error}")

            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError as exc:
                raise RuntimeError(
                    f"{label} returned invalid JSON"
                ) from exc

        except Exception as exc:
            last_error = exc

            if attempt < attempts:
                time.sleep(2)

    raise RuntimeError(
        str(last_error)
        if last_error
        else f"{label} failed"
    )


def get_web_analytics():
    return run_json_script(
        [str(WEB_ANALYTICS), "--dashboard-json"],
        "web-analytics.py",
    )


def get_r2_usage():
    return run_json_script(
        [str(R2_USAGE)],
        "r2-usage.py",
    )


# ============================================================
# R2 CLIENT / STORAGE INFO
# ============================================================

def make_s3():
    return boto3.client(
        "s3",
        endpoint_url=required("R2_ENDPOINT"),
        aws_access_key_id=required("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=required("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
    )


def storage_info(s3, bucket):
    objects = 0
    total_bytes = 0

    paginator = s3.get_paginator("list_objects_v2")

    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            objects += 1
            total_bytes += obj.get("Size", 0)

    return {
        "gb": round(total_bytes / 1_000_000_000, 2),
        "objects": objects,
    }


def video_storage_info(root):
    objects = 0
    total_bytes = 0

    if not root.is_dir():
        return {
            "gb": None,
            "objects": None,
        }

    for path in root.rglob("video.mp4"):
        try:
            total_bytes += path.stat().st_size
            objects += 1
        except OSError:
            continue

    return {
        "gb": round(total_bytes / 1_000_000_000, 2),
        "objects": objects,
    }


# ============================================================
# MAIN
# ============================================================

def main():
    load_env(CONFIG)
    previous = load_previous_dashboard()

    bucket = required("R2_BUCKET")
    key = os.environ.get(
        "R2_DASHBOARD_KEY",
        "site-monitor/live/dashboard.json",
    )

    (
        latest,
        samples,
        history,
        video_history,
        video_samples,
        generated,
    ) = parse_health()

    previous_summary = (
        previous.get("latest", {}).get("analytics", {})
    )
    previous_visits = previous.get("visits", {})
    previous_page_load = previous.get("pageLoad", {})
    previous_analytics_generated = previous.get(
        "analyticsGenerated"
    )
    previous_r2_usage = previous.get("r2Usage", {})

    # --------------------------------------------------------
    # Web Analytics / Site Performance
    # --------------------------------------------------------

    analytics_summary = {
        "visits": None,
        "visitsWithoutBots": None,
        "pageLoad": None,
    }
    visits = {
        "labels": [],
        "values": [],
        "withoutBots": [],
    }
    page_load = {
        "labels": [],
        "values": [],
    }
    analytics_generated = None
    analytics_fallback = False

    previous_analytics_recent = recent_enough(
        previous_analytics_generated
    )

    try:
        analytics = get_web_analytics()

        analytics_generated = analytics.get("generated")
        analytics_summary = analytics.get(
            "summary",
            analytics_summary,
        )
        visits = analytics.get("visits", visits)
        page_load = analytics.get("pageLoad", page_load)

        current_history_useful = has_useful_analytics_history(
            visits,
            page_load,
        )
        previous_history_useful = has_useful_analytics_history(
            previous_visits,
            previous_page_load,
        )

        if (
            not current_history_useful
            and previous_history_useful
            and previous_analytics_recent
        ):
            visits = previous_visits
            page_load = previous_page_load
            analytics_generated = previous_analytics_generated
            analytics_fallback = True

            print(
                "WARNING: analytics returned an empty 24-hour "
                "dataset; keeping recent last-known-good chart data",
                file=sys.stderr,
            )

        # The daily page-load summary can briefly be null just
        # after midnight. Keep the recent value rather than
        # flashing a dash while Cloudflare catches up.
        if (
            analytics_summary.get("pageLoad") is None
            and finite_number(previous_summary.get("pageLoad"))
            and previous_analytics_recent
        ):
            analytics_summary = {
                **analytics_summary,
                "pageLoad": previous_summary["pageLoad"],
            }
            analytics_fallback = True

    except Exception as exc:
        if (
            previous_analytics_recent
            and has_useful_analytics_history(
                previous_visits,
                previous_page_load,
            )
        ):
            analytics_summary = previous_summary
            visits = previous_visits
            page_load = previous_page_load
            analytics_generated = previous_analytics_generated
            analytics_fallback = True

            print(
                "WARNING: analytics unavailable; keeping recent "
                f"last-known-good data: {exc}",
                file=sys.stderr,
            )
        else:
            print(
                "WARNING: analytics unavailable and no recent "
                "fallback is available; publishing health data "
                f"anyway: {exc}",
                file=sys.stderr,
            )

    # --------------------------------------------------------
    # R2 operation usage
    # --------------------------------------------------------

    r2_usage = {
        "generated": None,
        "month": None,
        "classA": None,
        "classB": None,
        "freeOperations": None,
        "other": None,
        "breakdown": {},
    }
    r2_usage_fallback = False
    previous_r2_recent = recent_enough(
        previous_r2_usage.get("generated")
    )

    try:
        r2_usage = get_r2_usage()

        current_total = r2_operation_total(r2_usage)
        previous_total = r2_operation_total(previous_r2_usage)
        same_month = (
            r2_usage.get("month")
            == previous_r2_usage.get("month")
        )

        if (
            current_total == 0
            and previous_total > 0
            and same_month
            and previous_r2_recent
        ):
            r2_usage = previous_r2_usage
            r2_usage_fallback = True

            print(
                "WARNING: R2 usage returned zero mid-month; "
                "keeping recent last-known-good operation totals",
                file=sys.stderr,
            )

    except Exception as exc:
        if (
            previous_r2_recent
            and r2_operation_total(previous_r2_usage) > 0
        ):
            r2_usage = previous_r2_usage
            r2_usage_fallback = True

            print(
                "WARNING: R2 usage unavailable; keeping recent "
                f"last-known-good data: {exc}",
                file=sys.stderr,
            )
        else:
            print(
                "WARNING: R2 usage unavailable and no recent "
                "fallback is available; publishing dashboard "
                f"anyway: {exc}",
                file=sys.stderr,
            )

    # --------------------------------------------------------
    # R2 storage information
    # --------------------------------------------------------

    s3 = make_s3()
    latest["storageInfo"] = storage_info(s3, bucket)
    latest["videoInfo"] = video_storage_info(
        Path(
            os.environ.get(
                "VIDEO_MEDIA_DIR",
                "/srv/media/anime",
            )
        )
    )

    # --------------------------------------------------------
    # Final dashboard JSON
    # --------------------------------------------------------

    payload = {
        "generated": generated,
        "published": datetime.now(TZ).isoformat(),
        "analyticsGenerated": analytics_generated,
        "sourceFallback": {
            "analytics": analytics_fallback,
            "r2Usage": r2_usage_fallback,
        },
        "latest": {
            **latest,
            "analytics": analytics_summary,
        },
        "visits": visits,
        "pageLoad": page_load,
        "r2Usage": r2_usage,
        "r2History": {
            "labels": [
                item["stamp"].strftime("%H:%M")
                for item in history
            ],
            "average": [
                item["average"]
                for item in history
            ],
            "worst": [
                item["worst"]
                for item in history
            ],
        },
        "samples": samples,
        "videoHistory": {
            "labels": [
                item["stamp"].strftime("%H:%M")
                for item in video_history
            ],
            "average": [
                item["average"]
                for item in video_history
            ],
        },
        "videoSamples": video_samples,
    }

    text = json.dumps(
        payload,
        indent=2,
        ensure_ascii=False,
    ) + "\n"

    # Atomic local write.
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUT.with_suffix(".json.tmp")
    temp.write_text(text, encoding="utf-8")
    temp.replace(OUT)

    # Publish to R2.
    response = s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=text.encode("utf-8"),
        ContentType="application/json",
    )

    print(
        f"Published {key} {response.get('ETag', '')}"
    )


if __name__ == "__main__":
    main()
