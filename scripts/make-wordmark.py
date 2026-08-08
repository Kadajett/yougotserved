"""
Wordmark: lowercase "ygs" in red, heavy sans, on the tan ground.

The hard part is 16 pixels. Three lowercase letters with two descenders turn to
mush at that size, so the type is set as large as the tile allows, the tracking
is tight, and the optical centre accounts for the descenders rather than the
bounding box. Variants differ only in how far that is pushed.
"""
from PIL import Image, ImageDraw, ImageFont
import pathlib

TAN = (228, 216, 195, 255)
RED = (179, 39, 30, 255)
WHITE = (255, 255, 255, 255)

S = 512
OUT = pathlib.Path(__file__).parent
BLACK_TTF = '/usr/share/fonts/truetype/lato/Lato-Black.ttf'
HEAVY_TTF = '/usr/share/fonts/truetype/lato/Lato-Heavy.ttf'


def draw_mark(name, bg, fg, ttf, size_frac, tracking, radius_frac=0.20, text='ygs'):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, S, S), radius=S * radius_frac, fill=bg)

    font = ImageFont.truetype(ttf, int(S * size_frac))

    # Measure each glyph so the tracking can be applied by hand. Pillow has no
    # letter-spacing, and the default spacing is loose for a three letter mark.
    widths = [d.textlength(ch, font=font) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)

    # Vertical placement uses the ink box of the whole word, which includes the
    # descenders of y and g. Centring on the font's line box instead leaves the
    # mark sitting visibly high.
    box = d.textbbox((0, 0), text, font=font)
    ink_h = box[3] - box[1]
    y = (S - ink_h) / 2 - box[1]

    x = (S - total) / 2
    for ch, w in zip(text, widths):
        d.text((x, y), ch, font=font, fill=fg)
        x += w + tracking

    img.save(OUT / f'{name}.png')
    return name


made = [
    draw_mark('wm-a', TAN, RED, BLACK_TTF, 0.62, -S * 0.012),
    draw_mark('wm-b', TAN, RED, BLACK_TTF, 0.72, -S * 0.030),
    draw_mark('wm-c', WHITE, RED, BLACK_TTF, 0.72, -S * 0.030),
    draw_mark('wm-d', TAN, RED, HEAVY_TTF, 0.72, -S * 0.022),
]
print('\n'.join(made))
