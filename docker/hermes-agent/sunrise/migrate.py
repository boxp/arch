#!/usr/bin/env python3
"""Dry-run legacy state conversion; prints private JSON, never writes live state."""

import json
from pathlib import Path
import sys
from watch import migrate, validate

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(
            "usage: migrate.py CONFIG LATEST_LEGACY_STATE (private JSON on stdout)"
        )
    config = json.loads(Path(sys.argv[1]).read_text())
    validate(config)
    state = migrate(json.loads(Path(sys.argv[2]).read_text()), config)
    print(json.dumps(state, ensure_ascii=False, indent=2))
