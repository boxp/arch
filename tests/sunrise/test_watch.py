import datetime as dt
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "watch",
    Path(__file__).resolve().parents[2] / "docker/hermes-agent/sunrise/watch.py",
)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
from urllib.parse import urlencode

URL = (
    "https://e5489.jr-odekake.net/e5489/cspc/CBDayTimeArriveSelRsvMyDiaPC?"
    + urlencode(
        {
            "inputDate": "20300102",
            "inputDepartStName": "A",
            "inputArriveStName": "B",
            "inputType": "0",
            "inputHour": "21",
            "inputMinute": "00",
            "inputUniqueDepartSt": "1",
            "inputUniqueArriveSt": "1",
            "inputSearchType": "2",
            "inputTransferDepartStName1": "A",
            "inputTransferArriveStName1": "B",
            "inputTransferDepartStUnique1": "1",
            "inputTransferArriveStUnique1": "1",
            "inputTransferTrainType1": "0001",
            "inputSpecificTrainType1": "2",
            "inputSpecificBriefTrainKana1": "ｻｲｽﾓｿ000",
            "SequenceType": "0",
        },
        encoding="shift_jis",
    )
)
LEG = {
    "date": "2030-01-02",
    "from": "A",
    "to": "B",
    "departure": "21:00",
    "stop": "2030-01-02T21:00:00+09:00",
    "enabled": True,
}
QUERY = {"url": URL, "train": "特急サンライズ出雲（ソロ）", "rooms": ["4110040"]}
NOW = dt.datetime.fromisoformat("2030-01-02T10:00:00+09:00")


def html(
    alt="残席なし",
    room="4110040",
    date="1月2日",
    start="A",
    end="B",
    train="特急サンライズ出雲（ソロ）",
):
    return f'''<img alt="空席あり"><table class="condition-table--4cols-4"><tr><td>{date}</td><td><span class="route-station__station1">{start}</span><span class="route-station__station2">{end}</span></td></tr></table><div class="route-train-list"><p class="route-train-list__time">21:00 発</p><h4 class="route-train-list__heading">{start}</h4><div class="route-train-list__train-name">{train}</div><table class="seat-facility"><th data-search-id="{room}"><img alt="B寝台"><img alt="禁煙個室"></th><td data-search-id="{room}"><img alt="{alt}"></td></table><p class="route-train-list__time">07:00 着</p><h4 class="route-train-list__heading">{end}</h4></div>'''


def twin_query():
    from urllib.parse import parse_qs, urlsplit, urlunsplit
    u = urlsplit(URL)
    params = {k: v[0] for k, v in parse_qs(u.query, encoding="shift_jis").items()}
    params["inputSpecificBriefTrainKana1"] = w.TWIN_KANA
    return {"url": urlunsplit((u.scheme, u.netloc, u.path, urlencode(params, encoding="shift_jis"), "")),
            "train": w.TWIN_CONFIG_NAME, "rooms": list(w.TWIN_ROOMS)}


def twin_html(alt="残席なし", start="A", end="B"):
    h = html(alt, "4110062", start=start, end=end, train=w.TWIN_OFFICIAL_NAME)
    return h.replace('</table><p', '<th data-search-id="4120062"><img alt="B寝台"><img alt="喫煙個室"></th><td data-search-id="4120062"><img alt="' + alt + '"></td></table><p')


def cfg():
    return {"legs": {"往路": dict(LEG, queries=[QUERY])}}


class WatchTest(unittest.TestCase):
    def test_synthesized_official_dom(self):
        fixture = (Path(__file__).parent / "fixtures/twin-official-synthetic.html").read_text()
        q = twin_query()
        for reverse in (False, True):
            leg = dict(LEG)
            h = fixture
            if reverse:
                leg.update({"from": "B", "to": "A"})
                h = h.replace(">A<", ">TEMP<").replace(">B<", ">A<").replace(">TEMP<", ">B<")
            for alt, expected in [("残席なし", "full"), ("空席あり", "available"), ("空席残りわずか", "available")]:
                self.assertEqual(w.parse(h.replace("残席なし", alt), leg, q),
                                 {r: expected for r in w.TWIN_ROOMS})
            for invalid in [h.replace("1月2日", "1月3日"),
                            h.replace(w.TWIN_OFFICIAL_NAME, "特急サンライズ出雲（シングル）"),
                            h.replace("21:00 発", "20:00 発")]:
                with self.assertRaises(w.ParseFailure):
                    w.parse(invalid, leg, q)
        self.assertEqual(w.parse(fixture.replace(w.TWIN_OFFICIAL_NAME, w.TWIN_CONFIG_NAME), LEG, q),
                         {r: "full" for r in w.TWIN_ROOMS})

    def test_parser_and_unknown(self):
        self.assertEqual(w.parse(html(), LEG, QUERY), {"4110040": "full"})
        self.assertEqual(
            w.parse(html("空席あり"), LEG, QUERY), {"4110040": "available"}
        )
        self.assertEqual(w.parse(html("空席状況のご案内ができません"), LEG, QUERY), {})
        self.assertEqual(w.parse(html(room="3010000", alt="空席あり"), LEG, QUERY), {})
        for h in [
            html(date="1月3日"),
            html(date="11月2日"),
            html(start="C"),
            html(train="違う列車"),
            "<html>error</html>",
        ]:
            with self.assertRaises(ValueError):
                w.parse(h, LEG, QUERY)

    def test_transitions_restart_and_partial(self):
        state = {}
        c = cfg()
        self.assertEqual(w.run(c, state, NOW, lambda _: html())[0], [])
        self.assertEqual(len(w.run(c, state, NOW, lambda _: html("空席あり"))[0]), 1)
        self.assertEqual(w.run(c, state, NOW, lambda _: html("空席あり"))[0], [])
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "state"
            w.atomic(p, state)
            import json

            state = json.loads(p.read_text())
        self.assertEqual(w.run(c, state, NOW, lambda _: html("空席あり"))[0], [])
        w.run(c, state, NOW, lambda _: html("案内不可"))
        self.assertEqual(w.run(c, state, NOW, lambda _: html("空席あり"))[0], [])
        w.run(c, state, NOW, lambda _: html())
        self.assertEqual(
            len(w.run(c, state, NOW, lambda _: html("空席残りわずか"))[0]), 1
        )

    def test_failures_and_stop(self):
        state = {}
        c = cfg()
        fail = lambda _: "<html>error</html>"
        self.assertFalse(w.run(c, state, NOW, fail)[0])
        self.assertFalse(w.run(c, state, NOW, fail)[0])
        self.assertEqual(len(w.run(c, state, NOW, fail)[0]), 1)
        self.assertFalse(w.run(c, state, NOW + dt.timedelta(hours=1), fail)[0])
        self.assertEqual(len(w.run(c, state, NOW + dt.timedelta(hours=6), fail)[0]), 1)
        self.assertEqual(
            w.run(c, state, NOW + dt.timedelta(hours=12), fail), ([], False)
        )

    def test_url_fail_closed(self):
        w.validate(cfg())
        for u in [
            URL.replace("https:", "http:"),
            URL.replace("e5489.jr-odekake.net", "evil.invalid"),
            URL.replace("20300102", "20300103"),
            URL.replace("ArriveStName=B", "ArriveStName=C"),
        ]:
            c = cfg()
            c["legs"]["往路"]["queries"] = [dict(QUERY, url=u)]
            with self.assertRaises(ValueError):
                w.validate(c)

    def test_partial_and_disabled(self):
        c = cfg()
        c["legs"]["second"] = dict(LEG, queries=[QUERY])
        state = {}
        calls = iter([html(), "<html>error</html>"])
        messages, active = w.run(c, state, NOW, lambda _: next(calls))
        self.assertTrue(active)
        self.assertEqual(messages, [])
        self.assertEqual(state["rooms"]["往路:4110040"], "full")
        self.assertNotIn("second:4110040", state["rooms"])
        c["legs"]["往路"]["enabled"] = False
        calls = []
        w.run(c, state, NOW, lambda url: calls.append(url) or html())
        self.assertEqual(len(calls), 1)

    def test_silent_and_lock(self):
        import fcntl, json, subprocess, sys

        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            c = cfg()
            c["legs"]["往路"]["enabled"] = False
            (p / "config").write_text(json.dumps(c))
            cmd = [
                sys.executable,
                str(Path(w.__file__)),
                str(p / "config"),
                str(p / "state"),
            ]
            result = subprocess.run(cmd, capture_output=True, check=True)
            self.assertEqual(result.stdout, b"")
            with open(str(p / "state") + ".lock", "a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                result = subprocess.run(cmd, capture_output=True, check=True)
                self.assertEqual(result.stdout, b"")

    def test_twin(self):
        q = dict(twin_query(), rooms=["4110062", "4120062"])
        c = cfg()
        c["legs"]["往路"]["queries"] = [q]
        state = {"rooms": {"往路:4110062": "full"}}
        msg = w.run(c, state, NOW, lambda _: html("空席あり", room="4110062", train=w.TWIN_OFFICIAL_NAME))[0][0]
        self.assertIn("2名分", msg)

    def test_twin_alias_both_directions_and_fail_closed(self):
        q = twin_query()
        w.validate({"legs": {"往路": dict(LEG, queries=[q])}})
        for start, end in [("A", "B"), ("B", "A")]:
            leg = dict(LEG, **{"from": start, "to": end})
            for alt, expected in [("空席あり", "available"), ("空席残りわずか", "available"), ("残席なし", "full")]:
                h = twin_html(alt, start, end)
                self.assertEqual(w.parse(h, leg, q), {r: expected for r in w.TWIN_ROOMS})
            for h in [twin_html(start=start, end=end).replace("1月2日", "1月3日"),
                      twin_html(start=end, end=start),
                      twin_html(start=start, end=end).replace(w.TWIN_OFFICIAL_NAME, "特急サンライズ瀬戸（サツイン）"),
                      twin_html(start=start, end=end).replace("21:00 発", "20:00 発")]:
                with self.assertRaises(w.ParseFailure):
                    w.parse(h, leg, q)
            bad = dict(q, url=q["url"].replace(urlencode({"x": w.TWIN_KANA}, encoding="shift_jis").split("=")[1], "wrong"))
            with self.assertRaises(w.ParseFailure):
                w.parse(twin_html(start=start, end=end), leg, bad)
            bad_type = dict(q, url=q["url"].replace("inputSpecificTrainType1=2", "inputSpecificTrainType1=3"))
            with self.assertRaises(w.ParseFailure):
                w.parse(twin_html(start=start, end=end), leg, bad_type)
            for bad in [dict(q, rooms=["4110062"]), dict(q, rooms=["4110040", "4120062"])]:
                with self.assertRaises(w.ParseFailure):
                    w.parse(twin_html(start=start, end=end), leg, bad)
        self.assertEqual(w.parse(twin_html().replace("喫煙個室", "禁煙席"), LEG, q), {"4110062": "full"})
        self.assertEqual(w.parse(twin_html().replace("4110062", "3010000").replace("4120062", "3010000"), LEG, q), {})
        with self.assertRaises(w.ParseFailure):
            w.parse(twin_html() + twin_html(), LEG, q)

    def test_safe_failure_codes_and_retention(self):
        import urllib.error
        cases = [(lambda: "混雑 20100946 secret", "congestion"),
                 (lambda: "<html>secret</html>", "conditions_missing"),
                 (lambda: html(train="wrong"), "route_mismatch"),
                 (lambda: html("unknown"), "equipment_unknown")]
        def raises(exc):
            def fail():
                raise exc
            return fail
        cases += [(raises(TimeoutError("secret")), "timeout"),
                  (raises(urllib.error.URLError(TimeoutError("secret"))), "timeout"),
                  (raises(urllib.error.HTTPError("https://secret", 500, "secret", {}, None)), "http"),
                  (raises(RuntimeError("secret")), "other")]
        for getter, code in cases:
            state = {"rooms": {"往路:4110040": "full"}}
            for i in range(3):
                messages, _ = w.run(cfg(), state, NOW, lambda _: getter())
            self.assertEqual(state["rooms"]["往路:4110040"], "full")
            self.assertEqual(state["observations"][0]["reason_code"], code)
            self.assertEqual(state["errors"]["往路:0"]["reason_code"], code)
            self.assertNotIn("secret", str(state))
            if code == "congestion":
                self.assertEqual(messages, [])
                self.assertFalse(w.run(cfg(), state, NOW + dt.timedelta(hours=6), lambda _: getter())[0])
                continue
            self.assertEqual(len(messages), 1)
            self.assertNotIn("https://", messages[0])
            self.assertFalse(w.run(cfg(), state, NOW + dt.timedelta(hours=1), lambda _: getter())[0])
            self.assertEqual(len(w.run(cfg(), state, NOW + dt.timedelta(hours=6), lambda _: getter())[0]), 1)

    def test_partial_twin_retains_unknown_room(self):
        q = twin_query()
        c = {"legs": {"往路": dict(LEG, queries=[q])}}
        state = {"rooms": {"往路:4110062": "full", "往路:4120062": "available"}}
        w.run(c, state, NOW, lambda _: twin_html().replace("喫煙個室", "不明"))
        self.assertEqual(state["rooms"]["往路:4120062"], "available")
        self.assertEqual(state["observations"][0]["cells"]["4120062"], "unknown")
        self.assertEqual(state["observations"][0]["reason_code"], "equipment_unknown")

    def test_congestion_restart_transition_and_mixed_tick(self):
        import json
        import os
        import subprocess
        import sys

        # Each tick is a new process running main(), with only local fixture input.
        script = '''
import datetime, importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location("fixture", sys.argv[1])
t = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t)
class Clock(datetime.datetime):
    @classmethod
    def now(cls, tz=None):
        return cls.fromisoformat(os.environ["FIXTURE_NOW"]).astimezone(tz)
t.w.dt.datetime = Clock
responses = iter(json.loads(os.environ["FIXTURE_RESPONSES"]))
sys.argv = ["watch.py", sys.argv[2], sys.argv[3]]
t.w.main(getter=lambda _: next(responses))
'''
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            config = cfg()
            config["legs"]["second"] = dict(LEG, queries=[QUERY])
            start = NOW - dt.timedelta(hours=4)
            (p / "config").write_text(json.dumps(config))
            initial = {"schema_version": 1, "rooms": {"往路:4110040": "full", "second:4110040": "full"},
                       "last_good": {"legacy": "preserved"}, "notifications": []}
            (p / "state").write_text(json.dumps(initial))

            def tick(hours, first, second):
                env = dict(os.environ, FIXTURE_NOW=(start + dt.timedelta(hours=hours)).isoformat(),
                           FIXTURE_RESPONSES=json.dumps([first, second]))
                result = subprocess.run([sys.executable, "-c", script, __file__, str(p / "config"), str(p / "state")],
                                        env=env, capture_output=True, text=True, check=True)
                self.assertEqual(result.stderr, "")
                return result.stdout, json.loads((p / "state").read_text())

            for count, hours in enumerate((0, 1, 2, 6.5, 7), 1):
                output, state = tick(hours, "混雑 20100946", html("空席あり") if hours == 7 else html())
                if hours == 7:
                    self.assertIn("【空席】", output)
                    self.assertNotIn("【監視障害】", output)
                else:
                    self.assertEqual(output, "")
                self.assertEqual(state["errors"]["往路:0"]["count"], count)
                self.assertEqual(state["errors"]["往路:0"]["reason_code"], "congestion")
                self.assertIsNone(state["errors"]["往路:0"]["last_alert"])
                self.assertEqual(state["observations"][0]["cells"]["4110040"], "unknown")
                self.assertEqual(dt.datetime.fromisoformat(state["observations"][0]["observed_at"]), start + dt.timedelta(hours=hours))
                self.assertEqual(state["rooms"]["往路:4110040"], "full")
                self.assertEqual(state["last_good"], initial["last_good"])
            output, state = tick(7.1, "<html>broken</html>", html())
            self.assertIn("【監視障害】", output)
            self.assertIn("検索条件を確認できません", output)
            self.assertEqual(state["errors"]["往路:0"]["count"], 6)
            output, state = tick(7.2, "混雑 20100946", html())
            self.assertEqual(output, "")
            output, state = tick(7.3, "<html>broken</html>", html())
            self.assertEqual(output, "")  # Existing six-hour alert suppression remains in force.
            self.assertEqual(state["errors"]["往路:0"]["reason_code"], "conditions_missing")
            previous_alert = state["errors"]["往路:0"]["last_alert"]
            history = state["notifications"]
            output, state = tick(14, "混雑 20100946", html())
            self.assertEqual(output, "")
            self.assertEqual(state["errors"]["往路:0"]["last_alert"], previous_alert)
            self.assertEqual(state["notifications"], history)
            output, state = tick(14.1, html(), html())
            self.assertEqual(output, "")  # Congestion recovery is silent too.
            self.assertEqual(state["errors"]["往路:0"]["count"], 0)
            self.assertEqual(state["notifications"], history)

    def test_equipment_header_and_duplicate_cells(self):
        for h in [
            html("空席あり").replace("禁煙個室", "禁煙席"),
            html("空席あり").replace("B寝台", "A寝台"),
            html("空席あり").replace(
                "</table><p",
                '<td data-search-id="4110040"><img alt="空席あり"></td></table><p',
            ),
        ]:
            self.assertEqual(w.parse(h, LEG, QUERY), {})

    def test_failure_streak_is_per_query(self):
        c = cfg()
        c["legs"]["second"] = dict(LEG, queries=[QUERY])
        state = {}
        for step in range(4):
            results = iter(
                [html(), "<html>error</html>"]
                if step % 2
                else ["<html>error</html>", html()]
            )
            self.assertFalse(w.run(c, state, NOW, lambda _: next(results))[0])
        self.assertLessEqual(max(x["count"] for x in state["errors"].values()), 1)

    def test_legacy_migration_and_delivery_journal(self):
        legacy = {
            "last_good": {"往路:4110040": "空席あり"},
            "last_alert": {"往路:4110040": "old-notification"},
            "queries": [QUERY],
            "failures": {
                "0": {
                    "consecutive": 3,
                    "last_notified_at": NOW.isoformat(),
                    "reason": "混雑",
                }
            },
            "last_run": {"status": "unknown"},
        }
        state = w.migrate(legacy, cfg())
        self.assertEqual(state["last_alert"], legacy["last_alert"])
        self.assertEqual(state["last_run"], legacy["last_run"])
        self.assertEqual(state["errors"]["往路:0"]["count"], 3)
        self.assertEqual(w.run(cfg(), state, NOW, lambda _: html("空席あり"))[0], [])
        self.assertEqual(w.run(cfg(), state, NOW, lambda _: "error")[0], [])
        w.run(cfg(), state, NOW, lambda _: html())
        messages = w.run(cfg(), state, NOW, lambda _: html("空席あり"))[0]
        self.assertEqual(len(messages), 1)
        self.assertEqual(state["notifications"][-1]["delivery"], "unconfirmed")
        self.assertEqual(state["notifications"][-1]["text"], messages[0])
        self.assertEqual(legacy["last_good"]["往路:4110040"], "空席あり")

    def test_unknown_observation_and_deadline_preserve_last_good(self):
        state = {"rooms": {"往路:4110040": "full"}}

        def deadline(_):
            raise w.DeadlineExceeded()

        messages, _ = w.run(cfg(), state, NOW, deadline)
        self.assertEqual(messages, [])
        self.assertEqual(state["rooms"]["往路:4110040"], "full")
        self.assertEqual(state["observations"][0]["cells"]["4110040"], "unknown")

    def test_read_only_http_and_redirect_refusal(self):
        from unittest.mock import MagicMock, patch

        response = MagicMock()
        response.__enter__.return_value.read.return_value = b"<html></html>"
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(w.urllib.request, "build_opener", return_value=opener):
            self.assertEqual(w.fetch(URL), "<html></html>")
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 15)
        with self.assertRaises(ValueError):
            w.NoRedirect().redirect_request(None, None, None, None, None, None)

    def test_active_main_stdout_and_restart(self):
        import contextlib, io, json
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p / "config").write_text(json.dumps(cfg()))
            args = ["watch.py", str(p / "config"), str(p / "state")]
            # main() reads the wall clock; keep the test outside the 01:50-05:30 JST closed hours.
            with patch.object(w.sys, "argv", args), patch.object(w.signal, "alarm"), \
                    patch.object(w, "closed_hours", return_value=False):
                for _ in range(2):
                    out = io.StringIO()
                    with contextlib.redirect_stdout(out):
                        w.main(getter=lambda _: html())
                    self.assertEqual(out.getvalue(), "")
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    w.main(getter=lambda _: html("空席あり"))
                self.assertIn("【空席】", out.getvalue())
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    w.main(getter=lambda _: html("空席あり"))
                self.assertEqual(out.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
