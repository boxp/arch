"""Runtime state machine tests, using only in-memory fake I/O."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'docker/codex-workspace/qwen-eval'))
from runtime import RuntimeController, RecoveryRequired


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
