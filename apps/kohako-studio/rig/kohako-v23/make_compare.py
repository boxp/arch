"""Stack pose sheets of two models (same poses) for side-by-side review; crops hair/shoulder zone."""
import sys
from PIL import Image, ImageDraw
a, b, out, la, lb = sys.argv[1:6]
A = Image.open(a).convert('RGB'); B = Image.open(b).convert('RGB')
w = max(A.width, B.width); h = A.height + B.height + 60
S = Image.new('RGB', (w, h), 'white'); d = ImageDraw.Draw(S)
d.text((8, 8), la, fill='red'); S.paste(A, (0, 30)); d.text((8, A.height + 38), lb, fill='red'); S.paste(B, (0, A.height + 60))
S.save(out, quality=88)
print(out, S.size)
