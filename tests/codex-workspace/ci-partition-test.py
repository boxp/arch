#!/usr/bin/env python3
"""Check the fixed baseline and the gate's fail-closed result predicate."""
import collections
import pathlib
import os
import tempfile
import re
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


def check_cases(cases, definitions):
    if len(cases) != 177 or len(set(cases)) != len(cases):
        raise ValueError('missing or duplicate baseline case')
    if set(cases) != {name for name in definitions if name.startswith('test_')} | {'root_guard_test'}:
        raise ValueError('missing or unknown case')
    shards = [cases[i::2] for i in range(2)]
    if collections.Counter(sum(shards, [])) != collections.Counter(cases):
        raise ValueError('partition coverage error')


def gate(result):
    return subprocess.run(['bash', '-c', 'test "$RESULT" = success'], env={'RESULT': result}).returncode == 0


class PartitionTest(unittest.TestCase):
    def test_baseline_and_shards(self):
        cases = (ROOT / 'tests/codex-workspace/task-board-runner-cases.txt').read_text().splitlines()
        script = (ROOT / 'tests/codex-workspace/task-board-runner-test.sh').read_text()
        definitions = set(re.findall(r'^([a-zA-Z0-9_]+)\(\) \{', script, re.M))
        check_cases(cases, definitions)
        for bad in (cases[:-1], cases[:-1] + [cases[0]], cases[:-1] + ['unknown']):
            with self.assertRaises(ValueError):
                check_cases(bad, definitions)

    def test_localllm_inventory(self):
        cases = (ROOT / 'tests/codex-workspace/localllm-docs-cases.txt').read_text().splitlines()
        script = (ROOT / 'tests/codex-workspace/localllm-docs-test.sh').read_text()
        definitions = set(re.findall(r'^(test_\w+)\(\) \{', script, re.M))
        def validate(items):
            if len(items) != 85 or len(set(items)) != len(items) or set(items) != definitions:
                raise ValueError('missing, duplicate or unknown localllm case')
            if collections.Counter(items[::2] + items[1::2]) != collections.Counter(items):
                raise ValueError('partition coverage error')
        validate(cases)
        for bad in (cases[:-1], cases[:-1] + [cases[0]], cases[:-1] + ['unknown']):
            with self.assertRaises(ValueError):
                validate(bad)

    def test_invalid_localllm_shards_fail_before_server_start(self):
        script = ROOT / 'tests/codex-workspace/localllm-docs-test.sh'
        for count, index in [('', '0'), ('0', '0'), ('2', ''), ('2', '2'),
                             ('2', '-1'), ('2', '01'), ('x', '0'), ('999999999999999', '0')]:
            env = dict(os.environ, LOCALLLM_TEST_SHARDS=count, LOCALLLM_TEST_SHARD=index)
            result = subprocess.run([str(script)], env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0, (count, index))
            self.assertIn('invalid shard', result.stderr)

    def test_unknown_case_fails_shard(self):
        # A minimal isolated fixture executes the real dispatcher with a bad manifest.
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            directory = root / 'tests/codex-workspace'
            directory.mkdir(parents=True)
            (directory / 'localllm-docs-test.sh').write_text(
                (ROOT / 'tests/codex-workspace/localllm-docs-test.sh').read_text())
            (directory / 'localllm-docs-cases.txt').write_text('unknown_case\n')
            env = dict(os.environ, LOCALLLM_TEST_SHARDS='2', LOCALLLM_TEST_SHARD='0')
            result = subprocess.run(['bash', str(directory / 'localllm-docs-test.sh')],
                                    env=env, capture_output=True, text=True, timeout=30)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('unknown case: unknown_case', result.stderr)

    def test_case_failure_propagates(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = pathlib.Path(tmp) / 'tests/codex-workspace'
            directory.mkdir(parents=True)
            script = (ROOT / 'tests/codex-workspace/localllm-docs-test.sh').read_text()
            script = script.replace('mapfile -t cases <',
                                    'test_fixture_failure() { return 23; }\nmapfile -t cases <')
            (directory / 'localllm-docs-test.sh').write_text(script)
            (directory / 'localllm-docs-cases.txt').write_text('test_fixture_failure\n')
            result = subprocess.run(['bash', str(directory / 'localllm-docs-test.sh')],
                                    env=dict(os.environ, LOCALLLM_TEST_SHARDS='2', LOCALLLM_TEST_SHARD='0'),
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 23)
            self.assertNotIn('localllm docs tests passed', result.stdout)

    def test_suite_inventory(self):
        workflow = (ROOT / '.github/workflows/test-codex-task-board-runner.yml').read_text()
        commands = [
            'bb tests/codex-workspace/model-updates-test.bb',
            'python3 tests/codex-workspace/task-board-reconcile-test.py',
            'python3 tests/codex-workspace/delegation-test.py',
            'tests/codex-workspace/task-board-events-test.sh',
            'tests/codex-workspace/ai-ops-ledger-test.sh',
            'bash tests/codex-workspace/ai-subscription-usage-test.sh',
            'bb tests/ai-observability/test_slo_snapshot.bb',
            'bb tests/ai-observability/test_outcome.bb',
            'bb tests/ai-observability/test_provider_quota.bb',
            'bb tests/ai-observability/test_agent_auth_expiry.bb',
            'bb tests/harness-eval/test_harness_eval.bb',
            'docs/project_docs/BOXP-360/tools/test.sh',
            'tests/codex-workspace/localllm-docs-test.sh',
            'tests/codex-workspace/localllm-source-check-test.sh',
            'bb docker/codex-workspace/novel-board/novel_board_runner.bb test',
            'tests/codex-workspace/novel-board-runner-test.sh',
            'tests/codex-workspace/recurring-events-test.sh',
            'bb tests/codex-workspace/infra-diagram-refresh-test.bb',
            'bb tests/codex-workspace/site-refresh-test.bb',
            'bb tests/codex-workspace/auth-gateway-test.bb',
            'bb docker/codex-workspace/task-board/test/langfuse_exporter_test.bb',
            'bb tests/codex-workspace/autonomy-policy-test.bb',
            'bb tests/codex-workspace/autonomy-control-test.bb',
            'bb tests/codex-workspace/vault-writer-test.bb',
            'bb tests/codex-workspace/task-board-conflict-test.bb',
            'bb tests/codex-workspace/task-board-todos-test.bb',
            'bb tests/codex-workspace/task-board-same-file-review-test.bb',
            'bb tests/codex-workspace/task-board-runner-boundary-test.bb',
            'bb tests/codex-workspace/task-board-mutation.bb --self-test',
        ]
        for command in commands:
            self.assertEqual(workflow.count(command), 2 if command == 'tests/codex-workspace/localllm-docs-test.sh' else 1, command)
        self.assertEqual(workflow.count('tests/codex-workspace/task-board-runner-test.sh'), 2)
        self.assertIn('group: [runner-0, runner-1, localllm-0, localllm-1, novel-board, remaining]', workflow)
        self.assertIn('fail-fast: false', workflow)
        for group in ('runner-0', 'runner-1', 'localllm-0', 'localllm-1', 'novel-board', 'remaining'):
            self.assertEqual(workflow.count("if: matrix.group == '" + group + "'"), 1)
        self.assertIn('max-parallel: 6', workflow)
        for shard in ('0', '1'):
            self.assertIn('TASK_BOARD_TEST_SHARDS=2 TASK_BOARD_TEST_SHARD=' + shard, workflow)
            self.assertIn('LOCALLLM_TEST_SHARDS=2 LOCALLLM_TEST_SHARD=' + shard, workflow)
        self.assertIn('needs: [suites]', workflow)
        self.assertIn('if: always()', workflow)

    def test_gate(self):
        workflow = (ROOT / '.github/workflows/test-codex-task-board-runner.yml').read_text()
        self.assertIn('test "$RESULT" = success', workflow)
        self.assertTrue(gate('success'))
        for result in ('', 'failure', 'cancelled', 'skipped', 'missing', 'Success'):
            self.assertFalse(gate(result))


if __name__ == '__main__':
    unittest.main()
