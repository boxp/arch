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

telegram = {"fail": False, "delay": 0.0, "sent": []}


class Stub(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        time.sleep(telegram["delay"])
        if not telegram["fail"]:
            telegram["sent"].append(body["text"])
        reply = json.dumps({"ok": not telegram["fail"], "result": {"message_id": len(telegram["sent"])}}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)

    def log_message(self, *args):
        pass


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

    # 4. mode fallback is unchanged: home success closes the receipt without Telegram.
    os.environ["BOXP_NOTIFY_TELEGRAM_MODE"] = "fallback"
    ev = event(4)
    telegram["sent"] = []
    await send(ev)
    check("fallback: home alone is delivered, Telegram untouched", state(ev) == "delivered" and not telegram["sent"])


asyncio.run(main())
sys.exit(1 if failures else 0)
