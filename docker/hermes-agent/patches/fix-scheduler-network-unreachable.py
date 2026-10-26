#!/usr/bin/env python3
"""Patch _summarize_cron_failure_for_delivery in the upstream scheduler.py.

Without this patch, OSError ENETUNREACH / Errno 101 failures (e.g. IPv6 egress
blocked) are classified by ``agent.error_classifier`` as a transport/timeout
verdict ("network is unreachable" is in ``_CONNECTION_MESSAGE_PATTERNS`` and
maps to the ``timeout`` reason), so the Telegram delivery notification reads
"the AI model service did not respond in time".  This patch inserts a
network-unreachable check before the provider classification so the operator
sees the real cause (pod egress / NetworkPolicy), not a provider timeout.

Verified against Hermes v0.22.5 (BOXP-313); originally written for v0.18.0
(BOXP-137).  Run with an optional path argument to patch a copy of the file
(used by local tests).
"""

import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "/opt/hermes/cron/scheduler.py"

MARKER = "network unreachable (ENETUNREACH)"

# Anchor: the provider classification block inside
# _summarize_cron_failure_for_delivery (v0.22.x shape).  Script-timeout and
# inactivity-watchdog checks precede it; we insert right before it so a
# genuine script timeout is still reported as such.
OLD = (
    '    if not job.get("no_agent"):\n'
    '        notice = provider_failure_notice(\n'
)

NEW = (
    '    # BOXP-137: ENETUNREACH / Errno 101 is an egress problem (pod routes,\n'
    '    # NetworkPolicy), not a model-service timeout.  The shared classifier\n'
    '    # maps "network is unreachable" to the timeout reason, so check first.\n'
    '    if (\n'
    '        "enetunreach" in lower\n'
    '        or "network is unreachable" in lower\n'
    '        or "errno 101" in lower\n'
    '        or "errno_101" in lower\n'
    '    ):\n'
    '        return (\n'
    '            f"⚠️ Cron \'{job_name}\' failed: network unreachable (ENETUNREACH). "\n'
    '            "Check pod egress routes and cluster NetworkPolicy. "\n'
    '            f"Run log: `hermes cron runs {job_id}`."\n'
    '        )\n'
    '    if not job.get("no_agent"):\n'
    '        notice = provider_failure_notice(\n'
)


def main() -> int:
    src = open(PATH, encoding="utf-8").read()
    if MARKER in src:
        print(f"{PATH}: network-unreachable check already present; nothing to do.")
        return 0
    if src.count(OLD) != 1:
        print(
            f"ERROR: expected exactly one match for the provider classification "
            f"anchor in {PATH} (found {src.count(OLD)}) — base image may have "
            "changed; update this patch.",
            file=sys.stderr,
        )
        return 1
    if "def _summarize_cron_failure_for_delivery(" not in src:
        print(
            f"ERROR: _summarize_cron_failure_for_delivery not found in {PATH}; "
            "update this patch.",
            file=sys.stderr,
        )
        return 1
    open(PATH, "w", encoding="utf-8").write(src.replace(OLD, NEW, 1))
    print(f"Patched {PATH}: network-unreachable check inserted before provider classification.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
