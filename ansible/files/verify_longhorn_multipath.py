#!/usr/bin/env python3
"""Fail closed on effective `multipath -t` configuration, without probing devices."""
import argparse
import shlex
import sys

WWID = "360000000000000000e00000000010001"
PATTERN = "^" + WWID + "$"


def verify(config, require_blacklist=False):
    stack = []
    rules = []
    for line in config.splitlines():
        tokens = shlex.split(line, comments=True)
        if not tokens:
            continue
        if tokens[-1] == "{":
            if len(tokens) != 2:
                raise ValueError("Unexpected multipath section")
            stack.append(tokens[0])
        elif tokens == ["}"]:
            if not stack:
                raise ValueError("Unbalanced multipath section")
            stack.pop()
        elif len(tokens) == 2:
            rules.append((tuple(stack), *tokens))
        else:
            raise ValueError("Unexpected multipath directive")
    if stack:
        raise ValueError("Unclosed multipath section")
    for scope, key, value in rules:
        if key == "config_dir" and value != "/etc/multipath/conf.d":
            raise ValueError("Non-default config_dir: drop-in would not be reliable")
        if scope == ("blacklist_exceptions",) and key == "wwid":
            # Conservative: POSIX regular expressions must not be interpreted by Python.
            raise ValueError("WWID blacklist exception requires separate review")
    if require_blacklist and (("blacklist",), "wwid", PATTERN) not in rules:
        raise ValueError("Exact target WWID blacklist missing in effective configuration")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-blacklist", action="store_true")
    args = parser.parse_args()
    try:
        verify(sys.stdin.read(), args.require_blacklist)
    except ValueError as error:
        sys.exit(str(error))
