#!/usr/bin/env python3

import os
import sys
from pathlib import Path

import boto3
from botocore.config import Config


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
    "R2_BUCKET",
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
]

missing = [key for key in required if not os.environ.get(key)]

if missing:
    print(
        "Missing config values: " + ", ".join(missing),
        file=sys.stderr,
    )
    sys.exit(1)


client = boto3.client(
    "s3",
    endpoint_url=os.environ["R2_ENDPOINT"],
    aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    region_name="auto",
    config=Config(signature_version="s3v4"),
)


bucket = os.environ["R2_BUCKET"]

object_count = 0
total_bytes = 0

paginator = client.get_paginator("list_objects_v2")

try:
    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            object_count += 1
            total_bytes += obj["Size"]

except Exception as exc:
    print(f"ERROR: {exc}", file=sys.stderr)
    sys.exit(1)


gb_decimal = total_bytes / 1_000_000_000
gib_binary = total_bytes / (1024 ** 3)

print(f"objects={object_count}")
print(f"bytes={total_bytes}")
print(f"gb={gb_decimal:.2f}")
print(f"gib={gib_binary:.2f}")
