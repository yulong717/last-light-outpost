"""Key magenta, scale and align a generated figure onto the 64-px canvas spec.

Usage:
  python tools/art/ai/normalize_pose.py IN.png OUT_BASENAME [--height 56] [--scale S]
      [--center-from torso|bbox|X] [--foot-from bottom|Y]

Writes OUT_BASENAME_512.png (8x, RGBA), OUT_BASENAME_64.png (k-centroid, RGBA), and prints the
scale used. By default the figure is scaled so its opaque height equals --height px (stand pose).
For other poses pass --scale (from the stand pose of the same set) so every frame shares one scale.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from sprite_utils import (M_HEIGHT, SCALE, alpha_bounds, k_centroid, key_magenta, place, save,  # noqa: E402
                          torso_center_x)


def normalize(src: Image.Image, height_px: float | None, scale: float | None,
              center_from: str = "torso", foot_from: str = "bottom"):
    keyed = key_magenta(src)
    l, t, r, b = alpha_bounds(keyed)
    if scale is None:
        scale = (height_px * SCALE) / (b - t + 1)
    if center_from == "torso":
        cx = torso_center_x(keyed, t, b)
    elif center_from == "bbox":
        cx = (l + r) / 2
    else:
        cx = float(center_from)
    foot = b + 1 if foot_from == "bottom" else float(foot_from)
    img512 = place(keyed, scale, foot, cx)
    img64 = k_centroid(img512)
    return img512, img64, {"scale": scale, "src_bounds": [l, t, r, b], "center_x": cx, "foot_y": foot}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", type=Path)
    ap.add_argument("out", type=str)
    ap.add_argument("--height", type=float, default=M_HEIGHT)
    ap.add_argument("--scale", type=float, default=None)
    ap.add_argument("--center-from", default="torso")
    ap.add_argument("--foot-from", default="bottom")
    a = ap.parse_args()
    img512, img64, info = normalize(Image.open(a.src), a.height, a.scale, a.center_from, a.foot_from)
    save(img512, f"{a.out}_512.png")
    save(img64, f"{a.out}_64.png")
    print(json.dumps(info))


if __name__ == "__main__":
    main()
