"""Render the three unaligned source mouths at identical scale."""
from pathlib import Path
import sys
from PIL import Image, ImageDraw

gen = Path(sys.argv[1]) / 'Projects/kohako-openamika-ui/live2d/gen'
out = Image.new('RGB', (1200, 380), 'white')
draw = ImageDraw.Draw(out)
for i, name in enumerate(['codex-mouth-closed-v16-1.png', 'codex-mouth-half-v17-1.png', 'codex-mouth-half-v20-1.png']):
    image = Image.open(gen / name).convert('RGB').crop((690, 500, 850, 620)).resize((400, 300))
    out.paste(image, (i * 400, 60))
    draw.text((i * 400 + 10, 20), name, fill='black')
out.save(sys.argv[2], quality=90, optimize=True)
