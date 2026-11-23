"""Deliverables for docs/ai-art/ZOMBIE_REACT.md (zombie hit / knockback / get-up sheet).

  python tools/art/ai/build_react.py FRAMES_DIR --out art/ai/out/zombie_basic --meta meta_in.json

Writes react.png (11 x 64x64 strip), contact_react.png (4x, magenta, frame numbers, foot line y=62),
react.gif (3x, 12 fps, plays once then holds 0.5 s), react_regions.png (classify() map:
shirt white / pants blue / skin green / outline black / other grey, 4x), meta.json.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
LABELS = ["hit", "hit", "hit", "air", "air", "land", "land", "getup", "getup", "getup", "getup"]
FOOT = 62
REGION_RGB = {"shirt": (255, 255, 255), "pants": (40, 90, 230), "skin": (40, 190, 60),
              "outline": (0, 0, 0), "other": (150, 150, 150)}


def load_classify():
    spec = importlib.util.spec_from_file_location("mzv", ROOT / "tools/art/make_zombie_variants.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.classify


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--meta", type=Path)
    a = ap.parse_args()
    frames = [Image.open(p).convert("RGBA") for p in sorted(a.dir.glob("[0-9][0-9].png"))]
    n = len(frames)
    a.out.mkdir(parents=True, exist_ok=True)

    strip = Image.new("RGBA", (64 * n, 64), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        strip.paste(f, (i * 64, 0))
    strip.save(a.out / "react.png")

    z = 4
    sheet = Image.new("RGB", (64 * z * n, 64 * z + 18), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    for i, f in enumerate(frames):
        bg = Image.new("RGBA", f.size, (255, 0, 255, 255))
        bg.alpha_composite(f)
        tile = bg.convert("RGB").resize((64 * z, 64 * z), Image.NEAREST)
        ImageDraw.Draw(tile).line([(0, (FOOT + 1) * z - 1), (64 * z, (FOOT + 1) * z - 1)], fill=(0, 255, 0))
        sheet.paste(tile, (i * 64 * z, 0))
        d.text((i * 64 * z + 4, 64 * z + 3), f"{i} {LABELS[i] if i < len(LABELS) else ''}", fill="white")
    sheet.save(a.out / "contact_react.png")

    g = 3
    gif = []
    for f in frames:
        bg = Image.new("RGBA", f.size, (58, 62, 74, 255))
        bg.alpha_composite(f)
        gif.append(bg.convert("RGB").resize((64 * g, 64 * g), Image.NEAREST))
    durations = [round(1000 / 12)] * (n - 1) + [round(1000 / 12) + 500]
    # loop=None -> no NETSCAPE loop block: browsers play it once and stop on the last frame
    gif[0].save(a.out / "react.gif", save_all=True, append_images=gif[1:], duration=durations, disposal=1)

    classify = load_classify()
    reg = Image.new("RGB", (64 * z * n, 64 * z), (255, 0, 255))
    counts = {}
    for i, f in enumerate(frames):
        arr = np.array(f)
        out = np.zeros((64, 64, 3), np.uint8)
        out[:] = (255, 0, 255)
        c = {}
        for y in range(64):
            for x in range(64):
                if arr[y, x, 3]:
                    part = classify(int(arr[y, x, 0]), int(arr[y, x, 1]), int(arr[y, x, 2]))
                    out[y, x] = REGION_RGB[part]
                    c[part] = c.get(part, 0) + 1
        counts[i] = c
        reg.paste(Image.fromarray(out).resize((64 * z, 64 * z), Image.NEAREST), (i * 64 * z, 0))
    reg.save(a.out / "react_regions.png")

    pal = {tuple(p) for p in np.array(Image.open(ROOT / "art/ai/refs/zombie_basic_palette.png").convert("RGB")).reshape(-1, 3)}
    used = set()
    for f in frames:
        arr = np.array(f).reshape(-1, 4)
        used |= {tuple(p) for p in arr[arr[:, 3] > 0][:, :3]}
    meta = json.loads(a.meta.read_text(encoding="utf-8")) if a.meta else {}
    bounds = []
    for f in frames:
        ys, xs = np.where(np.array(f)[..., 3] > 0)
        bounds.append([int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())])
    meta.update({"frames": n, "frame_size": [64, 64], "labels": LABELS[:n], "bounds_xyxy": bounds,
                 "colours_used": len(used), "colours_outside_palette": len(used - pal),
                 "region_pixel_counts": counts})
    (a.out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"frames": n, "colours_used": len(used), "outside_palette": len(used - pal)}))


if __name__ == "__main__":
    main()
