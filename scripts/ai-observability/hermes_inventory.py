#!/usr/bin/env python3
"""Read-only Hermes session-counter coverage, never session IDs or content."""
import argparse
import json
from pathlib import Path
import re
import sqlite3

# Fixed patterns decide local vs cloud from billing_base_url; the URL itself never leaves the process.
LOCAL_URL = re.compile(r'localhost|127\.0\.0\.1|ollama|\.svc\b|\.local\b|:11434\b')
SUBSCRIPTION_MODE = re.compile(r'subscription|chatgpt|oauth|plan')
API_MODE = re.compile(r'\bapi\b|api[_-]?key|pay')
FAMILIES = ('gemma', 'qwen')

FIELDS = ('input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens',
          'reasoning_tokens', 'api_call_count', 'tool_call_count')


def inventory(connection):
    # One SQLite read transaction keeps all counts on a consistent snapshot.
    connection.execute('BEGIN')
    columns = {row[1]: row[4] for row in connection.execute('PRAGMA table_info(sessions)')}
    if not columns:
        return {'state': 'unsupported_schema'}
    result = {'state': 'ok', 'sessions': connection.execute('SELECT count(*) FROM sessions').fetchone()[0],
              'with_parent': None, 'fields': {}}
    if 'parent_session_id' in columns:
        result['with_parent'] = connection.execute('SELECT count(*) FROM sessions WHERE parent_session_id IS NOT NULL').fetchone()[0]
    for field in FIELDS:
        if field not in columns:
            result['fields'][field] = None
            continue
        row = connection.execute('SELECT count(' + field + '), '
                                 'sum(CASE WHEN typeof(' + field + ") IN ('integer','real') AND " +
                                 field + '>0 THEN 1 ELSE 0 END) FROM sessions').fetchone()
        result['fields'][field] = {'nonnull': row[0], 'positive': row[1] or 0,
                                   'defaults_to_zero': columns[field] == '0'}
    # No unrestricted model/provider/billing strings leave the process.
    result['model_family_counts'] = {
        family: connection.execute('SELECT count(*) FROM sessions WHERE lower(model) LIKE ?',
                                   ('%' + family + '%',)).fetchone()[0]
        for family in ('gemma', 'qwen')} if 'model' in columns else None
    result['billing_modes'] = {
        mode: connection.execute('SELECT count(*) FROM sessions WHERE billing_mode=?', (mode,)).fetchone()[0]
        for mode in ('subscription', 'api', 'local')} if 'billing_mode' in columns else None
    result['billing_mode_classes'] = classify_modes(connection) if 'billing_mode' in columns else None
    result['placement_by_family'] = classify_placement(connection) if {'billing_base_url', 'model'} <= set(columns) else None
    return result


def classify_modes(connection):
    counts = {'subscription_like': 0, 'api_like': 0, 'other': 0, 'null_or_empty': 0}
    for (mode,) in connection.execute('SELECT billing_mode FROM sessions'):
        if mode is None or mode == '':
            counts['null_or_empty'] += 1
        elif SUBSCRIPTION_MODE.search(str(mode).lower()):
            counts['subscription_like'] += 1
        elif API_MODE.search(str(mode).lower()):
            counts['api_like'] += 1
        else:
            counts['other'] += 1
    return counts


def classify_placement(connection):
    """Count sessions by (local/cloud/unknown placement, model family). No strings are returned."""
    counts = {}
    for placement in ('local', 'cloud', 'unknown'):
        for family in FAMILIES + ('other',):
            counts[placement + '/' + family] = 0
    for url, model in connection.execute('SELECT billing_base_url, model FROM sessions'):
        url = str(url or '').lower()
        placement = 'unknown' if not url else 'local' if LOCAL_URL.search(url) else 'cloud'
        model = str(model or '').lower()
        family = next((f for f in FAMILIES if f in model), 'other')
        counts[placement + '/' + family] += 1
    return counts


def cron_usage(path):
    """Per-job token sums from the cron usage audit; jobs are numbered by first appearance, never by id."""
    ordinals, jobs = {}, {}
    try:
        with open(path, encoding='utf-8') as stream:
            for line in stream:
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(event, dict):
                    continue
                job = ordinals.setdefault(str(event.get('job_id')), len(ordinals) + 1)
                entry = jobs.setdefault(job, {'fires': 0, 'errors': 0, 'prompt_tokens': 0, 'completion_tokens': 0,
                                              'total_tokens': 0, 'fires_with_usage': 0, 'duration_ms': 0})
                entry['fires'] += 1
                entry['errors'] += bool(event.get('error'))
                values = {k: event.get(k) for k in ('prompt_tokens', 'completion_tokens', 'total_tokens', 'duration_ms')}
                if all(type(v) is int and 0 <= v <= 10**12 for v in values.values()):
                    entry['fires_with_usage'] += 1
                    for k, v in values.items():
                        entry[k] += v
    except OSError:
        return {'state': 'unavailable'}
    return {'state': 'ok', 'jobs': {str(k): v for k, v in sorted(jobs.items())}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', required=True)
    parser.add_argument('--cron-usage')
    args = parser.parse_args()
    try:
        with sqlite3.connect(Path(args.db).resolve().as_uri() + '?mode=ro', uri=True) as connection:
            result = inventory(connection)
    except (OSError, sqlite3.Error, ValueError):
        result = {'state': 'unavailable'}
    if args.cron_usage:
        result['cron_usage'] = cron_usage(args.cron_usage)
    print(json.dumps(result, sort_keys=True))
    return 0 if result['state'] == 'ok' else 1


if __name__ == '__main__':
    raise SystemExit(main())
