import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).resolve().parents[2] / 'scripts/ai-observability/usage_pilot.py'
spec = importlib.util.spec_from_file_location('usage_pilot', path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class PilotTest(unittest.TestCase):
    def test_privacy(self):
        base = {'ordinal': 1, 'scope': 'leaf', 'kind': 'call'}
        for extra in ({'prompt': 'secret'}, {'input_tokens': 'secret'}, {'model': 'private'}, {'ordinal': 'secret'}):
            with self.assertRaises(ValueError):
                m.aggregate_calls([{**base, **extra}])

    def test_no_double_count_or_missing_zero(self):
        a = {'ordinal': 1, 'scope': 'leaf', 'kind': 'call', 'input_tokens': 10,
             'output_tokens': 5, 'total_tokens': 15, 'cache_read_tokens': 4,
             'reasoning_tokens': 2}
        b = {'ordinal': 2, 'scope': 'leaf', 'kind': 'call', 'input_tokens': 20}
        parent = {'ordinal': 3, 'scope': 'parent', 'kind': 'call', 'total_tokens': 100}
        cumulative = {'ordinal': 4, 'scope': 'leaf', 'kind': 'cumulative', 'total_tokens': 100}
        out = m.aggregate_calls([a, a, b, parent, cumulative])
        self.assertEqual((out['calls'], out['duplicates'], out['excluded_parent'], out['excluded_cumulative']), (2, 1, 1, 1))
        self.assertEqual(out['fields']['total_tokens'], {'observed_sum': 15, 'observed_calls': 1, 'missing_calls': 1})
        self.assertEqual(out['fields']['input_tokens']['observed_sum'], 30)
        self.assertEqual(out['fields']['cache_read_tokens']['observed_sum'], 4)
        self.assertIsNone(out['fields']['cache_write_tokens']['observed_sum'])
        with self.assertRaises(ValueError):
            m.aggregate_calls([a, {**a, 'total_tokens': 16}])


if __name__ == '__main__':
    unittest.main()
