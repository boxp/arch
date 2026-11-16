"""Apply the experimental lower-rim removal to a copy of the v11e layout."""
import os
from pathlib import Path
from PIL import Image

layout = Path(os.environ['LAYOUT'])
for side in ('left', 'right'):
    path = layout / f'eye_{side}_lash.png'
    image = Image.open(path).convert('RGBA')
    assert image.size == (150, 100)
    for y in range(67, 76):
        for x in range(150):
            image.putpixel((x, y), (0, 0, 0, 0))
    image.save(path)
