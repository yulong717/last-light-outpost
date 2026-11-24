"""Round 10: fog zombie M walk redo (stand seed 3 from round 9 is kept).

  python tools/art/ai/build_zombie10.py refs
  python tools/art/ai/build_zombie10.py key-gen [--seeds 1 2 3 4]
  python tools/art/ai/build_zombie10.py key-post
  python tools/art/ai/build_zombie10.py key-pick SEED
  python tools/art/ai/build_zombie10.py walk-gen [--seeds 1 2 3 4]
  python tools/art/ai/build_zombie10.py walk-post
  python tools/art/ai/build_zombie10.py walk-pick SEED

What changed against round 9 (build_zombie9.py, whose post-processing and region rules are reused):
1. Pose: the video no longer starts from the upright stand. A walk key pose is drawn first with H3 Image
   (Picture 1 = the current game zombie's walk frame 0 as pose/layout: hunched, head forward, both arms reaching
   forward; Picture 2 = round 9 stand seed 3 for identity/colours; Picture 3 = anchor for style). The video uses
   that key as first and last frame, so the whole loop stays hunched with the arms forward.
2. Head lock: the key's head (rows above the neck) is pasted into every frame at a fixed x; it only follows the
   body bob (0 or 1 px down, measured from the shoulder line). No per-frame changes on the face.
3. Even gait: the loop is not sampled evenly in time. Leg spread (width of the bottom 12 rows) is measured on every
   video frame of the chosen period; the two widest frames are the contacts (frames 0 and 4), the narrowest
   frame between them is the crossing (frames 2 and 6), and 1/3/5/7 are the time midpoints between those.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1]))
import build_zombie9 as z9  # noqa: E402
from build_palette import check  # noqa: E402
from pixelize import downscale  # noqa: E402
from sprite_utils import key_magenta  # noqa: E402

ROOT = z9.ROOT
RAW = ROOT / "art/ai/raw/zombie10"
OUT = ROOT / "art/ai/out/zombie_m"
PY = z9.PY
FOOT = z9.FOOT

KEY_PROMPT = (
    "Redraw the fog zombie from <Picture 2> in exactly the pose and position of <Picture 1>, as a clean pixel art "
    "game sprite for a 2D side-scrolling zombie game. Pose from <Picture 1>: a classic shambling zombie walk, "
    "strongly hunched forward with a rounded back, the head pushed forward and hanging low in front of the "
    "shoulders, BOTH arms stretched straight forward at shoulder height reaching toward the right, hands drooping "
    "limply at the wrists, legs apart in a dragging mid-step. Character from <Picture 2>: keep its small head "
    "(3.5 heads tall, not chibi, the head is much smaller than in <Picture 1>), grey-green rotting skin, sunken "
    "dark eyes, bald head with a few stray hairs, torn ragged plain light grey shirt (neutral grey, not greenish), "
    "dark blue-grey trousers, dark worn shoes, and its total height. Three-quarter view facing right with the torso "
    "turned slightly toward the camera. Nothing on the head. Draw it in exactly the pixel art style of "
    "<Picture 3>: a single light source from the upper left, 3 to 4 shading steps, a 1 pixel near-black outline, "
    "muted grey-green colours. Plain solid magenta background, no ground, no floor line, no cast shadow, no text."
)
WALK_PROMPT = (
    "Pixel art game sprite animation of the fog zombie from <Picture 1>: keep its grey-green skin, small head, torn "
    "light grey shirt, dark blue-grey trousers, dark shoes, colours and near-black outlines exactly. Three-quarter "
    "view facing right, fixed camera, no zoom, no pan, full body visible at all times. The background stays plain "
    "solid magenta in every frame. It shambles forward in place on a treadmill with a slow, steady zombie walk: "
    "the body stays strongly hunched the whole time, the head stays pushed forward and does not turn, both arms "
    "stay stretched forward at shoulder height reaching to the right and only sway slightly. The legs clearly "
    "alternate with even, equal steps: the front foot drags forward, the back foot drags forward, knees bending, "
    "feet scraping along the ground line. Two full steps at a constant pace. Seamless loop. No effects. Flat colors."
)


# ---------------------------------------------------------------- refs / key pose

def _x16(img: Image.Image, path: Path):
    c = Image.new("RGBA", (64, 64), (255, 0, 255, 255))
    c.alpha_composite(img.convert("RGBA"))
    c.convert("RGB").resize((1024, 1024), Image.NEAREST).save(path)


def refs():
    RAW.mkdir(parents=True, exist_ok=True)
    # pose layout: current game zombie walk frame 0, scaled to the M height (56) on foot row 61
    z = Image.open(ROOT / "public/assets/sprites/zombie_basic.png").convert("RGBA").crop((0, 0, 64, 64))
    a = np.array(z)[..., 3] > 0
    ys, xs = np.where(a)
    fig = z.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    s = 56 / fig.height
    fig = fig.resize((round(fig.width * s), 56), Image.NEAREST)
    lay = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    lay.alpha_composite(fig, ((64 - fig.width) // 2, FOOT + 1 - 56))
    lay.save(RAW / "ref_pose_64.png")
    _x16(lay, RAW / "ref_pose_16x.png")
    _x16(Image.open(OUT / "stand.png"), RAW / "ref_stand_16x.png")
    shutil.copy(ROOT / "art/ai/raw/zombie9/ref_anchor_1024.png", RAW / "ref_anchor_1024.png")
    print("refs ->", RAW)


def run(cmd: list) -> str:
    return z9.run(cmd)


def key_gen(seeds: list[int]):
    for s in seeds:
        print("key", s, run([PY, "-I", ROOT / "tools/art/ai/run_comfy.py", ROOT / "art/ai/workflows/h3_image_edit_3ref.json",
                             "--image", f"load1={RAW / 'ref_pose_16x.png'}", "--image", f"load2={RAW / 'ref_stand_16x.png'}",
                             "--image", f"load3={RAW / 'ref_anchor_1024.png'}",
                             "--set", "scale1.width=1024", "--set", "scale1.height=1024",
                             "--set", "cond.width=1024", "--set", "cond.height=1024",
                             "--set", f"sampler.seed={s}", "--set", f"cond.prompt={KEY_PROMPT}",
                             "--set", f"save.filename_prefix=ai_art/zombie10_key_s{s}",
                             "--out", RAW / f"key_s{s}", "--tag", f"r10 zombie walk key seed {s}"]), flush=True)


def key_post():
    rp = z9.region_palettes()
    rows, summary = [], {}
    for d in sorted(p for p in RAW.glob("key_s*") if p.is_dir()):
        s = int(d.name.split("_s")[-1])
        raws = sorted(d.glob("zombie10_key_*.png"))
        if not raws:
            continue
        small, q = z9.post_stand_raw(raws[-1], rp)
        (fin,), info = z9.tidy_frames([q])
        fin.save(d / "key_64.png")
        m = z9.measure(fin)
        info.update(measure=m, regions=z9.region_stats(fin), outside_palette=check(d / "key_64.png")["outside_palette"])
        summary[s] = info
        rows.append((s, small, fin, z9.region_map(fin), m, info))
    sc = 4
    out = Image.new("RGB", (len(rows) * (64 * sc + 6), 3 * (64 * sc + 14)), (20, 20, 20))
    dd = ImageDraw.Draw(out)
    for i, (s, small, fin, rm, m, info) in enumerate(rows):
        x = i * (64 * sc + 6)
        for j, (lab, im) in enumerate((("raw/16", small), (f"h{m['height']} w{m['width']} {info['colours'][1]}c", fin),
                                       ("regions", rm))):
            dd.text((x + 3, j * (64 * sc + 14) + 1), f"s{s} {lab}", fill=(255, 255, 255))
            out.paste(z9.tile(im, sc), (x, j * (64 * sc + 14) + 14))
    out.save(RAW / "key_seeds_x4.png")
    (RAW / "key_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    for s, v in summary.items():
        print(s, v["measure"], v["colours"], v["regions"], "out", v["outside_palette"])


def key_pick(seed: int):
    img = Image.open(RAW / f"key_s{seed}" / "key_64.png")
    img.save(RAW / "key.png")
    c = Image.new("RGBA", (64, 64), (255, 0, 255, 255))
    c.alpha_composite(img)
    c.convert("RGB").resize((512, 512), Image.NEAREST).save(RAW / "key_512.png")
    (RAW / "key_pick.json").write_text(json.dumps({"seed": seed}), encoding="utf-8")
    print("key picked", seed)


# ---------------------------------------------------------------- walk

def walk_gen(seeds: list[int]):
    key = RAW / "key_512.png"
    for s in seeds:
        print("walk", s, run([PY, "-I", ROOT / "tools/art/ai/run_comfy.py", ROOT / "art/ai/workflows/h3_video_i2v.json",
                              "--image", f"first={key}", "--image", f"last={key}",
                              "--set", "scale_first.width=512", "--set", "scale_first.height=512",
                              "--set", "scale_last.width=512", "--set", "scale_last.height=512",
                              "--set", "cond.width=512", "--set", "cond.height=512", "--set", "cond.length=56",
                              "--set", f"noise.noise_seed={s}", "--set", f"cond.prompt={WALK_PROMPT}",
                              "--set", f"save.filename_prefix=ai_art/zombie10_walk_s{s}",
                              "--out", RAW / f"walk_s{s}", "--tag", f"r10 zombie walk seed {s}"]), flush=True)


def leg_spread(path: Path) -> float:
    """Horizontal extent of the feet: width of the opaque area in the bottom 12/56 of the figure."""
    a = np.array(key_magenta(Image.open(path)))[..., 3] > 128
    ys = np.where(a.any(1))[0]
    top, bot = ys.min(), ys.max()
    band = a[bot - int((bot - top) * 12 / 56):bot + 1]
    xs = np.where(band.any(0))[0]
    return float(xs.max() - xs.min() + 1)


def gait_pick(frames: list[Path], pmin=16, pmax=48) -> dict:
    """Loop period from pick_frames (best closure), then contact/crossing phases from leg spread."""
    pick = frames[0].parent / "pick_loop"
    if pick.exists():
        shutil.rmtree(pick)
    info = json.loads(subprocess.run([str(PY), "-I", str(ROOT / "tools/art/ai/pick_frames.py"), "loop",
                                      *map(str, frames), "-n", "8", "--min-period", str(pmin), "--max-period", str(pmax),
                                      "--out", str(pick)], capture_output=True, text=True, cwd=ROOT,
                                     encoding="utf-8").stdout.strip().splitlines()[-1])
    start, period = info["start"], info["period"]
    sp = np.array([leg_spread(f) for f in frames])
    idx = np.arange(start, start + period)
    w = sp[idx % len(frames)] if start + period > len(frames) else sp[idx]
    # smooth the spread a little (1-2-1) before finding the extremes
    ws = np.convolve(np.r_[w[-1], w, w[0]], [0.25, 0.5, 0.25], "valid")
    # two contacts half a period apart: choose offset c maximising spread(c) + spread(c + P/2)
    half = period / 2
    best = max(range(period), key=lambda c: ws[c] + ws[int(round(c + half)) % period])
    c0, c1 = best, int(round(best + half)) % period
    seg = lambda a, b: (b - a) % period  # noqa: E731

    def cross(a, b):
        n = seg(a, b)
        inner = [(a + k) % period for k in range(1, n)]
        return min(inner, key=lambda k: ws[k]) if inner else a

    x0, x1 = cross(c0, c1), cross(c1, c0)
    def mid(a, b):
        # in-between: the frame whose leg spread is closest to the mean of its two neighbours' spread
        # (even stride on screen, not just even in time); ties -> closest to the time midpoint
        n = seg(a, b)
        inner = [(a + k) % period for k in range(1, n)]
        if not inner:
            return a
        target = (ws[a] + ws[b]) / 2
        return min(inner, key=lambda k: (abs(ws[k] - target) + 0.5 * abs(seg(a, k) - n / 2)))
    phases = [c0, mid(c0, x0), x0, mid(x0, c1), c1, mid(c1, x1), x1, mid(x1, c0)]
    picked = [int(start + p) for p in phases]
    info.update(spread=[float(v) for v in w], contact=[int(c0), int(c1)], crossing=[int(x0), int(x1)],
                picked=picked, step_frames=[seg(phases[i], phases[(i + 1) % 8]) for i in range(8)])
    return info


def shoulder_row(img: Image.Image, neck: int) -> float:
    """Mean y of the first shirt-region pixels per column (shoulder line) below the neck."""
    a = np.array(img.convert("RGBA"))
    reg = z9.raw_region(a[..., :3])
    sh = (a[..., 3] > 0) & (reg == "shirt")
    sh[:neck] = False
    cols = [np.where(sh[:, x])[0][0] for x in range(a.shape[1]) if sh[:, x].any()]
    return float(np.median(cols)) if cols else float(neck)


def head_mask(key: Image.Image) -> tuple[np.ndarray, int]:
    """Head of the key frame = opaque pixels above the neck that are not shirt/arm (connected to the skull)."""
    from scipy import ndimage
    a = np.array(key.convert("RGBA"))
    op = a[..., 3] > 0
    reg = z9.raw_region(a[..., :3])
    ys = np.where(op.any(1))[0]
    top = int(ys.min())
    # neck: the row with the fewest opaque pixels between 22% and 40% of the height, restricted to the head column
    lab, _ = ndimage.label(op & (reg != "shirt"), structure=np.ones((3, 3)))
    head_lab = lab[top][op[top]].max() if op[top].any() else 0
    blob = lab == head_lab
    h = int(ys.max()) - top + 1
    rows = range(top + int(h * 0.22), top + int(h * 0.40))
    widths = {y: blob[y].sum() for y in rows}
    neck = min(widths, key=lambda y: (widths[y], -y))
    m = np.zeros_like(op)
    m[:neck] = blob[:neck] | (op[:neck] & (reg[:neck] != "shirt") & ~lab.astype(bool)[:neck])
    # keep only what is connected to the skull
    l2, _ = ndimage.label(m, structure=np.ones((3, 3)))
    keep = l2[top][m[top]].max() if m[top].any() else 0
    return (l2 == keep) if keep else m, neck


def head_lock(frames: list[Image.Image], key: Image.Image, force_dy: list[int] | None = None) -> tuple[list[Image.Image], list[int]]:
    hm, neck = head_mask(key)
    k = np.array(key.convert("RGBA"))
    ref_sh = shoulder_row(key, neck)
    out, dys = [], []
    for i, f in enumerate(frames):
        a = np.array(f.convert("RGBA"))
        dy = force_dy[i] if force_dy is not None else int(np.clip(round(shoulder_row(f, neck - 2) - ref_sh), 0, 1))
        dys.append(dy)
        # clear the frame's own head: everything above the neck row (+dy) that is not shirt/arm reaching up
        reg = z9.raw_region(a[..., :3])
        clr = np.zeros(a.shape[:2], bool)
        clr[:neck + dy] = True
        clr &= reg != "shirt"
        # keep the forward arms: they are to the right of the head mask's right edge + 1
        hx = np.where(hm.any(0))[0]
        clr[:, hx.max() + 2:] = False
        a[clr] = 0
        ys, xs = np.where(hm)
        a[ys + dy, xs] = k[ys, xs]
        out.append(Image.fromarray(a, "RGBA"))
    return out, dys


def region_islands(img: Image.Image, max_px: int = 6) -> tuple[Image.Image, int]:
    """Small specks of one region inside another (skin dots on the shirt, light shirt-grey dots on the arm)
    take the most common colour of the surrounding region, so every region reads as one block for
    ZombieComposer. A speck = 8-connected piece of <= max_px pixels whose 5x5 surroundings (outline and
    'other' ignored) are >= 60% another single region."""
    from scipy import ndimage
    a = np.array(img.convert("RGBA"))
    op = a[..., 3] > 0
    reg = np.full(op.shape, "", dtype=object)
    for y, x in zip(*np.where(op)):
        reg[y, x] = z9.region_of(a[y, x])
    fixed = 0
    for name in ("skin", "shirt", "pants"):
        lab, n = ndimage.label(reg == name, structure=np.ones((3, 3)))
        for i in range(1, n + 1):
            m = lab == i
            if m.sum() > max_px:
                continue
            ring = ndimage.binary_dilation(m, np.ones((5, 5))) & ~m & op
            around = [r for r in reg[ring] if r not in ("outline", "other")]
            if not around:
                continue
            other = max(set(around), key=around.count)
            if other == name or around.count(other) < 0.6 * len(around):
                continue
            cols = [tuple(c) for c in a[ring & (reg == other)][:, :3]]
            # per pixel: the most common colour of `other` among its 8 neighbours (keeps shading), else overall
            glob = max(set(cols), key=cols.count)
            for y, x in zip(*np.where(m)):
                nb = [tuple(a[yy, xx, :3]) for yy in range(y - 1, y + 2) for xx in range(x - 1, x + 2)
                      if 0 <= yy < a.shape[0] and 0 <= xx < a.shape[1] and reg[yy, xx] == other]
                a[y, x, :3] = max(set(nb), key=nb.count) if nb else glob
            reg[m] = other
            fixed += int(m.sum())
    return Image.fromarray(a, "RGBA"), fixed


def walk_frames(s: int, rp, key: Image.Image, key_h8: int):
    d = RAW / f"walk_s{s}"
    frames = sorted(d.glob("zombie10_walk_*.png"))
    info = gait_pick(frames)
    picked = [frames[i % len(frames)] for i in info["picked"]]
    k0 = key_magenta(Image.open(frames[0]))
    ys = np.where(np.array(k0)[..., 3] > 128)[0]
    scale = key_h8 / (ys.max() - ys.min() + 1)
    ds = d / "ds"
    if ds.exists():
        shutil.rmtree(ds)
    downscale(picked, ds, scale, align="hybrid")
    small = [z9.largest_blob(Image.open(ds / f"{i:02d}.png").convert("RGBA")) for i in range(len(picked))]
    q = [z9.quantize_regions(f, rp) for f in small]
    _, dys = head_lock(q, key)
    # contacts (body lowest) keep the key's head row, the other frames lift it by 1 px: height stays 56-57
    dys = [d - max(dys) for d in dys]
    q, _ = head_lock(q, key, dys)
    fin, tinfo = z9.tidy_frames(q)
    fin_r = [region_islands(f) for f in fin]
    fin = [f for f, _ in fin_r]
    tinfo["region_px_fixed"] = sum(n for _, n in fin_r)
    # tidy may merge colours: re-apply the head from the final key colours so the head is pixel-identical
    fin, _ = head_lock(fin, fin_key(key, fin), dys)
    info.update(tinfo, scale=round(float(scale), 4), head_dy=dys)
    return small, fin, info


def fin_key(key: Image.Image, fin: list[Image.Image]) -> Image.Image:
    """Key frame with its colours snapped to the final sheet's colours (same region nearest)."""
    cols = np.unique(np.concatenate([np.array(f)[np.array(f)[..., 3] > 0][:, :3] for f in fin]), axis=0)
    a = np.array(key.convert("RGBA"))
    op = a[..., 3] > 0
    for y, x in zip(*np.where(op)):
        if not (cols == a[y, x, :3]).all(1).any():
            r = z9.region_of(a[y, x])
            cand = [c for c in cols if z9.region_of(c) == r] or list(cols)
            a[y, x, :3] = min(cand, key=lambda c: int(((c.astype(int) - a[y, x, :3]) ** 2).sum()))
    return Image.fromarray(a, "RGBA")


def head_identical(fin: list[Image.Image], key: Image.Image, dys: list[int]) -> bool:
    hm, _ = head_mask(key)
    ys, xs = np.where(hm)
    ref = np.array(fin[0])[ys + dys[0], xs]
    return all((np.array(f)[ys + dy, xs] == ref).all() for f, dy in zip(fin, dys))


def walk_post():
    rp = z9.region_palettes()
    key = Image.open(RAW / "key.png")
    key_h8 = z9.measure(key)["height"] * 8
    rows, summary = [], {}
    for d in sorted(p for p in RAW.glob("walk_s*") if p.is_dir()):
        s = int(d.name.split("_s")[-1])
        if not list(d.glob("zombie10_walk_*.png")):
            continue
        small, fin, info = walk_frames(s, rp, key, key_h8)
        fd = d / "final"
        fd.mkdir(exist_ok=True)
        for i, f in enumerate(fin):
            f.save(fd / f"{i:02d}.png")
        st = z9.strip(fin)
        st.save(fd / "walk.png")
        ms = [z9.measure(f) for f in fin]
        feet = [int(np.where(np.array(f)[..., 3] > 0)[0].max()) for f in fin]
        info.update(heights=[m["height"] for m in ms], feet=feet, regions=z9.region_stats(st),
                    outside_palette=check(fd / "walk.png")["outside_palette"],
                    head_identical=head_identical(fin, key, info["head_dy"]),
                    out_spread=[leg_spread_small(f) for f in fin])
        summary[s] = info
        rows.append((s, fin, info))
    sc = 3
    cw = 64 * sc
    out = Image.new("RGB", (8 * cw, len(rows) * (cw * 2 + 32)), (20, 20, 20))
    dd = ImageDraw.Draw(out)
    for r, (s, fin, info) in enumerate(rows):
        y = r * (cw * 2 + 32)
        dd.text((3, y + 2), f"seed {s}  period {info['period']} start {info['start']}  steps {info['step_frames']}  "
                            f"{info['colours'][1]}c  h {min(info['heights'])}-{max(info['heights'])}  "
                            f"spread {info['out_spread']}  head dy {info['head_dy']}", fill=(255, 255, 255))
        for i, f in enumerate(fin):
            out.paste(z9.tile(f, sc), (i * cw, y + 16))
            out.paste(z9.tile(z9.region_map(f), sc), (i * cw, y + 16 + cw))
            dd.text((i * cw + 3, y + 18), str(i), fill=(255, 255, 255))
    out.save(OUT / "walk10_seeds_x3.png")
    (RAW / "walk_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    for s, v in summary.items():
        print(s, "period", v["period"], "steps", v["step_frames"], "c", v["colours"], "h", v["heights"], "feet",
              v["feet"], "spread", v["out_spread"], "dy", v["head_dy"], "head_id", v["head_identical"],
              "out", v["outside_palette"])


def leg_spread_small(img: Image.Image) -> int:
    a = np.array(img)[..., 3] > 0
    ys = np.where(a.any(1))[0]
    band = a[ys.max() - 11:ys.max() + 1]
    xs = np.where(band.any(0))[0]
    return int(xs.max() - xs.min() + 1)


def walk_pick(seed: int):
    fd = RAW / f"walk_s{seed}" / "final"
    summ = json.loads((RAW / "walk_summary.json").read_text(encoding="utf-8"))
    meta_in = {"round": 10, "seed": seed, "prompt": WALK_PROMPT,
               "first_last": "walk key pose x8 on magenta (art/ai/raw/zombie10/key_512.png)",
               "key": {"seed": json.loads((RAW / "key_pick.json").read_text())["seed"], "prompt": KEY_PROMPT,
                       "references": {"Picture 1": "public/assets/sprites/zombie_basic.png walk frame 0, scaled to 56 px, x16",
                                      "Picture 2": "art/ai/out/zombie_m/stand.png (round 9 stand seed 3) x16",
                                      "Picture 3": "art/ai/style/anchor.png x5"},
                       "workflow": "art/ai/workflows/h3_image_edit_3ref.json (1024x1024)",
                       "seeds": json.loads((RAW / "key_summary.json").read_text(encoding="utf-8"))},
               "workflow": "art/ai/workflows/h3_video_i2v.json 512x512, 56 frames",
               "frame_pick": "loop period from pick_frames.py, contacts = widest leg spread pair half a period apart "
                             "(frames 0/4), crossings = narrowest between (2/6), 1/3/5/7 = time midpoints",
               "head_lock": "key head pixels pasted at fixed x, dy 0/1 from shoulder line",
               "seeds": summ,
               "generation": json.loads((RAW / f"walk_s{seed}" / "meta.json").read_text(encoding="utf-8"))[-1]}
    mp = RAW / "walk_meta.json"
    mp.write_text(json.dumps(meta_in, ensure_ascii=False), encoding="utf-8")
    subprocess.run([str(PY), "-I", str(ROOT / "tools/art/ai/build_sheet.py"), str(fd), "--name", "walk", "--fps", "8",
                    "--loop", "--out", str(OUT)], check=True, cwd=ROOT)
    frames = [Image.open(fd / f"{i:02d}.png") for i in range(8)]
    z9.strip([z9.region_map(f) for f in frames]).resize((64 * 8 * 4, 256), Image.NEAREST).save(OUT / "walk_regions_x4.png")
    z9.OUT = OUT
    z9.write_meta({"walk": meta_in})
    print("walk picked", seed)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["refs", "key-gen", "key-post", "key-pick", "walk-gen", "walk-post", "walk-pick"])
    ap.add_argument("seed", nargs="?", type=int)
    ap.add_argument("--seeds", nargs="*", type=int, default=[1, 2, 3, 4])
    a = ap.parse_args()
    {"refs": refs, "key-gen": lambda: key_gen(a.seeds), "key-post": key_post, "key-pick": lambda: key_pick(a.seed),
     "walk-gen": lambda: walk_gen(a.seeds), "walk-post": walk_post, "walk-pick": lambda: walk_pick(a.seed)}[a.cmd]()


if __name__ == "__main__":
    main()
