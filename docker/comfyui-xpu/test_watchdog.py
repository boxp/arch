import contextlib
import http.server
import importlib.util
import io
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

PATH = Path(__file__).with_name('watchdog.py')
spec = importlib.util.spec_from_file_location('watchdog', PATH)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


class WatchdogTests(unittest.TestCase):
    def setUp(self):
        self.output = io.StringIO()
        self.redirect = contextlib.redirect_stderr(self.output)
        self.redirect.__enter__()

    def tearDown(self):
        self.redirect.__exit__(None, None, None)

    def test_fdinfo(self):
        with tempfile.TemporaryDirectory() as tmp:
            fd = Path(tmp) / '123/fdinfo'
            fd.mkdir(parents=True)
            data = 'drm-client-id:\t1\ndrm-engine-render:\t100 ns\ndrm-engine-capacity-render:\t9\ndrm-engine-copy:\t20 ns\n'
            (fd / '1').write_text(data)
            (fd / '2').write_text(data)
            (fd / '3').write_text('drm-client-id: 2\ndrm-engine-compute: 30 ns\n')
            (fd / '4').symlink_to(fd / 'missing')
            self.assertEqual(w.gpu_time(123, Path(tmp)), 150)
            self.assertIsNone(w.gpu_time(999, Path(tmp)))

    def test_progress_and_stall(self):
        d = w.StallDetector(10, 200)
        q = [[1, 'a']]
        self.assertFalse(d.tick(0, q, 0, 0))
        self.assertFalse(d.tick(9, q, 200_000_000, 100))
        self.assertFalse(d.tick(18, q, 400_000_000, 200))
        self.assertTrue(d.tick(28, q, 400_000_000, 300))
        self.assertIn('stalled prompt a', self.output.getvalue())

    def test_queue_changes_and_failures(self):
        d = w.StallDetector(10, 200)
        a, b = [[1, 'a']], [[2, 'b']]
        d.tick(0, a, 0, 0)
        self.assertFalse(d.tick(20, None, 0, 0))
        self.assertTrue(d.tick(21, a, 0, 0))
        self.assertFalse(d.tick(22, b, 0, 0))
        self.assertFalse(d.tick(30, [], 0, 0))
        self.assertFalse(d.tick(31, b, 0, 0))
        self.assertTrue(d.tick(41, b, 0, 0))

    def test_missing_and_disabled(self):
        d = w.StallDetector(1, 200)
        for now in range(5):
            self.assertFalse(d.tick(now, [[1, 'a']], None, None))
        self.assertEqual(self.output.getvalue().count('warning:'), 1)
        self.assertFalse(d.tick(5, [[1, 'a']], 0, 0))
        self.assertFalse(d.tick(7, [[1, 'a']], None, 0))
        self.assertTrue(d.tick(8, [[1, 'a']], 0, 0))
        d = w.StallDetector(0, 200)
        d.tick(0, [[1, 'a']], 0, 0)
        self.assertFalse(d.tick(10000, [[1, 'a']], 0, 0))

    def test_invalid_settings(self):
        for name in ('POLL_SECONDS', 'MIN_GPU_MS', 'STALL_SECONDS'):
            for value in ('bad', '-1', 'nan', 'inf'):
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    w.settings({'COMFYUI_WATCHDOG_' + name: value})
        with self.assertRaises(ValueError):
            w.settings({'COMFYUI_WATCHDOG_POLL_SECONDS': '0'})


class ProcessTests(unittest.TestCase):
    def test_supervision(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"queue_running": [[1, "test-prompt"]], "queue_pending": []}')
            def log_message(self, *args):
                pass
        server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        env = dict(os.environ, COMFYUI_WATCHDOG_POLL_SECONDS='0.03',
                   COMFYUI_WATCHDOG_STALL_SECONDS='0.12')
        code = ("import importlib.util,sys; "
                f"s=importlib.util.spec_from_file_location('w',{str(PATH)!r}); "
                "w=importlib.util.module_from_spec(s); s.loader.exec_module(w); "
                f"w.queue_running=lambda: w.json.load(w.urlopen('http://127.0.0.1:{server.server_port}/queue',timeout=1))['queue_running']; "
                "w.gpu_time=lambda pid: 0; sys.argv=['watchdog','--']+sys.argv[1:]; sys.exit(w.main())")
        try:
            with tempfile.TemporaryDirectory() as tmp:
                pidfile = Path(tmp) / 'pid'
                child = f'import os,time; open({str(pidfile)!r},"w").write(str(os.getpid())); time.sleep(30)'
                result = subprocess.run([sys.executable, '-c', code, sys.executable, '-c', child], env=env, capture_output=True, timeout=5)
                self.assertEqual(result.returncode, 70, result.stderr)
                with self.assertRaises(ProcessLookupError):
                    os.kill(int(pidfile.read_text()), 0)
                self.assertIn(b'stalled prompt test-prompt', result.stderr)
            result = subprocess.run([sys.executable, '-c', code, sys.executable, '-c', 'import sys; sys.exit(23)'], env=env, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 23)
            proc = subprocess.Popen([sys.executable, '-c', code, sys.executable, '-c', 'import time; time.sleep(30)'], env=env, stderr=subprocess.PIPE)
            time.sleep(0.07)
            proc.send_signal(signal.SIGTERM)
            _, stderr = proc.communicate(timeout=5)
            self.assertEqual(proc.returncode, 128 + signal.SIGTERM, stderr)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
