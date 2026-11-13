import os
import tempfile
import unittest
from pathlib import Path
from boxp_vault_image import read_image, MAX_BYTES


class VaultImages(unittest.TestCase):
    def test_regular_image_and_boundary_rejections(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as outside:
            root = Path(d)
            (root / 'attachments').mkdir()
            (root / 'attachments/案 1.png').write_bytes(b'\x89PNG\r\n\x1a\nfixture')
            self.assertEqual(read_image(d, 'attachments/案 1.png')['mime'], 'image/png')
            (Path(outside) / 'secret.png').write_bytes(b'\x89PNG\r\n\x1a\nprivate')
            (root / 'escape').symlink_to(outside)
            (root / 'link.png').symlink_to(Path(outside) / 'secret.png')
            (root / '.secret.png').write_bytes(b'\x89PNG\r\n\x1a\nprivate')
            (root / 'fake.png').write_bytes(b'<html>secret</html>')
            (root / 'fake.jpg').write_bytes(b'\x89PNG\r\n\x1a\nfixture')
            (root / 'large.png').write_bytes(b'\x89PNG\r\n\x1a\n' + b'X' * MAX_BYTES)
            os.mkfifo(root / 'pipe.png')
            for path in ('../secret.png', '/secret.png', 'attachments//案 1.png', 'attachments/../fake.png', '.secret.png', 'escape/secret.png', 'link.png', 'fake.png', 'fake.jpg', 'large.png', 'pipe.png', 'x.svg', 'a\\b.png', 'a\x00.png'):
                with self.subTest(path=path), self.assertRaises((ValueError, OSError)):
                    read_image(d, path)
            with self.assertRaises((ValueError, OSError)):
                read_image('', 'attachments/案 1.png')

    def test_signature_formats(self):
        with tempfile.TemporaryDirectory() as d:
            for name, data, mime in [('a.jpg', b'\xff\xd8\xffx', 'image/jpeg'), ('a.gif', b'GIF89ax', 'image/gif'), ('a.webp', b'RIFF0000WEBPx', 'image/webp')]:
                Path(d, name).write_bytes(data)
                self.assertEqual(read_image(d, name)['mime'], mime)
