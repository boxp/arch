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
             '                metadata = dict(metadata or {}, _boxp_task_board_final=True)\n'),
        ],
    }
    pending = {}
    for name, replacements in changes.items():
        text = (root / name).read_text()
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
