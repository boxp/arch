"""Fail closed if the pinned cron delivery integration changes."""
import py_compile
import sys
from pathlib import Path


def main(root):
    path = root / 'cron/scheduler_delivery.py'
    text = path.read_text()
    anchor = '\n\n# Late-bound origin namespace (see module docstring). Imported LAST'
    replacement = ('\n\nfrom cron.boxp_cron_delivery import wrap as _boxp_cron_wrap\n'
                   'import sys as _boxp_sys\n'
                   '_deliver_result = _boxp_cron_wrap(_deliver_result, _boxp_sys.modules[__name__])\n' + anchor)
    if replacement not in text:
        if text.count(anchor) != 1 or text.count('def _deliver_result(') != 1 or text.count('external_execution = os.environ.get("_HERMES_CRON_EXTERNAL_WORKER", "")') != 1:
            raise RuntimeError('BOXP-501 cron delivery anchor mismatch')
        text = text.replace(anchor, replacement, 1)
    compile(text, str(path), 'exec')
    path.write_text(text)
    target = root / 'cron/boxp_cron_delivery.py'
    target.write_text(Path(__file__).with_name('boxp_cron_delivery.py').read_text())
    py_compile.compile(str(target), doraise=True)

if __name__ == '__main__':
    main(Path(sys.argv[1] if len(sys.argv) > 1 else '/opt/hermes'))
