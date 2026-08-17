#!/usr/bin/env python3

import json
import os
import subprocess
import sys
from pathlib import Path

import boto3


BASE = Path.home() / "repos" / "site-mon"
OUT = BASE / "data" / "dashboard.json"
CONFIG = Path.home() / ".config" / "mediser-monitor" / "config.env"


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


def read_video_r2_info():
    remote = os.environ.get(
        "VIDEO_R2_REMOTE",
        "r2:w41it-video",
    ).rstrip("/")

    result = subprocess.run(
        [
            "rclone",
            "lsjson",
            remote,
            "--recursive",
            "--files-only",
            "--include",
            "**/video.mp4",
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )

    if result.returncode != 0:
        error = result.stderr.strip() or result.stdout.strip() or "rclone lsjson failed"
        raise RuntimeError(error)

    entries = json.loads(result.stdout or "[]")
    objects = 0
    total_bytes = 0

    for entry in entries:
        path = str(entry.get("Path") or entry.get("Name") or "")

        if path != "video.mp4" and not path.endswith("/video.mp4"):
            continue

        size = entry.get("Size")

        if not isinstance(size, (int, float)):
            continue

        objects += 1
        total_bytes += int(size)

    return {
        "gb": round(total_bytes / 1_000_000_000, 2),
        "objects": objects,
        "source": "r2",
    }


def make_dashboard_s3():
    return boto3.client(
        "s3",
        endpoint_url=required("R2_ENDPOINT"),
        aws_access_key_id=required("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=required("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
    )


def main():
    load_env(CONFIG)

    if not OUT.exists():
        raise RuntimeError(f"Missing dashboard JSON: {OUT}")

    payload = json.loads(OUT.read_text(encoding="utf-8"))
    latest = payload.setdefault("latest", {})

    failed = False

    try:
        latest["videoInfo"] = read_video_r2_info()
    except Exception as exc:
        failed = True
        latest["videoInfo"] = {
            "gb": None,
            "objects": None,
            "source": "r2",
            "error": str(exc),
        }
        print(
            f"WARNING: R2 video storage scan failed: {exc}",
            file=sys.stderr,
        )

    text = json.dumps(
        payload,
        indent=2,
        ensure_ascii=False,
    ) + "\n"

    temp = OUT.with_suffix(".json.tmp")
    temp.write_text(text, encoding="utf-8")
    temp.replace(OUT)

    s3 = make_dashboard_s3()
    bucket = required("R2_BUCKET")
    key = os.environ.get(
        "R2_DASHBOARD_KEY",
        "site-monitor/live/dashboard.json",
    )

    response = s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=text.encode("utf-8"),
        ContentType="application/json",
    )

    info = latest["videoInfo"]
    print(
        "Video R2 info: "
        f"{info.get('objects')} videos, {info.get('gb')} GB; "
        f"published {key} {response.get('ETag', '')}"
    )

    return 1 if failed else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
