"""Round 14 small fixes on the M fog zombie (round 13 leftovers), then rebuild zombie_basic_26.

  python tools/art/ai/fix_zombie_m14.py

1. attack frame 1: grey-green neck / collar pixels on the left shoulder are skin-region. 2. react frame 4 (getup 0,
lying): skin-coloured folds inside the shirt, and shirt-coloured highlights on the head.
Rule (torso mask): the torso is the convex hull of the largest shirt piece. Skin pixels inside that hull and outside
the head box become the nearest shirt colour of the frame's palette (same lightness order); shirt pixels inside the
head box become the nearest skin colour. Only these two frames are touched; colours stay within the walk's 16.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1]))
import build_zombie9 as z9  # noqa: E402
import build_zombie10 as z10  # noqa: E402
import build_zombie12 as z12  # noqa: E402

ROOT = z9.ROOT
OUT = ROOT / "art/ai/out/zombie_m"
RAW = ROOT / "art/ai/raw/zombie12"
PY = z9.PY


def frames_of(p):
    st = Image.open(p).convert("RGBA")
    return [st.crop((64 * i, 0, 64 * i + 64, 64)) for i in range(st.width // 64)]


def regions(a):
    reg = np.full(a.shape[:2], "", dtype=object)
    for y, x in zip(*np.where(a[..., 3] > 0)):
        reg[y, x] = z9.region_of(a[y, x])
    return reg


def hull_mask(m: np.ndarray) -> np.ndarray:
    from scipy.spatial import ConvexHull, Delaunay
    pts = np.argwhere(m)
    h = Delaunay(pts[ConvexHull(pts).vertices])
    grid = np.argwhere(np.ones_like(m))
    return (h.find_simplex(grid) >= 0).reshape(m.shape)


def torso_fix(img: Image.Image, head_box: tuple[int, int, int, int], walk_cols: np.ndarray,
              behind_head: bool = False) -> tuple[Image.Image, int]:
    from scipy import ndimage
    a = np.array(img.convert("RGBA"))
    reg = regions(a)
    lab, n = ndimage.label(reg == "shirt", structure=np.ones((3, 3)))
    big = lab == (np.argmax(ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))) + 1)
    torso = hull_mask(big)
    x0, y0, x1, y1 = head_box
    hb = np.zeros_like(torso)
    hb[y0:y1 + 1, x0:x1 + 1] = True
    if behind_head:
        # facing right: left of the head and below its middle is the back / shoulder -> torso
        zone = np.zeros_like(torso)
        zone[(y0 + y1) // 2:y1 + 5, :x0] = True
        torso = torso | (zone & (a[..., 3] > 0))
    lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]  # noqa: E731
    shirt_c = [c for c in walk_cols if z9.region_of(c) == "shirt"]
    skin_c = [c for c in walk_cols if z9.region_of(c) == "skin"]
    skin_l = sorted(lum(c) for c in skin_c)
    shirt_sorted = sorted(shirt_c, key=lum)
    skin_sorted = sorted(skin_c, key=lum)
    n_fix = 0
    for y, x in zip(*np.where(torso & ~hb & (reg == "skin"))):
        # same lightness rank: darkest skin -> darkest shirt ... lightest -> lightest
        r = np.searchsorted(skin_l, lum(a[y, x])) / max(1, len(skin_l))
        a[y, x, :3] = shirt_sorted[min(len(shirt_sorted) - 1, int(r * len(shirt_sorted)))]
        n_fix += 1
    for y, x in zip(*np.where(hb & (reg == "shirt"))):
        a[y, x, :3] = min(skin_sorted, key=lambda c: abs(lum(c) - lum(a[y, x])))
        n_fix += 1
    return Image.fromarray(a, "RGBA"), n_fix


def main():
    walk = frames_of(OUT / "walk.png")
    cols = np.unique(np.concatenate([np.array(f)[np.array(f)[..., 3] > 0][:, :3] for f in walk]), axis=0)
    log = {}
    # 1. attack frame 1: head box = the pasted walk head (round 13 tracking)
    att = frames_of(OUT / "attack.png")
    h = json.loads((RAW / "attack_summary.json").read_text(encoding="utf-8"))["attack_s3"]["heads"][1]
    hm, neck = z10.head_mask(walk[0])
    neck -= z12.NECK_STUB
    hm[neck:] = False
    ys, xs = np.where(hm)
    box = (xs.min() + h["dx"] - 1, ys.min() + h["dy"] - 1, xs.max() + h["dx"] + 1, neck + h["dy"] + 1)
    att[1], n1 = torso_fix(att[1], box, cols, behind_head=True)
    log["attack_1"] = {"head_box": [int(v) for v in box], "px": n1}
    # 2. react frame 4 (getup 0, lying, head on the left): head box = opaque pixels left of the shirt hull
    rf = frames_of(OUT / "react.png")
    a = np.array(rf[4])
    reg = regions(a)
    sx = np.where((reg == "shirt").any(0))[0]
    from scipy import ndimage
    lab, n = ndimage.label(reg == "shirt", structure=np.ones((3, 3)))
    big = lab == (np.argmax(ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))) + 1)
    bx0 = int(np.where(big.any(0))[0].min())
    op = a[..., 3] > 0
    hy, hx = np.where(op[:, :bx0 + 6])
    hy, hx = np.where(op[:, :bx0])
    box2 = (int(hx.min()), int(hy.min()), bx0 - 1, int(hy.max()))
    rf[4], n2 = torso_fix(rf[4], box2, cols)
    log["react_4"] = {"head_box": list(box2), "px": n2}
    print(log)
    for name, fr, fps, loop in (("attack", att, 10, True), ("react", rf, 10, False)):
        fd = RAW / f"{name}_r14"
        if fd.exists():
            shutil.rmtree(fd)
        fd.mkdir()
        for i, f in enumerate(fr):
            f.save(fd / f"{i:02d}.png")
        subprocess.run([str(PY), "-I", str(ROOT / "tools/art/ai/build_sheet.py"), str(fd), "--name", name, "--fps",
                        str(fps), *(["--loop"] if loop else []), "--out", str(OUT)], check=True, cwd=ROOT)
        z9.strip([z9.region_map(f) for f in fr]).resize((64 * len(fr) * 4, 256), Image.NEAREST).save(
            OUT / f"{name}_regions_x4.png")
    (RAW / "fix_r14.json").write_text(json.dumps(log, indent=1), encoding="utf-8")
    subprocess.run([str(PY), "-I", str(ROOT / "tools/art/ai/build_zombie13.py"), "sheet26"], check=True, cwd=ROOT)


if __name__ == "__main__":
    main()
