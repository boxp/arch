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


def cfg():
    return {"legs": {"往路": dict(LEG, queries=[QUERY])}}


class WatchTest(unittest.TestCase):
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
        q = dict(QUERY, rooms=["4110062"])
        c = cfg()
        c["legs"]["往路"]["queries"] = [q]
        state = {"rooms": {"往路:4110062": "full"}}
        msg = w.run(c, state, NOW, lambda _: html("空席あり", room="4110062"))[0][0]
        self.assertIn("2名分", msg)

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
            with patch.object(w.sys, "argv", args), patch.object(w.signal, "alarm"):
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
