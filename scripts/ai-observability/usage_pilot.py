#!/usr/bin/env python3
"""Bounded local metadata-only experiment; no network or raw event output."""
import argparse
import glob
import json
import os
from collections import Counter

FIELDS = ('input_tokens', 'output_tokens', 'total_tokens', 'cache_read_tokens',
          'cache_write_tokens', 'reasoning_tokens')
KEYS = set(FIELDS) | {'ordinal', 'scope', 'kind'}


def aggregate_calls(records):
    """Only explicitly identified, non-overlapping leaf calls may be summed.

    Ordinals are local ephemeral integers, never returned or persisted. Cumulative
    and parent observations are excluded, not converted into calls.
    """
    seen = {}
    result = {'calls': 0, 'duplicates': 0, 'excluded_parent': 0,
              'excluded_cumulative': 0, 'fields': {}}
    sums = Counter()
    present = Counter()
    for record in records:
        if not isinstance(record, dict) or set(record) - KEYS:
            raise ValueError('unsupported metadata')
        if set(('ordinal', 'scope', 'kind')) - set(record):
            raise ValueError('missing identity or semantics')
        ordinal = record['ordinal']
        if type(ordinal) is not int or not 0 <= ordinal < 1000000:
            raise ValueError('invalid local ordinal')
        if record['scope'] not in ('leaf', 'parent') or record['kind'] not in ('call', 'cumulative'):
            raise ValueError('invalid semantics')
        for key in FIELDS:
            value = record.get(key)
            if value is not None and (type(value) is not int or value < 0 or value > 10**12):
                raise ValueError('invalid usage')
        if ordinal in seen:
            if seen[ordinal] != record:
                raise ValueError('conflicting identity')
            result['duplicates'] += 1
            continue
        seen[ordinal] = record.copy()
        if record['scope'] == 'parent':
            result['excluded_parent'] += 1
            continue
        if record['kind'] == 'cumulative':
            result['excluded_cumulative'] += 1
            continue
        result['calls'] += 1
        for key in FIELDS:
            if record.get(key) is not None:
                present[key] += 1
                sums[key] += record[key]
    for key in FIELDS:
        result['fields'][key] = {'observed_sum': sums[key] if present[key] else None,
                                  'observed_calls': present[key],
                                  'missing_calls': result['calls'] - present[key]}
    return result


def codex_inventory(root, limit):
    files = glob.glob(os.path.join(root, '**', '*.jsonl'), recursive=True)
    files.sort(key=lambda p: (os.path.getmtime(p), p), reverse=True)
    stats = Counter(files_selected=min(limit, len(files)))
    keys = ('input_tokens', 'cached_input_tokens', 'output_tokens',
            'reasoning_output_tokens', 'total_tokens')
    for path in files[:limit]:
        previous = None
        try:
            with open(path, encoding='utf-8') as stream:
                for line in stream:
                    try:
                        event = json.loads(line)
                    except (ValueError, UnicodeError):
                        stats['invalid_lines'] += 1
                        continue
                    if not isinstance(event, dict) or event.get('type') != 'event_msg':
                        continue
                    payload = event.get('payload')
                    if not isinstance(payload, dict) or payload.get('type') != 'token_count':
                        continue
                    stats['token_count_events'] += 1
                    info = payload.get('info')
                    if not isinstance(info, dict):
                        stats['missing_info'] += 1
                        continue
                    for group in ('total_token_usage', 'last_token_usage'):
                        usage = info.get(group)
                        if not isinstance(usage, dict):
                            stats[group + '_missing'] += 1
                            continue
                        stats[group + '_present'] += 1
                        for key in keys:
                            value = usage.get(key)
                            if type(value) is int and 0 <= value <= 10**12:
                                stats[group + '_' + key + '_present'] += 1
                                if group == 'last_token_usage':
                                    label = 'last_' + key + '_max'
                                    stats[label] = max(stats[label], value)
                    total = info.get('total_token_usage')
                    if isinstance(total, dict):
                        signature = tuple(total.get(k) if type(total.get(k)) is int else None for k in keys)
                        if signature == previous:
                            stats['repeated_cumulative_snapshots'] += 1
                        previous = signature
        except (OSError, UnicodeError):
            stats['unreadable_files'] += 1
    return dict(sorted(stats.items()))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--codex-sessions', required=True)
    parser.add_argument('--limit', type=int, default=30, choices=range(1, 101))
    args = parser.parse_args()
    print(json.dumps(codex_inventory(args.codex_sessions, args.limit), sort_keys=True, indent=2))


if __name__ == '__main__':
    main()
