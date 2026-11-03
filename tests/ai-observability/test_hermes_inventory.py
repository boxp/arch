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


if __name__ == '__main__':
    unittest.main()
