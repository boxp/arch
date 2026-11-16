import sys
from PIL import Image, ImageDraw
a, b, out = sys.argv[1:4]
A = Image.open(a).convert('RGB'); B = Image.open(b).convert('RGB')
cw, ch = A.width // 3, A.height // 3
labels = 'ABCDEFGHI'
cells = [1, 2, 3, 4, 6, 8]  # B C D E G I
tiles = []
for i in cells:
    r, c = divmod(i, 3)
    box = (c * cw, r * ch + int(ch * 0.30), (c + 1) * cw, r * ch + int(ch * 0.95))  # shoulders/hair zone
    tiles.append((labels[i], A.crop(box), B.crop(box)))
tw, th = tiles[0][1].size
S = Image.new('RGB', (tw * 2 + 10, (th + 20) * len(tiles)), 'white'); d = ImageDraw.Draw(S)
for k, (l, ta, tb) in enumerate(tiles):
    y = k * (th + 20)
    d.text((4, y + 4), f'{l} v17', fill='red'); d.text((tw + 14, y + 4), f'{l} v23', fill='red')
    S.paste(ta, (0, y + 18)); S.paste(tb, (tw + 10, y + 18))
S.save(out, quality=90); print(S.size)
