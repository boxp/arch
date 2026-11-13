"""Read-only image transport for Kohako Home; never accepts a filesystem root."""
import base64
import os
import stat
from pathlib import PurePosixPath

MAX_BYTES = 5 * 1024 * 1024
MIMES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp'}


def read_image(root, relative):
    if not root or not isinstance(relative, str) or len(relative) > 1500 or '\\' in relative or any(ord(c) < 32 for c in relative):
        raise ValueError('invalid_path')
    parts = relative.split('/')
    if not parts or any(not p or p.startswith('.') for p in parts) or PurePosixPath(relative).is_absolute():
        raise ValueError('invalid_path')
    mime = MIMES.get(PurePosixPath(relative).suffix.lower())
    if not mime:
        raise ValueError('unsupported_type')
    # Directory descriptors pin each component; concurrent symlink substitution
    # cannot redirect this read outside the configured vault.
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        image_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        with os.fdopen(image_fd, 'rb') as f:
            meta = os.fstat(f.fileno())
            if not stat.S_ISREG(meta.st_mode):
                raise ValueError('invalid_file')
            if meta.st_size > MAX_BYTES:
                raise ValueError('too_large')
            data = f.read(MAX_BYTES + 1)
    finally:
        os.close(fd)
    if len(data) > MAX_BYTES:
        raise ValueError('too_large')
    detected = ('image/png' if data.startswith(b'\x89PNG\r\n\x1a\n') else
                'image/jpeg' if data.startswith(b'\xff\xd8\xff') else
                'image/gif' if data[:6] in (b'GIF87a', b'GIF89a') else
                'image/webp' if data[:4] == b'RIFF' and data[8:12] == b'WEBP' else None)
    if detected != mime:
        raise ValueError('unsupported_type')
    return {'mime': mime, 'data': base64.b64encode(data).decode('ascii')}


async def handle(adapter, request):
    import asyncio
    from aiohttp import web
    # Runs/session delegated credentials must not become vault read credentials.
    error = adapter._check_auth(request)
    if error is not None:
        return error
    if not adapter._api_key:
        return web.json_response({'error': 'forbidden'}, status=403)
    try:
        result = await asyncio.to_thread(read_image, os.getenv('OBSIDIAN_VAULT_PATH'), request.query.get('path'))
        return web.json_response(result, headers={'Cache-Control': 'no-store'})
    except (ValueError, OSError):
        return web.json_response({'error': 'image_unavailable'}, status=404, headers={'Cache-Control': 'no-store'})
