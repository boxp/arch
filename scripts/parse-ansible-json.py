#!/usr/bin/env python3
"""
Parse Ansible JSON callback output and generate structured data for github-comment.

Usage:
    parse-ansible-json.py <node_name> <json_file1> [json_file2 ...] -- <text_file1> [text_file2 ...]

Example:
    parse-ansible-json.py shanghai-1 control-plane.json node-specific.json -- control-plane.txt node-specific.txt
"""

import json
import sys
from pathlib import Path


def parse_args(args: list[str]) -> tuple[str, list[Path], list[Path]]:
    """Parse command line arguments."""
    if len(args) < 4 or "--" not in args:
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    node_name = args[1]
    separator_idx = args.index("--")
    json_files = [Path(f) for f in args[2:separator_idx]]
    text_files = [Path(f) for f in args[separator_idx + 1 :]]

    if not json_files or not text_files:
        print("Error: At least one JSON and one text file required", file=sys.stderr)
        sys.exit(1)

    return node_name, json_files, text_files


def extract_stats(data: dict, node_name: str) -> dict:
    """Extract stats for the node from Ansible JSON output."""
    stats = data.get("stats", {})
    node_stats = stats.get(node_name) or next(iter(stats.values()), {})
    return {
        "ok": node_stats.get("ok", 0),
        "changed": node_stats.get("changed", 0),
        "skipped": node_stats.get("skipped", 0),
        "failures": node_stats.get("failures", 0),
        "unreachable": node_stats.get("unreachable", 0),
    }


def extract_changed_tasks(data: dict) -> list[dict]:
    """Extract tasks that have changed=true."""
    tasks = []
    for play in data.get("plays", []):
        for task in play.get("tasks", []):
            hosts = task.get("hosts", {})
            for host_result in hosts.values():
                if host_result.get("changed"):
                    tasks.append({
                        "task": host_result.get("task", "unknown"),
                        "action": host_result.get("action", "unknown"),
                    })
    # Remove duplicates while preserving order
    seen = set()
    unique_tasks = []
    for t in tasks:
        key = (t["task"], t["action"])
        if key not in seen:
            seen.add(key)
            unique_tasks.append(t)
    return unique_tasks


def format_diff(diff: dict | list | str) -> str:
    """Format a diff object into a readable string."""
    if isinstance(diff, str):
        return diff
    if isinstance(diff, list):
        return "\n\n".join(format_diff(d) for d in diff)
    if isinstance(diff, dict):
        if "before" in diff and "after" in diff:
            before = diff["before"] if isinstance(diff["before"], str) else str(diff["before"])
            after = diff["after"] if isinstance(diff["after"], str) else str(diff["after"])
            before_lines = "\n".join(f"- {line}" for line in before.splitlines())
            after_lines = "\n".join(f"+ {line}" for line in after.splitlines())
            return f"--- before\n+++ after\n{before_lines}\n{after_lines}"
        if "prepared" in diff:
            return diff["prepared"]
        return str(diff)
    return str(diff)


def extract_diffs(data: dict) -> str:
    """Extract diff content from tasks."""
    diffs = []
    for play in data.get("plays", []):
        for task in play.get("tasks", []):
            hosts = task.get("hosts", {})
            for host_result in hosts.values():
                diff = host_result.get("diff")
                if diff:
                    diffs.append(format_diff(diff))
    return "\n\n".join(diffs)


def process_json_files(json_files: list[Path], node_name: str) -> tuple[dict, list, str]:
    """Process all JSON files and aggregate results."""
    total_stats = {"ok": 0, "changed": 0, "skipped": 0, "failures": 0, "unreachable": 0}
    all_tasks = []
    all_diffs = []

    for json_file in json_files:
        if not json_file.exists():
            print(f"Warning: JSON file not found: {json_file}", file=sys.stderr)
            continue

        try:
            data = json.loads(json_file.read_text())
        except json.JSONDecodeError as e:
            print(f"Warning: Failed to parse {json_file}: {e}", file=sys.stderr)
            continue

        stats = extract_stats(data, node_name)
        for key in total_stats:
            total_stats[key] += stats[key]

        all_tasks.extend(extract_changed_tasks(data))

        diff = extract_diffs(data)
        if diff:
            all_diffs.append(diff)

    # Deduplicate tasks
    seen = set()
    unique_tasks = []
    for t in all_tasks:
        key = (t["task"], t["action"])
        if key not in seen:
            seen.add(key)
            unique_tasks.append(t)

    return total_stats, unique_tasks, "\n\n".join(all_diffs)


def read_text_files(text_files: list[Path]) -> str:
    """Read and combine all text output files."""
    outputs = []
    for i, text_file in enumerate(text_files):
        if not text_file.exists():
            continue
        content = text_file.read_text()
        if i > 0:
            outputs.append("\n\n--- Next Playbook ---\n\n")
        outputs.append(content)
    return "".join(outputs)


def main():
    node_name, json_files, text_files = parse_args(sys.argv)

    stats, changed_tasks, diffs = process_json_files(json_files, node_name)
    full_output = read_text_files(text_files)

    result = {
        "name": node_name,
        "ok": stats["ok"],
        "changed": stats["changed"],
        "skipped": stats["skipped"],
        "failed": stats["failures"] + stats["unreachable"],
        "changed_tasks": changed_tasks,
        "diff": diffs,
        "full_output": full_output,
    }

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
