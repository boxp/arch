import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('boxp_cron_delivery_test', Path(__file__).with_name('boxp_cron_delivery.py'))
mod = importlib.util.module_from_spec(spec)
with patch.dict(os.environ, {'BOXP_CRON_COPY_RECOVERY_SECONDS': '0'}):
    spec.loader.exec_module(mod)

class CronCopyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.copy = patch.object(mod, 'COPY_DIR', self.root / 'copies'); self.copy.start(); self.addCleanup(self.copy.stop)
        self.pending = patch.object(mod, 'pending_dir', return_value=self.root / 'pending'); self.pending.start(); self.addCleanup(self.pending.stop)
        base = types.ModuleType('gateway.platforms.base')
        base.BasePlatformAdapter = type('Adapter', (), {'extract_media': staticmethod(lambda text: ([], text.replace('[media]', '')))})
        self.modules = patch.dict(sys.modules, {'gateway': types.ModuleType('gateway'), 'gateway.platforms': types.ModuleType('gateway.platforms'), 'gateway.platforms.base': base}); self.modules.start(); self.addCleanup(self.modules.stop)
        self.delivery = types.SimpleNamespace(_sched=types.SimpleNamespace(_is_cron_silence_response=lambda text: text == 'SILENT'), _resolve_delivery_targets=lambda job, **kw: job.get('targets', [{'platform': 'telegram'}]), _redact_cron_payload=lambda text, what: text.replace('secret', '[redacted]'), BOT_CHAT_PLATFORM='bot-chat')
        self.job = {'id': 'job1', 'name': 'Test', 'execution_id': 'run1'}
    def send(self, job=None, content='hello secret [media]', result=None, **kw):
        return mod.wrap(lambda *a, **k: result, self.delivery)(job or self.job, content, **kw)
    def files(self): return list((self.root / 'copies').glob('*.md'))
    def test_success_and_dedupe(self):
        self.send(); self.send()
        self.assertEqual(len(self.files()), 1)
        self.assertEqual(json.loads(self.files()[0].read_text())['text'], 'hello [redacted] ')
    def test_skips(self):
        self.send(result='error'); self.send(content=' '); self.send(content='SILENT')
        self.send(job={**self.job, '_notification_all_targets_suppressed': True})
        self.send(job={**self.job, 'targets': [{'platform': 'discord'}]})
        self.assertEqual(self.files(), [])
    def test_external_queue_and_gateway(self):
        with patch.dict(os.environ, {'_HERMES_CRON_EXTERNAL_WORKER': 'run1'}):
            self.send(); self.assertEqual(self.files(), [])
            self.send(adapters={}); self.assertEqual(len(self.files()), 1)
    def test_failure(self):
        warning = types.ModuleType('gateway.warning_notifications'); warning.warning_notifications_enabled = lambda *a: True
        with patch.dict(sys.modules, {'gateway.warning_notifications': warning}):
            self.send(for_failure=True)
        self.assertTrue(self.files()[0].name.endswith('-failure.md'))
    def test_recovery(self):
        atomic = mod.atomic
        def fail_copy(path, payload):
            if path.parent == mod.COPY_DIR: raise OSError('offline')
            atomic(path, payload)
        with patch.object(mod, 'atomic', side_effect=fail_copy): self.send()
        self.assertEqual(self.files(), [])
        mod.recover()
        self.assertEqual(len(self.files()), 1)
        self.assertEqual(list((self.root / 'pending').glob('*.json')), [])

if __name__ == '__main__': unittest.main()
