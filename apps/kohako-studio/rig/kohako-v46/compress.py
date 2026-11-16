"""Keep downloadable review sheets near 2 MB while retaining all frames."""
import io,sys
from pathlib import Path
from PIL import Image
for arg in sys.argv[1:]:
 path=Path(arg); im=Image.open(path).convert('RGB')
 for quality in (85,75,65,55,45):
  buf=io.BytesIO(); im.save(buf,format='JPEG',quality=quality,optimize=True)
  if buf.tell() <= 2_000_000: break
 path.write_bytes(buf.getvalue())
 print(path,buf.tell(),quality)
