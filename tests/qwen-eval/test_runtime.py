"""Runtime state machine tests, using only in-memory fake I/O."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'docker/codex-workspace/qwen-eval'))
from runtime import RuntimeController, RecoveryRequired, RuntimeAdapter
from harness import Harness, FakeAdapter
from unittest.mock import Mock


class Backend:
    def __init__(self):
        self.state = [1, 0, 'open:baseline']
        self.calls = []
        self.lease = True
        self.fail = None
    def assert_lease(self):
        if not self.lease: raise RecoveryRequired('lease lost')
    def snapshot(self): return list(self.state)
    def compare_and_set(self, expected, desired, deadline):
        self.calls.append((expected, desired))
        if self.state != expected: raise RecoveryRequired('conflict')
        if self.fail == 'before': raise TimeoutError('unknown write')
        self.state = list(desired)
        if self.fail == 'after': raise TimeoutError('unknown write')
    def wait(self, desired, deadline):
        if self.fail == 'wait': raise TimeoutError('not converged')
        if self.state != desired: raise RecoveryRequired('drift')


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.backend = Backend()
        self.now = 100
        self.c = self.make()
    def make(self):
        return RuntimeController(self.tmp.name, 'BOXP-344-test', self.backend, wall=lambda:self.now)
    def test_full_order_and_owner(self):
        for phase in ('fence','stop-gemma','start-qwen','stop-qwen','restore-gemma','reopen'):
            if phase == 'reopen': self.c.mark_verified()
            self.c.phase(phase)
        self.assertEqual(self.backend.state, [1,0,'open:BOXP-344-test'])
        self.assertEqual(len(self.backend.calls), 6)
    def test_write_uncertain_is_never_replayed_after_restart(self):
        self.backend.fail = 'before'
        with self.assertRaises(TimeoutError): self.c.phase('fence')
        self.c.db.close(); self.c = self.make()
        with self.assertRaises(RecoveryRequired): self.c.phase('fence')
        with self.assertRaises(RecoveryRequired): self.c.reconcile()
        self.assertEqual(len(self.backend.calls), 1)
    def test_applied_unknown_is_observed_not_replayed(self):
        self.backend.fail = 'after'
        with self.assertRaises(TimeoutError): self.c.phase('fence')
        self.c.db.close(); self.c = self.make(); self.backend.fail = None
        self.assertEqual(self.c.reconcile(), 'fence')
        self.assertEqual(len(self.backend.calls), 1)
        self.c.phase('stop-gemma')
    def test_failed_restore_never_reopens(self):
        for phase in ('fence','stop-gemma','start-qwen','stop-qwen'):
            self.c.phase(phase)
        self.backend.fail = 'wait'
        with self.assertRaises(TimeoutError): self.c.phase('restore-gemma')
        with self.assertRaises(RecoveryRequired): self.c.phase('reopen')
        self.assertEqual(self.backend.state[2], 'verify:BOXP-344-test')
    def test_limits_and_cancel_allow_only_restoration(self):
        with self.assertRaises(ValueError): self.c.check_batch(3)
        self.c.phase('fence'); self.c.phase('stop-gemma'); self.c.phase('start-qwen')
        self.now += 1801; self.c.cancel()
        with self.assertRaises(RecoveryRequired): self.c.check_batch(1)
        for phase in ('stop-qwen','restore-gemma'): self.c.phase(phase)
        self.c.mark_verified(); self.c.phase('reopen')
    def test_cancel_before_qwen_starts_can_verify_and_reopen(self):
        for early_phase in ('fence', 'stop-gemma'):
            with self.subTest(early_phase=early_phase), tempfile.TemporaryDirectory() as root:
                backend = Backend()
                c = RuntimeController(root, 'BOXP-349-early', backend)
                self.addCleanup(c.db.close)
                c.phase('fence')
                if early_phase == 'stop-gemma': c.phase('stop-gemma')
                c.cancel()
                with self.assertRaises(RecoveryRequired): c.phase('start-qwen')
                c.phase('restore-gemma')
                with self.assertRaises(RecoveryRequired): c.phase('reopen')
                c.mark_verified(); c.phase('reopen')
                self.assertEqual(backend.state, [1,0,'open:BOXP-349-early'])

    def test_dispatch_requires_live_settled_qwen(self):
        with self.assertRaises(RecoveryRequired): self.c.reserve_dispatch()
        for phase in ('fence','stop-gemma','start-qwen'): self.c.phase(phase)
        self.c.reserve_dispatch()
        self.c.phase('stop-qwen')
        with self.assertRaises(RecoveryRequired): self.c.reserve_dispatch()
        self.assertEqual(self.c.db.execute('SELECT count(*) FROM dispatches').fetchone()[0], 1)

    def test_restart_after_restore_runs_only_fresh_probe(self):
        for phase in ('fence','stop-gemma','start-qwen','stop-qwen','restore-gemma'):
            self.c.phase(phase)
        count = len(self.backend.calls)
        self.c.db.close(); self.c = self.make()
        with self.assertRaises(RecoveryRequired): self.c.phase('reopen')
        self.c.db.close()
        adapter = RuntimeAdapter(self.tmp.name, self.tmp.name, self.c.token, self.backend)
        self.c = adapter.controller
        adapter.assert_lease = self.backend.assert_lease
        adapter.verify_gemma_ready = Mock(side_effect=lambda: adapter.record('gemma-restored', {}))
        adapter.restore_gemma_verify()
        adapter.verify_gemma_ready.assert_called_once_with()
        self.assertEqual(len(self.backend.calls), count)
        adapter.restore_gemma_verify()
        self.assertEqual(len(list(adapter.evidence.glob('gemma-restored-*.json'))), 2)
        self.c.phase('reopen')

    def test_harness_restores_cancelled_completed_fence(self):
        class CancelBeforeStop(FakeAdapter):
            def stop_gemma_and_prove_gpu_free(self): raise RuntimeError('cancelled')
            def can_restore_without_handover(self): return True
        h = Harness(Path(self.tmp.name)/'harness')
        self.addCleanup(h.db.close)
        h.submit('task-board'); a = CancelBeforeStop()
        self.assertEqual(h.run('task-board', a), 'failed')
        self.assertNotIn('generate', a.calls)
        self.assertIn('restore_gemma_verify', a.calls)
        self.assertIn('reopen', a.calls)

    def test_adapter_restart_preserves_evidence(self):
        a = RuntimeAdapter(self.tmp.name, self.tmp.name, self.c.token, self.backend)
        self.addCleanup(a.controller.db.close)
        a.record('proof', {'first':True})
        b = RuntimeAdapter(self.tmp.name, self.tmp.name, self.c.token, self.backend)
        self.addCleanup(b.controller.db.close)
        b.record('proof', {'second':True})
        self.assertNotEqual(a.evidence, b.evidence)
        self.assertEqual(len(list(Path(self.tmp.name).glob('runtime-evidence/*/proof-*.json'))), 2)
        a.assert_lease = self.backend.assert_lease
        self.assertFalse(a.can_restore_without_handover())
        self.c.phase('fence'); a.pod_uid = 'drained'
        self.assertTrue(a.can_restore_without_handover())

    def test_drift_and_lost_lease_block_writes(self):
        self.backend.state[2] = 'closed:someone-else'
        with self.assertRaises(RecoveryRequired): self.c.phase('fence')
        self.backend.lease = False
        with self.assertRaises(RecoveryRequired): self.c.phase('fence')
        self.assertFalse(self.backend.calls)
    def test_phase_order_and_token_persist(self):
        with self.assertRaises(RecoveryRequired): self.c.phase('start-qwen')
        with self.assertRaises(RecoveryRequired): RuntimeController(self.tmp.name, 'other', self.backend)

if __name__ == '__main__': unittest.main()
