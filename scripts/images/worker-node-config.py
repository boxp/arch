#!/usr/bin/env python3
"""Print the per-node worker image expectations as KEY=VALUE lines.

The values come from ansible/vars/nodes.yml (node_ips, worker_nodes, cluster)
and the pinned versions in ansible/playbooks/worker-image.yml, so the build
script and the image verifier share one source of truth with the playbook.

Usage: worker-node-config.py <node_name> [--repo-root DIR]
"""
import argparse
import re
import sys
from pathlib import Path

import yaml

INTERFACE_RE = re.compile(r"^[a-z][a-z0-9]*$")


def load_config(repo_root: Path, node_name: str) -> dict:
    nodes = yaml.safe_load((repo_root / "ansible/vars/nodes.yml").read_text())
    playbook = yaml.safe_load((repo_root / "ansible/playbooks/worker-image.yml").read_text())[0]

    if node_name not in nodes["node_ips"]:
        raise SystemExit(f"{node_name}: missing from node_ips in ansible/vars/nodes.yml")
    if node_name not in nodes["worker_nodes"]:
        raise SystemExit(f"{node_name}: missing from worker_nodes in ansible/vars/nodes.yml")

    worker = nodes["worker_nodes"][node_name]
    if not INTERFACE_RE.match(str(worker["interface"])):
        raise SystemExit(f"{node_name}: invalid interface name {worker['interface']!r}")
    if not isinstance(worker["gpu_host_tools"], bool):
        raise SystemExit(f"{node_name}: gpu_host_tools must be a boolean")

    k8s = next(role for role in playbook["roles"] if role["role"] == "kubernetes_components")["vars"]
    cluster = nodes["cluster"]
    return {
        "NODE_NAME": node_name,
        "NODE_IP": nodes["node_ips"][node_name],
        "NETWORK_INTERFACE": worker["interface"],
        "GPU_HOST_TOOLS": "true" if worker["gpu_host_tools"] else "false",
        "GATEWAY": cluster["gateway"],
        "DNS_SERVERS": " ".join(cluster["dns_servers"]),
        "KUBERNETES_VERSION": k8s["kubernetes_version"],
        "KUBERNETES_PACKAGE_VERSION": k8s["kubernetes_package_version"],
        "CRIO_VERSION": k8s["crio_version"],
        "CRIO_PACKAGE_VERSION": k8s["crio_package_version"],
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("node_name")
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args(argv)
    for key, value in load_config(args.repo_root, args.node_name).items():
        print(f"{key}={value}")  # noqa: T201 - this script's output is its interface
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
