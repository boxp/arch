#!/usr/bin/env python3
"""Backport the webhook route option ``mirror_to_session`` to Hermes v0.18.0.

Upstream Hermes (gateway/platforms/webhook.py on main) supports
``mirror_to_session: true`` on a webhook route: after a successful delivery to
a chat platform the delivered text is also appended to that chat's gateway
session transcript as a labelled USER turn (``[Webhook delivery: <route>]``),
so a follow-up reply in that chat has the context of what the webhook run just
told the user.  The pinned base image (v0.18.0) ships ``gateway.mirror``
(already used by cron ``attach_to_session``) but its webhook adapter never
calls it, so Task Board event notifications (BOXP-270) reached Telegram
without entering the DM conversation context.

This patch inserts the same three pieces as upstream, adapted to the v0.18.0
code shape (no profile scoping in this version):

1. ``_handle_webhook``: carry ``route`` and ``mirror`` in the per-delivery
   info (agent mode and deliver_only mode).
2. ``_deliver_cross_platform``: mirror after ``adapter.send`` succeeded.
3. ``_mirror_delivery``: best-effort helper, never raises, user role.

Default stays off (route must opt in), exactly like upstream.  Run with an
optional path argument to patch a copy of the file (used by local tests).
"""

import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "/opt/hermes/gateway/platforms/webhook.py"

MARKER = "def _mirror_delivery("

# 1a. agent-mode delivery info ------------------------------------------------
OLD_DELIVER_CONFIG = '''        deliver_config = {
            "deliver": route_config.get("deliver", "log"),
            "deliver_extra": self._render_delivery_extra(
                route_config.get("deliver_extra", {}), payload
            ),
        }
        self._delivery_info[session_chat_id] = deliver_config
'''
NEW_DELIVER_CONFIG = '''        deliver_config = {
            "deliver": route_config.get("deliver", "log"),
            "deliver_extra": self._render_delivery_extra(
                route_config.get("deliver_extra", {}), payload
            ),
            # BOXP-270 backport of upstream ``mirror_to_session``.
            "route": route_name,
            "mirror": route_config.get("mirror_to_session") is True,
        }
        self._delivery_info[session_chat_id] = deliver_config
'''

# 1b. deliver_only delivery info ---------------------------------------------
OLD_DIRECT_CONFIG = '''            delivery = {
                "deliver": route_config.get("deliver", "log"),
                "deliver_extra": self._render_delivery_extra(
                    route_config.get("deliver_extra", {}), payload
                ),
                "payload": payload,
            }
'''
NEW_DIRECT_CONFIG = '''            delivery = {
                "deliver": route_config.get("deliver", "log"),
                "deliver_extra": self._render_delivery_extra(
                    route_config.get("deliver_extra", {}), payload
                ),
                "payload": payload,
                # BOXP-270 backport of upstream ``mirror_to_session``.
                "route": route_name,
                "mirror": route_config.get("mirror_to_session") is True,
            }
'''

# 2. mirror after a successful cross-platform send ----------------------------
OLD_SEND = '''        return await adapter.send(chat_id, content, metadata=metadata)
'''
NEW_SEND = '''        result = await adapter.send(chat_id, content, metadata=metadata)
        if result.success:
            self._mirror_delivery(
                platform_name, str(chat_id), content, delivery, thread_id
            )
        return result

    def _mirror_delivery(
        self,
        platform_name: str,
        chat_id: str,
        content: str,
        delivery: dict,
        thread_id: Optional[str],
    ) -> None:
        """Best-effort mirror of a delivered response into the TARGET chat's
        session transcript (BOXP-270 backport of upstream ``mirror_to_session``).

        Same path and USER-role convention as cron ``attach_to_session``
        (``cron.scheduler._maybe_mirror_cron_delivery``): the text is not the
        target session's agent speaking, and a labelled user turn merges safely
        on strict-alternation providers.  Opt-in per route
        (``mirror_to_session: true``), default off.  Never raises — a delivered
        message must not be reported failed because the mirror broke.
        """
        if delivery.get("mirror") is not True:
            return
        route = delivery.get("route") or "webhook"
        try:
            from gateway.mirror import mirror_to_session

            ok = mirror_to_session(
                platform_name,
                chat_id,
                f"[Webhook delivery: {route}]\\n{content}",
                source_label="webhook",
                thread_id=thread_id,
                role="user",
            )
            logger.log(
                logging.INFO if ok else logging.DEBUG,
                "[webhook] Route '%s' delivery %smirrored into %s:%s session",
                route,
                "" if ok else "not ",
                platform_name,
                chat_id,
            )
        except Exception as e:
            logger.debug(
                "[webhook] Route '%s' delivery mirror into %s:%s failed: %s",
                route,
                platform_name,
                chat_id,
                e,
            )
'''

REPLACEMENTS = [
    ("delivery info (agent mode)", OLD_DELIVER_CONFIG, NEW_DELIVER_CONFIG),
    ("delivery info (deliver_only)", OLD_DIRECT_CONFIG, NEW_DIRECT_CONFIG),
    ("cross-platform send + _mirror_delivery", OLD_SEND, NEW_SEND),
]


def main() -> int:
    src = open(PATH, encoding="utf-8").read()
    if MARKER in src:
        print(f"{PATH}: mirror_to_session already present; nothing to do.")
        return 0
    for label, old, new in REPLACEMENTS:
        if src.count(old) != 1:
            print(
                f"ERROR: expected exactly one match for '{label}' in {PATH} "
                f"(found {src.count(old)}) — base image may have changed; "
                "update this patch.",
                file=sys.stderr,
            )
            return 1
    for _label, old, new in REPLACEMENTS:
        src = src.replace(old, new, 1)
    open(PATH, "w", encoding="utf-8").write(src)
    print(f"Patched {PATH}: webhook route option mirror_to_session backported.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
