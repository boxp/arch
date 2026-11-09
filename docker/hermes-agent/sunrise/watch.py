#!/usr/bin/env python3
"""Read-only Sunrise availability monitor. Configuration and state are private."""

import datetime as dt
import fcntl
import json
import os
import re
import signal
from pathlib import Path
import sys
import tempfile
import urllib.parse
import urllib.error
import urllib.request
from html.parser import HTMLParser


class DeadlineExceeded(BaseException):
    pass


JST = dt.timezone(dt.timedelta(hours=9))
HOST = "e5489.jr-odekake.net"
PATH = "/e5489/cspc/CBDayTimeArriveSelRsvMyDiaPC"
ROOMS = {
    "4110040": ("ソロ", "B寝台", "禁煙個室"),
    "4110041": ("シングル", "B寝台", "禁煙個室"),
    "4120041": ("シングル", "B寝台", "喫煙個室"),
    "4110042": ("シングルツイン", "B寝台", "禁煙個室"),
    "4120042": ("シングルツイン", "B寝台", "喫煙個室"),
    "2110002": ("シングルデラックス", "A寝台", "禁煙個室"),
    "2120002": ("シングルデラックス", "A寝台", "喫煙個室"),
    "4110062": ("サンライズツイン", "B寝台", "禁煙個室"),
    "4120062": ("サンライズツイン", "B寝台", "喫煙個室"),
}


TWIN_ROOMS = ("4110062", "4120062")
TWIN_CONFIG_NAME = "特急サンライズ出雲（サンライズツイン）"
TWIN_OFFICIAL_NAME = "特急サンライズ出雲（サツイン）"
TWIN_KANA = "ｻｲｽﾓｻ000"


class ParseFailure(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


REASONS = {
    "congestion": "公式サイトが混雑しています（20100946）",
    "timeout": "取得がタイムアウトしました",
    "http": "HTTP取得に失敗しました",
    "conditions_missing": "検索条件を確認できません",
    "route_mismatch": "日付・経路または列車を確認できません",
    "equipment_unknown": "設備情報を確認できません",
    "deadline": "確認時間の上限に達しました",
    "other": "検索結果を確認できません",
}


def train_matches(name, leg, query):
    if name == query["train"]:
        return True
    if (name, query["train"], tuple(query["rooms"])) != (
        TWIN_OFFICIAL_NAME, TWIN_CONFIG_NAME, TWIN_ROOMS
    ):
        return False
    try:
        params = valid_url(query["url"], leg["date"])
    except (ValueError, KeyError, UnicodeError):
        return False
    return (params.get("inputSpecificBriefTrainKana1") == [TWIN_KANA]
            and params.get("inputSpecificTrainType1") == ["2"]
            and params.get("inputTransferTrainType1") == ["0001"])


def failure_code(exc):
    if isinstance(exc, ParseFailure):
        return exc.code
    if isinstance(exc, (TimeoutError,)):
        return "timeout"
    if isinstance(exc, urllib.error.HTTPError):
        return "http"
    if isinstance(exc, urllib.error.URLError):
        return "timeout" if isinstance(exc.reason, TimeoutError) else "http"
    return "other"


class Node:
    def __init__(self, tag="", attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def walk(self):
        yield self
        for c in self.children:
            if isinstance(c, Node):
                yield from c.walk()

    def text(self):
        return "".join(c.text() if isinstance(c, Node) else c for c in self.children)

    def cls(self, name):
        return name in self.attrs.get("class", "").split()


class Parser(HTMLParser):
    void = {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs)
        self.stack[-1].children.append(n)
        if tag not in self.void:
            self.stack.append(n)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Node(tag, attrs))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def select(n, predicate):
    return [x for x in n.walk() if predicate(x)]


def valid_url(url, date):
    u = urllib.parse.urlsplit(url)
    if u.scheme != "https" or u.netloc != HOST or u.path != PATH or u.fragment:
        raise ValueError("URL")
    q = urllib.parse.parse_qs(u.query, encoding="shift_jis", errors="strict")
    if q.get("inputDate") != [date.replace("-", "")] or any(
        len(v) != 1 for v in q.values()
    ):
        raise ValueError("URL date")
    return q


def parse(html, leg, query):
    """Return known cells only; ambiguous or missing cells remain unknown."""
    if "20100946" in html:
        raise ParseFailure("congestion")
    p = Parser()
    p.feed(html)
    root = p.root
    conditions = select(
        root, lambda n: n.tag == "table" and n.cls("condition-table--4cols-4")
    )
    if len(conditions) != 1:
        raise ParseFailure("conditions_missing")
    c = conditions[0]
    date = dt.date.fromisoformat(leg["date"])
    # Match the date cell itself: January 2 must not match November 2.
    cells = select(c, lambda n: n.tag == "td")
    shown_date = (
        re.match(r"\s*(\d{1,2})月(\d{1,2})日(?:\s|（|\(|$)", cells[0].text())
        if cells
        else None
    )
    starts = select(c, lambda n: n.cls("route-station__station1"))
    ends = select(c, lambda n: n.cls("route-station__station2"))
    if (
        not shown_date
        or tuple(map(int, shown_date.groups())) != (date.month, date.day)
        or len(starts) != 1
        or len(ends) != 1
        or starts[0].text().strip() != leg["from"]
        or ends[0].text().strip() != leg["to"]
    ):
        raise ParseFailure("route_mismatch")
    routes = select(root, lambda n: n.cls("route-train-list"))
    if len(routes) != 1:
        raise ParseFailure("route_mismatch")
    route = routes[0]
    names = select(route, lambda n: n.cls("route-train-list__train-name"))
    stations = select(route, lambda n: n.cls("route-train-list__heading"))
    times = select(route, lambda n: n.cls("route-train-list__time"))
    if (
        len(names) != 1
        or not train_matches(names[0].text().strip(), leg, query)
        or len(stations) != 2
        or [s.text().strip() for s in stations] != [leg["from"], leg["to"]]
        or len(times) != 2
        or times[0].text().strip() != leg["departure"] + " 発"
    ):
        raise ParseFailure("route_mismatch")
    tables = select(route, lambda n: n.tag == "table" and n.cls("seat-facility"))
    if len(tables) != 1:
        raise ParseFailure("equipment_unknown")
    table = tables[0]
    result = {}
    for room in query["rooms"]:
        expected = ROOMS[room]
        th = select(
            table, lambda n: n.tag == "th" and n.attrs.get("data-search-id") == room
        )
        td = select(
            table, lambda n: n.tag == "td" and n.attrs.get("data-search-id") == room
        )
        if len(th) != 1 or len(td) != 1:
            continue
        labels = [n.attrs.get("alt") for n in select(th[0], lambda n: n.tag == "img")]
        alts = [n.attrs.get("alt") for n in select(td[0], lambda n: n.tag == "img")]
        if expected[1] not in labels or expected[2] not in labels or len(alts) != 1:
            continue
        if alts[0] in ("空席あり", "空席残りわずか"):
            result[room] = "available"
        elif alts[0] == "残席なし":
            result[room] = "full"
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("redirect")


def fetch(url):
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0"}, method="GET"
    )
    with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as response:
        data = response.read(2000001)
        if len(data) > 2000000:
            raise ValueError("response size")
        return data.decode("utf-8")


def atomic(path, state):
    fd, name = tempfile.mkstemp(prefix=".sunrise-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
        fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def validate(cfg):
    if not isinstance(cfg["legs"], dict) or not cfg["legs"]:
        raise ValueError("legs")
    for key, leg in cfg["legs"].items():
        date = dt.date.fromisoformat(leg["date"])
        stop = dt.datetime.fromisoformat(leg["stop"])
        if (
            stop.tzinfo is None
            or stop.astimezone(JST).date() != date
            or stop.astimezone(JST).strftime("%H:%M") != leg["departure"]
        ):
            raise ValueError("stop")
        if (
            not key
            or not leg["from"]
            or not leg["to"]
            or leg["from"] == leg["to"]
            or not isinstance(leg["enabled"], bool)
        ):
            raise ValueError("leg")
        seen = set()
        for q in leg["queries"]:
            params = valid_url(q["url"], leg["date"])
            if params.get("inputDepartStName") != [leg["from"]] or params.get(
                "inputArriveStName"
            ) != [leg["to"]]:
                raise ValueError("URL direction")
            allowed = {
                "inputDepartStName",
                "inputArriveStName",
                "inputType",
                "inputDate",
                "inputHour",
                "inputMinute",
                "inputUniqueDepartSt",
                "inputUniqueArriveSt",
                "inputSearchType",
                "inputTransferDepartStName1",
                "inputTransferArriveStName1",
                "inputTransferDepartStUnique1",
                "inputTransferArriveStUnique1",
                "inputTransferTrainType1",
                "inputSpecificTrainType1",
                "inputSpecificBriefTrainKana1",
                "SequenceType",
            }
            if (
                set(params) != allowed
                or params["inputTransferDepartStName1"] != [leg["from"]]
                or params["inputTransferArriveStName1"] != [leg["to"]]
            ):
                raise ValueError("URL parameters")
            fixed = {
                "inputType": "0",
                "inputSearchType": "2",
                "inputUniqueDepartSt": "1",
                "inputUniqueArriveSt": "1",
                "inputTransferDepartStUnique1": "1",
                "inputTransferArriveStUnique1": "1",
                "inputTransferTrainType1": "0001",
                "inputSpecificTrainType1": "2",
                "SequenceType": "0",
            }
            if any(params[k] != [v] for k, v in fixed.items()):
                raise ValueError("URL parameters")
            groups = {
                ("4110042", "4120042", "2110002", "2120002"): (
                    "特急サンライズ出雲",
                    "ｻｲｽﾓ 000",
                ),
                ("4110041", "4120041"): ("特急サンライズ出雲（シングル）", "ｻｲｽﾓｼ000"),
                ("4110040",): ("特急サンライズ出雲（ソロ）", "ｻｲｽﾓｿ000"),
                ("4110062", "4120062"): (
                    "特急サンライズ出雲（サンライズツイン）",
                    "ｻｲｽﾓｻ000",
                ),
            }
            group = groups.get(tuple(q["rooms"]))
            if (
                not group
                or q["train"] != group[0]
                or params["inputSpecificBriefTrainKana1"] != [group[1]]
            ):
                raise ValueError("train mapping")
            if (
                not q["train"].startswith("特急サンライズ出雲")
                or not q["rooms"]
                or any(x not in ROOMS or x in seen for x in q["rooms"])
            ):
                raise ValueError("rooms")
            seen.update(q["rooms"])
        if not seen:
            raise ValueError("queries")


def migrate(legacy, cfg):
    """Pure conversion of a just-read legacy state; never use the contract snapshot."""
    import copy

    if "last_good" not in legacy or "last_alert" not in legacy:
        raise ValueError("旧stateの通知履歴がありません")
    state = copy.deepcopy(legacy)
    state.update(schema_version=1, rooms={}, errors={}, notifications=[])
    values = {
        "残席なし": "full",
        "空席あり": "available",
        "空席残りわずか": "available",
    }
    old_queries = {q["url"]: str(i) for i, q in enumerate(legacy.get("queries", []))}
    for direction, leg in cfg["legs"].items():
        for index, query in enumerate(leg["queries"]):
            for room in query["rooms"]:
                key = direction + ":" + room
                raw = legacy["last_good"].get(key)
                if raw in values:
                    state["rooms"][key] = values[raw]
                elif raw not in (None, "unknown"):
                    raise ValueError("旧stateの設備状態が不明です")
                # An unknown with an alert history must not manufacture a new transition.
                elif legacy["last_alert"].get(key):
                    state["rooms"][key] = "available"
            failure = legacy.get("failures", {}).get(old_queries.get(query["url"]))
            if failure:
                state["errors"][direction + ":" + str(index)] = {
                    "count": failure["consecutive"],
                    "last_alert": failure.get("last_notified_at"),
                    "reason": failure.get("reason"),
                }
    return state


def run(cfg, state, now, getter=fetch):
    messages = []
    active = False
    expired = False
    state.setdefault("rooms", {})
    state.setdefault("errors", {})
    state.setdefault("notifications", [])
    observations = []
    for direction, leg in cfg["legs"].items():
        if not leg["enabled"] or now >= dt.datetime.fromisoformat(leg["stop"]):
            continue
        active = True
        for index, q in enumerate(leg["queries"]):
            found = {}
            code = None
            try:
                if expired:
                    raise DeadlineExceeded()
                found = parse(getter(q["url"]), leg, q)
                if len(found) != len(q["rooms"]):
                    code = "equipment_unknown"
            except DeadlineExceeded:
                expired = True
                code = "deadline"
            except Exception as exc:
                code = failure_code(exc)
            reason = REASONS.get(code)
            observations.append(
                {
                    "direction": direction,
                    "query_index": index,
                    "cells": {r: found.get(r, "unknown") for r in q["rooms"]},
                    "reason": reason,
                    "reason_code": code,
                    "observed_at": now.isoformat(),
                }
            )
            error_key = direction + ":" + str(index)
            item = state["errors"].setdefault(
                error_key, {"count": 0, "last_alert": None}
            )
            if reason:
                item["count"] += 1
                last = (
                    dt.datetime.fromisoformat(item["last_alert"])
                    if item["last_alert"]
                    else None
                )
                if item["count"] >= 3 and (
                    last is None or now - last >= dt.timedelta(hours=6)
                ):
                    messages.append(
                        f"【監視障害】{leg['date']} {leg['from']}→{leg['to']} {q['train']}\n{reason}。3回以上連続で確認できていません。前回の正常結果を保持しています。\n観測: {now.astimezone(JST):%Y-%m-%d %H:%M} JST"
                    )
                    item["last_alert"] = now.isoformat()
                item["reason"] = reason
                item["reason_code"] = code
            else:
                item["count"] = 0
                item["reason"] = None
                item["reason_code"] = None
            for room, value in found.items():
                key = direction + ":" + room
                previous = state["rooms"].get(key)
                state["rooms"][key] = value
                if value == "available" and previous == "full":
                    name = ROOMS[room][0]
                    suffix = (
                        "\nサンライズツインは1名でも2名分の料金券が必要です。"
                        if name == "サンライズツイン"
                        else ""
                    )
                    messages.append(
                        f"【空席】{leg['date']} {leg['from']}→{leg['to']} {name}（{ROOMS[room][2]}）\n観測: {now.astimezone(JST):%Y-%m-%d %H:%M} JST\n{q['url']}\n料金は未確認です。予約は確保されておらず、空席は変動します。{suffix}"
                    )
    # The scheduler cannot acknowledge delivery to this process. Retain evidence
    # for explicit reconciliation rather than claiming successful delivery.
    for message in messages:
        state["notifications"].append(
            {"at": now.isoformat(), "text": message, "delivery": "unconfirmed"}
        )
    state["notifications"] = state["notifications"][-100:]
    state["observations"] = observations
    state["last_checked_at"] = now.isoformat()
    state["active"] = active
    return messages, active


def main(getter=fetch):
    if len(sys.argv) != 3:
        raise ValueError("usage: watch.py CONFIG STATE")
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(DeadlineExceeded()))
    signal.alarm(240)
    config, path = Path(sys.argv[1]), Path(sys.argv[2])
    cfg = json.loads(config.read_text())
    validate(cfg)
    with open(str(path) + ".lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        state = (
            json.loads(path.read_text())
            if path.exists()
            else {"schema_version": 1, "rooms": {}, "errors": {}}
        )
        if state.get("schema_version") != 1:
            raise ValueError("stateはmigrate.pyによる変換が必要です")
        messages, _ = run(cfg, state, dt.datetime.now(dt.timezone.utc), getter)
        atomic(path, state)
        if messages:
            print("\n\n".join(messages))


if __name__ == "__main__":
    try:
        main()
    except DeadlineExceeded:
        print("sunrise monitor: deadline exceeded", file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("sunrise monitor: 処理に失敗しました", file=sys.stderr)
        sys.exit(1)
