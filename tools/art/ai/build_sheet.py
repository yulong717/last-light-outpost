"""Build final outputs for one action (TEST_SPEC §6 step 7).

  python tools/art/ai/build_sheet.py DIR --name walk --fps 10 --loop --out art/ai/out/B/akai [--meta m.json]

Reads DIR/00.png.. (64x64 RGBA) and writes into OUT:
  <name>.png           horizontal strip, 64x64 per frame
  <name>.json          {frameWidth, frameHeight, frames, fps, loop}
  contact_<name>.png   4x, with foot line / centerline / M head line, frame numbers
  <name>.gif           4x preview on a neutral background
and merges --meta (JSON) into OUT/meta.json under key <name>.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from sprite_utils import CANVAS, FOOT_Y, M_HEIGHT, MID_X  # noqa: E402

BG = (58, 62, 74)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", type=Path)
    ap.add_argument("--name", required=True)
    ap.add_argument("--fps", type=int, required=True)
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--zoom", type=int, default=4)
    ap.add_argument("--meta", type=Path)
    a = ap.parse_args()

    frames = [Image.open(p).convert("RGBA") for p in sorted(a.dir.glob("[0-9][0-9].png"))]
    n, z = len(frames), a.zoom
    a.out.mkdir(parents=True, exist_ok=True)

    strip = Image.new("RGBA", (CANVAS * n, CANVAS), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        strip.paste(f, (i * CANVAS, 0))
    strip.save(a.out / f"{a.name}.png")
    (a.out / f"{a.name}.json").write_text(json.dumps(
        {"frameWidth": CANVAS, "frameHeight": CANVAS, "frames": n, "fps": a.fps, "loop": a.loop}, indent=1),
        encoding="utf-8")

    cell = CANVAS * z
    sheet = Image.new("RGB", (cell * n, cell + 16), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    for i, f in enumerate(frames):
        bg = Image.new("RGBA", f.size, BG + (255,))
        bg.alpha_composite(f)
        tile = bg.convert("RGB").resize((cell, cell), Image.NEAREST)
        td = ImageDraw.Draw(tile)
        fy = (FOOT_Y + 1) * z - 1
        td.line([(0, fy), (cell, fy)], fill=(0, 255, 0))
        td.line([(MID_X * z, 0), (MID_X * z, cell)], fill=(0, 128, 255))
        hy = (FOOT_Y - M_HEIGHT + 1) * z
        td.line([(0, hy), (cell, hy)], fill=(255, 255, 255))
        sheet.paste(tile, (i * cell, 16))
        d.text((i * cell + 3, 2), str(i), fill="white")
        if i:
            d.line([(i * cell, 0), (i * cell, cell + 16)], fill=(90, 90, 90))
    sheet.save(a.out / f"contact_{a.name}.png")

    gif = []
    for f in frames:
        bg = Image.new("RGBA", f.size, BG + (255,))
        bg.alpha_composite(f)
        gif.append(bg.convert("RGB").resize((cell, cell), Image.NEAREST))
    gif[0].save(a.out / f"{a.name}.gif", save_all=True, append_images=gif[1:],
                duration=round(1000 / a.fps), loop=0 if a.loop else 1, disposal=1)

    meta_path = a.out / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    entry = json.loads(a.meta.read_text(encoding="utf-8")) if a.meta else {}
    cols = set()
    for f in frames:
        arr = np.array(f).reshape(-1, 4)
        cols |= {tuple(c) for c in arr[arr[:, 3] > 0][:, :3].tolist()}
    feet = []
    for f in frames:
        al = np.array(f)[..., 3] > 0
        ys = np.where(al.any(1))[0]
        feet.append(int(ys.max()) if len(ys) else None)
    entry.update({"frames": n, "fps": a.fps, "loop": a.loop, "colours": len(cols), "foot_rows": feet})
    meta[a.name] = entry
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"name": a.name, "frames": n, "colours": len(cols), "foot_rows": feet}))


if __name__ == "__main__":
    main()
