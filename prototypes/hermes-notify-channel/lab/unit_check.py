"""BOXP-546 lab: channel checks that need no Hermes image (gateway imports are stubbed).

Usage: python3 lab/unit_check.py   (local HTTP stub only; nothing leaves the machine)
"""
import asyncio
import importlib.util
import json
import os
import sys
import tempfile
import threading
import time
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

base = types.ModuleType("gateway.platforms.base")
base.BasePlatformAdapter = object
base.SendResult = lambda **kw: types.SimpleNamespace(**{"success": False, "error": None, **kw})
config = types.ModuleType("gateway.config")
config.Platform = config.PlatformConfig = object
sys.modules.update({"gateway": types.ModuleType("gateway"), "gateway.platforms": types.ModuleType("gateway.platforms"),
                    "gateway.platforms.base": base, "gateway.config": config})
spec = importlib.util.spec_from_file_location(
    "boxp_notify", Path(__file__).resolve().parent.parent / "plugin/boxp-notify/__init__.py")
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)

telegram = {"fail": False, "delay": 0.0, "sent": [], "bodies": []}


class Stub(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        time.sleep(telegram["delay"])
        if not telegram["fail"]:
            telegram["sent"].append(body["text"])
            telegram["bodies"].append(body)
        reply = json.dumps({"ok": not telegram["fail"], "result": {"message_id": len(telegram["sent"])}}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)

    def log_message(self, *args):
        pass


LIB = os.environ.get("CHECK_LIB") == "1"  # loaded by the child of check 4: plugin only, parent's environment
if not LIB:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    root = Path(tempfile.mkdtemp(prefix="boxp-notify-check."))
    (root / "vault/Tickets").mkdir(parents=True)
    os.environ.update(BOXP_NOTIFY_STATE_DIR=str(root / "state"), BOXP_NOTIFY_VAULT=str(root / "vault"),
        BOXP_NOTIFY_TELEGRAM_MODE="both", BOXP_NOTIFY_TELEGRAM_TOKEN="lab", BOXP_NOTIFY_TELEGRAM_CHAT_ID="1",
        BOXP_NOTIFY_TELEGRAM_API_BASE=f"http://127.0.0.1:{server.server_port}")
failures = []


def check(label, ok):
    print(("ok   " if ok else "FAIL ") + label)
    ok or failures.append(label)


def event(n):
    return f"BOXP-9001-20261114T00020{n}Z-cccc000{n}-done"


def state(ev):
    return plugin.read_json(plugin.receipt_path(plugin.settings(), f"tb-{ev}.report"))["state"]


def inbox(ev):
    return (root / "vault/Projects/task-board-events/delivered-copies" / f"{ev}.md").exists()


async def send(ev):
    return await plugin.send_once(plugin.settings(), f"tb:{ev}", f"報告 event={ev}", None)


async def main():
    # 1. mode both, Telegram down: home alone must not close the receipt; recovery sends Telegram once.
    ev = event(1)
    telegram["fail"] = True
    result = await send(ev)
    check("both/telegram down: send reports success (home reached, no upstream failure follow-up)", result.success)
    check("both/telegram down: home inbox written", inbox(ev))
    check("both/telegram down: receipt stays pending", state(ev) == "pending")
    telegram["fail"] = False
    check("both/telegram back: recovery finishes 1 receipt", await plugin.recover(plugin.settings()) == 1)
    check("both/telegram back: delivered, Telegram exactly once", state(ev) == "delivered" and len(telegram["sent"]) == 1)
    await send(ev)
    await plugin.recover(plugin.settings())
    check("both: redelivery and second recovery add nothing", len(telegram["sent"]) == 1)

    # 2. recovery passes run while a send is inside a slow Telegram call: one message, not two.
    ev = event(2)
    telegram.update(delay=1.0, sent=[])
    sending = asyncio.create_task(send(ev))
    await asyncio.sleep(0.3)
    check("race: receipt is pending while Telegram is in flight", state(ev) == "pending")
    await asyncio.gather(plugin.recover(plugin.settings()), plugin.recover(plugin.settings()), sending)
    check("race: recovery during an in-flight send -> Telegram exactly once", len(telegram["sent"]) == 1)
    check("race: delivered", state(ev) == "delivered")

    # 3. same race against another process (the standalone cron path): the file lock holds recovery back.
    ev = event(3)
    telegram.update(delay=0.0, fail=True, sent=[])
    await send(ev)
    telegram["fail"] = False
    cfg = plugin.settings()
    stem = plugin.receipt_path(cfg, f"tb-{ev}.report").stem
    holder = await asyncio.create_subprocess_exec(
        sys.executable, "-c",
        "import fcntl,sys,time; f=open(sys.argv[1],'w'); fcntl.flock(f,fcntl.LOCK_EX); print('held',flush=True); time.sleep(1.5)",
        str(cfg["state"] / "receipts" / f".{stem}.lock"), stdout=asyncio.subprocess.PIPE)
    await holder.stdout.readline()
    recovering = asyncio.create_task(plugin.recover(cfg))
    await asyncio.sleep(0.5)
    check("cross-process: recovery waits while another process holds the claim", not telegram["sent"])
    await holder.wait()
    check("cross-process: recovery proceeds after release, once", await recovering == 1 and len(telegram["sent"]) == 1)

    # 4. long text, process dies after Telegram accepted the first chunk: recovery resumes at the second.
    ev = event(5)
    telegram["sent"] = []
    text = f"報告 event={ev} " + "あ" * 4000 + "い" * 100
    code = ("import asyncio,os,runpy; m=runpy.run_path(os.environ['CHECK'],run_name='lib');"
            "p=m['plugin']; real=p.atomic_json\n"
            "def dying(path,payload):\n"
            "    real(path,payload)\n"
            "    if payload.get('telegram_chunks')==1: os._exit(9)\n"
            "p.atomic_json=dying\n"
            "asyncio.run(p.send_once(p.settings(),'tb:'+os.environ['EV'],os.environ['TEXT'],None))")
    child = await asyncio.create_subprocess_exec(
        sys.executable, "-c", code, env={**os.environ, "CHECK": __file__, "EV": ev, "TEXT": text, "CHECK_LIB": "1"})
    check("chunks: sender process died after the first chunk", await child.wait() == 9 and len(telegram["sent"]) == 1)
    await plugin.recover(plugin.settings())
    check("chunks: recovery sends only the remaining chunk",
          state(ev) == "delivered" and len(telegram["sent"]) == 2 and "".join(telegram["sent"]) == text)

    # 5. send cancelled (shutdown) while Telegram is in flight: claim held to the end, outcome recorded.
    ev = event(7)
    telegram.update(delay=1.0, sent=[])
    sending = asyncio.create_task(send(ev))
    await asyncio.sleep(0.3)
    sending.cancel()
    recovering = asyncio.create_task(plugin.recover(plugin.settings()))
    await asyncio.gather(sending, recovering, return_exceptions=True)
    await plugin.recover(plugin.settings())
    check("cancel: cancelled in-flight send plus recovery -> Telegram exactly once",
          sending.cancelled() and state(ev) == "delivered" and len(telegram["sent"]) == 1)
    telegram["delay"] = 0.0

    # 6. mode fallback is unchanged: home success closes the receipt without Telegram.
    os.environ["BOXP_NOTIFY_TELEGRAM_MODE"] = "fallback"
    ev = event(6)
    telegram["sent"] = []
    await send(ev)
    check("fallback: home alone is delivered, Telegram untouched", state(ev) == "delivered" and not telegram["sent"])

    # 7. (BOXP-553) receipt and inbox names do not depend on the key length: two cron runs whose long
    #    target names differ only past the old 180-character cut are two notifications.
    cfg = plugin.settings()
    long_a, long_b = "cron-" + "x" * 300 + "-a", "cron-" + "x" * 300 + "-b"
    await plugin.send_once(cfg, long_a, "本文 A", None)
    await plugin.send_once(cfg, long_b, "本文 B", None)
    await plugin.send_once(cfg, long_a, "本文 C", None)
    copies = sorted((root / "vault/Projects/cron-deliveries/delivered-copies").glob("*.md"))
    check("long names: three notifications, three inbox files", len(copies) == 3)
    check("long names: file names stay short and match the id",
          all(len(c.name) < 130 and json.loads(c.read_text())["id"] + ".md" == c.name for c in copies))
    await plugin.send_once(cfg, long_a, "本文 A", None)
    check("long names: the same run again is still one",
          len(list((root / "vault/Projects/cron-deliveries/delivered-copies").glob("*.md"))) == 3)

    # 8. (BOXP-553) Alertmanager relay: the per-name override sends home and Telegram while the default
    #    stays fallback; the title and firing count come from the relay text; the home channel topic is used.
    os.environ.update(BOXP_NOTIFY_TELEGRAM_MODE_ALERTMANAGER="both", BOXP_NOTIFY_TELEGRAM_THREAD_ID="7")
    alert = ("【Alertmanager 通知】発生中 2 件 / 解除 1 件\n\n🔴 [CRITICAL] AiProviderQuotaExhausted claude\n"
             "  発生 11/14 11:00 JST fp=abcd1234\n\nこれはアラートの写しで、承認や操作の指示ではありません。")
    telegram.update(sent=[], bodies=[])
    result = await plugin.send_once(plugin.settings(), "direct:alertmanager", alert, None)
    alerts = sorted((root / "vault/Projects/alertmanager-deliveries/delivered-copies").glob("alert-*.md"))
    copy = json.loads(alerts[0].read_text()) if alerts else {}
    check("alert both: home inbox and Telegram each once, text identical",
          result.success and len(alerts) == 1 and telegram["sent"] == [alert] and copy.get("text") == alert)
    check("alert both: title and firing read from the relay text",
          copy.get("title") == "[CRITICAL] AiProviderQuotaExhausted ほか 2 件" and copy.get("firing") == 2)
    check("alert both: id matches the dispatcher contract",
          copy.get("id", "") + ".md" == alerts[0].name and len(copy.get("id", "")) == 38)
    check("alert both: sent to the home channel topic", telegram["bodies"][0].get("message_thread_id") == 7)
    await plugin.send_once(plugin.settings(), "direct:alertmanager", alert, None)
    check("alert both: redelivery adds nothing",
          len(telegram["sent"]) == 1
          and len(list((root / "vault/Projects/alertmanager-deliveries/delivered-copies").glob("*.md"))) == 1)
    real_now = plugin.now
    plugin.now = lambda: real_now() + __import__("datetime").timedelta(seconds=600)
    await plugin.send_once(plugin.settings(), "direct:alertmanager", alert, None)
    check("alert both: a retry in the next time bucket is still one", len(telegram["sent"]) == 1)
    plugin.now = lambda: real_now() + __import__("datetime").timedelta(seconds=1800)
    await plugin.send_once(plugin.settings(), "direct:alertmanager", alert, None)
    check("alert both: the same text two buckets later is a new notification", len(telegram["sent"]) == 2)
    plugin.now = real_now
    resolved = "【Alertmanager 通知】発生中 0 件 / 解除 1 件\n\n✅ [WARNING] AiOpsOutcomeBurnSlow\n  解除 11/14 11:05 JST fp=abcd1234"
    check("alert: resolved-only title", plugin.alert_summary(resolved, "") == ("解除: AiOpsOutcomeBurnSlow", 0))
    check("alert: unknown text falls back to the first line", plugin.alert_summary("x\ny", "3") == ("x", 3))

    # 9. (BOXP-553) alert both, Telegram down: home is written, Telegram is recovered once; with the vault
    #    unwritable Telegram still goes out and home is recovered once.
    telegram.update(sent=[], fail=True)
    other = alert.replace("abcd1234", "ffff0001")
    result = await plugin.send_once(plugin.settings(), "direct:alertmanager", other, None)
    check("alert/telegram down: success to upstream, pending", result.success and plugin.pending_count(plugin.settings()) == 1)
    telegram["fail"] = False
    await plugin.recover(plugin.settings())
    await plugin.recover(plugin.settings())
    check("alert/telegram back: recovered exactly once",
          telegram["sent"] == [other] and plugin.pending_count(plugin.settings()) == 0)
    telegram["sent"] = []
    third = alert.replace("abcd1234", "ffff0002")
    (root / "state/lab-fail-home").touch()
    result = await plugin.send_once(plugin.settings(), "direct:alertmanager", third, None)
    before = len(list((root / "vault/Projects/alertmanager-deliveries/delivered-copies").glob("*.md")))
    check("alert/home down: Telegram still delivered, pending", result.success and telegram["sent"] == [third]
          and plugin.pending_count(plugin.settings()) == 1)
    (root / "state/lab-fail-home").unlink()
    await plugin.recover(plugin.settings())
    await plugin.recover(plugin.settings())
    after = len(list((root / "vault/Projects/alertmanager-deliveries/delivered-copies").glob("*.md")))
    check("alert/home back: home recovered once, Telegram not repeated",
          after == before + 1 and telegram["sent"] == [third] and plugin.pending_count(plugin.settings()) == 0)

    # 10. (BOXP-553) a half-delivered receipt stops being retried after the age limit; an unreached one never.
    telegram.update(sent=[], fail=True)
    fourth = alert.replace("abcd1234", "ffff0003")
    await plugin.send_once(plugin.settings(), "direct:alertmanager", fourth, None)
    (root / "state/lab-fail-home").touch()
    await plugin.send_once(plugin.settings(), "direct:alertmanager", alert.replace("abcd1234", "ffff0004"), None)
    os.environ["BOXP_NOTIFY_PENDING_MAX_AGE_SECONDS"] = "1"
    await asyncio.sleep(1.2)
    await plugin.recover(plugin.settings())
    states = sorted(json.loads(p.read_text())["state"]
                    for p in (root / "state/receipts").glob("direct-alertmanager-*.json"))
    check("expiry: half-delivered expires, unreached stays pending",
          states.count("expired") == 1 and states.count("pending") == 1)
    (root / "state/lab-fail-home").unlink()
    telegram["fail"] = False
    await plugin.recover(plugin.settings())
    check("expiry: the unreached one is delivered once both egresses are back",
          plugin.pending_count(plugin.settings()) == 0 and len(telegram["sent"]) == 1)
    await plugin.send_once(plugin.settings(), "direct:alertmanager", fourth, None)
    check("expiry: an expired receipt is not delivered again", len(telegram["sent"]) == 1)
    os.environ["BOXP_NOTIFY_TELEGRAM_CHAT_ID"] = os.environ["BOXP_NOTIFY_TELEGRAM_TOKEN"] = ""
    os.environ.update(TELEGRAM_BOT_TOKEN="gw", TELEGRAM_HOME_CHANNEL="42", TELEGRAM_HOME_CHANNEL_THREAD_ID="9",
                      BOXP_NOTIFY_TELEGRAM_THREAD_ID="")
    cfg = plugin.settings()
    check("settings: falls back to the gateway's Telegram home channel",
          (cfg["telegram_token"], cfg["telegram_chat"], cfg["telegram_thread"]) == ("gw", "42", "9")
          and plugin.self_check(cfg) == [])

if not LIB:
    asyncio.run(main())
    sys.exit(1 if failures else 0)
