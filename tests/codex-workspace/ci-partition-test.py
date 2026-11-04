#!/usr/bin/env python3
"""Check the fixed baseline and the gate's fail-closed result predicate."""
import collections
import pathlib
import re
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


def check_cases(cases, definitions):
    if len(cases) != 141 or len(set(cases)) != len(cases):
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

    def test_suite_inventory(self):
        workflow = (ROOT / '.github/workflows/test-codex-task-board-runner.yml').read_text()
        commands = [
            'python3 tests/codex-workspace/delegation-test.py',
            'tests/codex-workspace/task-board-events-test.sh',
            'tests/codex-workspace/ai-ops-ledger-test.sh',
            'bash tests/codex-workspace/ai-subscription-usage-test.sh',
            'bb tests/ai-observability/test_slo_snapshot.bb',
            'bb tests/ai-observability/test_outcome.bb',
            'bb tests/harness-eval/test_harness_eval.bb',
            'docs/project_docs/BOXP-360/tools/test.sh',
            'tests/codex-workspace/localllm-docs-test.sh',
            'tests/codex-workspace/localllm-source-check-test.sh',
            'bb docker/codex-workspace/novel-board/novel_board_runner.bb test',
            'tests/codex-workspace/novel-board-runner-test.sh',
            'tests/codex-workspace/recurring-events-test.sh',
            'bb tests/codex-workspace/autonomy-policy-test.bb',
            'bb tests/codex-workspace/autonomy-control-test.bb',
            'bb tests/codex-workspace/vault-writer-test.bb',
            'bb tests/codex-workspace/task-board-todos-test.bb',
        ]
        for command in commands:
            self.assertEqual(workflow.count(command), 1, command)
        self.assertEqual(workflow.count('tests/codex-workspace/task-board-runner-test.sh'), 2)
        self.assertIn('group: [runner-0, runner-1, localllm, remaining]', workflow)
        self.assertIn('fail-fast: false', workflow)
        for group in ('runner-0', 'runner-1', 'localllm', 'remaining'):
            self.assertEqual(workflow.count("if: matrix.group == '" + group + "'"), 1)
        for shard in ('0', '1'):
            self.assertIn('TASK_BOARD_TEST_SHARDS=2 TASK_BOARD_TEST_SHARD=' + shard, workflow)
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
