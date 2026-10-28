import importlib.util
import multiprocessing
import os
from pathlib import Path
import socket
import tempfile
import time
import threading
import unittest
from unittest.mock import patch

P = Path(__file__).resolve().parents[2] / 'docker/codex-workspace/qwen-eval/harness.py'
spec = importlib.util.spec_from_file_location('harness', P)
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

def crash_worker(root, point):
    x = h.Harness(root)
    if point == 'generation':
        class Crash(h.FakeAdapter):
            def generate(self, contract): os._exit(42)
        x.run('task-board', Crash())
    else:
        original = x.publish
        def publish(board):
            original(board); os._exit(42)
        x.publish = publish
        x.run('task-board', h.FakeAdapter())

def worker(root, board):
    x = h.Harness(root); x.submit(board); x.run(board, h.FakeAdapter())

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.x = h.Harness(self.root)
    def test_parallel_and_duplicate(self):
        with patch.object(socket, 'socket', side_effect=AssertionError('network')):
            ps = [multiprocessing.get_context('fork').Process(target=worker, args=(self.root,b)) for b in h.INPUTS]
            for p in ps: p.start()
            for p in ps: p.join(10); self.assertEqual(p.exitcode, 0)
            for board in h.INPUTS:
                self.x.submit(board)
                self.assertEqual(self.x.run(board, h.FakeAdapter()), 'completed')
                dest = self.root/'vault/qwen-synthetic-evaluation'/board
                self.assertEqual((dest/'note.md').read_text().count('image.png'), 1)
                self.assertEqual((dest/'image.png').read_bytes(), h.png())
    def test_failure_and_restore(self):
        for step in ('fence_and_drain','stop_gemma_and_prove_gpu_free','start_qwen','generate','stop_qwen_and_prove_gpu_free','restore_gemma_verify','reopen'):
            with self.subTest(step=step), tempfile.TemporaryDirectory() as d:
                x = h.Harness(d); x.submit('task-board'); a = h.FakeAdapter(step)
                state = x.run('task-board', a)
                unsafe = step in ('fence_and_drain', 'stop_gemma_and_prove_gpu_free')
                if unsafe:
                    self.assertNotIn('stop_qwen_and_prove_gpu_free', a.calls)
                    self.assertNotIn('restore_gemma_verify', a.calls)
                    self.assertNotIn('reopen', a.calls)
                    x.submit('novel-board')
                    with self.assertRaises(RuntimeError): x.run('novel-board', h.FakeAdapter())
                else:
                    self.assertIn('stop_qwen_and_prove_gpu_free', a.calls)
                recovery = unsafe or step.startswith(('stop_qwen', 'restore_gemma', 'reopen'))
                self.assertEqual(state, 'recovery-needed' if recovery else 'failed')
                self.assertFalse((Path(d)/'vault').exists())
    def test_default_closed(self):
        self.x.submit('task-board')
        self.assertEqual(self.x.run('task-board', h.ClosedAdapter()), 'recovery-needed')
    def test_interrupted_states_never_regenerate(self):
        for state in ('draining','image-ready','generating','staged','restoring','publishing'):
            with self.subTest(state=state), tempfile.TemporaryDirectory() as d:
                x = h.Harness(d); x.submit('task-board'); x.state('task-board',state)
                a = h.FakeAdapter(); self.assertEqual(h.Harness(d).run('task-board',a),'recovery-needed')
                self.assertEqual(a.calls, [])
                x.submit('novel-board')
                with self.assertRaises(RuntimeError): x.run('novel-board', a)
    def test_actual_crash_does_not_regenerate(self):
        for point in ('generation', 'publication'):
            with self.subTest(point=point), tempfile.TemporaryDirectory() as d:
                x = h.Harness(d); x.submit('task-board')
                p = multiprocessing.get_context('fork').Process(target=crash_worker, args=(d,point))
                p.start(); p.join(5); self.assertEqual(p.exitcode,42)
                a = h.FakeAdapter()
                self.assertEqual(h.Harness(d).run('task-board',a),'recovery-needed')
                self.assertEqual(a.calls, [])

    def test_active_text_and_uncontrolled_users(self):
        self.x.submit('task-board')
        entered, release = threading.Event(), threading.Event()
        class Drain(h.FakeAdapter):
            def fence_and_drain(self):
                self.step('fence_and_drain'); entered.set(); release.wait(3)
        a = Drain()
        # SQLite connections are thread-bound, so construct one in the worker.
        t = threading.Thread(target=lambda: h.Harness(self.root).run('task-board',a))
        t.start(); self.assertTrue(entered.wait(2))
        self.assertNotIn('start_qwen', a.calls)
        release.set(); t.join(5); self.assertIn('start_qwen', a.calls)
        for reason in ('uncontrolled ingress','uncontrolled GPU user','timeout','OOM'):
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as d:
                x = h.Harness(d); x.submit('task-board')
                class Refuse(h.FakeAdapter):
                    def fence_and_drain(self): raise RuntimeError(reason)
                a = Refuse(); self.assertEqual(x.run('task-board',a),'recovery-needed')
                self.assertNotIn('start_qwen',a.calls)

    def test_generation_timeout_oom_and_bad_output_restore_without_link(self):
        for failure in (TimeoutError('timeout'), MemoryError('OOM'), MemoryError(), ValueError('generation')):
            with self.subTest(failure=str(failure)), tempfile.TemporaryDirectory() as d:
                x = h.Harness(d); x.submit('task-board')
                class Fail(h.FakeAdapter):
                    def generate(self, contract):
                        self.step('generate')
                        raise failure
                a = Fail()
                self.assertEqual(x.run('task-board', a), 'failed')
                self.assertEqual(a.calls[-3:], ['stop_qwen_and_prove_gpu_free', 'restore_gemma_verify', 'reopen'])
                self.assertFalse((Path(d) / 'vault').exists())
                self.assertEqual(x.run('task-board', a), 'failed')
                self.assertEqual(a.calls.count('generate'), 1)
        self.x.submit('task-board')
        class Bad(h.FakeAdapter):
            def generate(self, contract): return b'not PNG'
        self.assertEqual(self.x.run('task-board', Bad()), 'failed')
        self.assertFalse((self.root / 'vault').exists())

    def test_reference_and_png(self):
        ref = self.root/'refs'; ref.mkdir(); (ref/'a.png').write_bytes(h.png())
        import hashlib
        digest = hashlib.sha256(h.png()).hexdigest()
        self.assertEqual(h.reference(ref,'a.png',digest),h.png())
        (ref/'link').symlink_to(ref/'a.png')
        for path, sha in [('link',digest),('../refs/a.png',digest),('a.png','bad'),('/etc/passwd',digest)]:
            with self.subTest(path=path), self.assertRaises(ValueError): h.reference(ref,path,sha)
        with self.assertRaises(ValueError): h.validate_png(h.png()[:-1])
    def test_existing_output_is_not_overwritten(self):
        self.x.submit('task-board')
        dest = self.root/'vault/qwen-synthetic-evaluation/task-board'; dest.mkdir(parents=True)
        (dest/'note.md').write_text('original')
        self.assertEqual(self.x.run('task-board',h.FakeAdapter()),'recovery-needed')
        self.assertEqual((dest/'note.md').read_text(),'original')
        self.assertFalse((dest/'image.png').exists())

if __name__ == '__main__': unittest.main()
