"""Pad a square generation image (magenta background) to a taller canvas, adding rows on top.

  python tools/art/ai/pad_canvas.py IN.png OUT.png --height 72 [--base 64]
A 1024x1024 image (64-px canvas at 16x) becomes 1024x1152 (64x72 at 16x): the figure keeps its
size and its feet stay at the bottom; the extra 8 px (x16 = 128 px) go above the head, so a raised
bat is not cut off when H3 renders it.
"""
import argparse
from pathlib import Path

from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--height", type=int, default=72, help="target canvas height in sprite pixels")
    ap.add_argument("--base", type=int, default=64, help="source canvas size in sprite pixels")
    ap.add_argument("--bottom", type=int, default=0,
                    help="sprite rows to add BELOW the figure (rest goes on top); e.g. 2 puts feet that were on row 63 onto row 69 of a 72 canvas")
    a = ap.parse_args()
    im = Image.open(a.src).convert("RGB")
    s = im.width // a.base
    out = Image.new("RGB", (im.width, a.height * s), (255, 0, 255))
    out.paste(im, (0, (a.height - a.base - a.bottom) * s))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    out.save(a.out)
    print(f"{im.size} -> {out.size}")


if __name__ == "__main__":
    main()
