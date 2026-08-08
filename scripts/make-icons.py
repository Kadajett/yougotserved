#!/usr/bin/env python3
"""
Makes the extension icon set from one source image.

Every icon in the package was the same 796 by 796 file under five names, so the
16 pixel toolbar icon was a 205 kB image that Chrome scaled down at draw time.
That is about 1 MB of the package for one picture.

    python3 scripts/make-icons.py <source.png>

Run it again when the artwork changes.
"""
import sys
import pathlib
from PIL import Image

SIZES = [16, 32, 48, 96, 128]
OUT = pathlib.Path('app/chrome-extension/public/icon')


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__.strip())
        return 2

    source = pathlib.Path(sys.argv[1])
    image = Image.open(source).convert('RGBA')

    # 16 and 32 get their own cut when one is supplied, named <source>-small.
    # Rounded corners and margin cost real letter area at 16 pixels, so the
    # small file drops both. Chrome allows different art for each size.
    small_path = source.with_name(source.stem + '-small' + source.suffix)
    small = Image.open(small_path).convert('RGBA') if small_path.exists() else None
    if small:
        print(f'small sizes from {small_path.name}')

    OUT.mkdir(parents=True, exist_ok=True)

    total = 0
    for size in SIZES:
        # LANCZOS, because the small sizes are a heavy reduction and nearest
        # neighbour drops whole features of the drawing at 16 pixels.
        art = small if (small and size <= 32) else image
        resized = art.resize((size, size), Image.LANCZOS)
        target = OUT / f'{size}.png'
        resized.save(target, 'PNG', optimize=True)
        written = target.stat().st_size
        total += written
        print(f'  {size:>3}x{size:<3}  {written / 1024:6.1f} kB  {target}')

    print(f'\nicon set: {total / 1024:.1f} kB total')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
