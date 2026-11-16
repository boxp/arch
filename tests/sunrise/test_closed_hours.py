import copy
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import contextlib
import io

from test_watch import w, cfg, html


def at(value):
    return dt.datetime.fromisoformat(value)


def future_cfg():
    c = cfg()
    c['legs']['往路']['stop'] = '2030-01-04T21:00:00+09:00'
    c['legs']['second'] = dict(c['legs']['往路'])
    return c


class ClosedHoursTest(unittest.TestCase):
    def test_boundaries_timezone_and_late_evening(self):
        for time, expected in [('01:49', 2), ('01:50', 0), ('05:29', 0),
                               ('05:30', 2), ('23:30', 2), ('23:59', 2)]:
            now = at('2030-01-02T' + time + ':00+09:00')
            for instant in (now, now.astimezone(dt.timezone.utc)):
                calls, state = [], {'last_good': {'x': 'old'}}
                before = copy.deepcopy(state)
                messages, _ = w.run(future_cfg(), state, instant,
                                    lambda url: calls.append(url) or html())
                self.assertEqual(len(calls), expected, time)
                self.assertEqual(messages, [])
                if not expected:
                    self.assertEqual(state, before)

    def test_crossing_boundary_discards_partial_tick(self):
        times = iter([at('2030-01-02T01:49:59+09:00'), at('2030-01-02T01:50:00+09:00')])
        state = {'rooms': {'往路:4110040': 'full'}, 'observations': ['old'],
                 'errors': {'old': {'count': 2}}, 'notifications': ['old']}
        before = copy.deepcopy(state)
        calls = []
        result = w.run(future_cfg(), state, at('2030-01-02T01:49:00+09:00'),
                       lambda url: calls.append(url) or html('空席あり'), lambda: next(times))
        self.assertEqual(result, ([], False))
        self.assertEqual(len(calls), 1)
        self.assertEqual(state, before)

    def test_official_close_persists_restart_and_resume(self):
        state = {'schema_version': 1, 'rooms': {'往路:4110040': 'full'},
                 'observations': ['old'], 'errors': {'往路:0': {'count': 2, 'last_alert': None}},
                 'notifications': ['old'], 'last_good': {'x': 'old'}, 'last_alert': {'x': 'old'}}
        before = copy.deepcopy(state)
        responses = iter([html('空席あり'), '【20100941】ただいま受付時間外です。'])
        now = at('2030-01-02T23:10:00+09:00')
        calls = []
        self.assertEqual(w.run(future_cfg(), state, now,
                               lambda url: calls.append(url) or next(responses)), ([], False))
        self.assertEqual(len(calls), 2)
        self.assertEqual(state.pop('closed_until'), '2030-01-03T05:30:00+09:00')
        self.assertEqual(state, before)
        state['closed_until'] = '2030-01-03T05:30:00+09:00'
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'state'
            w.atomic(p, state)
            state = json.loads(p.read_text())
        saved = copy.deepcopy(state)
        for t in ['2030-01-02T23:59:00+09:00', '2030-01-03T05:29:00+09:00']:
            self.assertEqual(w.run(future_cfg(), state, at(t), lambda _: self.fail('getter')), ([], False))
            self.assertEqual(state, saved)
        resumed = at('2030-01-03T05:30:00+09:00')
        messages, _ = w.run(future_cfg(), state, resumed, lambda _: html('空席あり'))
        self.assertEqual(len(messages), 1)
        self.assertNotIn('closed_until', state)
        self.assertEqual(w.run(future_cfg(), state, resumed, lambda _: html('空席あり'))[0], [])
        w.run(future_cfg(), state, resumed, lambda _: html('unknown'))
        self.assertEqual(w.run(future_cfg(), state, resumed, lambda _: html('空席あり'))[0], [])
        w.run(future_cfg(), state, resumed, lambda _: html())
        self.assertEqual(len(w.run(future_cfg(), state, resumed, lambda _: html('空席あり'))[0]), 2)

    def test_failures_are_not_closure(self):
        for response, code in [('20100946', 'congestion'), ('<html></html>', 'conditions_missing')]:
            state = {}
            w.run(future_cfg(), state, at('2030-01-02T23:30:00+09:00'), lambda _: response)
            self.assertNotIn('closed_until', state)
            self.assertEqual(state['errors']['往路:0']['reason_code'], code)
            self.assertEqual(state['errors']['往路:0']['count'], 1)

    def test_final_request_crosses_closing_boundary(self):
        for response in (html('空席あり'), '<html></html>'):
            times = iter([at('2030-01-02T01:49:59+09:00'),
                          at('2030-01-02T01:50:00+09:00')])
            state = {'rooms': {'往路:4110040': 'full'},
                     'errors': {'往路:0': {'count': 2, 'last_alert': None}},
                     'observations': ['old'], 'notifications': ['old']}
            before = copy.deepcopy(state)
            self.assertEqual(w.run(cfg(), state, at('2030-01-02T01:49:59+09:00'),
                                   lambda _: response, lambda: next(times)), ([], False))
            self.assertEqual(state, before)

    def test_first_official_closure_stops_remaining_seven_queries(self):
        c = future_cfg()
        for leg in c['legs'].values():
            leg['queries'] = leg['queries'] * 4
        calls, state = [], {}
        self.assertEqual(w.run(c, state, at('2030-01-02T00:10:00+09:00'),
                               lambda url: calls.append(url) or '20100941'), ([], False))
        self.assertEqual(len(calls), 1)
        self.assertEqual(state, {'closed_until': '2030-01-02T05:30:00+09:00'})

    def test_timeout_remains_failure_after_pause_expires(self):
        state = {'closed_until': '2030-01-02T05:30:00+09:00',
                 'rooms': {'往路:4110040': 'full'},
                 'errors': {'往路:0': {'count': 2, 'last_alert': None}}}
        def timeout(_):
            raise TimeoutError()
        messages, _ = w.run(cfg(), state, at('2030-01-02T05:30:00+09:00'), timeout)
        self.assertEqual(len(messages), 1)
        self.assertNotIn('closed_until', state)
        self.assertEqual(state['errors']['往路:0']['count'], 3)
        self.assertEqual(state['errors']['往路:0']['reason_code'], 'timeout')
        self.assertEqual(state['rooms']['往路:4110040'], 'full')

    def test_main_persists_official_pause_and_is_silent(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p / 'config').write_text(json.dumps(cfg()))
            # Use valid configuration and a controlled clock inside main.
            class Clock(dt.datetime):
                current = at('2030-01-01T23:30:00+09:00')
                @classmethod
                def now(cls, tz=None):
                    return cls.current.astimezone(tz)
            with patch.object(w.sys, 'argv', ['watch.py', str(p / 'config'), str(p / 'state')]), \
                 patch.object(w.signal, 'alarm'), patch.object(w.dt, 'datetime', Clock):
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    w.main(lambda _: '20100941')
                    w.main(lambda _: self.fail('getter'))
                self.assertEqual(out.getvalue(), '')
                self.assertEqual(json.loads((p / 'state').read_text())['closed_until'],
                                 '2030-01-02T05:30:00+09:00')
                calls = []
                Clock.current = at('2030-01-02T05:30:00+09:00')
                with contextlib.redirect_stdout(out):
                    w.main(lambda url: calls.append(url) or html())
                self.assertEqual(len(calls), 1)
                self.assertEqual(out.getvalue(), '')
                self.assertNotIn('closed_until', json.loads((p / 'state').read_text()))
