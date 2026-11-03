import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('matched_eval', Path(__file__).resolve().parents[2] / 'scripts/ai-observability-matched-eval.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class EvalTest(unittest.TestCase):
    def call(self, route, output):
        with patch.object(m.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=output)):
            return m.run_one(route, 'cache-subset', 'before', '/tmp')

    def test_provider_cache_semantics(self):
        answer = '{"total":1280,"cache_write":null}'
        codex = '\n'.join(json.dumps(e) for e in [
            {'type':'item.completed', 'item':{'type':'agent_message','text':answer}},
            {'type':'turn.completed','usage':{'input_tokens':1200,'cached_input_tokens':900,'output_tokens':80,'reasoning_output_tokens':30}}])
        a = self.call('sol', codex)
        b = self.call('fable', json.dumps({'result':answer,'usage':{'input_tokens':300,'cache_read_input_tokens':900,'cache_creation_input_tokens':0,'output_tokens':80}}))
        self.assertTrue(a['passed'] and b['passed'])
        self.assertEqual(a['total_tokens'], b['total_tokens'])
        self.assertEqual(a['total_tokens'], 1280)
        self.assertIsNone(a['cache_write_tokens'])
        self.assertEqual(a['reasoning_tokens'], 30)
        # The provider's answer is evaluated, never included in persisted metadata.
        self.assertNotIn('result', b)
        self.assertNotIn('answer', a)

    def test_missing_usage_and_incomplete_are_not_success(self):
        row = self.call('fable', json.dumps({'result':'{"total":1280,"cache_write":null}'}))
        self.assertIsNone(row['total_tokens'])
        row = self.call('sol', json.dumps({'type':'turn.failed'}))
        self.assertEqual(row['status'], 'incomplete')
        self.assertFalse(row['passed'])


if __name__ == '__main__':
    unittest.main()
