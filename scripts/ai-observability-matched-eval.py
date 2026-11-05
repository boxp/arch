#!/usr/bin/env python3
"""Finite subscription-only eval; persist numeric metadata, never raw CLI output.

Fixtures below are public synthetic data, not collected production prompts.
No retries, fallback, tools, personal content, or routing changes.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

CASES = {
    'cache-subset': ('Input tokens include cache-read; output includes reasoning. '
                     'Unknown fields stay null. Calculate total=input+output. '
                     'Return JSON only with keys total and cache_write. '
                     'input=1200 output=80 cache_read=900 reasoning=30 cache_write=unknown.',
                     {'total': 1280, 'cache_write': None}),
    'snapshot-dedup': ('Cumulative snapshots are not independent calls. For snapshots '
                       '100,100,180,180 calculate the latest cumulative total and '
                       'the count of increases from initial zero. Return JSON only '
                       'with keys total and increases.', {'total': 180, 'increases': 2}),
}
MODELS = {'sol': 'gpt-6.1-sol', 'fable': 'claude-fable-5-1'}


def prompt(case, variant):
    question = CASES[case][0]
    # One harness change: deduplicate identical retrieved records, preserving meaning.
    record = 'Reference: missing usage is unknown; cached/reasoning subsets are not added to total.'
    context = '\n'.join([record] * (24 if variant == 'before' else 1))
    return question + '\n' + context


def number(value):
    return value if type(value) in (int, float) and value >= 0 else None


def run_one(route, case, variant, cwd):
    env = os.environ.copy()
    for key in ('OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_ADMIN_KEY', 'ANTHROPIC_API_KEY'):
        env.pop(key, None)
    env.pop('CLAUDECODE', None)
    model = MODELS[route]
    if route == 'sol':
        cmd = ['codex', 'exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
               '--sandbox', 'read-only', '--json', '--model', model,
               '-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"',
               '-c', 'model_reasoning_effort="medium"',
               '-c', 'developer_instructions="Answer the fixed JSON task directly. Do not use tools."', '-']
    else:
        cmd = ['claude', '--print', '--model', model, '--effort', 'medium', '--tools', '',
               '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
               '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence',
               '--max-turns', '1', '--output-format', 'json', '--system-prompt',
               'Answer the fixed JSON task directly. Do not use tools.']
    value = prompt(case, variant)
    row = dict(route=route, requested_model=model, observed_model=None, effort='medium', case=case, variant=variant,
               template='public-usage-arithmetic-v1', retrieval_records=24 if variant == 'before' else 1,
               input_bytes=len(value.encode()), ttft_ms=None, tool_calls=0,
               input_tokens=None, output_tokens=None, cache_read_tokens=None,
               cache_write_tokens=None, reasoning_tokens=None, total_tokens=None,
               provider_cost_usd=None, production_acceptance=None, owner_rescue=None)
    start = time.monotonic()
    try:
        p = subprocess.run(cmd, input=value, text=True, capture_output=True, env=env, cwd=cwd, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        row.update(status='unavailable', passed=False, duration_ms=round((time.monotonic()-start)*1000))
        return row
    row['duration_ms'] = round((time.monotonic()-start)*1000)
    answer, usage, completed = '', {}, False
    if p.returncode:
        row.update(status='cli_failed', passed=False)
        return row  # Do not print provider error strings or retry.
    try:
        if route == 'sol':
            for line in p.stdout.splitlines():
                event = json.loads(line)
                if event.get('type') == 'item.completed':
                    item = event.get('item', {})
                    if item.get('type') == 'agent_message':
                        answer = item.get('text', '')
                    elif item.get('type') not in ('reasoning',):
                        row['tool_calls'] += 1
                if event.get('type') == 'turn.completed':
                    usage = event.get('usage', {})
                    completed = True
            if not completed:
                row.update(status='incomplete', passed=False)
                return row
            row.update(input_tokens=number(usage.get('input_tokens')),
                       output_tokens=number(usage.get('output_tokens')),
                       cache_read_tokens=number(usage.get('cached_input_tokens')),
                       cache_write_tokens=number(usage.get('cache_write_input_tokens')),
                       reasoning_tokens=number(usage.get('reasoning_output_tokens')))
            if row['input_tokens'] is not None and row['output_tokens'] is not None:
                row['total_tokens'] = row['input_tokens'] + row['output_tokens']
        else:
            event = json.loads(p.stdout)
            answer, usage = event.get('result', ''), event.get('usage', {})
            if event.get('is_error'):
                row.update(status='provider_failed', passed=False)
                return row
            row.update(input_tokens=number(usage.get('input_tokens')),
                       output_tokens=number(usage.get('output_tokens')),
                       cache_read_tokens=number(usage.get('cache_read_input_tokens')),
                       cache_write_tokens=number(usage.get('cache_creation_input_tokens')))
            parts = [row[k] for k in ('input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens')]
            if all(v is not None for v in parts):
                row['total_tokens'] = sum(parts)  # Anthropic's cache counts exclude input_tokens.
        cleaned = answer.strip()
        if cleaned.startswith('```') and cleaned.endswith('```'):
            cleaned = '\n'.join(cleaned.splitlines()[1:-1])
        row.update(status='completed', output_bytes=len(answer.encode()),
                   passed=json.loads(cleaned) == CASES[case][1] and row['tool_calls'] == 0)
    except (ValueError, TypeError, AttributeError):
        row.update(status='invalid_result', passed=False)
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true', help='Explicitly run at most eight subscription calls')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if not args.execute:
        parser.error('--execute is required; no implicit model calls')
    rows = []
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='boxp385-eval-') as cwd:
        for case in CASES:
            # Alternate route order across cases to expose warm-cache/order bias.
            for route in (('sol', 'fable') if case == 'cache-subset' else ('fable', 'sol')):
                for variant in ('before', 'after'):
                    if time.monotonic()-started > 600 or sum(r.get('total_tokens') or 0 for r in rows) >= 100000:
                        args.out.parent.mkdir(parents=True, exist_ok=True)
                        args.out.write_text(json.dumps({'status':'stopped_budget', 'rows':rows}, indent=2)+'\n')
                        return 1
                    row = run_one(route, case, variant, cwd)
                    rows.append(row)
                    print(json.dumps(row), flush=True)
                    if row['status'] != 'completed' or not row['passed'] or row['total_tokens'] is None:
                        # Failure is retained, never silently dropped from successful-task denominator.
                        args.out.parent.mkdir(parents=True, exist_ok=True)
                        args.out.write_text(json.dumps({'status':'stopped', 'rows':rows}, indent=2)+'\n')
                        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({'status':'completed', 'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                    'max_calls':8, 'max_concurrency':1, 'max_retries':0, 'rows':rows}, indent=2)+'\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
