"""Fail-closed build-time patch for the pinned Hermes v0.22.5 adapter/shaper."""
import py_compile
import sys
from pathlib import Path


def main(root):
    changes = {
        "gateway/run_turn_persistence.py": [
            ('        _intentional_silence = self._is_intentional_silence(agent_result, response)\n',
             '        _intentional_silence = self._is_intentional_silence(agent_result, response)\n'
             '        from gateway.boxp_task_board_delivery import shape as _boxp_shape\n'
             '        response, _boxp_proven_silence = _boxp_shape(\n'
             '            source, agent_result, response, _intentional_silence)\n'
             '        _intentional_silence = self._is_intentional_silence(agent_result, response)\n'),
            ('if _intentional_silence and not silence_allowed(_silence_kind, _silence_reply_expected):',
             'if _intentional_silence and not (_boxp_proven_silence or silence_allowed(_silence_kind, _silence_reply_expected)):'),
        ],
        "gateway/run_turn.py": [
            ('        """Platform stream consumer for the proxy path when streaming is enabled, else ``None``."""\n',
             '        """Platform stream consumer for the proxy path when streaming is enabled, else ``None``."""\n'
             '        from gateway.boxp_task_board_delivery import is_task_board_source\n'
             '        if is_task_board_source(source):\n'
             '            return None\n'),
            ('        # Same silence predicate as the normal path, else this branch leaks the literal marker.\n',
             '        from gateway.boxp_task_board_delivery import identity as _boxp_identity, shape as _boxp_shape\n'
             '        _boxp_queued = (getattr(getattr(turn_ctx.source, "platform", None), "value", None) == "webhook"\n'
             '                        and _boxp_identity(turn_ctx.source.chat_id) is not None)\n'
             '        _boxp_proven_silence = False\n'
             '        if _boxp_queued:\n'
             '            first_response, _boxp_proven_silence = _boxp_shape(\n'
             '                turn_ctx.source, _delivery_result, first_response,\n'
             '                self._is_intentional_silence(_delivery_result, first_response))\n'
             '        # Same silence predicate as the normal path, else this branch leaks the literal marker.\n'),
            ('            if silence_allowed(turn_ctx.persist_user_display_kind, turn_ctx.reply_expected):',
             '            if _boxp_proven_silence or silence_allowed(turn_ctx.persist_user_display_kind, turn_ctx.reply_expected):'),
            ('                    metadata=turn_ctx._status_thread_metadata, event_message_id=turn_ctx.event_message_id,',
             '                    metadata=(dict(turn_ctx._status_thread_metadata or {}, _boxp_task_board_final=True,\n'
             '                                   ) if _boxp_queued\n'
             '                              else turn_ctx._status_thread_metadata), event_message_id=turn_ctx.event_message_id,'),
        ],
        "gateway/run_turn_runner.py": [
            ('        ctx = self._ctx\n        if ctx.mute_notification_reply:\n',
             '        ctx = self._ctx\n'
             '        from gateway.boxp_task_board_delivery import is_task_board_source\n'
             '        if is_task_board_source(ctx.source):\n'
             '            return None, None, None, False\n'
             '        if ctx.mute_notification_reply:\n'),
        ],
        "gateway/platforms/webhook.py": [
            ('    async def send(self, chat_id: str, content: str, reply_to: Optional[str] = None,',
             '    async def _send_final_text(self, event, session_key, text_content, metadata,\n'
             '                               is_ephemeral_response, ephemeral_ttl, record_delivery):\n'
             '        metadata = dict(metadata or {}, _boxp_task_board_final=True)\n'
             '        return await super()._send_final_text(\n'
             '            event, session_key, text_content, metadata,\n'
             '            is_ephemeral_response, ephemeral_ttl, record_delivery)\n\n'
             '    async def _notify_turn_error(self, event, error):\n'
             '        from gateway.boxp_task_board_delivery import identity, notice\n'
             '        ident = identity(event.source.chat_id)\n'
             '        if ident is None:\n'
             '            return await super()._notify_turn_error(event, error)\n'
             '        metadata = {"_boxp_task_board_final": True}\n'
             '        try:\n'
             '            result = await self.send(event.source.chat_id, notice(ident[0], "turn_exception"), metadata=metadata)\n'
             '            if not result.success:\n'
             '                logger.warning("task-board exception notice undelivered event=%s recovery=reconcile_receipt_and_destination", ident[0])\n'
             '        except Exception:\n'
             '            logger.warning("task-board exception notice unavailable event=%s", ident[0])\n'
             '        return metadata\n\n'
             '    async def send(self, chat_id: str, content: str, reply_to: Optional[str] = None,'),
            ('        # Autonomous lane (no human reader):',
             '        from gateway.boxp_task_board_delivery import send_once as _boxp_send_once\n'
             '        _boxp_result = await _boxp_send_once(self, chat_id, content, metadata=metadata)\n'
             '        if _boxp_result is not None:\n'
             '            return _boxp_result\n'
             '        # Autonomous lane (no human reader):'),
        ],
        "gateway/run_startup.py": [
            ('        if is_intentional_silence_response(last["content"]):\n',
             '        if is_intentional_silence_response(last["content"]):\n'
             '            from gateway.boxp_task_board_delivery import recovered_marker\n'
             '            _boxp_recovered = recovered_marker(origin, last["content"])\n'
             '            if _boxp_recovered is not None:\n'
             '                return _boxp_recovered\n'),
            ('            metadata = {"thread_id": row["thread_id"]} if row.get("thread_id") else None\n',
             '            metadata = {"thread_id": row["thread_id"]} if row.get("thread_id") else None\n'
             '            if row.get("platform") == "webhook":\n'
             '                from gateway.boxp_task_board_delivery import NOTICE\n'
             '                metadata = dict(metadata or {}, _boxp_task_board_final=True,\n'
             '                                _boxp_task_board_notice=row["content"].startswith(NOTICE))\n'),
        ],
    }
    pending = {}
    for name, replacements in changes.items():
        text = (root / name).read_text()
        if name == "gateway/run_turn.py":
            # Upgrade the previous queued patch without discarding confirmed delivery.
            previous = ("                self._is_intentional_silence(_delivery_result, first_response))\n"
                        "            _already_streamed = False\n")
            text = text.replace(previous, previous.replace("            _already_streamed = False\n", ""), 1)
        if name == "gateway/run_startup.py":
            previous = ('            if row.get("platform") == "webhook":\n'
                        '                metadata = dict(metadata or {}, _boxp_task_board_final=True)\n')
            text = text.replace(previous, "", 1)
        for old, new in replacements:
            if new in text:
                continue
            if text.count(old) != 1:
                raise RuntimeError(f"BOXP-373 anchor mismatch: {name}; review changed upstream before building")
            text = text.replace(old, new, 1)
        compile(text, name, "exec")
        pending[root / name] = text
    for path, text in pending.items():
        path.write_text(text)
    target = root / "gateway/boxp_task_board_delivery.py"
    target.write_text(Path(__file__).with_name("boxp_task_board_delivery.py").read_text())
    py_compile.compile(str(target), doraise=True)


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "/opt/hermes"))
