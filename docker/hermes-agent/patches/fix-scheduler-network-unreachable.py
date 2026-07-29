#!/usr/bin/env python3
"""Patch _summarize_cron_failure_for_delivery in the upstream scheduler.py.

Without this patch, OSError ENETUNREACH / Errno 101 failures (e.g. IPv6 egress
blocked) produce a traceback that may contain the word "timeout" from an inner
requests timeout and are therefore misclassified as "provider timeout" in the
Telegram delivery notification.  This patch inserts a network-unreachable check
before the generic timeout branch so the operator sees the real cause.

See BOXP-137 for the incident that motivated this fix.
"""

import sys

PATH = "/opt/hermes/cron/scheduler.py"

OLD = '    if "readtimeout" in lower or "timed out" in lower or "timeout" in lower:'

NEW = (
    '    if (\n'
    '        "enetunreach" in lower\n'
    '        or "network is unreachable" in lower\n'
    '        or "errno 101" in lower\n'
    '        or "errno_101" in lower\n'
    '        or "errno 103" in lower\n'
    '        or "errno_103" in lower\n'
    '    ):\n'
    '        return (\n'
    '            f"⚠️ Cron \'{job_name}\' failed: network unreachable. "\n'
    '            "Check pod egress routes and cluster NetworkPolicy. "\n'
    '            "Full details saved in cron output."\n'
    '        )\n'
    '    if "readtimeout" in lower or "timed out" in lower or "timeout" in lower:'
)

src = open(PATH).read()
if OLD not in src:
    print(
        f"ERROR: expected pattern not found in {PATH} — base image may have changed; "
        "update this patch.",
        file=sys.stderr,
    )
    sys.exit(1)

patched = src.replace(OLD, NEW, 1)
open(PATH, "w").write(patched)
print(f"Patched {PATH}: network-unreachable check inserted before timeout catch-all.")
