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
        # Fake per-target lanes: a target's 'outcome' is live / standalone / fail / relay-fail.
        # Like upstream, the live lane reports delivered=True after a confirmation timeout or a
        # partial split send; only _live_send_text's message_id tells a confirmed full text send.
        live_text = {'live': (True, False, 42), 'live-timeout': (True, True, None), 'live-partial': (True, False, None), 'live-fail': (False, False, None)}
        def live_send_text(t, text, *a, **kw):
            return live_text[t.outcome]
        def live(t, text, media, *, target_errors, delivery_errors, unverified_targets):
            if not t.outcome.startswith('live'):
                return False
            adapter_ok, _, _ = self.delivery._live_send_text(t, text, None, {})
            return adapter_ok
        def standalone(t, content, media, target_errors, delivery_errors):
            if t.outcome in ('fail', 'relay-fail'):
                target_errors.append(f'{t.platform_name} failed'); delivery_errors.extend(target_errors)
        self.delivery = types.SimpleNamespace(_sched=types.SimpleNamespace(_is_cron_silence_response=lambda text: text == 'SILENT'), _resolve_delivery_targets=lambda job, **kw: job.get('targets', [{'platform': 'telegram'}]), _redact_cron_payload=lambda text, what: text.replace('secret', '[redacted]'), BOT_CHAT_PLATFORM='bot-chat', _live_send_text=live_send_text, _deliver_via_live_adapter=live, _deliver_standalone=standalone)
        self.job = {'id': 'job1', 'name': 'Test', 'execution_id': 'run1'}
    def original(self, job, content, adapters=None, loop=None, *, for_failure=False):
        # Mirrors upstream _deliver_result: lanes are looked up on the module at call time.
        if os.environ.get('_HERMES_CRON_EXTERNAL_WORKER') == job.get('execution_id') and adapters is None:
            return None  # handed to the durable queue; nothing sent in this process
        errors = []
        for target in self.delivery._resolve_delivery_targets(job, for_failure=for_failure):
            t = types.SimpleNamespace(platform_name=target['platform'], outcome=target.get('outcome', 'standalone'), is_relay=target.get('outcome') == 'relay-fail')
            target_errors = []
            if not self.delivery._deliver_via_live_adapter(t, content, [], target_errors=target_errors, delivery_errors=errors, unverified_targets=[]):
                self.delivery._deliver_standalone(t, content, [], target_errors, errors)
        return '; '.join(errors) or None
    def send(self, job=None, content='hello secret [media]', **kw):
        return mod.wrap(self.original, self.delivery)(job or self.job, content, **kw)
    def files(self): return list((self.root / 'copies').glob('*.md'))
    def test_success_and_dedupe(self):
        self.send(); self.send()
        self.assertEqual(len(self.files()), 1)
        self.assertEqual(json.loads(self.files()[0].read_text())['text'], 'hello [redacted] ')
    def test_skips(self):
        self.send(job={**self.job, 'targets': [{'platform': 'telegram', 'outcome': 'fail'}]})
        self.send(job={**self.job, 'targets': [{'platform': 'telegram', 'outcome': 'relay-fail'}]})
        self.send(content=' '); self.send(content='SILENT')
        self.send(job={**self.job, '_notification_all_targets_suppressed': True})
        self.send(job={**self.job, 'targets': [{'platform': 'discord'}]})
        self.assertEqual(self.files(), [])
    def test_telegram_success_with_other_target_failure(self):
        job = {**self.job, 'targets': [{'platform': 'telegram', 'outcome': 'live'}, {'platform': 'discord', 'outcome': 'fail'}]}
        self.assertEqual(self.send(job=job), 'discord failed')
        self.assertEqual(len(self.files()), 1)
    def test_other_target_success_with_telegram_failure(self):
        job = {**self.job, 'targets': [{'platform': 'telegram', 'outcome': 'fail'}, {'platform': 'discord', 'outcome': 'live'}]}
        self.send(job=job)
        self.assertEqual(self.files(), [])
    def test_live_timeout_or_partial_send_is_not_copied(self):
        for outcome in ('live-timeout', 'live-partial'):
            self.send(job={**self.job, 'execution_id': outcome, 'targets': [{'platform': 'telegram', 'outcome': outcome}]})
        self.assertEqual(self.files(), [])
    def test_wrap_is_idempotent(self):
        mod.wrap(self.original, self.delivery); live = self.delivery._deliver_via_live_adapter
        mod.wrap(self.original, self.delivery)
        self.assertIs(self.delivery._deliver_via_live_adapter, live)
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
