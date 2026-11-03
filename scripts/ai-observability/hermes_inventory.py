#!/usr/bin/env python3
"""Read-only Hermes session-counter coverage, never session IDs or content."""
import argparse
import json
from pathlib import Path
import sqlite3

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
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', required=True)
    args = parser.parse_args()
    try:
        with sqlite3.connect(Path(args.db).resolve().as_uri() + '?mode=ro', uri=True) as connection:
            result = inventory(connection)
    except (OSError, sqlite3.Error, ValueError):
        result = {'state': 'unavailable'}
    print(json.dumps(result, sort_keys=True))
    return 0 if result['state'] == 'ok' else 1


if __name__ == '__main__':
    raise SystemExit(main())
