"""Explicit-credential transport for the runtime controller (not enabled by default).

One node lease serializes cooperative controllers. Kubernetes has no multi-object
transaction: each write uses UID/resourceVersion tests, with gate changes first.
A partial write is left pending for observation, never retried automatically.
"""
import json
import subprocess
import time
from pathlib import Path

from runtime import RecoveryRequired


class KubernetesBackend:
    TARGETS = (('local-llm', 'llama-server'),
               ('stable-diffusion', 'qwen-image-eval'))

    def __init__(self, kubeconfig, lease_check, convergence_check, *,
                 ownership_check, clock=time.monotonic, run=subprocess.run):
        # Never silently inherit the Task Board runner's credentials.
        self.kubeconfig = str(Path(kubeconfig).resolve(strict=True))
        self.lease_check, self.convergence_check = lease_check, convergence_check
        self.ownership_check, self.clock, self.run = ownership_check, clock, run
        self.observed = None

    def assert_lease(self):
        self.lease_check()

    def call(self, args, deadline):
        remaining = deadline - self.clock()
        if remaining <= 0:
            raise TimeoutError('runtime I/O deadline')
        result = self.run(['kubectl', '--kubeconfig', self.kubeconfig,
                           '--request-timeout=' + str(min(20, remaining)) + 's',
                           *args], capture_output=True, text=True,
                          timeout=min(25, remaining), check=False)
        if result.returncode:
            # Do not include API bodies or credentials in exceptions.
            raise RecoveryRequired('runtime API operation failed; observe before recovery')
        return json.loads(result.stdout)

    def read(self, deadline):
        objects = []
        for ns, name in self.TARGETS:
            objects.append(self.call(['get', '--raw',
                f'/apis/apps/v1/namespaces/{ns}/deployments/{name}/scale'], deadline))
        objects.append(self.call(['-n', 'local-llm', 'get', 'configmap',
                                  'llama-server-admission', '-o', 'json'], deadline))
        state = [objects[0]['spec'].get('replicas', 0), objects[1]['spec'].get('replicas', 0),
                 objects[2]['data']['state']]
        if any(type(value) is not int or value not in (0, 1) for value in state[:2]):
            raise RecoveryRequired('unexpected replica count')
        return state, objects

    def snapshot(self):
        self.assert_lease()
        self.observed = self.read(self.clock() + 30)
        return self.observed[0]

    def compare_and_set(self, expected, desired, deadline):
        self.assert_lease()
        # The caller must verify the exact installed Argo ownership contract.
        # This hook cannot be omitted, even in a manually invoked adapter.
        self.ownership_check()
        if self.observed is None or self.observed[0] != expected:
            raise RecoveryRequired('snapshot required before mutation')
        current, objects = self.read(deadline)
        if current != expected or any(
            a['metadata']['uid'] != b['metadata']['uid'] or
            a['metadata']['resourceVersion'] != b['metadata']['resourceVersion']
            for a, b in zip(objects, self.observed[1])):
            raise RecoveryRequired('resource changed after snapshot')
        # closed -> verify happens while Gemma is stopped; only then scale it up.
        # Other phases change exactly one field. A failed second write cannot
        # expose inference or start Qwen alongside Gemma.
        for index in (2, 0, 1):
            if current[index] == desired[index]:
                continue
            self.assert_lease()
            latest, fresh = self.read(deadline)
            if latest != current or any(
                a['metadata']['uid'] != b['metadata']['uid'] or
                a['metadata']['resourceVersion'] != b['metadata']['resourceVersion']
                for a, b in zip(fresh, objects)):
                raise RecoveryRequired('concurrent runtime writer')
            obj = fresh[index]
            # Scale JSON omits replicas when zero. Test/replace its spec object
            # so zero->one works without weakening the old-value precondition.
            path = '/data/state' if index == 2 else '/spec'
            old = current[index] if index == 2 else obj['spec']
            new = desired[index] if index == 2 else dict(obj['spec'], replicas=desired[index])
            patch = [{'op': 'test', 'path': '/metadata/uid', 'value': obj['metadata']['uid']},
                     {'op': 'test', 'path': '/metadata/resourceVersion',
                      'value': obj['metadata']['resourceVersion']},
                     {'op': 'test', 'path': path, 'value': old},
                     {'op': 'replace', 'path': path, 'value': new}]
            if index == 2:
                args = ['-n', 'local-llm', 'patch', 'configmap', 'llama-server-admission']
            else:
                ns, name = self.TARGETS[index]
                args = ['-n', ns, 'patch', 'deployment', name, '--subresource=scale']
            self.call([*args, '--type=json', '-p', json.dumps(patch), '-o', 'json'], deadline)
            current[index] = desired[index]
            latest, objects = self.read(deadline)
            if latest != current:
                raise RecoveryRequired('runtime write readback mismatch')
        self.observed = (current, objects)

    def wait(self, desired, deadline):
        while self.clock() < deadline:
            self.assert_lease()
            self.ownership_check()
            state, _ = self.read(deadline)
            if state != desired:
                raise RecoveryRequired('runtime state drift during convergence')
            # Checks all Pods/UIDs, gate propagation, rollout or Pod absence.
            # GPU/drain/probe proofs remain in LiveAdapter between phases.
            if self.convergence_check(desired, deadline):
                return
            time.sleep(min(1, max(0, deadline - self.clock())))
        raise TimeoutError('runtime convergence deadline')
