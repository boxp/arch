"""Best-effort copies of successful Telegram cron deliveries."""
import hashlib
import json
import logging
import os
import re
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)
COPY_DIR = Path('/home/boxp/Documents/obsidian-headless/BOXP/Projects/cron-deliveries/delivered-copies')


def pending_dir():
    from hermes_constants import get_hermes_home
    return get_hermes_home() / 'cron-delivery-copies-pending'


def atomic(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, tmp = tempfile.mkstemp(prefix='.copy-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(payload, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def recover():
    try:
        for path in pending_dir().glob('*.json'):
            try:
                payload = json.loads(path.read_text())
                atomic(COPY_DIR / (payload['id'] + '.md'), payload)
                path.unlink(missing_ok=True)
            except Exception:
                log.warning('cron copy recovery failed')
    except Exception:
        log.warning('cron copy recovery unavailable')


def record(job, content, for_failure, delivery):
    try:
        if job.get('_notification_all_targets_suppressed') or not content or not content.strip():
            return
        if delivery._sched._is_cron_silence_response(content):
            return
        targets = delivery._resolve_delivery_targets(job, for_failure=for_failure)
        if not any(t.get('platform') == 'telegram' for t in targets):
            return
        if for_failure:
            from gateway.warning_notifications import warning_notifications_enabled
            try:
                cfg = delivery._sched.load_config()
            except Exception:
                cfg = None
            if not warning_notifications_enabled('telegram', cfg):
                return
        from gateway.platforms.base import BasePlatformAdapter
        _, text = BasePlatformAdapter.extract_media(content)
        text = delivery._redact_cron_payload(text, 'delivery content')
        if not text.strip():
            return
        job_id = str(job.get('id') or '')
        execution = str(job.get('execution_id') or '')
        key = execution or hashlib.sha256((job_id + text + str(for_failure)).encode()).hexdigest()[:16]
        ident = re.sub(r'[^A-Za-z0-9_.-]', '_', f'cron-{job_id}-{key}') + ('-failure' if for_failure else '')
        payload = {'id': ident, 'job_id': job_id, 'job_name': delivery._redact_cron_payload(str(job.get('name') or job_id), 'job name'), 'no_agent': bool(job.get('no_agent')), 'failure': bool(for_failure), 'execution_id': execution, 'text': text, 'sent_at': datetime.now(timezone.utc).isoformat()}
        try:
            atomic(COPY_DIR / (ident + '.md'), payload)
        except Exception:
            atomic(pending_dir() / (ident + '.json'), payload)
    except Exception:
        log.warning('cron delivered copy unavailable', exc_info=True)


_sent = threading.local()


def _mark_sent(t):
    stack = getattr(_sent, 'stack', None)
    if stack:
        stack[-1].add(str(getattr(t, 'platform_name', '') or '').lower())


def _wrap_live(original):
    def wrapped_live(t, *args, **kwargs):
        delivered = original(t, *args, **kwargs)
        if delivered:
            _mark_sent(t)
        return delivered
    wrapped_live.__name__ = 'wrapped'
    return wrapped_live


def _wrap_standalone(original):
    def wrapped_standalone(t, content, media_files, target_errors, delivery_errors, *args, **kwargs):
        before = len(target_errors)
        result = original(t, content, media_files, target_errors, delivery_errors, *args, **kwargs)
        # Upstream reports a failed standalone send by appending to target_errors (relay fails closed).
        if not getattr(t, 'is_relay', False) and len(target_errors) == before:
            _mark_sent(t)
        return result
    wrapped_standalone.__name__ = 'wrapped'
    return wrapped_standalone


def wrap(original, delivery):
    """Copy when the Telegram target itself was delivered, even if another target failed."""
    for name, factory in (('_deliver_via_live_adapter', _wrap_live), ('_deliver_standalone', _wrap_standalone)):
        current = getattr(delivery, name, None)
        if current is not None and getattr(current, '__name__', '') != 'wrapped':
            setattr(delivery, name, factory(current))

    def wrapped(job, content, adapters=None, loop=None, *, for_failure=False):
        stack = getattr(_sent, 'stack', None)
        if stack is None:
            stack = _sent.stack = []
        stack.append(set())
        try:
            result = original(job, content, adapters, loop, for_failure=for_failure)
        finally:
            sent = stack.pop()
        try:
            if 'telegram' in sent:
                record(job, content, for_failure, delivery)
        except Exception:
            log.warning('cron copy inspection failed', exc_info=True)
        return result
    return wrapped


def start_recovery():
    try:
        interval = int(os.getenv('BOXP_CRON_COPY_RECOVERY_SECONDS', '300'))
    except ValueError:
        interval = 300
    if interval <= 0:
        return
    def run():
        while True:
            recover()
            threading.Event().wait(interval)
    threading.Thread(target=run, name='boxp-cron-copy-recovery', daemon=True).start()

start_recovery()
