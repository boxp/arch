"""BOXP-373: evidence-based silence and metadata-only delivery receipts.

Only the authenticated task-board adapter's canonical chat identity is eligible.
This module never modifies Notes, replays work, or relaxes gateway authorization.
It writes metadata-only delivery receipts alongside the vault Tickets directory.
"""
from __future__ import annotations

import base64
import fcntl
import hashlib
import json
import logging
import os
import re
from pathlib import Path
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)
VAULT = Path("/home/boxp/Documents/obsidian-headless/BOXP/Tickets")
EVENT = re.compile(r"(BOXP-\d+)-(?:\d{8}T\d{6}Z-[a-f0-9-]+-(?:review|blocked|done)|lane-(?:review|blocked|done)-\d{8}T\d{6}Z-[a-f0-9]+|digest-\d{8}T\d{6}Z-[a-f0-9]+)")
NOTICE = "【Task Board 配送要確認】"


def identity(chat_id):
    try:
        if chat_id.startswith("webhook:v2:"):
            token = chat_id[len("webhook:v2:"):]
            profile, route, event = json.loads(base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)))
        else:
            _, route, event = chat_id.split(":", 2)
            profile = "default"
        match = EVENT.fullmatch(event)
        if route == "task-board" and profile == "default" and match:
            return event, match[1]
    except (ValueError, TypeError, AttributeError):
        pass
    return None



def is_task_board_source(source):
    return (getattr(getattr(source, "platform", None), "value", None) == "webhook"
            and identity(getattr(source, "chat_id", None)) is not None)

def receipt(event, ticket, vault=VAULT):
    """Read only exact helper-produced event receipts, never retain Notes bodies."""
    pattern = re.compile(
        r"^.*\[kohako-event\]: \[kohako-event\] handled event=" + re.escape(event)
        + r" run=\S+ result=(notified|silent|question|deferred|continued) summary=.+$"
    )
    results = set()
    try:
        with (vault / f"{ticket}.md").open() as stream:
            for line in stream:
                match = pattern.fullmatch(line.rstrip("\n"))
                if match:
                    results.add(match[1])
    except (OSError, UnicodeError):
        return "unknown"
    return next(iter(results)) if len(results) == 1 else "unknown"


def notice(event, reason):
    return (f"{NOTICE} event={event} reason={reason}\n"
            "業務処理・通知の完了は未確認です。最新票Notesとeventの配送receiptを照合し、"
            "必要な報告だけ取り次いでください。業務処理の再実行・自動再送はしません。")


def shape(source, result, response, marker, vault=VAULT):
    """Return (outbound text, proven silence). Unknown never grants silence."""
    if getattr(getattr(source, "platform", None), "value", None) != "webhook":
        return response, False
    ident = identity(source.chat_id)
    if not ident:
        return response, False
    event, ticket = ident
    proof = receipt(event, ticket, vault)
    if result.get("failed"):
        from gateway.response_filters import is_intentional_silence_response
        if response.strip() and response != "(empty)" and not is_intentional_silence_response(response):
            return response + "\n\n" + notice(event, "agent_failed"), False
        return notice(event, "agent_failed"), False
    if marker:
        if proof in {"silent", "deferred", "continued"}:
            digest_silence_receipt(vault, event, proof)
            logger.info("task-board outcome event=%s classification=proven_silent", event)
            return response, True
        return notice(event, "missing_reply"), False
    if not response.strip() or response == "(empty)":
        return notice(event, "empty_response"), False
    return response, False


def recovered_marker(source, response, vault=VAULT):
    """A persisted marker does not establish whether the agent succeeded.

    None means unrelated source. Even a silent Notes receipt cannot establish
    the outcome of the crashed run, so require reconciliation instead of
    suppressing a potentially undelivered failure.
    """
    ident = identity(source.chat_id)
    if getattr(getattr(source, "platform", None), "value", None) != "webhook" or not ident:
        return None
    return notice(ident[0], "recovered_outcome_unknown")


def clock():
    return datetime.now(timezone.utc)


def quiet_policy(vault=VAULT):
    """The dispatcher publishes its effective window; before its first tick use the same inputs."""
    spec = os.getenv("CODEX_TASK_BOARD_EVENT_QUIET_HOURS", "2-9")
    zone = os.getenv("CODEX_TASK_BOARD_EVENT_TIMEZONE", "Asia/Tokyo")
    try:
        policy = json.loads((Path(vault).parent / "Projects/task-board-events/quiet-policy.json").read_text())
        if isinstance(policy["quiet_hours"], str) and isinstance(policy["timezone"], str):
            return policy["quiet_hours"], policy["timezone"]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return spec, zone


def quiet_now(vault=VAULT):
    """Same semantics as the dispatcher's quiet-at?: an unparsable spec means no quiet hours."""
    spec, zone = quiet_policy(vault)
    match = re.fullmatch(r"(\d{1,2})-(\d{1,2})", spec)
    if not match:
        return False
    start, end = map(int, match.groups())
    try:
        hour = clock().astimezone(ZoneInfo(zone)).hour
    except (KeyError, ValueError, OSError):
        # Hold rather than risk a night send; the held event stays recoverable.
        logger.warning("task-board quiet policy has an invalid timezone")
        return True
    return start <= hour < end if start <= end else hour >= start or hour < end


def vault_receipt(vault, event, state, classification):
    try:
        directory = Path(vault).parent / "Projects/task-board-events/delivery-receipts"
        directory.mkdir(parents=True, exist_ok=True)
        import tempfile
        fd, temporary = tempfile.mkstemp(prefix=".receipt-", dir=directory)
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump({"event": event, "state": state, "classification": classification,
                           "updated_at": clock().isoformat()}, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, directory / (event + ".json"))
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return True
    except Exception:
        logger.warning("task-board vault receipt unavailable event=%s", event)
        return False


def receipt_shows_egress(vault, event, root=None):
    """True when a send of this event happened or may have happened."""
    if root is None:
        try:
            from hermes_constants import get_hermes_home
            root = get_hermes_home() / "task-board-delivery-receipts"
        except Exception:
            root = None
    paths = [Path(vault).parent / "Projects/task-board-events/delivery-receipts" / (event + ".json")]
    if root is not None:
        paths.append(Path(root) / (hashlib.sha256(event.encode()).hexdigest() + ".json"))
    for path in paths:
        try:
            if json.loads(path.read_text()).get("state") in {"sent", "uncertain"}:
                return True
        except (OSError, ValueError, AttributeError):
            pass
    return False


def digest_silence_receipt(vault, event, proof, root=None):
    """A digest ends without a send, and a deferred event enters the digest, only on
    this proof of an intentional silence.

    A silence never replaces the evidence of an earlier send: the dispatcher would
    otherwise close a digest whose report may not have arrived.
    """
    expected = "silent" if "-digest-" in event else "deferred"
    if proof == expected and not receipt_shows_egress(vault, event, root):
        vault_receipt(vault, event, "silent", proof)


async def send_once(adapter, chat_id, content, *, metadata=None, root=None, vault=VAULT):
    """None for unrelated routes. At most one notice and one report per event.

    Persist intent BEFORE egress. Crashes/transport errors stay uncertain: a
    retry must reconcile the receipt and target, not risk a second side effect.
    """
    # Progress/advisory sends share this adapter. Only server-marked final/error
    # sends (including ledger recovery) may consume the event's final receipt.
    if not (metadata or {}).get("_boxp_task_board_final"):
        return None
    ident = identity(chat_id)
    if not ident:
        return None
    from gateway.platforms.base import SendResult
    from gateway.platforms.webhook_delivery import retained_destination
    from gateway.response_filters import is_intentional_silence_response
    event, ticket = ident
    proof = receipt(event, ticket, vault)
    if is_intentional_silence_response(content):
        if proof in {"silent", "deferred", "continued"}:
            digest_silence_receipt(vault, event, proof, root)
            return SendResult(success=True)
        content = notice(event, "missing_reply")
    elif not content.strip():
        content = notice(event, "empty_response")
    elif NOTICE not in content and proof not in {"notified", "question"}:
        # Preserve a potentially necessary report, but do not claim its work succeeded.
        content += "\n\n" + notice(event, "missing_or_conflicting_receipt")
    classification = "unresolved" if NOTICE in content else proof
    try:
        if root is None:
            from hermes_constants import get_hermes_home
            root = get_hermes_home() / "task-board-delivery-receipts"
        root = Path(root)
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        key = hashlib.sha256(event.encode()).hexdigest()
        # A reconciliation notice is not the business report. Its successful
        # delivery must not consume the report's receipt if a later authorized
        # attempt supplies the missing report. Keep the same event-wide lock.
        suffix = ".notice.json" if (content.startswith(NOTICE) or
                                    (metadata or {}).get("_boxp_task_board_notice")) else ".json"
        path = root / (key + suffix)
        with (root / (key + ".lock")).open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return SendResult(success=False, error=f"Delivery in flight; reconcile event={event}")
            quiet = quiet_now(vault)
            # Reconcile before any quiet hold: a hold must not overwrite the evidence of
            # an earlier egress. While quiet, a report's receipt also answers for a notice.
            report = root / (key + ".json")
            for existing in [path] + ([report] if quiet and path != report else []):
                if not existing.exists():
                    continue
                previous = json.loads(existing.read_text())
                if previous.get("state") == "sent" and previous.get("event") == event:
                    vault_receipt(vault, event, "sent", previous.get("classification"))
                    logger.info("task-board duplicate event=%s classification=%s", event, previous.get("classification"))
                    return SendResult(success=True)
                vault_receipt(vault, event, "uncertain", previous.get("classification"))
                return SendResult(success=False, error=f"Delivery uncertain; reconcile event={event}")
            if quiet:
                # The receipt is the only evidence of the hold: without it this is not a success.
                if vault_receipt(vault, event, "quiet-held", classification):
                    return SendResult(success=True)
                return SendResult(success=False, error=f"Quiet hold unrecorded; reconcile event={event}")
            # Resolve the authorized destination before creating any delivery intent.
            delivery = retained_destination(adapter, chat_id)

            def save(state):
                payload = {"event": event, "classification": classification, "state": state,
                           "updated_at": datetime.now(timezone.utc).isoformat()}
                temporary = path.with_suffix(".tmp")
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "w") as stream:
                    json.dump(payload, stream)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, path)
                directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)

            save("intent")
            try:
                sent = await adapter._deliver_to(delivery, chat_id, content)
            except Exception:
                save("uncertain")
                vault_receipt(vault, event, "uncertain", classification)
                logger.warning("task-board delivery event=%s classification=%s state=uncertain", event, classification)
                return SendResult(success=False, error=f"Delivery uncertain; reconcile event={event}")
            save("sent" if sent.success else "uncertain")
            vault_receipt(vault, event, "sent" if sent.success else "uncertain", classification)
            logger.info("task-board delivery event=%s classification=%s state=%s", event, classification,
                        "sent" if sent.success else "uncertain")
            return sent
    except Exception:
        # Never fall through to unguarded egress on corrupt/missing evidence/storage.
        logger.warning("task-board delivery event=%s state=storage_or_destination_error", event)
        return SendResult(success=False, error=f"Receipt/destination unavailable; reconcile event={event}")
