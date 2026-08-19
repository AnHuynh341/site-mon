#!/usr/bin/env python3

import subprocess
import sys
from pathlib import Path


script = Path(__file__).with_name(
    "video-throughput.py"
)

raise SystemExit(
    subprocess.call(
        [
            sys.executable,
            str(script),
            "audio",
        ]
    )
)
