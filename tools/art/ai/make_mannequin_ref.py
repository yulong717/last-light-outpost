"""Re-proportion a generated mannequin to the M spec (56 px tall, head ~16 px = 3.5 heads) and place it
on a 1024 magenta canvas (16x space: foot row 61 -> bottom edge y=992, centerline x=512).

The figure is cut at the neck row; head and body are scaled separately (LANCZOS, then re-keyed),
so H3 can redraw the result cleanly. Usage:
  python tools/art/ai/make_mannequin_ref.py SRC.png NECK_Y OUT.png [--head 16] [--body-width 1.0] [--head-width 1.0] [--height 56]
NECK_Y is the source-pixel row of the narrowest neck point.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from sprite_utils import FOOT_Y, MID_X, alpha_bounds, key_magenta, torso_center_x  # noqa: E402

S = 16  # 1024 / 64


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", type=Path)
    ap.add_argument("neck_y", type=int)
    ap.add_argument("out", type=Path)
    ap.add_argument("--head", type=float, default=16)
    ap.add_argument("--height", type=float, default=56)
    ap.add_argument("--body-width", type=float, default=1.0, help="extra horizontal scale for the body")
    ap.add_argument("--head-width", type=float, default=1.0, help="extra horizontal scale for the head")
    a = ap.parse_args()

    k = key_magenta(Image.open(a.src))
    l, t, r, b = alpha_bounds(k)
    cx = torso_center_x(k, t, b)
    head = k.crop((0, t, k.width, a.neck_y))
    body = k.crop((0, a.neck_y, k.width, b + 1))

    head_h = a.head * S
    body_h = (a.height - a.head) * S
    hs = head_h / head.height
    bs = body_h / body.height
    head_r = head.resize((round(head.width * hs * a.head_width), round(head_h)), Image.LANCZOS)
    body_r = body.resize((round(body.width * bs * a.body_width), round(body_h)), Image.LANCZOS)

    canvas = Image.new("RGBA", (1024, 1024), (255, 0, 255, 255))
    bottom = (FOOT_Y + 1) * S
    top = bottom - round(head_h) - round(body_h)
    mid = MID_X * S
    canvas.alpha_composite(body_r, (round(mid - cx * bs * a.body_width), top + round(head_h)))
    canvas.alpha_composite(head_r, (round(mid - cx * hs * a.head_width), top))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(a.out)
    print(f"head x{hs:.3f} body x{bs:.3f} top={top} bottom={bottom}")


if __name__ == "__main__":
    main()
