#!/usr/bin/env python3
"""Read-only, metadata-only Task Board run and delegated session coverage."""
import argparse
from collections import Counter
import json
import math
import os
from pathlib import Path
import re

TICKET = re.compile(r'[A-Z]+-\d+\Z')
# Same shape as the ledger's run-id-re: full uuid, short hex suffix, or none, with optional -groom.
RUN = re.compile(r'\d{8}T\d{6}Z(?:-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|-[0-9a-f]{1,8})?(?:-groom)?\Z')
UUID = re.compile(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\Z')
MODELS = {'gpt-6.1-terra': 'codex-terra', 'gpt-6.1-sol': 'codex-sol', 'gpt-6-astra': 'codex-astra', 'claude-fable-5-1': 'claude-fable', 'claude-opus-5-5': 'claude-opus', 'claude-sonnet-5-5': 'claude-sonnet', 'claude-haiku-5-5': 'claude-haiku'}
ALLOWED = {'agent': set('codex codex-terra codex-sol codex-full codex-mini codex-astra claude-fable claude-opus claude-sonnet fable localllm localllm-coder'.split()), 'status': set('succeeded retrying blocked interrupted failed running superseded'.split()), 'result': set('review blocked done ready'.split()), 'action': set('implement groom review-fix blocked-retry docs-edit docs-groom'.split())}
REASONS = ('no_events', 'unreadable', 'no_usage_event', 'multiple_usage_events', 'child_session_not_found', 'child_session_ambiguous', 'child_session_unreadable', 'child_no_token_count', 'summary_missing', 'delegation_missing', 'delegation_failed', 'review_gate_usage_unrecorded', 'claude_subagent_usage_unknown', 'claude_usage_lower_bound_only')


def enum(value, allowed):
    return None if value is None else value if value in allowed else 'other'


def number(value):
    return value if type(value) is int and 0 <= value <= 10**12 else None


def usage(raw, runtime):
    if not isinstance(raw, dict):
        return None
    names = ('input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'reasoning_output_tokens') if runtime == 'codex' else ('input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens')
    values = {key: number(raw.get(key)) for key in names}
    required = names[:2] if runtime == 'codex' else names
    if any(values[key] is None for key in required):
        return None
    values['total_tokens'] = sum(values[key] for key in required)
    return values


CLAUDE_KEYS = ('input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens')
MODEL_KEYS = ('inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens')


def model_usage(raw):
    if not isinstance(raw, dict):
        return None
    totals = dict.fromkeys(CLAUDE_KEYS, 0)
    models = {}
    for model, values in raw.items():
        if not isinstance(model, str) or not isinstance(values, dict):
            return None
        parsed = [number(values.get(key)) for key in MODEL_KEYS]
        if any(value is None for value in parsed):
            return None
        for key, value in zip(CLAUDE_KEYS, parsed):
            totals[key] += value
        mapped = MODELS.get(model, 'other')
        models[mapped] = models.get(mapped, 0) + sum(parsed)
    totals['total_tokens'] = sum(totals.values())
    return totals, models


def read_events(path):
    events = []
    try:
        with path.open(encoding='utf-8') as stream:
            for line in stream:
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if isinstance(event, dict):
                    events.append(event)
    except (OSError, UnicodeError):
        return None
    return events


def summary(path, reasons):
    try:
        text = path.read_text(encoding='utf-8')
    except FileNotFoundError:
        reasons.add('summary_missing')
        return {**{key: None for key in ALLOWED}, 'exit_code': None}
    except (OSError, UnicodeError):
        reasons.add('unreadable')
        return {**{key: None for key in ALLOWED}, 'exit_code': None}
    result = {}
    for key in ALLOWED:
        pattern = r'(?<![\w-]):' + key + (r'\s+"([^"\\]*)"' if key in ('agent', 'result') else r'\s+:([\w-]+)')
        match = re.search(pattern, text)
        result[key] = enum(match.group(1) if match else None, ALLOWED[key])
    match = re.search(r'(?<![\w-]):exit-code\s+(-?\d+)(?![\w-])', text)
    result['exit_code'] = int(match.group(1)) if match and len(match.group(1)) <= 12 else None
    # The runner calls codex review exactly once per reviewed PR: every PR in checked-pr-urls passed it, and the
    # PR named by a failing :gate :codex-review was reviewed too. pr-urls alone also covers runs that stopped at the
    # CI/draft/mergeability gate, so it is not evidence. Only the count is kept; URLs are never copied into the report.
    checked = re.search(r':checked-pr-urls\s+\[([^\]]*)\]', text)
    expected = len(re.findall(r'"[^"\\]*"', checked.group(1))) if checked else 0
    expected += bool(re.search(r':gate\s+:codex-review\b', text))
    result['review_gate_expected_calls'] = expected
    return result


def child(path, sessions, reasons):
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(data, dict):
            raise ValueError
    except FileNotFoundError:
        reasons.add('delegation_missing')
        return None, None
    except (OSError, UnicodeError, ValueError):
        reasons.add('unreadable')
        return None, None
    if data.get('kind') == 'exempt':
        return 'absent', None
    if data.get('kind') != 'delegated':
        reasons.add('delegation_failed')
        return None, None
    thread = data.get('thread')
    if not isinstance(thread, str) or not UUID.fullmatch(thread):
        reasons.add('child_session_not_found')
        return None, None
    matches = list(sessions.rglob('*' + thread + '.jsonl'))
    if len(matches) != 1:
        reasons.add('child_session_ambiguous' if matches else 'child_session_not_found')
        return None, None
    events = read_events(matches[0])
    if events is None:
        reasons.add('child_session_unreadable')
        return None, None
    latest = None
    model = None
    for event in events:
        payload = event.get('payload')
        if not isinstance(payload, dict):
            continue
        if event.get('type') == 'turn_context' and isinstance(payload.get('model'), str):
            model = enum(payload['model'], MODELS) if payload['model'] not in MODELS else MODELS[payload['model']]
        if event.get('type') == 'event_msg' and payload.get('type') == 'token_count':
            info = payload.get('info')
            if isinstance(info, dict) and isinstance(info.get('total_token_usage'), dict):
                latest = usage(info['total_token_usage'], 'codex')
    if latest is None:
        reasons.add('child_no_token_count')
    return latest, model


def review_usage(path):
    calls = recorded = 0
    usages = []
    for file in sorted(path.glob('codex-review-*-usage.jsonl')):
        try:
            with file.open(encoding='utf-8') as stream:
                for line in stream:
                    calls += 1
                    try:
                        data = json.loads(line)
                        value = usage(data.get('usage'), 'codex') if isinstance(data, dict) and data.get('usage_status') == 'recorded' else None
                    except ValueError:
                        value = None
                    if value is not None:
                        recorded += 1
                        usages.append(value)
        except (OSError, UnicodeError):
            calls += 1  # An unreadable file represents at least one unknown call.
    if not usages:
        return calls, recorded, None
    return calls, recorded, {key: sum(u[key] for u in usages if u[key] is not None) if any(u[key] is not None for u in usages) else None for key in usages[0]}


def run(path, sessions, ordinal, no_ids):
    reasons = set()
    row = {'ordinal': ordinal} if no_ids else {'ticket': path.parent.name, 'run_id': path.name}
    metadata = summary(path / 'summary.edn', reasons)
    expected_calls = metadata.pop('review_gate_expected_calls', 0)
    row.update(metadata)
    events_path = path / 'events.jsonl'
    events = read_events(events_path)
    if events is None:
        reasons.add('no_events' if not events_path.exists() else 'unreadable')
        events = []
    elif not events:
        reasons.add('no_events')
    types = {event.get('type') for event in events if isinstance(event.get('type'), str)}
    runtime = 'claude' if types & {'assistant', 'result', 'system'} else 'codex' if types & {'thread.started', 'turn.started', 'turn.completed', 'item.started', 'item.completed'} else 'unknown'
    row['runtime'] = runtime
    parent = None
    row['parent_model'] = None
    row['counts'] = None
    row['assistant_usage_observation'] = None
    row.update(subagent_usage=None, usage_completeness=None, lower_bound_tokens=None, claude_model_totals=None)
    if runtime == 'codex':
        row['counts'] = {name.replace('.', '_') + '_count': sum(e.get('type') == name for e in events) for name in ('item.started', 'item.completed')}
        candidates = [e for e in events if e.get('type') == 'turn.completed']
    elif runtime == 'claude':
        candidates = [e for e in events if e.get('type') == 'result']
        counts = dict.fromkeys(('tool_use_count', 'tool_result_error_count', 'subagent_message_count', 'assistant_message_count'), 0)
        observations = []
        last_result_index = max((i for i, e in enumerate(events) if e.get('type') == 'result'), default=-1)
        first_seen = {}
        snapshots = {}
        for index, event in enumerate(events):
            kind = event.get('type')
            message = event.get('message')
            if not isinstance(message, dict):
                continue
            if kind == 'assistant':
                counts['assistant_message_count'] += 1
                counts['subagent_message_count'] += event.get('parent_tool_use_id') is not None
                model = message.get('model')
                if isinstance(model, str) and event.get('parent_tool_use_id') is None:
                    row['parent_model'] = MODELS.get(model, 'other')
                observed = usage(message.get('usage'), 'claude')
                if observed is not None:
                    observations.append(observed)
                message_id = message.get('id')
                if isinstance(message_id, str):
                    first_seen.setdefault(message_id, index)
                    snapshots[message_id] = observed
            blocks = message.get('content')
            if isinstance(blocks, list):
                for block in blocks:
                    if isinstance(block, dict):
                        counts['tool_use_count'] += kind == 'assistant' and block.get('type') == 'tool_use'
                        counts['tool_result_error_count'] += kind == 'user' and block.get('type') == 'tool_result' and block.get('is_error') is True
        row['counts'] = counts
        row['assistant_usage_observation'] = {'messages_with_usage': len(observations), 'sum_total_tokens': sum(x['total_tokens'] for x in observations) if observations else None, 'stream_reemission_duplicates_possible': True}
    else:
        candidates = []
    if runtime == 'claude':
        parsed_parents = [usage(e.get('usage'), 'claude') for e in candidates]
        summed_parent = ({key: sum(value[key] for value in parsed_parents) for key in (*CLAUDE_KEYS, 'total_tokens')}
                         if parsed_parents and all(value is not None for value in parsed_parents) else None)
        cumulative = None
        valid_sequence = True
        previous = None
        for event in candidates:
            parsed = model_usage(event.get('modelUsage'))
            if parsed is None:
                valid_sequence = False
                continue
            totals, models = parsed
            if previous is not None and any(totals[key] < previous[key] for key in CLAUDE_KEYS):
                valid_sequence = False
                continue
            previous = totals
            cumulative = totals
            row['claude_model_totals'] = models
        trailing = [message_id for message_id, index in first_seen.items() if index > last_result_index]
        complete = bool(candidates) and not trailing and row['status'] not in (None, 'interrupted', 'running')
        row['usage_completeness'] = 'complete' if complete else 'lower_bound'
        if not complete:
            base = cumulative['total_tokens'] if cumulative is not None else summed_parent['total_tokens'] if summed_parent is not None else 0
            row['lower_bound_tokens'] = base + sum(snapshots[i]['total_tokens'] for i in trailing if snapshots[i] is not None)
            reasons.add('claude_usage_lower_bound_only')
        else:
            parent = summed_parent
            if parent is None:
                reasons.add('no_usage_event')
            if valid_sequence and cumulative is not None and parent is not None:
                difference = {key: cumulative[key] - parent[key] for key in CLAUDE_KEYS}
                if all(value >= 0 for value in difference.values()):
                    difference['total_tokens'] = sum(difference.values())
                    row['subagent_usage'] = difference
            if row['subagent_usage'] is None:
                reasons.add('claude_subagent_usage_unknown')
    elif len(candidates) > 1:
        reasons.add('multiple_usage_events')
    elif candidates:
        parent = usage(candidates[0].get('usage'), runtime)
        if parent is None:
            reasons.add('no_usage_event')
    else:
        reasons.add('no_usage_event')
    row['parent_usage'] = parent
    child_usage, row['child_model'] = child(path / 'delegation.json', sessions, reasons)
    row['child_absent'] = child_usage == 'absent'
    row['child_usage'] = None if row['child_absent'] else child_usage
    calls, recorded, review = review_usage(path)
    row.update(review_gate_expected_calls=expected_calls, review_gate_calls=calls, review_gate_recorded_calls=recorded, review_gate_usage=review)
    # Fewer usage lines than reviewed PRs means a producer-side write failed for at least one PR; a partial sum would
    # otherwise look complete when another PR's record exists. Unparseable/unrecorded lines are counted but not summed.
    if calls < expected_calls or calls > recorded:
        reasons.add('review_gate_usage_unrecorded')
    if parent is None or (runtime == 'claude' and row['subagent_usage'] is None):
        row['run_total_known'] = None
    elif row['child_absent']:
        row['run_total_known'] = parent['total_tokens']
    elif row['child_usage'] is not None:
        row['run_total_known'] = parent['total_tokens'] + row['child_usage']['total_tokens']
    else:
        row['run_total_known'] = None
    if row['run_total_known'] is None:
        row['run_output_tokens_known'] = None
    else:
        row['run_output_tokens_known'] = parent['output_tokens'] + (0 if row['child_absent'] else row['child_usage']['output_tokens'])
    if row['run_total_known'] is not None and row['subagent_usage'] is not None:
        row['run_total_known'] += row['subagent_usage']['total_tokens']
        row['run_output_tokens_known'] += row['subagent_usage']['output_tokens']
    if row['run_total_known'] is not None and review is not None:
        row['run_total_known'] += review['total_tokens']
        row['run_output_tokens_known'] += review['output_tokens']
    row['unknown_reasons'] = [reason for reason in REASONS if reason in reasons]
    return row


def report(root, sessions, limit=None, ticket=None, no_ids=False, include_rows=False):
    paths = []
    runs = root / 'runs'
    try:
        for ticket_path in sorted(runs.iterdir()):
            if not TICKET.fullmatch(ticket_path.name) or (ticket and ticket_path.name != ticket) or not ticket_path.is_dir():
                continue
            for path in sorted(ticket_path.iterdir()):
                if RUN.fullmatch(path.name) and path.is_dir():
                    paths.append(path)
    except OSError:
        pass
    if limit is not None:
        paths = paths[:limit]
    rows = [run(path, sessions, i, no_ids) for i, path in enumerate(paths, 1)]
    histogram = Counter(reason for row in rows for reason in row['unknown_reasons'])
    groups = []
    for agent, status in sorted({(r['agent'], r['status']) for r in rows}, key=lambda x: (x[0] or '', x[1] or '')):
        subset = [r for r in rows if (r['agent'], r['status']) == (agent, status)]
        known = sorted(r['run_total_known'] for r in subset if r['run_total_known'] is not None)
        mid = len(known) // 2
        median = (known[mid] if len(known) % 2 else (known[mid - 1] + known[mid]) / 2) if known else None
        parents = [r['parent_usage']['total_tokens'] for r in subset if r['parent_usage'] is not None]
        bounds = [r['lower_bound_tokens'] for r in subset if r['lower_bound_tokens'] is not None]
        groups.append({'runs_with_lower_bound_only': len(bounds), 'sum_lower_bound_tokens': sum(bounds) if bounds else None, 'agent': agent, 'status': status, 'count': len(subset), 'runs_with_total_known': len(known), 'runs_with_parent_known': len(parents), 'sum_known_parent_totals': sum(parents) if parents else None, 'sum_known_totals': sum(known) if known else None, 'sum_known_output_tokens': sum(r['run_output_tokens_known'] for r in subset if r['run_output_tokens_known'] is not None) if known else None, 'median_known_totals': median, 'p90_known_totals': known[math.ceil(len(known) * .9) - 1] if known else None})
    agents = []
    for agent in sorted({r['agent'] for r in rows}, key=lambda x: x or ''):
        subset = [r for r in rows if r['agent'] == agent]
        success = sum(r['status'] == 'succeeded' and r['result'] in ('review', 'done') for r in subset)
        agents.append({'agent': agent, 'success': success, 'non_success': len(subset) - success, 'success_rate': success / len(subset) if subset else None})
    bounds = [r['lower_bound_tokens'] for r in rows if r['lower_bound_tokens'] is not None]
    result = {'runs_with_lower_bound_only': len(bounds), 'sum_lower_bound_tokens': sum(bounds) if bounds else None, 'runs_scanned': len(rows), 'runs_by_runtime': {k: sum(r['runtime'] == k for r in rows) for k in ('codex', 'claude', 'unknown')}, 'runs_with_parent_usage_known': sum(r['parent_usage'] is not None for r in rows), 'runs_with_child_usage_known': sum(r['child_usage'] is not None for r in rows), 'runs_with_review_gate_usage_recorded': sum(r['review_gate_recorded_calls'] > 0 for r in rows), 'runs_with_run_total_known': sum(r['run_total_known'] is not None for r in rows), 'unknown_reasons': {k: histogram[k] for k in REASONS}, 'groups': groups, 'agents': agents}
    if include_rows:
        result['rows'] = rows
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default=os.environ.get('CODEX_TASK_BOARD_ROOT', '/home/boxp/.codex-task-board'))
    parser.add_argument('--codex-sessions', default=str(Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'sessions'))
    parser.add_argument('--limit', type=int)
    parser.add_argument('--ticket')
    parser.add_argument('--no-ids', action='store_true')
    parser.add_argument('--rows', action='store_true')
    args = parser.parse_args()
    if (args.limit is not None and args.limit < 1) or (args.ticket and not TICKET.fullmatch(args.ticket)):
        parser.error('invalid limit or ticket')
    print(json.dumps(report(Path(args.root), Path(args.codex_sessions), args.limit, args.ticket, args.no_ids, args.rows), indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
