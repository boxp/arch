"""Build-time integration; fail closed when the reviewed upstream anchor changes."""
from pathlib import Path
import shutil

root = Path('/opt/hermes/gateway/platforms')
p = root / 'api_server.py'
src = p.read_text()
anchor = '            # Registered LAST so every native mirror above wins:'
if src.count(anchor) != 1:
    raise SystemExit('vault image route anchor mismatch')
addition = '''            # BOXP-542: server-key authenticated vault images, no profile mirrors.
            from gateway.platforms.boxp_vault_image import handle as vault_image
            self._app.router.add_get('/v1/kohako/vault-image', lambda request: vault_image(self, request))
'''
p.write_text(src.replace(anchor, addition + anchor))
shutil.copyfile(Path(__file__).with_name('boxp_vault_image.py'), root / 'boxp_vault_image.py')
