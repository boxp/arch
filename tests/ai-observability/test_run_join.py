import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('run_join', Path(__file__).resolve().parents[2] / 'scripts/ai-observability/run_join.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
THREAD = '12345678-1234-1234-1234-123456789abc'
RUN = '20261103T071657Z-12345678-1234-1234-1234-123456789abc'


class JoinTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='SECRET-XYZ')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.sessions = self.root / 'sessions'
        self.path = self.root / 'runs' / 'BOXP-385' / RUN
        self.path.mkdir(parents=True)

    def write_events(self, events):
        (self.path / 'events.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in events))

    def get(self):
        return module.report(self.root, self.sessions, no_ids=True, include_rows=True)

    def test_codex_child_and_privacy(self):
        (self.path / 'summary.edn').write_text('{:agent "secret-agent" :status :failed :result "SECRET-XYZ" :action :implement}')
        (self.path / 'delegation.json').write_text(json.dumps({'kind': 'delegated', 'thread': THREAD, 'reason': 'SECRET-XYZ'}))
        self.write_events([{'type': 'thread.started', 'thread_id': 'SECRET-XYZ'}, {'type': 'item.started', 'text': 'SECRET-XYZ'}, {'type': 'item.completed'}, {'type': 'turn.completed', 'usage': {'input_tokens': 100, 'cached_input_tokens': 80, 'output_tokens': 20, 'reasoning_output_tokens': 10}}])
        self.sessions.mkdir()
        (self.sessions / ('session-' + THREAD + '.jsonl')).write_text('\n'.join(json.dumps(e) for e in [{'type': 'turn_context', 'payload': {'model': 'private-model'}}, {'type': 'event_msg', 'payload': {'type': 'token_count', 'info': {'total_token_usage': {'input_tokens': 10, 'cached_input_tokens': 9, 'output_tokens': 5, 'reasoning_output_tokens': 3}}}}]))
        report = self.get()
        row = report['rows'][0]
        self.assertEqual(row['run_total_known'], 135)
        self.assertEqual(row['agent'], 'other')
        self.assertEqual(row['child_model'], 'other')
        self.assertEqual(report['groups'][0]['sum_known_totals'], 135)
        output = json.dumps(report)
        for private in ('SECRET-XYZ', THREAD, RUN, 'BOXP-385', 'secret-agent', 'private-model'):
            self.assertNotIn(private, output)
        (self.sessions / ('other-' + THREAD + '.jsonl')).write_text('')
        row = self.get()['rows'][0]
        self.assertIsNone(row['run_total_known'])
        self.assertIn('child_session_ambiguous', row['unknown_reasons'])

    def test_claude_counts_and_missing(self):
        u = {'input_tokens': 10, 'output_tokens': 2, 'cache_read_input_tokens': 3, 'cache_creation_input_tokens': 4}
        (self.path / 'summary.edn').write_text('{:status :succeeded}')
        self.write_events([{'type': 'assistant', 'parent_tool_use_id': 'SECRET-XYZ', 'message': {'model': 'claude-opus-5-5', 'usage': u, 'content': [{'type': 'tool_use', 'id': 'SECRET-XYZ', 'name': 'SECRET-XYZ'}]}}, {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'is_error': True}]}}, {'type': 'result', 'usage': u}])
        row = self.get()['rows'][0]
        self.assertEqual(row['parent_usage']['total_tokens'], 19)
        self.assertEqual(row['assistant_usage_observation']['sum_total_tokens'], 19)
        self.assertEqual(row['counts'], {'tool_use_count': 1, 'tool_result_error_count': 1, 'subagent_message_count': 1, 'assistant_message_count': 1})
        self.assertIn('delegation_missing', row['unknown_reasons'])
        self.assertIsNone(row['run_total_known'])
        self.assertNotIn('SECRET-XYZ', json.dumps(self.get()))

    def test_review_gate_usage_and_missing_records(self):
        self.write_events([{'type': 'turn.completed', 'usage': {'input_tokens': 100, 'output_tokens': 20}}])
        (self.path / 'delegation.json').write_text(json.dumps({'kind': 'exempt'}))
        summary = self.path / 'summary.edn'
        summary.write_text('{:review-gate {:checked-pr-urls ["https://example.invalid/private"]}}')
        row = self.get()['rows'][0]
        self.assertIn('review_gate_usage_unrecorded', row['unknown_reasons'])
        summary.write_text('{}')
        self.assertNotIn('review_gate_usage_unrecorded', self.get()['rows'][0]['unknown_reasons'])
        summary.write_text('{:review-gate {:gate :codex-review}}')
        file = self.path / 'codex-review-boxp__example-123-usage.jsonl'
        record = {'usage_status': 'recorded', 'thread_id': 'SECRET-XYZ', 'pr_url': 'SECRET-XYZ', 'usage': {'input_tokens': 120, 'cached_input_tokens': 20, 'output_tokens': 30, 'reasoning_output_tokens': 5}}
        file.write_text(json.dumps(record) + '\n')
        report = self.get()
        row = report['rows'][0]
        self.assertEqual((row['review_gate_calls'], row['review_gate_recorded_calls']), (1, 1))
        self.assertEqual((row['run_total_known'], row['run_output_tokens_known']), (270, 50))
        self.assertEqual(report['runs_with_review_gate_usage_recorded'], 1)
        self.assertNotIn('review_gate_usage_unrecorded', row['unknown_reasons'])
        self.assertNotIn('SECRET-XYZ', json.dumps(report))
        with file.open('a') as stream:
            stream.write('malformed\n')
        row = self.get()['rows'][0]
        self.assertEqual((row['review_gate_calls'], row['review_gate_recorded_calls']), (2, 1))
        self.assertEqual(row['run_total_known'], 270)
        self.assertIn('review_gate_usage_unrecorded', row['unknown_reasons'])
        summary.write_text('{:review-gate {:gate :codex-review :pr-urls ["private"]}}')
        file.unlink()
        self.assertIn('review_gate_usage_unrecorded', self.get()['rows'][0]['unknown_reasons'])
        summary.write_text('{:review-gate {:gate :ci :pr-urls ["private"] :checked-pr-urls []}}')
        self.assertNotIn('review_gate_usage_unrecorded', self.get()['rows'][0]['unknown_reasons'])

    def test_review_gate_partial_records_across_multiple_prs(self):
        self.write_events([{'type': 'turn.completed', 'usage': {'input_tokens': 100, 'output_tokens': 20}}])
        (self.path / 'delegation.json').write_text(json.dumps({'kind': 'exempt'}))
        summary = self.path / 'summary.edn'
        record = json.dumps({'usage_status': 'recorded', 'usage': {'input_tokens': 120, 'cached_input_tokens': 20, 'output_tokens': 30}}) + '\n'
        (self.path / 'codex-review-boxp__example-1-usage.jsonl').write_text(record)
        # Two PRs passed the gate but only one usage file was written: the sum is a lower bound, not a complete value.
        summary.write_text('{:review-gate {:checked-pr-urls ["https://example.invalid/1" "https://example.invalid/2"]}}')
        row = self.get()['rows'][0]
        self.assertEqual((row['review_gate_expected_calls'], row['review_gate_calls'], row['review_gate_recorded_calls']), (2, 1, 1))
        self.assertEqual(row['run_total_known'], 270)
        self.assertIn('review_gate_usage_unrecorded', row['unknown_reasons'])
        # One PR passed and a second one failed the codex-review gate: both were reviewed, so two records are expected.
        summary.write_text('{:review-gate {:gate :codex-review :url "https://example.invalid/2" :checked-pr-urls ["https://example.invalid/1"]}}')
        row = self.get()['rows'][0]
        self.assertEqual(row['review_gate_expected_calls'], 2)
        self.assertIn('review_gate_usage_unrecorded', row['unknown_reasons'])
        (self.path / 'codex-review-boxp__example-2-usage.jsonl').write_text(record)
        report = self.get()
        row = report['rows'][0]
        self.assertEqual((row['review_gate_expected_calls'], row['review_gate_calls'], row['review_gate_recorded_calls']), (2, 2, 2))
        self.assertEqual((row['run_total_known'], row['run_output_tokens_known']), (420, 80))
        self.assertNotIn('review_gate_usage_unrecorded', row['unknown_reasons'])
        self.assertNotIn('example.invalid', json.dumps(report))

    def test_multiple_results_unknown(self):
        self.write_events([{'type': 'turn.completed', 'usage': {'input_tokens': 1, 'output_tokens': 2}}] * 2)
        row = self.get()['rows'][0]
        self.assertIsNone(row['parent_usage'])
        self.assertIn('multiple_usage_events', row['unknown_reasons'])

    def claude_setup(self, status='succeeded'):
        (self.path / 'summary.edn').write_text('{:status :' + status + '}')
        (self.path / 'delegation.json').write_text(json.dumps({'kind': 'exempt'}))

    def test_claude_results_and_subagents(self):
        self.claude_setup()
        u = {'input_tokens': 10, 'output_tokens': 2, 'cache_read_input_tokens': 3, 'cache_creation_input_tokens': 4}
        def model(a, b, c, d):
            return {'inputTokens': a, 'outputTokens': b, 'cacheReadInputTokens': c, 'cacheCreationInputTokens': d}
        self.write_events([{'type': 'result', 'usage': u, 'modelUsage': {'claude-opus-5-5': model(11, 3, 3, 4)}},
                           {'type': 'result', 'usage': u, 'modelUsage': {'claude-opus-5-5': model(22, 6, 6, 8), 'private-model': model(1, 1, 0, 0)}}])
        report = self.get()
        row = report['rows'][0]
        self.assertEqual(row['parent_usage']['total_tokens'], 38)
        self.assertEqual(row['subagent_usage'], {'input_tokens': 3, 'output_tokens': 3, 'cache_read_input_tokens': 0, 'cache_creation_input_tokens': 0, 'total_tokens': 6})
        self.assertEqual((row['run_total_known'], row['run_output_tokens_known']), (44, 7))
        self.assertEqual(row['claude_model_totals'], {'claude-opus': 42, 'other': 2})
        self.assertNotIn('private-model', json.dumps(report))
        self.assertNotIn('multiple_usage_events', row['unknown_reasons'])
        self.write_events([{'type': 'result', 'usage': u, 'modelUsage': {'claude-opus-5-5': model(11, 3, 3, 4)}}])
        self.assertEqual(self.get()['rows'][0]['run_total_known'], 21)

    def test_claude_invalid_cumulative(self):
        self.claude_setup()
        u = {'input_tokens': 10, 'output_tokens': 2, 'cache_read_input_tokens': 3, 'cache_creation_input_tokens': 4}
        def m(n):
            return {'private-model': {'inputTokens': n, 'outputTokens': 2, 'cacheReadInputTokens': 3, 'cacheCreationInputTokens': 4}}
        for events in ([{'type': 'result', 'usage': u}],
                       [{'type': 'result', 'usage': u, 'modelUsage': m(11)}, {'type': 'result', 'usage': u, 'modelUsage': m(10)}],
                       [{'type': 'result', 'usage': u, 'modelUsage': m(9)}],
                       [{'type': 'result', 'usage': u, 'modelUsage': m(-1)}]):
            with self.subTest(events=events):
                self.write_events(events)
                row = self.get()['rows'][0]
                self.assertIsNone(row['run_total_known'])
                self.assertIn('claude_subagent_usage_unknown', row['unknown_reasons'])

    def test_claude_lower_bounds_and_privacy(self):
        u = {'input_tokens': 10, 'output_tokens': 2, 'cache_read_input_tokens': 3, 'cache_creation_input_tokens': 4}
        later = dict(u, output_tokens=5)
        def assistant(mid, value, parent=None, model='claude-opus-5-5'):
            return {'type': 'assistant', 'parent_tool_use_id': parent, 'message': {'id': mid, 'model': model, 'usage': value}}
        self.claude_setup('interrupted')
        self.write_events([assistant('private-id', u), assistant('private-id', later), assistant(None, u)])
        report = self.get()
        row = report['rows'][0]
        self.assertEqual(row['lower_bound_tokens'], 22)
        self.assertIsNone(row['parent_usage'])
        self.assertEqual((report['runs_with_lower_bound_only'], report['sum_lower_bound_tokens']), (1, 22))
        self.assertEqual((report['groups'][0]['runs_with_lower_bound_only'], report['groups'][0]['sum_lower_bound_tokens']), (1, 22))
        self.assertNotIn('private-id', json.dumps(report))
        self.assertNotIn('no_usage_event', row['unknown_reasons'])
        model = {'claude-haiku-5-5': {'inputTokens': 11, 'outputTokens': 3, 'cacheReadInputTokens': 3, 'cacheCreationInputTokens': 4}}
        events = [assistant('old-id', u), {'type': 'result', 'usage': u, 'modelUsage': model}, assistant('new-id', later, 'tool', 'private-model')]
        self.write_events(events)
        row = self.get()['rows'][0]
        self.assertEqual(row['lower_bound_tokens'], 43)
        self.assertEqual(row['parent_model'], 'claude-opus')
        self.assertEqual(row['claude_model_totals'], {'claude-haiku': 21})
        self.assertIsNone(row['run_total_known'])
        self.claude_setup('succeeded')
        self.assertEqual(self.get()['rows'][0]['usage_completeness'], 'lower_bound')
        self.assertNotIn('private-model', json.dumps(self.get()))

    def test_exempt_delegation_uses_parent_total_and_short_run_id(self):
        short = self.root / 'runs' / 'BOXP-1' / '20261001T000000Z-1a2b3c4d'
        short.mkdir(parents=True)
        (short / 'summary.edn').write_text('{:agent "codex-sol" :status :succeeded :result "review" :action :implement :exit-code 0}')
        (short / 'events.jsonl').write_text(json.dumps({'type': 'thread.started', 'thread_id': THREAD}) + '\n' +
                                            json.dumps({'type': 'turn.completed', 'usage': {'input_tokens': 100, 'cached_input_tokens': 60, 'output_tokens': 10, 'reasoning_output_tokens': 4}}) + '\n')
        (short / 'delegation.json').write_text(json.dumps({'kind': 'exempt', 'reason': 'small-task'}))
        (self.path / 'summary.edn').write_text('{:agent "codex-sol" :status :failed :result "blocked"}')
        self.write_events([{'type': 'turn.completed', 'usage': {'input_tokens': 5, 'output_tokens': 5}}])
        (self.path / 'delegation.json').write_text(json.dumps({'kind': 'failed'}))
        out = self.get()
        rows = {r['ordinal']: r for r in out['rows']}
        self.assertEqual(out['runs_scanned'], 2)
        exempt = rows[1]
        self.assertTrue(exempt['child_absent'])
        self.assertIsNone(exempt['child_usage'])
        self.assertEqual(exempt['run_total_known'], 110)  # subsets are not re-added
        self.assertEqual(exempt['run_output_tokens_known'], 10)
        self.assertEqual(exempt['unknown_reasons'], [])
        failed = rows[2]
        self.assertFalse(failed['child_absent'])
        self.assertIsNone(failed['run_total_known'])
        self.assertIn('delegation_failed', failed['unknown_reasons'])
        group = [g for g in out['groups'] if g['status'] == 'failed'][0]
        self.assertEqual((group['runs_with_parent_known'], group['sum_known_parent_totals'], group['sum_known_totals']), (1, 10, None))
        self.assertEqual(out['unknown_reasons']['review_gate_usage_unrecorded'], 0)


if __name__ == '__main__':
    unittest.main()
