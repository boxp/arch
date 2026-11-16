import importlib.util
import json
from pathlib import Path
import sqlite3
import unittest

spec = importlib.util.spec_from_file_location('hermes_inventory', Path(__file__).resolve().parents[2] / 'scripts/ai-observability/hermes_inventory.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class HermesTest(unittest.TestCase):
    def test_private_strings_and_missing_fields(self):
        c = sqlite3.connect(':memory:')
        c.execute('CREATE TABLE sessions(id TEXT, model TEXT, content TEXT, input_tokens INTEGER DEFAULT 0)')
        c.execute("INSERT INTO sessions VALUES('secret-id','private-model','private-body',10)")
        c.commit()
        out = m.inventory(c)
        self.assertEqual(out['fields']['input_tokens'], {'nonnull':1, 'positive':1, 'defaults_to_zero':True})
        self.assertIsNone(out['fields']['output_tokens'])
        for private in ('secret-id','private-model','private-body'):
            self.assertNotIn(private, json.dumps(out))

    def test_empty_and_unsupported(self):
        c = sqlite3.connect(':memory:')
        self.assertEqual(m.inventory(c), {'state':'unsupported_schema'})
        c.close()
        c = sqlite3.connect(':memory:')
        c.execute('CREATE TABLE sessions(input_tokens INTEGER DEFAULT 0)')
        out = m.inventory(c)
        self.assertEqual(out['fields']['input_tokens']['positive'], 0)
        self.assertEqual(out['sessions'], 0)
        self.assertIsNone(out['model_family_counts'])

    def test_placement_modes_and_cron_usage(self):
        import tempfile
        c = sqlite3.connect(':memory:')
        c.execute('CREATE TABLE sessions(model TEXT, billing_base_url TEXT, billing_mode TEXT, input_tokens INTEGER DEFAULT 0)')
        c.executemany('INSERT INTO sessions VALUES(?,?,?,?)', [
            ('gemma-private', 'http://ollama.private.svc:11434/v1', None, 1),
            ('gpt-private', 'https://api.private.example/v1', 'chatgpt-plan-secret', 1),
            ('qwen-private', '', 'api', 1), ('other', 'https://x.example', 'weird', 1)])
        c.commit()
        out = m.inventory(c)
        self.assertEqual(out['placement_by_family']['local/gemma'], 1)
        self.assertEqual(out['placement_by_family']['cloud/other'], 2)
        self.assertEqual(out['placement_by_family']['unknown/qwen'], 1)
        self.assertEqual(out['billing_mode_classes'], {'subscription_like': 1, 'api_like': 1, 'other': 1, 'null_or_empty': 1})
        for private in ('private', 'secret', 'example', 'weird'):
            self.assertNotIn(private, json.dumps(out))
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'usage_audit.jsonl'
            path.write_text('\n'.join([
                json.dumps({'job_id': 'job-secret-a', 'prompt_tokens': 10, 'completion_tokens': 2, 'total_tokens': 12, 'duration_ms': 5, 'error': None}),
                json.dumps({'job_id': 'job-secret-a', 'prompt_tokens': None, 'completion_tokens': 2, 'total_tokens': 12, 'duration_ms': 5, 'error': 'boom-secret'}),
                json.dumps({'job_id': 'job-secret-b', 'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2, 'duration_ms': 1, 'error': ''}),
                'not json']) + '\n')
            usage = m.cron_usage(path)
            self.assertEqual(usage['jobs']['1'], {'fires': 2, 'errors': 1, 'prompt_tokens': 10, 'completion_tokens': 2, 'total_tokens': 12, 'fires_with_usage': 1, 'duration_ms': 5})
            self.assertEqual(usage['jobs']['2']['fires'], 1)
            self.assertNotIn('secret', json.dumps(usage))
            self.assertEqual(m.cron_usage(Path(d) / 'missing.jsonl'), {'state': 'unavailable'})


if __name__ == '__main__':
    unittest.main()
