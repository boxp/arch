import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[2] / 'docker/codex-workspace/qwen-eval'
sys.path.insert(0, str(BASE))
from harness import png, validate_reference_contract
from live import LiveAdapter
from runtime import RuntimeController


class LeaseTests(unittest.TestCase):
    def test_restart_and_foreign_token_fail_closed(self):
        with tempfile.TemporaryDirectory() as d:
            def start(token, mode):
                proc = subprocess.Popen([sys.executable, str(BASE/'node_lease.py'), d, mode], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                proc.stdin.write(token+'\n'); proc.stdin.flush()
                return proc
            first = start('BOXP-349-a', 'new')
            self.assertEqual(first.stdout.readline().strip(), 'LEASED')
            rival = start('BOXP-349-a', 'recover')
            self.assertNotEqual(rival.wait(timeout=5), 0)
            rival.communicate()
            first.stdin.close(); first.wait(timeout=5); first.stdout.close(); first.stderr.close()
            foreign = start('BOXP-349-b', 'recover')
            self.assertNotEqual(foreign.wait(timeout=5), 0); foreign.communicate()
            recovered = start('BOXP-349-a', 'recover')
            self.assertEqual(recovered.stdout.readline().strip(), 'LEASED')
            recovered.stdin.close(); recovered.wait(timeout=5); recovered.stdout.close(); recovered.stderr.close()
            self.assertEqual(json.loads((Path(d)/'boxp344-window.json').read_text())['token'], 'BOXP-349-a')

    def test_reference_contract_and_unsupported_dispatch(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d)/'synthetic.png').write_bytes(png())
            ref = {'path':'synthetic.png', 'sha256':hashlib.sha256(png()).hexdigest()}
            self.assertEqual(validate_reference_contract(d, ref), png())
            with self.assertRaises(ValueError): validate_reference_contract(d, dict(ref, sha256='0'*64))
            adapter = LiveAdapter(d, d, 'BOXP-349-test')
            with self.assertRaisesRegex(RuntimeError, 'not supported'):
                adapter.generate({'reference':ref})

    def test_limits_have_hard_ceiling(self):
        with tempfile.TemporaryDirectory() as d:
            for kwargs in ({'max_batch':3}, {'max_window':1801}):
                with self.assertRaises(ValueError): RuntimeController(d, 'x', object(), **kwargs)

    def test_completed_token_is_immutable_and_archived(self):
        import time
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            old={'token':'BOXP-349-a','state':'completed','pid':999999999,'start':'0',
                 'completed_at':time.time()-300,'regeneration_allowed':False}
            marker=root/'boxp344-window.json';marker.write_text(json.dumps(old))
            def run(token,mode):
                p=subprocess.Popen([sys.executable,str(BASE/'node_lease.py'),d,mode],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                p.stdin.write(token+'\n');p.stdin.flush();return p
            recovery=run('BOXP-349-a','recover')
            self.assertNotEqual(recovery.wait(timeout=5),0);recovery.communicate()
            self.assertEqual(json.loads(marker.read_text()),old)
            next_window=run('BOXP-349-b','new')
            self.assertEqual(next_window.stdout.readline().strip(),'LEASED')
            next_window.stdin.close();next_window.wait(timeout=5);next_window.stdout.close();next_window.stderr.close()
            self.assertEqual(json.loads((root/'completed-windows/BOXP-349-a.json').read_text()),old)
            current=json.loads(marker.read_text());current.update(state='completed',completed_at=time.time()-300,regeneration_allowed=False)
            marker.write_text(json.dumps(current))
            duplicate=run('BOXP-349-a','new')
            self.assertNotEqual(duplicate.wait(timeout=5),0);duplicate.communicate()
