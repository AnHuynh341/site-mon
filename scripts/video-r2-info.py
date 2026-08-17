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
        error = (
            result.stderr.strip()
            or result.stdout.strip()
            or "rclone lsjson failed"
        )
        raise RuntimeError(error)

    entries = json.loads(result.stdout or "[]")
    objects = 0
    total_bytes = 0

    for entry in entries:
        path = str(
            entry.get("Path")
            or entry.get("Name")
            or ""
        )

        if (
            path != "video.mp4"
            and not path.endswith("/video.mp4")
        ):
            continue

        size = entry.get("Size")

        if not isinstance(size, (int, float)):
            continue

        objects += 1
        total_bytes += int(size)

    return {
        "gb": round(
            total_bytes / 1_000_000_000,
            2,
        ),
        "objects": objects,
        "source": "r2",
    }


def finite_number(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
    )


def combine_storage_health(latest):
    """
    Combine the latest audio and video R2 probes into the single
    Storage service-health value shown by the dashboard.

    The average is weighted by the number of successful samples so
    five audio samples + five video samples behave like one ten-sample
    R2 probe rather than an average-of-averages guess.

    Audio/video delivery charts remain separate because their history
    and probe-health payloads are not modified here.
    """

    audio = latest.get("storage")
    video = latest.get("video")

    if not isinstance(audio, dict):
        audio = {}

    if not isinstance(video, dict):
        video = {}

    audio_success = int(
        audio.get("successfulSamples") or 0
    )
    video_success = int(
        video.get("successfulSamples") or 0
    )

    audio_total = int(
        audio.get("totalSamples") or 0
    )
    video_total = int(
        video.get("totalSamples") or 0
    )

    total_success = (
        audio_success
        + video_success
    )
    total_samples = (
        audio_total
        + video_total
    )

    weighted_sum = 0.0
    weighted_count = 0

    audio_ms = audio.get("ms")
    video_ms = video.get("ms")

    if (
        audio_success > 0
        and finite_number(audio_ms)
    ):
        weighted_sum += (
            float(audio_ms)
            * audio_success
        )
        weighted_count += audio_success

    if (
        video_success > 0
        and finite_number(video_ms)
    ):
        weighted_sum += (
            float(video_ms)
            * video_success
        )
        weighted_count += video_success

    combined_ms = (
        round(weighted_sum / weighted_count)
        if weighted_count > 0
        else None
    )

    worst_values = [
        value
        for value in (
            audio.get("worst"),
            video.get("worst"),
        )
        if finite_number(value)
    ]

    combined_worst = (
        max(worst_values)
        if worst_values
        else None
    )

    audio_status = str(
        audio.get("status") or "UNKNOWN"
    ).upper()
    video_status = str(
        video.get("status") or "UNKNOWN"
    ).upper()

    if total_success == 0:
        combined_status = "DOWN"

    elif (
        total_samples > 0
        and total_success < total_samples
    ):
        combined_status = "UNSTABLE"

    elif (
        audio_status == "UP"
        and video_status == "UP"
    ):
        combined_status = "UP"

    elif (
        audio_status == "DOWN"
        and video_status == "DOWN"
    ):
        combined_status = "DOWN"

    else:
        combined_status = "UNSTABLE"

    latest["storage"] = {
        "status": combined_status,
        "ms": combined_ms,
        "worst": combined_worst,
        "successfulSamples": total_success,
        "totalSamples": total_samples,
        "audioMs": (
            round(audio_ms)
            if finite_number(audio_ms)
            else None
        ),
        "videoMs": (
            round(video_ms)
            if finite_number(video_ms)
            else None
        ),
        "audioStatus": audio_status,
        "videoStatus": video_status,
        "combined": True,
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
        raise RuntimeError(
            f"Missing dashboard JSON: {OUT}"
        )

    payload = json.loads(
        OUT.read_text(encoding="utf-8")
    )
    latest = payload.setdefault(
        "latest",
        {},
    )

    # The final Storage service-health card represents all media
    # currently served from R2: audio + video.
    combine_storage_health(latest)

    failed = False

    try:
        latest["videoInfo"] = (
            read_video_r2_info()
        )
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

    temp = OUT.with_suffix(
        ".json.tmp"
    )
    temp.write_text(
        text,
        encoding="utf-8",
    )
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
    storage = latest.get("storage", {})

    print(
        "Combined R2 health: "
        f"audio={storage.get('audioMs')} ms, "
        f"video={storage.get('videoMs')} ms, "
        f"average={storage.get('ms')} ms; "
        "Video R2 info: "
        f"{info.get('objects')} videos, "
        f"{info.get('gb')} GB; "
        f"published {key} "
        f"{response.get('ETag', '')}"
    )

    return 1 if failed else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(
            f"ERROR: {exc}",
            file=sys.stderr,
        )
        raise SystemExit(1)
