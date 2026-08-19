#!/usr/bin/env python3
import json
import os
import random
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import boto3

BASE = Path.home() / "repos" / "site-mon"
CONFIG = Path.home() / ".config/mediser-monitor/config.env"
TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def load_env():
    for raw in CONFIG.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


def required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing config value: {name}")
    return value


def int_env(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError as exc:
        raise RuntimeError(f"Invalid {name}") from exc


def env_urls(prefix):
    return [
        value
        for i in range(1, 6)
        if (value := os.environ.get(f"{prefix}_{i}", "").strip())
    ]


def video_urls():
    configured = env_urls("VIDEO_R2_TEST_URL")
    if configured:
        return configured

    root = Path(os.environ.get("VIDEO_MEDIA_ROOT", "/srv/media"))
    base_url = os.environ.get(
        "VIDEO_R2_BASE_URL",
        "https://w41it-video-r2.meochon341.workers.dev",
    ).rstrip("/")

    if not root.is_dir():
        return []

    return sorted({
        f"{base_url}/{quote(path.relative_to(root).as_posix(), safe='/')}"
        for path in root.rglob("video.mp4")
    })


def audio_urls():
    return env_urls("AUDIO_THROUGHPUT_URL") or env_urls("R2_TEST_URL")


def with_probe_query(url, value):
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    query.append(("probe", value))
    return urlunsplit((
        parts.scheme,
        parts.netloc,
        parts.path,
        urlencode(query),
        parts.fragment,
    ))


def curl_sample(url, token, range_bytes, timeout, good_bps, slow_bps):
    fmt = (
        "%{http_code}|%{time_starttransfer}|%{time_total}|"
        "%{speed_download}|%{size_download}"
    )
    command = [
        "curl", "-L", "-sS",
        "-r", f"0-{range_bytes - 1}",
        "-o", "/dev/null",
        "--max-filesize", str(range_bytes * 2),
        "--max-time", str(timeout),
        "-w", fmt,
        with_probe_query(url, token),
    ]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout + 15,
        )
        parts = result.stdout.strip().splitlines()[-1].split("|")
        code, ttfb, total, speed, size = parts
        metrics = {
            "httpCode": int(code or 0),
            "ttfbMs": round(float(ttfb or 0) * 1000),
            "durationMs": round(float(total or 0) * 1000),
            "bytesPerSecond": round(float(speed or 0)),
            "bytesDownloaded": round(float(size or 0)),
        }
        bps = metrics["bytesPerSecond"]
        if result.returncode != 0 or metrics["httpCode"] != 206:
            status = "UNSTABLE"
        elif bps >= good_bps:
            status = "GOOD"
        elif bps >= slow_bps:
            status = "SLOW"
        else:
            status = "UNSTABLE"
        sample = {
            "status": status,
            "mibps": round(bps / 1024**2, 3),
            "mbps": round(bps * 8 / 1_000_000, 2),
            **metrics,
            "path": urlsplit(url).path,
            "curlExit": result.returncode,
        }
        if result.stderr.strip():
            sample["curlError"] = result.stderr.strip()
        return sample
    except Exception as exc:
        return {
            "status": "UNSTABLE",
            "mibps": 0.0,
            "mbps": 0.0,
            "httpCode": 0,
            "ttfbMs": 0,
            "durationMs": timeout * 1000,
            "bytesPerSecond": 0,
            "bytesDownloaded": 0,
            "path": urlsplit(url).path,
            "curlExit": 124,
            "curlError": str(exc),
        }


def load_history(path, cutoff, slot):
    try:
        history = json.loads(path.read_text(encoding="utf-8")).get("history", [])
    except (OSError, json.JSONDecodeError):
        history = []

    kept = []
    for item in history:
        if item.get("slot") == slot.isoformat():
            continue
        try:
            stamp = datetime.fromisoformat(
                str(item.get("stamp", "")).replace("Z", "+00:00")
            )
            if stamp.tzinfo is None:
                stamp = stamp.replace(tzinfo=TZ)
            if stamp.astimezone(TZ) >= cutoff:
                kept.append(item)
        except ValueError:
            pass
    return kept


def publish(kind, payload):
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    out = BASE / "data" / f"{kind}-throughput.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".json.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(out)

    client = boto3.client(
        "s3",
        endpoint_url=required("R2_ENDPOINT"),
        aws_access_key_id=required("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=required("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
    )
    key = os.environ.get(
        f"R2_{kind.upper()}_THROUGHPUT_KEY",
        f"site-monitor/live/{kind}-throughput.json",
    )
    client.put_object(
        Bucket=required("R2_BUCKET"),
        Key=key,
        Body=text.encode(),
        ContentType="application/json",
        CacheControl="no-store",
    )


def main(kind):
    if kind not in {"audio", "video"}:
        raise RuntimeError("kind must be audio or video")

    load_env()
    now = datetime.now(TZ)
    slot = now.replace(
        minute=0 if now.minute < 30 else 30,
        second=0,
        microsecond=0,
    )

    if kind == "video":
        urls = video_urls()
        defaults = (4 * 1024**2, 2, 120, 1024**2, 256 * 1024)
    else:
        urls = audio_urls()
        defaults = (1 * 1024**2, 2, 60, 512 * 1024, 128 * 1024)

    if not urls:
        raise RuntimeError(f"No {kind} URLs available")

    prefix = kind.upper()
    range_bytes = int_env(f"{prefix}_THROUGHPUT_RANGE_BYTES", defaults[0])
    count = min(
        int_env(f"{prefix}_THROUGHPUT_SAMPLE_COUNT", defaults[1]),
        len(urls),
    )
    timeout = int_env(f"{prefix}_THROUGHPUT_MAX_SECONDS", defaults[2])
    good_bps = int_env(f"{prefix}_THROUGHPUT_GOOD_BPS", defaults[3])
    slow_bps = int_env(f"{prefix}_THROUGHPUT_SLOW_BPS", defaults[4])

    chosen = random.Random(
        f"{kind}:{slot.isoformat()}"
    ).sample(sorted(set(urls)), count)

    with ThreadPoolExecutor(max_workers=count) as pool:
        samples = list(pool.map(
            lambda pair: curl_sample(
                pair[1],
                f"{slot:%Y%m%d%H%M}-{pair[0]}",
                range_bytes,
                timeout,
                good_bps,
                slow_bps,
            ),
            enumerate(chosen, 1),
        ))

    average_bps = round(
        sum(sample["bytesPerSecond"] for sample in samples) / len(samples)
    )
    average_mibps = round(average_bps / 1024**2, 3)

    if average_bps >= good_bps:
        average_status = "GOOD"
    elif average_bps >= slow_bps:
        average_status = "SLOW"
    else:
        average_status = "UNSTABLE"

    latest = {
        "stamp": now.isoformat(),
        "slot": slot.isoformat(),
        "label": slot.strftime("%H:%M"),
        "kind": kind,
        "status": average_status,
        "mibps": average_mibps,
        "avgMibps": average_mibps,
        "mbps": round(average_bps * 8 / 1_000_000, 2),
        "ttfbMs": round(
            sum(sample["ttfbMs"] for sample in samples) / len(samples)
        ),
        "durationMs": round(
            sum(sample["durationMs"] for sample in samples) / len(samples)
        ),
        "sampleCount": len(samples),
        "samples": samples,
    }

    out = BASE / "data" / f"{kind}-throughput.json"
    history = load_history(out, now - timedelta(hours=24), slot)
    history.append(latest)

    payload = {
        "generated": now.isoformat(),
        "config": {
            "rangeBytes": range_bytes,
            "sampleCount": count,
            "maxSeconds": timeout,
            "goodAtOrAboveBps": good_bps,
            "slowAtOrAboveBps": slow_bps,
        },
        "latest": latest,
        "history": history,
    }
    publish(kind, payload)

    print(
        f"{kind.capitalize()} throughput: {latest['status']}; "
        f"average {latest['avgMibps']:.3f} MiB/s across "
        f"{len(samples)} samples"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else "video"))
    except Exception as exc:
        print(f"throughput probe error: {exc}", file=sys.stderr)
        raise SystemExit(1)
