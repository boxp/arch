#!/usr/bin/env python3
"""One bounded local research or synthetic runtime window; requires ownership proofs."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import fcntl
import contextlib

from harness import Harness, INPUTS
from kubernetes_runtime import KubernetesBackend
from live import cluster
from runtime import RuntimeAdapter, RecoveryRequired


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', required=True)
    p.add_argument('--token', required=True)
    p.add_argument('--write-kubeconfig')
    p.add_argument('--node-api', action='store_true', help='dedicated SA Pod file transport; no write credential in this process')
    p.add_argument('--read-kubeconfig', required=True)
    p.add_argument('--ownership-check', required=True, help='executable that verifies deployed Argo ownership; exit 0 only on proof')
    p.add_argument('--research-manifest', help='local-only manifest for one normal localllm-created character note')
    p.add_argument('--vault')
    p.add_argument('--board-root', default='/home/boxp/.codex-task-board')
    p.add_argument('--docs-write-lock', help='same file as normal localllm document writer')
    p.add_argument('--recover-observe', action='store_true', help='reclaim same-token stale lease and observe pending transition only')
    p.add_argument('--max-window', type=int, default=1800)
    p.add_argument('--max-batch', type=int, choices=(1, 2), default=2)
    args = p.parse_args()
    os.environ['KUBECONFIG'] = str(Path(args.read_kubeconfig).resolve(strict=True))
    proof = str(Path(args.ownership_check).resolve(strict=True))
    holder = {}
    def ownership():
        result = subprocess.run([proof], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=20, check=False)
        if result.returncode: raise RecoveryRequired('Argo ownership proof failed')
    def convergence(desired, deadline):
        for (ns, name), count in zip(KubernetesBackend.TARGETS, desired[:2]):
            obj = cluster('deployment', name, ns)
            pods = cluster('pods', '-l=app='+name, ns)['items']
            if obj['spec'].get('replicas', 0) != count or obj.get('status', {}).get('observedGeneration', 0) < obj['metadata']['generation']:
                return False
            if count == 0:
                if pods: return False
            elif len(pods) != 1 or pods[0]['metadata'].get('deletionTimestamp') or not pods[0].get('status', {}).get('containerStatuses') or not all(s.get('ready') for s in pods[0]['status']['containerStatuses']):
                return False
        if desired[0]:
            try: holder['adapter'].require_gate(desired[2].split(':', 1)[0])
            except RuntimeError: return False
        return True
    if args.node_api:
        from file_backend import FileQueueBackend
        backend = FileQueueBackend(lambda: holder['adapter'].assert_lease(), convergence,
                                   ownership_check=ownership, ssh=lambda *a, **k: holder['adapter'].ssh(*a, **k))
    else:
        if not args.write_kubeconfig: p.error('--node-api or --write-kubeconfig is required')
        backend = KubernetesBackend(args.write_kubeconfig, lambda: holder['adapter'].assert_lease(),
                                    convergence, ownership_check=ownership)
    if args.research_manifest:
        if not args.vault or not args.docs_write_lock: p.error('research requires --vault and --docs-write-lock')
        from research import ResearchHarness
        h = ResearchHarness(args.root, args.vault, json.loads(Path(args.research_manifest).read_text()), board_root=args.board_root)
        boards = list(h.inputs)
    else:
        h = Harness(args.root, profile='turbo')
        boards = list(INPUTS)[:args.max_batch]
    adapter = RuntimeAdapter(h.root, h.root, args.token, backend, max_window=args.max_window, max_batch=args.max_batch)
    holder['adapter'] = adapter
    if args.research_manifest: adapter.reference_root = h.vault
    try:
        if args.recover_observe:
            adapter.acquire_lease(recover=True)
            print(json.dumps({'reconcile': adapter.controller.reconcile()}))
        else:
            if not args.research_manifest:
                for board in boards: h.submit(board)
            with contextlib.ExitStack() as stack:
                if args.docs_write_lock:
                    lock = stack.enter_context(open(args.docs_write_lock, 'a+b'))
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                result = h.run_many(boards, adapter)
            if set(result.values()) == {'completed'}:
                adapter.mark_window_completed(len(boards))
            print(json.dumps(result))
    finally:
        adapter.release_lease()
        adapter.controller.db.close()
        h.db.close()


if __name__ == '__main__': main()
