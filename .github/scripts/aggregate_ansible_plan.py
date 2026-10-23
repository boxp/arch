#!/usr/bin/env python3
"""Combine per-node Ansible plan artifacts without treating incomplete runs as clean."""

import argparse
import json
from pathlib import Path


def aggregate(input_dir: Path, expected_nodes: list[str], job_results: dict[str, str]) -> dict:
    plans_by_key: dict[tuple[str, str], dict] = {}
    node_status: dict[str, dict] = {}
    problems: list[str] = []
    artifact_paths = sorted(input_dir.glob("*.fmt.json")) + sorted(input_dir.glob("*-status.json"))
    for path in artifact_paths:
        try:
            value = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            problems.append(f"Unreadable artifact file {path.name}: {exc}")
            continue
        if not isinstance(value, dict):
            continue
        if "job_status" in value and "node" in value:
            node_status[value["node"]] = value
            continue
        if not {"node", "playbook"}.issubset(value):
            continue
        key = (value["node"], value["playbook"])
        if key in plans_by_key:
            if plans_by_key[key] != value:
                problems.append(f"Conflicting duplicate result for {key[0]} / {key[1]}")
            continue
        plans_by_key[key] = value

    plans = list(plans_by_key.values())
    represented = {p["node"] for p in plans}
    for node in expected_nodes:
        status_record = node_status.get(node, {})
        status = status_record.get("job_status", "unknown")
        if node not in represented:
            plans.append({
                "node": node, "playbook": "result-unavailable", "has_changes": False,
                "status": "missing", "stats": {}, "changed_tasks": [], "failed_tasks": [],
            })
            problems.append(f"No plan artifact was produced for {node}")
        elif status != "success":
            problems.append(f"Plan job for {node} ended with status: {status}")
            for plan in plans:
                if plan["node"] == node:
                    plan["status"] = "partial" if status != "success" else "complete"
        else:
            required = status_record.get("expected_playbooks") or ["worker-image" if node.startswith("golyat-") else "control-plane"]
            skipped = any(p["node"] == node and p.get("playbook") in {"ssh-connectivity", "cp-memory-headroom"} for p in plans)
            if not skipped:
                for required_playbook in required:
                    if not any(p["node"] == node and p["playbook"] == required_playbook for p in plans):
                        problems.append(f"Required {required_playbook} result is missing for {node}")
                        plans.append({"node": node, "playbook": required_playbook, "has_changes": False,
                                      "status": "missing", "stats": {}, "changed_tasks": [], "failed_tasks": []})
            for plan in plans:
                if plan["node"] == node and "status" not in plan:
                    plan["status"] = "complete"

    for group, result in job_results.items():
        if result != "success":
            problems.append(f"{group} job group ended with status: {result}")

    for plan in plans:
        if plan.get("playbook") in {"ssh-connectivity", "cp-memory-headroom"}:
            plan["status"] = "skipped"
            problems.append(f"Plan skipped for {plan['node']}: {plan['playbook']}")
            continue
        stat_errors = any((stat.get("failures", 0) or stat.get("unreachable", 0)) for stat in plan.get("stats", {}).values())
        if plan.get("failed_tasks") or stat_errors or plan.get("status") in {"missing", "partial"}:
            if plan.get("failed_tasks") or stat_errors:
                plan["status"] = "failed"
            problems.append(f"Plan result needs attention for {plan['node']} / {plan['playbook']}")

    plans.sort(key=lambda p: (expected_nodes.index(p["node"]) if p["node"] in expected_nodes else 999, p["playbook"]))
    has_changes = bool(problems) or any(bool(p.get("has_changes")) for p in plans)
    return {"plans": plans, "has_changes": has_changes, "problems": sorted(set(problems))}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-nodes", nargs="+", required=True)
    parser.add_argument("--job-result", action="append", default=[], metavar="GROUP=RESULT")
    args = parser.parse_args()
    job_results = dict(item.split("=", 1) for item in args.job_result)
    result = aggregate(args.input_dir, args.expected_nodes, job_results)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
