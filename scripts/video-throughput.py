#!/usr/bin/env python3

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import boto3


BASE = Path.home() / "repos" / "site-mon"
CONFIG = Path.home() / ".config" / "mediser-monitor" / "config.env"
OUT = BASE / "data" / "video-throughput.json"
TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def load_env(path):
    if not path.exists():
        raise RuntimeError(f"Missing config file: {path}")

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


def integer_env(name, default):
    raw = os.environ.get(name)

    if raw is None:
        return default

    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"Invalid integer config value: {name}={raw}") from exc


def discover_video_urls(root, base_url):
    if not root.is_dir():
        return []

    urls = []

    for path in root.rglob("video.mp4"):
        try:
            relative = path.relative_to(root).as_posix()
        except ValueError:
            continue

        urls.append(
            f"{base_url.rstrip('/')}/{quote(relative, safe='/')}"
        )

    return sorted(set(urls))


def add_probe_query(url, stamp):
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    query.append(("probe", stamp))

    return urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            parts.path,
            urlencode(query),
            parts.fragment,
        )
    )


def choose_url(urls, now):
    if not urls:
        raise RuntimeError("No local video.mp4 files available for throughput probe")

    # Rotate through the library so one permanently warm object does not
    # make the whole delivery path look healthier than it really is.
    index = (now.toordinal() * 24 + now.hour) % len(urls)
    return urls[index]


def parse_curl_metrics(raw):
    line = raw.strip().splitlines()[-1] if raw.strip() else ""
    parts = line.split("|")

    if len(parts) != 5:
        raise RuntimeError(f"Unexpected curl metrics: {line!r}")

    code, ttfb, total, speed, size = parts

    return {
        "httpCode": int(code or 0),
        "ttfbMs": round(float(ttfb or 0) * 1000),
        "durationMs": round(float(total or 0) * 1000),
        "bytesPerSecond": round(float(speed or 0)),
        "bytesDownloaded": round(float(size or 0)),
    }


def classify(metrics, returncode, good_bps, slow_bps):
    if (
        metrics["httpCode"] != 206
        or metrics["bytesDownloaded"] <= 0
    ):
        return "UNSTABLE"

    # A timeout is useful evidence even if curl managed to download part of
    # the sample. Do not let a partial transfer be reported as healthy.
    if returncode != 0:
        return "UNSTABLE"

    speed = metrics["bytesPerSecond"]

    if speed >= good_bps:
        return "GOOD"

    if speed >= slow_bps:
        return "SLOW"

    return "UNSTABLE"


def load_history():
    if not OUT.exists():
        return []

    try:
        payload = json.loads(OUT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    history = payload.get("history", [])
    return history if isinstance(history, list) else []


def trim_history(history, cutoff):
    kept = []

    for item in history:
        try:
            stamp = datetime.fromisoformat(
                str(item.get("stamp", "")).replace("Z", "+00:00")
            )
        except ValueError:
            continue

        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=TZ)

        if stamp.astimezone(TZ) >= cutoff:
            kept.append(item)

    return kept


def make_s3():
    return boto3.client(
        "s3",
        endpoint_url=required("R2_ENDPOINT"),
        aws_access_key_id=required("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=required("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
    )


def main():
    load_env(CONFIG)

    now = datetime.now(TZ)
    range_bytes = integer_env("VIDEO_THROUGHPUT_RANGE_BYTES", 8 * 1024 * 1024)
    max_seconds = integer_env("VIDEO_THROUGHPUT_MAX_SECONDS", 120)
    good_bps = integer_env("VIDEO_THROUGHPUT_GOOD_BPS", 1024 * 1024)
    slow_bps = integer_env("VIDEO_THROUGHPUT_SLOW_BPS", 256 * 1024)

    root = Path(os.environ.get("VIDEO_MEDIA_ROOT", "/srv/media"))
    base_url = os.environ.get(
        "VIDEO_R2_BASE_URL",
        "https://w41it-video-r2.meochon341.workers.dev",
    )

    urls = discover_video_urls(root, base_url)
    clean_url = choose_url(urls, now)
    probe_url = add_probe_query(clean_url, now.strftime("%Y%m%d%H%M%S"))

    write_out = "%{http_code}|%{time_starttransfer}|%{time_total}|%{speed_download}|%{size_download}"

    command = [
        "curl",
        "-L",
        "-sS",
        "-r",
        f"0-{range_bytes - 1}",
        "-o",
        "/dev/null",
        "--max-time",
        str(max_seconds),
        "-w",
        write_out,
        probe_url,
    ]

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=max_seconds + 15,
    )

    metrics = parse_curl_metrics(result.stdout)
    status = classify(metrics, result.returncode, good_bps, slow_bps)
    speed_bps = metrics["bytesPerSecond"]

    sample = {
        "stamp": now.isoformat(),
        "label": now.strftime("%H:%M"),
        "status": status,
        "mibps": round(speed_bps / (1024 ** 2), 3),
        "mbps": round(speed_bps * 8 / 1_000_000, 2),
        **metrics,
        "sampleBytes": range_bytes,
        "path": urlsplit(clean_url).path,
        "curlExit": result.returncode,
    }

    if result.stderr.strip():
        sample["curlError"] = result.stderr.strip()

    cutoff = now - timedelta(hours=24)
    history = trim_history(load_history(), cutoff)
    history.append(sample)

    payload = {
        "generated": now.isoformat(),
        "config": {
            "rangeBytes": range_bytes,
            "maxSeconds": max_seconds,
            "goodAtOrAboveBps": good_bps,
            "slowAtOrAboveBps": slow_bps,
        },
        "latest": sample,
        "history": history,
    }

    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUT.with_suffix(".json.tmp")
    temp.write_text(text, encoding="utf-8")
    temp.replace(OUT)

    bucket = required("R2_BUCKET")
    key = os.environ.get(
        "R2_THROUGHPUT_KEY",
        "site-monitor/live/video-throughput.json",
    )

    response = make_s3().put_object(
        Bucket=bucket,
        Key=key,
        Body=text.encode("utf-8"),
        ContentType="application/json",
        CacheControl="no-store",
    )

    print(
        "Video throughput probe: "
        f"{status}; {sample['mibps']:.3f} MiB/s "
        f"({sample['mbps']:.2f} Mbps); "
        f"TTFB {sample['ttfbMs']} ms; "
        f"HTTP {sample['httpCode']}; "
        f"published {key} {response.get('ETag', '')}"
    )

    # An unhealthy transfer is still a successful monitoring run: the probe
    # measured and published the problem. Only monitoring failures exit 1.
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"video throughput probe error: {exc}", file=sys.stderr)
        raise SystemExit(1)
