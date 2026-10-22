#!/usr/bin/env python3
"""Fail closed on effective `multipath -t` / `multipathd show config` output.

The input is parsed, never executed, and no block device is probed.
"""
import argparse
import shlex
import sys

VENDOR = "^IET$"
PRODUCT = "^VIRTUAL-DISK$"


def parse(config):
    """Return (rules, device_blocks) from multipath.conf style text."""
    stack = []
    rules = []
    device_blocks = []
    current_device = None
    for line in config.splitlines():
        tokens = shlex.split(line, comments=True)
        if not tokens:
            continue
        if tokens[-1] == "{":
            if len(tokens) != 2:
                raise ValueError("Unexpected multipath section")
            stack.append(tokens[0])
            if tokens[0] == "device":
                current_device = {"scope": tuple(stack[:-1])}
        elif tokens == ["}"]:
            if not stack:
                raise ValueError("Unbalanced multipath section")
            if stack.pop() == "device":
                device_blocks.append(current_device)
                current_device = None
        elif len(tokens) == 2:
            rules.append((tuple(stack), *tokens))
            if current_device is not None:
                current_device[tokens[0]] = tokens[1]
        else:
            raise ValueError("Unexpected multipath directive")
    if stack:
        raise ValueError("Unclosed multipath section")
    return rules, device_blocks


def verify(config, require_blacklist=False):
    rules, device_blocks = parse(config)
    for scope, key, value in rules:
        if key == "config_dir" and value != "/etc/multipath/conf.d":
            raise ValueError("Non-default config_dir: drop-in would not be reliable")
        if scope == ("blacklist_exceptions",) and key == "wwid":
            # Conservative: POSIX regular expressions must not be interpreted by Python.
            raise ValueError("WWID blacklist exception requires separate review")
    for block in device_blocks:
        # Conservative: a device exception wins over the device blacklist and its
        # POSIX regular expressions must not be re-interpreted by Python.
        if block["scope"] == ("blacklist_exceptions",):
            raise ValueError("Device blacklist exception requires separate review")
    excluded = any(
        block["scope"] == ("blacklist",)
        and block.get("vendor") == VENDOR
        and block.get("product") == PRODUCT
        for block in device_blocks
    )
    if require_blacklist and not excluded:
        raise ValueError("Longhorn IET/VIRTUAL-DISK device blacklist missing in effective configuration")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-blacklist", action="store_true")
    args = parser.parse_args()
    try:
        verify(sys.stdin.read(), args.require_blacklist)
    except ValueError as error:
        sys.exit(str(error))
