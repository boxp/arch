"""SFW fixtures: no network, provider, live Notes, credentials or real recipients."""
import asyncio
import ast
import base64
from contextlib import nullcontext
import importlib.util
import json
import logging
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch

import boxp_task_board_delivery as delivery

EVENT = "BOXP-999-20261030T120000Z-00000000-0000-0000-0000-000000000000-review"
RUN = "20261030T120000Z-00000000-0000-0000-0000-000000000000"
CHAT = "webhook:v2:" + base64.urlsafe_b64encode(json.dumps(["default", "task-board", EVENT]).encode()).decode().rstrip("=")


class Fixtures(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name) / "Tickets"
        self.vault.mkdir()
        self.root = Path(self.tmp.name) / "receipts"
        self.source = NS(platform=NS(value="webhook"), chat_id=CHAT)
        self.calls = []
        self.fail = False
        self.pause = False
        self.started = asyncio.Event()
        self.release = asyncio.Event()

        async def send(destination, chat, text):
            self.calls.append(text)
            if self.fail:
                raise RuntimeError("private fixture error must never be persisted")
            if self.pause:
                self.started.set()
                await self.release.wait()
            return NS(success=True)

        self.adapter = NS(_deliver_to=send)
        base = types.ModuleType("gateway.platforms.base")
        base.SendResult = lambda success, error=None: NS(success=success, error=error)
        retained = types.ModuleType("gateway.platforms.webhook_delivery")
        retained.retained_destination = lambda adapter, chat: {"deliver": "fixture"}
        filters = types.ModuleType("gateway.response_filters")
        filters.is_intentional_silence_response = lambda text: text.strip() in {"[SILENT]", "NO_REPLY"}
        filters.is_autonomous_silence_response = lambda text: any(m in text for m in ["NO_REPLY", "[SILENT]"])
        self.addCleanup(patch.stopall)
        patch.dict(sys.modules, {"gateway.platforms.base": base,
                                "gateway.platforms.webhook_delivery": retained,
                                "gateway.response_filters": filters}).start()

    def note(self, result, event=EVENT):
        with (self.vault / "BOXP-999.md").open("a") as stream:
            stream.write(f"- 2026-10-30 12:00:00 UTC [kohako-event]: [kohako-event] handled event={event} run={RUN} result={result} summary=SFW fixture\n")

    async def send(self, text):
        return await delivery.send_once(self.adapter, CHAT, text, metadata={"_boxp_task_board_final": True},
                                        root=self.root, vault=self.vault)

    def shape(self, text, *, marker=False, failed=False):
        return delivery.shape(self.source, {"failed": failed}, text, marker, self.vault)

    async def test_success_and_question_preserve_report_and_deduplicate(self):
        for result in ["notified", "question"]:
            with self.subTest(result=result):
                (self.vault / "BOXP-999.md").unlink(missing_ok=True)
                self.note(result)
                self.root = Path(self.tmp.name) / result
                text = "【Task Board 通知】SFW fixture"
                self.assertEqual(self.shape(text), (text, False))
                self.assertTrue((await self.send(text)).success)
                self.assertTrue((await self.send(text)).success)
                self.assertEqual(self.calls[-1], text)
        self.assertEqual(len(self.calls), 2)

    async def test_proven_silent_has_no_warning_or_egress(self):
        self.note("silent")
        self.assertEqual(self.shape("[SILENT]", marker=True), ("[SILENT]", True))
        self.assertTrue((await self.send("NO_REPLY")).success)
        self.assertFalse(self.calls)

    async def test_silence_without_evidence_alerts_once(self):
        text, silent = self.shape("[SILENT]", marker=True)
        self.assertFalse(silent)
        self.assertIn("reason=missing_reply", text)
        await self.send(text)
        await self.send(text)
        self.assertEqual(len(self.calls), 1)
        receipt = json.loads(next(self.root.glob("*.json")).read_text())
        self.assertEqual(receipt["classification"], "unresolved")
        self.assertEqual(receipt["state"], "sent")  # notice delivered; business outcome unresolved
        self.assertEqual(set(receipt), {"event", "classification", "state", "updated_at"})

    async def test_notified_but_missing_reply_is_not_silence(self):
        self.note("notified")
        text, silent = self.shape("NO_REPLY", marker=True)
        self.assertFalse(silent)
        self.assertIn("missing_reply", text)

    async def test_reconciliation_notice_does_not_consume_later_report(self):
        for outcome in ["notified", "question"]:
            with self.subTest(outcome=outcome):
                (self.vault / "BOXP-999.md").unlink(missing_ok=True)
                self.root = Path(self.tmp.name) / outcome
                self.calls.clear()
                recovered = delivery.recovered_marker(self.source, "NO_REPLY", self.vault)
                self.assertTrue((await self.send(recovered)).success)
                self.assertTrue((await self.send(recovered)).success)
                self.note(outcome)
                report = "SFW recovered business report"
                self.assertTrue((await self.send(report)).success)
                self.assertTrue((await self.send(report)).success)
                self.assertTrue((await self.send(recovered)).success)
                self.assertEqual(self.calls, [recovered, report])
                self.assertEqual(len(list(self.root.glob("*.json"))), 2)

    async def test_recovered_prefix_uses_notice_receipt_and_preserves_unknown_report(self):
        recovered = delivery.recovered_marker(self.source, "NO_REPLY", self.vault)
        prefix = "♻️ Recovered reply — the gateway restarted during delivery, so this may be a duplicate:\n\n"
        metadata = {"_boxp_task_board_final": True, "_boxp_task_board_notice": True}
        async def recovered_send():
            return await delivery.send_once(self.adapter, CHAT, prefix + recovered, metadata=metadata,
                                            root=self.root, vault=self.vault)
        self.assertTrue((await recovered_send()).success)
        self.assertTrue((await recovered_send()).success)
        self.assertTrue((await self.send("SFW report with unknown outcome")).success)
        self.assertTrue((await self.send("SFW report with unknown outcome")).success)
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.calls[0], prefix + recovered)
        self.assertIn("missing_or_conflicting_receipt", self.calls[1])
        self.assertEqual(len(list(self.root.glob("*.json"))), 2)

    async def test_installed_startup_recovery_connects_to_delivery(self):
        installed = Path("/opt/hermes/gateway/run_startup.py")
        if not installed.exists():
            self.skipTest("integration runs inside the built Hermes image")
        from gateway.delivery_ledger import RECOVERED_MARKER
        tree = ast.parse(installed.read_text())
        method = next(node for cls in tree.body if isinstance(cls, ast.ClassDef)
                      for node in cls.body if isinstance(node, ast.AsyncFunctionDef)
                      and node.name == "_redeliver_claimed_obligations")
        namespace = {"asyncio": asyncio, "logger": logging.getLogger("boxp.fixture"),
                     "logging": logging, "_log_suppressed": lambda *a, **k: nullcontext()}
        cls = ast.ClassDef(name="Probe", bases=[], keywords=[], body=[method], decorator_list=[])
        exec(compile(ast.fix_missing_locations(ast.Module(body=[cls], type_ignores=[])),
                     "installed_startup_fixture", "exec"), namespace)
        probe = namespace["Probe"]()
        async def adapter_for(row):
            async def send(chat_id, content, metadata):
                return await delivery.send_once(self.adapter, chat_id, content, metadata=metadata,
                                                root=self.root, vault=self.vault)
            return NS(send=send)
        async def arm():
            pass
        probe._obligation_adapter = adapter_for
        probe._arm_flood_timers_for_waiting_rows = arm
        ledger = types.ModuleType("gateway.delivery_ledger")
        ledger.RECOVERED_MARKER = RECOVERED_MARKER
        ledger.mark_delivered = lambda *args: None
        ledger.mark_failed = lambda *args: self.fail("unexpected delivery failure")
        recovered = delivery.recovered_marker(self.source, "NO_REPLY", self.vault)
        row = {"platform": "webhook", "chat_id": CHAT, "content": recovered,
               "needs_marker": True, "obligation_id": "fixture", "attempts": 1}
        with patch.dict(sys.modules, {"gateway.delivery_ledger": ledger,
                                      "gateway.boxp_task_board_delivery": delivery}):
            self.assertEqual(await probe._redeliver_claimed_obligations([row, row]), 2)
        self.assertEqual(self.calls, [RECOVERED_MARKER + recovered])
        self.note("notified")
        await self.send("SFW business report")
        await self.send("SFW business report")
        self.assertEqual(self.calls, [RECOVERED_MARKER + recovered, "SFW business report"])
        self.assertEqual(len(list(self.root.glob("*.json"))), 2)

    async def test_installed_queued_path_shapes_and_records_first_response(self):
        turn = Path("/opt/hermes/gateway/run_turn.py")
        notifications = Path("/opt/hermes/gateway/run_notifications.py")
        if not turn.exists() or not notifications.exists():
            self.skipTest("integration runs inside the pinned Hermes image")
        names = {"_run_agent_deliver_first_response", "_deliver_queued_first_response",
                 "_send_queued_final_text"}
        methods = [node for path in (turn, notifications)
                   for cls in ast.parse(path.read_text()).body if isinstance(cls, ast.ClassDef)
                   for node in cls.body if isinstance(node, ast.AsyncFunctionDef) and node.name in names]
        self.assertEqual({node.name for node in methods}, names)
        # Evaluate the installed methods with their actual control flow, using only
        # a fake adapter and temporary vault/receipts.
        from contextlib import suppress
        namespace = {"Any": object, "Optional": __import__("typing").Optional,
                     "TurnContext": object, "SessionSource": object, "MessageEvent": lambda **kw: NS(**kw),
                     "BasePlatformAdapter": type("BasePlatformAdapter", (), {}),
                     "logger": logging.getLogger("boxp.fixture"), "suppress": suppress,
                     "silence_allowed": lambda *args: False,
                     "_unexpected_silence_reply": lambda: "unexpected warning"}
        cls = ast.ClassDef(name="Probe", bases=[], keywords=[], body=methods, decorator_list=[])
        exec(compile(ast.fix_missing_locations(ast.Module(body=[cls], type_ignores=[])),
                     "installed_queued_fixture", "exec"), namespace)
        probe = namespace["Probe"]()
        probe._is_intentional_silence = lambda result, text: not result.get("failed") and text.strip() in {"NO_REPLY", "[SILENT]"}
        probe._run_agent_stream_confirmed_final_delivery = lambda *args, **kwargs: False
        probe._pop_post_delivery_callback = lambda *args: None
        async def media(*args, **kwargs):
            pass
        probe._deliver_media_from_response = media
        async def send(chat_id, content, metadata=None):
            return await delivery.send_once(self.adapter, chat_id, content, metadata=metadata,
                                            root=self.root, vault=self.vault)
        adapter = NS(send=send)
        run = types.ModuleType("gateway.run")
        run._strip_response_attachments_for_direct_send = lambda text, adapter: text
        bridge = types.ModuleType("gateway.boxp_task_board_delivery")
        bridge.identity = delivery.identity
        bridge.shape = lambda source, result, response, marker: delivery.shape(source, result, response, marker, self.vault)
        ctx = NS(mute_notification_reply=False, session_key="fixture", stream_consumer_holder=[None],
                 source=self.source, persist_user_display_kind="human", reply_expected=None,
                 _status_thread_metadata=None, event_message_id=None, inbound_message_id="fixture",
                 run_generation=1)
        async def queued(text, failed=False):
            result = {"final_response": text, "failed": failed}
            await probe._run_agent_deliver_first_response(ctx, adapter, result, result, None)
            return result
        with patch.dict(sys.modules, {"gateway.run": run, "gateway.boxp_task_board_delivery": bridge}):
            self.note("silent")
            await queued("NO_REPLY")
            self.assertEqual(self.calls, [])
            await queued("NO_REPLY", failed=True)
            self.assertIn("agent_failed", self.calls[-1])
            self.assertEqual(len(self.calls), 1)
            (self.vault / "BOXP-999.md").unlink()
            await queued("NO_REPLY")  # notice deduplicated, unknown is not silent
            self.assertEqual(len(self.calls), 1)
            self.note("notified")
            first = await queued("SFW first report")
            self.assertTrue(first["already_sent"])
            await queued("SFW first report")
            # Normal fallback and startup recovery for this event share the
            # queued report receipt, including after a crash before ledger ack.
            await self.send("SFW first report")
            await self.send("Recovered: SFW first report")
            self.assertEqual(self.calls[1:], ["SFW first report"])
            # A real queued inbound event supplies its own source/event identity.
            next_event = EVENT.replace("120000Z", "120001Z")
            next_chat = CHAT[:len("webhook:v2:")] + base64.urlsafe_b64encode(
                json.dumps(["default", "task-board", next_event]).encode()).decode().rstrip("=")
            self.note("question", next_event)
            ctx.source = NS(platform=NS(value="webhook"), chat_id=next_chat)
            await queued("SFW follow-up report")
            await queued("SFW follow-up report")
            self.assertEqual(self.calls[1:], ["SFW first report", "SFW follow-up report"])
            self.assertEqual(len(list(self.root.glob("*.json"))), 3)

    async def test_uncertain_queued_send_blocks_normal_fallback(self):
        self.note("notified")
        self.fail = True
        result = await delivery.send_once(self.adapter, CHAT, "SFW first report",
            metadata={"_boxp_task_board_final": True, "_boxp_task_board_queued": True},
            root=self.root, vault=self.vault)
        self.assertFalse(result.success)
        self.fail = False
        self.assertFalse((await self.send("SFW fallback report")).success)
        self.assertEqual(len(self.calls), 1)

    async def test_marker_plus_report_is_preserved_even_with_silent_receipt(self):
        self.note("silent")
        for text in ["NO_REPLY\nSFW report", "SFW report\n[SILENT]"]:
            with self.subTest(text=text):
                self.root = Path(self.tmp.name) / str(len(self.calls))
                self.assertEqual(self.shape(text), (text, False))
                await self.send(text)
                self.assertIn(text, self.calls[-1])
                self.assertIn("missing_or_conflicting_receipt", self.calls[-1])

    async def test_empty_and_failed_never_gain_silence(self):
        self.note("silent")
        for text, failed in [("", False), ("(empty)", False), ("NO_REPLY", True)]:
            shaped, silent = self.shape(text, marker=text == "NO_REPLY", failed=failed)
            self.assertFalse(silent)
            self.assertTrue(shaped.startswith(delivery.NOTICE))
            self.assertIn(EVENT, shaped)

    async def test_partial_failed_work_report_is_preserved(self):
        text = "SFW step A completed; step B failed"
        shaped, silent = self.shape(text, failed=True)
        self.assertFalse(silent)
        self.assertIn(text, shaped)
        self.assertIn("agent_failed", shaped)
        await self.send(shaped)
        self.assertEqual(self.calls, [shaped])

    async def test_installed_adapter_marks_final_and_logs_undelivered_exception(self):
        installed = Path("/opt/hermes/gateway/platforms/webhook.py")
        if not installed.exists():
            self.skipTest("integration runs inside the built Hermes image")
        tree = ast.parse(installed.read_text())
        names = {"_send_final_text", "_notify_turn_error"}
        methods = [node for cls in tree.body if isinstance(cls, ast.ClassDef)
                   for node in cls.body if isinstance(node, ast.AsyncFunctionDef) and node.name in names]
        self.assertEqual({node.name for node in methods}, names)

        class BaseProbe:
            async def _send_final_text(self, *args):
                return args[3]

        logger = logging.getLogger("boxp.fixture")
        namespace = {"BaseProbe": BaseProbe, "logger": logger}
        cls = ast.ClassDef(name="Probe", bases=[ast.Name(id="BaseProbe", ctx=ast.Load())],
                           keywords=[], body=methods, decorator_list=[])
        code = ast.fix_missing_locations(ast.Module(body=[cls], type_ignores=[]))
        exec(compile(code, "installed_adapter_fixture", "exec"), namespace)
        probe = namespace["Probe"]()
        final_meta = await probe._send_final_text(None, "fixture", "report", {"thread_id": "fixture"}, False, 0, None)
        self.assertTrue(final_meta["_boxp_task_board_final"])
        self.assertEqual(final_meta["thread_id"], "fixture")

        async def failed_send(*args, **kwargs):
            return NS(success=False)

        probe.send = failed_send
        with patch.dict(sys.modules, {"gateway.boxp_task_board_delivery": delivery}):
            with self.assertLogs(logger, level="WARNING") as logs:
                await probe._notify_turn_error(NS(source=self.source), RuntimeError("private fixture error"))
        self.assertIn(EVENT, logs.output[0])
        self.assertIn("recovery=reconcile_receipt_and_destination", logs.output[0])
        self.assertNotIn("private fixture", logs.output[0])

    async def test_crash_left_marker_requires_outcome_reconciliation(self):
        # Upstream recovers only the persisted marker, not the agent result.
        # Failed, unknown and successful runs therefore have identical durable
        # evidence and must all produce a notice, including with silent Notes.
        for outcome, failed in [("failed", True), ("unknown", None), ("success", False)]:
            with self.subTest(outcome=outcome):
                (self.vault / "BOXP-999.md").unlink(missing_ok=True)
                self.note("silent")
                self.root = Path(self.tmp.name) / outcome
                if failed is not None:
                    live, silent = self.shape("NO_REPLY", marker=True, failed=failed)
                    self.assertEqual(silent, not failed)
                    if failed:
                        self.assertIn("agent_failed", live)
                recovered = delivery.recovered_marker(self.source, "NO_REPLY", self.vault)
                self.assertIn("reason=recovered_outcome_unknown", recovered)
                self.assertIn(EVENT, recovered)
                self.assertTrue((await self.send(recovered)).success)
                self.assertEqual(self.calls[-1], recovered)
        (self.vault / "BOXP-999.md").unlink()
        self.assertIn("recovered_outcome_unknown", delivery.recovered_marker(self.source, "NO_REPLY", self.vault))
        self.source.platform.value = "telegram"
        self.assertIsNone(delivery.recovered_marker(self.source, "NO_REPLY", self.vault))

    async def test_unknown_report_preserved_with_recovery_metadata(self):
        await self.send("SFW work report")
        self.assertIn("SFW work report", self.calls[0])
        self.assertIn("missing_or_conflicting_receipt", self.calls[0])

    async def test_conflicting_or_other_event_receipts_do_not_authorize_silence(self):
        self.note("silent", event=EVENT + "-other")
        self.assertFalse(self.shape("NO_REPLY", marker=True)[1])
        self.note("silent")
        self.note("notified")
        self.assertFalse(self.shape("NO_REPLY", marker=True)[1])

    async def test_exception_and_restart_never_resend_uncertain_egress(self):
        self.note("question")
        self.fail = True
        self.assertFalse((await self.send("SFW question")).success)
        self.fail = False
        self.assertFalse((await self.send("SFW question")).success)
        self.assertEqual(len(self.calls), 1)
        text = next(self.root.glob("*.json")).read_text()
        self.assertNotIn("SFW question", text)
        self.assertNotIn("private fixture", text)
        self.assertEqual(json.loads(text)["state"], "uncertain")

    async def test_concurrent_delivery_does_not_block_event_loop_or_duplicate(self):
        self.note("notified")
        self.pause = True
        first = asyncio.create_task(self.send("SFW report"))
        await asyncio.wait_for(self.started.wait(), 1)
        self.assertFalse((await asyncio.wait_for(self.send("SFW report"), 1)).success)
        self.release.set()
        self.assertTrue((await first).success)
        self.assertEqual(len(self.calls), 1)

    async def test_corrupt_storage_fails_closed(self):
        self.note("notified")
        await self.send("SFW report")
        next(self.root.glob("*.json")).write_text("broken")
        self.assertFalse((await self.send("SFW report")).success)
        self.assertEqual(len(self.calls), 1)

    async def test_interim_never_consumes_final_receipt(self):
        self.assertIsNone(await delivery.send_once(self.adapter, CHAT, "SFW progress", metadata={"_interim_send": True},
                                                   root=self.root, vault=self.vault))
        self.assertIsNone(await delivery.send_once(self.adapter, CHAT, "SFW progress", root=self.root, vault=self.vault))
        self.assertFalse(self.root.exists())
        self.note("notified")
        self.assertTrue((await self.send("SFW final report")).success)
        self.assertEqual(self.calls, ["SFW final report"])

    async def test_destination_exception_is_failure_without_egress(self):
        def missing(adapter, chat):
            raise RuntimeError("fixture authorization revoked")
        with patch.object(sys.modules["gateway.platforms.webhook_delivery"], "retained_destination", missing):
            result = await self.send("SFW report")
        self.assertFalse(result.success)
        self.assertIn(EVENT, result.error)
        self.assertFalse(self.calls)

    async def test_human_and_other_webhooks_keep_existing_behavior(self):
        self.source.platform.value = "telegram"
        self.assertEqual(self.shape("NO_REPLY", marker=True), ("NO_REPLY", False))
        self.assertIsNone(await delivery.send_once(self.adapter, "webhook:other:" + EVENT, "NO_REPLY"))
        self.assertIsNone(delivery.identity("webhook:task-board:../../secrets"))


class PatchBuild(unittest.TestCase):
    def test_patch_anchor_mismatch_never_changes_files(self):
        spec = importlib.util.spec_from_file_location("patch_delivery", Path(__file__).with_name("fix-task-board-delivery.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "gateway/run_turn_persistence.py"
            path.parent.mkdir()
            path.write_text("# changed upstream\n")
            with self.assertRaises(RuntimeError):
                module.main(root)
            self.assertEqual(path.read_text(), "# changed upstream\n")


if __name__ == "__main__":
    unittest.main()
