"""Conditional API transport: no cluster or credentials used."""
import copy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'docker/codex-workspace/qwen-eval'))
from kubernetes_runtime import KubernetesBackend
from runtime import RecoveryRequired, RuntimeController


class API:
    def __init__(self):
        self.objects = [dict(metadata=dict(uid=str(i), resourceVersion='1'),
                             spec=dict(replicas=1) if i == 0 else dict()) for i in range(2)]
        self.objects.append(dict(metadata=dict(uid='gate', resourceVersion='1'),
                                 data=dict(state='open:baseline')))
        self.patches = []
        self.fail = None
        self.lease = True
        self.conflict = False
    def check(self):
        if not self.lease: raise RecoveryRequired('lease lost')
    def run(self, args, **kwargs):
        assert kwargs['timeout'] <= 25
        assert args[1] == '--kubeconfig'
        index = 2 if 'llama-server-admission' in args else (
            1 if any('/qwen-image-eval/' in a or a == 'qwen-image-eval' for a in args) else 0)
        if 'patch' in args:
            patch = json.loads(args[args.index('-p')+1])
            self.patches.append((index, patch, args))
            obj = self.objects[index]
            for op in patch[:3]:
                parts = op['path'].strip('/').split('/')
                actual = obj[parts[0]] if len(parts) == 1 else obj[parts[0]][parts[1]]
                if actual != op['value']:
                    return SimpleNamespace(returncode=1, stdout='{}')
            if self.fail == index:
                return SimpleNamespace(returncode=1, stdout='{}')
            parts = patch[-1]['path'].strip('/').split('/')
            if len(parts) == 1: obj[parts[0]] = patch[-1]['value']
            else: obj[parts[0]][parts[1]] = patch[-1]['value']
            obj['metadata']['resourceVersion'] = str(int(obj['metadata']['resourceVersion'])+1)
        return SimpleNamespace(returncode=0, stdout=json.dumps(copy.deepcopy(self.objects[index])))


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.config = Path(self.tmp.name)/'config'; self.config.touch()
        self.api = API()
        self.backend = KubernetesBackend(self.config, self.api.check, lambda *_:True,
                                         ownership_check=lambda:None, run=self.api.run)
    def test_all_phases_use_narrow_preconditioned_writes(self):
        controller = RuntimeController(self.tmp.name, 'BOXP-349-test', self.backend)
        self.addCleanup(controller.db.close)
        for phase in ('fence','stop-gemma','start-qwen','stop-qwen','restore-gemma','reopen'):
            if phase == 'reopen': controller.mark_verified()
            controller.phase(phase)
        self.assertEqual(self.backend.snapshot(), [1,0,'open:BOXP-349-test'])
        self.assertEqual([x[0] for x in self.api.patches], [2,0,1,1,2,0,2])
        for index, patch, args in self.api.patches:
            self.assertEqual([x['op'] for x in patch], ['test','test','test','replace'])
            if index < 2: self.assertIn('--subresource=scale', args)
    def test_early_cancel_can_verify_without_starting_qwen(self):
        controller = RuntimeController(self.tmp.name, 'BOXP-349-early', self.backend)
        self.addCleanup(controller.db.close)
        controller.phase('fence'); controller.cancel()
        controller.phase('restore-gemma'); controller.mark_verified(); controller.phase('reopen')
        self.assertEqual(self.backend.snapshot(), [1,0,'open:BOXP-349-early'])
        self.assertEqual([x[0] for x in self.api.patches], [2,2,2])

    def test_resource_version_change_refuses_patch(self):
        expected = self.backend.snapshot()
        self.api.objects[0]['metadata']['resourceVersion'] = '2'
        with self.assertRaises(RecoveryRequired):
            self.backend.compare_and_set(expected, [1,0,'closed:test'], float('inf'))
        self.assertFalse(self.api.patches)
    def test_restore_partial_write_remains_verify_and_pending(self):
        controller = RuntimeController(self.tmp.name, 'BOXP-349-test', self.backend)
        self.addCleanup(controller.db.close)
        for phase in ('fence','stop-gemma','start-qwen','stop-qwen'): controller.phase(phase)
        self.api.fail = 0
        with self.assertRaises(RecoveryRequired): controller.phase('restore-gemma')
        self.assertEqual(self.backend.snapshot(), [0,0,'verify:BOXP-349-test'])
        count = len(self.api.patches)
        with self.assertRaises(RecoveryRequired): controller.reconcile()
        with self.assertRaises(RecoveryRequired): controller.phase('reopen')
        self.assertEqual(len(self.api.patches), count)
    def test_lease_and_ownership_required(self):
        expected = self.backend.snapshot()
        self.api.lease = False
        with self.assertRaises(RecoveryRequired):
            self.backend.compare_and_set(expected, [1,0,'closed:test'], float('inf'))
        self.api.lease = True
        def deny(): raise RecoveryRequired('Argo contract absent')
        self.backend.ownership_check = deny
        with self.assertRaises(RecoveryRequired):
            self.backend.compare_and_set(expected, [1,0,'closed:test'], float('inf'))
        self.assertFalse(self.api.patches)
    def test_expired_deadline_does_not_send(self):
        with self.assertRaises(TimeoutError): self.backend.read(0)
        self.assertFalse(self.api.patches)

if __name__ == '__main__': unittest.main()
