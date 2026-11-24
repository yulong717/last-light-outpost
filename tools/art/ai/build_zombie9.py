"""Round 9: fog zombie on the M mannequin (56 px, three-quarter view), ZombieComposer region colours.

  python tools/art/ai/build_zombie9.py refs
  python tools/art/ai/build_zombie9.py stand-gen [--seeds 1 2 3 4]
  python tools/art/ai/build_zombie9.py stand-post
  python tools/art/ai/build_zombie9.py stand-pick SEED
  python tools/art/ai/build_zombie9.py walk-gen [--seeds 1 2 3 4]
  python tools/art/ai/build_zombie9.py walk-post
  python tools/art/ai/build_zombie9.py walk-pick SEED

Region rule (docs/ai-art/ZOMBIE_REACT.md §2, same as ZombieComposer / make_zombie_variants.classify):
  outline v < 0.11 | shirt s < 0.07 & v > 0.58 | pants hue 165-230 & s > 0.15 | skin hue 70-165 & s >= 0.07
Every raw pixel is first given a region from its own colour (relaxed thresholds, H3 is not exact), then
quantized only to master.gpl colours of that region, so a region can never leak into another one.
Edge pixels (touching transparency) become the near-black outline colours. Characters <= 16 colours,
merged only within a region, jointly over all frames (no per-frame flicker).
Palette: master.gpl k-means 48 + neutral cloth greys (no danger red, no reserved, no identity).
Canvas 64x64, foot row y=61 (ART_STYLE_SPEC; the game's ZombieComposer FOOT_ROW is 62, see REPORT).
"""
from __future__ import annotations

import argparse
import colorsys
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1]))
from build_palette import check, part  # noqa: E402
from make_zombie_variants import classify  # noqa: E402
from pixelize import N4, despill, downscale, limit_colours, remove_islands, shifted, srgb_to_oklab  # noqa: E402
from sprite_utils import k_centroid, key_magenta  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "art/ai/raw/zombie9"
OUT = ROOT / "art/ai/out/zombie_m"
PY = ROOT / ".venv-art/Scripts/python.exe"
FOOT, G = 61, 16
MAX_COLOURS = 16
REGION_COLOUR = {"shirt": (240, 240, 240), "pants": (60, 110, 220), "skin": (70, 190, 80),
                 "outline": (0, 0, 0), "other": (150, 150, 150)}

STAND_PROMPT = (
    "Redraw <Picture 1> as a clean pixel art game sprite for a 2D side-scrolling zombie game: dress the grey "
    "mannequin as the fog zombie from <Picture 2>: grey-green rotting skin, sunken dark eyes, bald head with a few "
    "stray hairs, a torn ragged plain light grey shirt (neutral grey, not greenish), dark blue-grey trousers, dark "
    "worn shoes. Keep exactly the mannequin's position, total height, small head (3.5 heads tall, not chibi), body "
    "width and three-quarter view facing right with the torso turned slightly toward the camera. Slightly hunched "
    "standing pose, arms hanging forward limply, feet on the same ground line. Nothing on the head, no hat. "
    "Draw it in exactly the pixel art style of <Picture 3>, as if by the same artist: a single light source from the "
    "upper left at 45 degrees, lit surfaces on the upper left and shadowed surfaces on the lower right, 3 to 4 "
    "shading steps, a 1 pixel near-black outline, muted grey-green colours. Plain solid magenta background, no "
    "ground, no floor line, no cast shadow, no text."
)
WALK_PROMPT = (
    "Pixel art game sprite animation of the fog zombie from <Picture 1>: keep its grey-green skin, small head, torn "
    "light grey shirt, dark blue-grey trousers, dark shoes, colours and near-black outlines exactly. Three-quarter "
    "view facing right, fixed camera, no zoom, no pan, full body visible at all times. The background stays plain "
    "solid magenta in every frame. It shambles forward in place on a treadmill with a slow limping zombie walk: "
    "hunched, head hanging forward, arms dangling forward and swaying, legs clearly alternating, knees bending, "
    "dragging steps, feet staying on the ground line. Two full steps. Seamless loop. No effects. Flat colors."
)


# ---------------------------------------------------------------- palette by region

def region_of(rgb) -> str:
    return classify(int(rgb[0]), int(rgb[1]), int(rgb[2]))


def region_palettes() -> dict[str, np.ndarray]:
    pal = np.concatenate([part("kmeans"), part("cloth")])
    out = {}
    for c in pal:
        out.setdefault(region_of(c), []).append(c)
    return {k: np.array(v, np.uint8) for k, v in out.items()}


def raw_region(rgb: np.ndarray) -> np.ndarray:
    """Relaxed region of unquantized pixels (H3 colours drift a little around the thresholds)."""
    h, s, v = np.vectorize(colorsys.rgb_to_hsv)(rgb[..., 0] / 255, rgb[..., 1] / 255, rgb[..., 2] / 255)
    hd = h * 360
    reg = np.full(rgb.shape[:-1], "other", dtype=object)
    skin = (hd >= 60) & (hd <= 170) & (s >= 0.06)
    pants = (hd > 170) & (hd <= 250) & (s > 0.10)
    # shirt incl. its shadows: neutral greys down to v 0.32 -> the 4 shirt colours (cloth greys + d7e5d8);
    # otherwise mid-grey shirt folds land in "other" (lavender 766f8e) and keep their grey when recoloured
    shirt = (s < 0.10) & (v > 0.32)
    reg[skin] = "skin"
    reg[pants] = "pants"
    reg[shirt] = "shirt"
    reg[v < 0.15] = "outline"
    return reg


def quantize_regions(img: Image.Image, rp: dict[str, np.ndarray]) -> Image.Image:
    a = np.array(img.convert("RGBA"))
    op = a[..., 3] > 0
    reg = raw_region(a[..., :3])
    # the shirt never reaches the head: light neutral pixels in the top 28% of the figure (head highlights)
    # belong to the skin region, otherwise recolouring the shirt would also tint the scalp
    ys = np.where(op.any(1))[0]
    if len(ys):
        head_end = ys.min() + int((ys.max() - ys.min() + 1) * 0.28)
        hm = np.zeros_like(op)
        hm[:head_end] = True
        reg[hm & (reg == "shirt")] = "skin"
    lab = srgb_to_oklab(a[..., :3].reshape(-1, 3)).reshape(a.shape[0], a.shape[1], 3)
    out = a.copy()
    for name in set(reg[op]):
        pal = rp.get(name)
        if pal is None or not len(pal):
            pal = np.concatenate(list(rp.values()))
        m = op & (reg == name)
        pl = srgb_to_oklab(pal)
        d = ((lab[m][:, None, :] - pl[None]) ** 2).sum(-1)
        out[m, :3] = pal[d.argmin(1)]
    # outline: every opaque pixel touching transparency -> nearest near-black outline colour
    edge = op & (sum(shifted(~op, dy, dx, True) for dy, dx in N4) > 0)
    ol = rp["outline"]
    pl = srgb_to_oklab(ol)
    d = ((lab[edge][:, None, :] - pl[None]) ** 2).sum(-1)
    out[edge, :3] = ol[d.argmin(1)]
    out[..., 3] = np.where(op, 255, 0)
    return Image.fromarray(out, "RGBA")


def strip(frames: list[Image.Image]) -> Image.Image:
    s = Image.new("RGBA", (64 * len(frames), 64), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        s.paste(f, (64 * i, 0))
    return s


def tidy_frames(frames: list[Image.Image]) -> tuple[list[Image.Image], dict]:
    """Islands per frame, then <=16 colours merged within regions jointly over all frames."""
    fixed = 0
    tmp = []
    for f in frames:
        f, n = remove_islands(f, 2)
        fixed += n
        tmp.append(f)
    s, cc = limit_colours(strip(tmp), MAX_COLOURS, group=lambda r, g, b: classify(r, g, b))
    out = [s.crop((64 * i, 0, 64 * i + 64, 64)) for i in range(len(frames))]
    return out, {"colours": cc, "island_px_fixed": fixed}


def region_map(img: Image.Image) -> Image.Image:
    a = np.array(img.convert("RGBA"))
    out = np.zeros_like(a)
    for y, x in zip(*np.where(a[..., 3] > 0)):
        out[y, x, :3] = REGION_COLOUR[region_of(a[y, x])]
        out[y, x, 3] = 255
    return Image.fromarray(out, "RGBA")


def region_stats(img: Image.Image) -> dict:
    a = np.array(img.convert("RGBA")).reshape(-1, 4)
    px = a[a[:, 3] > 0][:, :3]
    st = {}
    for c in px:
        k = region_of(c)
        st[k] = st.get(k, 0) + 1
    return st


# ---------------------------------------------------------------- measure / sheets

def measure(img: Image.Image) -> dict:
    a = np.array(img)[..., 3] > 0
    ys, xs = np.where(a)
    top, bot = int(ys.min()), int(ys.max())
    h = bot - top + 1
    w = a.sum(1)
    lo, hi = top + int(h * 0.25), top + int(h * 0.45)
    ww = w[lo:hi + 1]
    neck = lo + int(np.where(ww <= ww.min() + 1)[0].max()) + 1
    return {"height": h, "head": neck - top, "width": int(xs.max() - xs.min() + 1), "top": top, "bottom": bot}


def tile(img: Image.Image, sc: int = 4, guides: bool = True) -> Image.Image:
    bg = Image.new("RGBA", img.size, (255, 0, 255, 255))
    bg.alpha_composite(img.convert("RGBA"))
    t = bg.convert("RGB").resize((img.width * sc, img.height * sc), Image.NEAREST)
    if guides:
        d = ImageDraw.Draw(t)
        d.line([(0, (FOOT + 1) * sc), (t.width, (FOOT + 1) * sc)], fill=(0, 255, 0))
        d.line([(0, (FOOT + 1 - 56) * sc), (t.width, (FOOT + 1 - 56) * sc)], fill=(255, 255, 255))
    return t


def grid_phase(img: Image.Image, g: int) -> tuple[int, int]:
    a = np.array(img.convert("RGB")).astype(np.int32)
    gx = np.abs(np.diff(a, axis=1)).sum(-1).sum(0)
    gy = np.abs(np.diff(a, axis=0)).sum(-1).sum(1)
    px = [gx[(np.arange(len(gx)) % g) == (o - 1) % g].sum() for o in range(g)]
    py = [gy[(np.arange(len(gy)) % g) == (o - 1) % g].sum() for o in range(g)]
    return int(np.argmax(px)), int(np.argmax(py))


def largest_blob(img: Image.Image) -> Image.Image:
    from scipy import ndimage
    a = np.array(img)
    lab, n = ndimage.label(a[..., 3] > 0, structure=np.ones((3, 3)))
    if n > 1:
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        a[(lab != int(np.argmax(sizes)) + 1) & (lab > 0), 3] = 0
    return Image.fromarray(a, "RGBA")


def to_foot(img: Image.Image) -> Image.Image:
    a = np.array(img)
    ys, xs = np.where(a[..., 3] > 0)
    out = np.zeros_like(a)
    dy = FOOT - int(ys.max())
    ty = ys + dy
    ok = (ty >= 0) & (ty < 64)
    out[ty[ok], xs[ok]] = a[ys[ok], xs[ok]]
    return Image.fromarray(out, "RGBA")


# ---------------------------------------------------------------- stand

def refs():
    RAW.mkdir(parents=True, exist_ok=True)
    m = Image.open(ROOT / "art/ai/mannequins/M/stand34_64.png").convert("RGBA")
    c = Image.new("RGBA", (64, 64), (255, 0, 255, 255))
    c.alpha_composite(m)
    c.convert("RGB").resize((1024, 1024), Image.NEAREST).save(RAW / "ref_mannequin_M.png")
    z = Image.open(ROOT / "public/assets/sprites/zombie_basic.png").convert("RGBA").crop((0, 0, 64, 64))
    c = Image.new("RGBA", (64, 64), (255, 0, 255, 255))
    c.alpha_composite(z)
    c.convert("RGB").resize((1024, 1024), Image.NEAREST).save(RAW / "ref_zombie_16x.png")
    a = Image.open(ROOT / "art/ai/style/anchor.png").convert("RGBA")
    big = a.resize((a.width * 5, a.height * 5), Image.NEAREST)
    c = Image.new("RGBA", (1024, 1024), (255, 0, 255, 255))
    c.alpha_composite(big, ((1024 - big.width) // 2, (1024 - big.height) // 2))
    c.convert("RGB").save(RAW / "ref_anchor_1024.png")
    print("refs ->", RAW)


def run(cmd: list[str]) -> str:
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, encoding="utf-8", cwd=ROOT)
    return (r.stdout.strip().splitlines() or [""])[-1] + (r.stderr[-400:] if r.returncode else "")


def stand_gen(seeds: list[int]):
    for s in seeds:
        print("stand", s, run([PY, "-I", ROOT / "tools/art/ai/run_comfy.py", ROOT / "art/ai/workflows/h3_image_edit_3ref.json",
                               "--image", f"load1={RAW / 'ref_mannequin_M.png'}", "--image", f"load2={RAW / 'ref_zombie_16x.png'}",
                               "--image", f"load3={RAW / 'ref_anchor_1024.png'}",
                               "--set", "scale1.width=1024", "--set", "scale1.height=1024",
                               "--set", "cond.width=1024", "--set", "cond.height=1024",
                               "--set", f"sampler.seed={s}", "--set", f"cond.prompt={STAND_PROMPT}",
                               "--set", f"save.filename_prefix=ai_art/zombie9_stand_s{s}",
                               "--out", RAW / f"stand_s{s}", "--tag", f"r9 zombie stand seed {s}"]), flush=True)


def post_stand_raw(raw: Path, rp) -> tuple[Image.Image, Image.Image]:
    img = Image.open(raw).convert("RGB")
    ox, oy = grid_phase(img, G)
    if ox or oy:
        pad = Image.new("RGB", img.size, (255, 0, 255))
        pad.paste(img.crop((ox, oy, img.width, img.height)), (0, 0))
        img = pad
    small = to_foot(largest_blob(k_centroid(despill(key_magenta(img)), G)))
    return small, quantize_regions(small, rp)


def stand_post():
    rp = region_palettes()
    rows, summary = [], {}
    for d in sorted(p for p in RAW.glob("stand_s*") if p.is_dir()):
        s = int(d.name.split("_s")[-1])
        raws = sorted(d.glob("zombie9_stand_*.png"))
        if not raws:
            continue
        small, q = post_stand_raw(raws[-1], rp)
        (fin,), info = tidy_frames([q])
        fin.save(d / "stand_64.png")
        small.save(d / "stand_64_unquant.png")
        m = measure(fin)
        info.update(measure=m, regions=region_stats(fin), outside_palette=check(d / "stand_64.png")["outside_palette"])
        summary[s] = info
        rows.append((s, small, fin, region_map(fin), m, info))
    sc = 4
    out = Image.new("RGB", (len(rows) * (64 * sc + 6), 3 * (64 * sc + 14)), (20, 20, 20))
    dd = ImageDraw.Draw(out)
    for i, (s, small, fin, rm, m, info) in enumerate(rows):
        x = i * (64 * sc + 6)
        for j, (lab, im) in enumerate((("raw/16", small), (f"h{m['height']} head{m['head']} w{m['width']} "
                                                           f"{info['colours'][1]}c", fin), ("regions", rm))):
            dd.text((x + 3, j * (64 * sc + 14) + 1), f"s{s} {lab}", fill=(255, 255, 255))
            out.paste(tile(im, sc), (x, j * (64 * sc + 14) + 14))
    OUT.mkdir(parents=True, exist_ok=True)
    out.save(OUT / "stand_seeds_x4.png")
    (RAW / "stand_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    for s, v in summary.items():
        print(s, v["measure"], v["colours"], v["regions"], "out", v["outside_palette"])


def stand_pick(seed: int):
    src = RAW / f"stand_s{seed}"
    OUT.mkdir(parents=True, exist_ok=True)
    img = Image.open(src / "stand_64.png")
    img.save(OUT / "stand.png")
    c = Image.new("RGBA", (64, 64), (255, 0, 255, 255))
    c.alpha_composite(img)
    c.convert("RGB").resize((512, 512), Image.NEAREST).save(RAW / "stand_key_512.png")  # video first/last frame
    region_map(img).resize((256, 256), Image.NEAREST).save(OUT / "stand_regions_x4.png")
    meta = {"stand": {"seed": seed, "prompt": STAND_PROMPT,
                      "references": {"Picture 1": "art/ai/mannequins/M/stand34_64.png x16 (M mannequin, 3/4)",
                                     "Picture 2": "public/assets/sprites/zombie_basic.png frame 0 x16",
                                     "Picture 3": "art/ai/style/anchor.png x5"},
                      "workflow": "art/ai/workflows/h3_image_edit_3ref.json (1024x1024)",
                      "seeds": json.loads((RAW / "stand_summary.json").read_text(encoding="utf-8")),
                      "generation": json.loads((src / "meta.json").read_text(encoding="utf-8"))[-1]}}
    write_meta(meta)
    print("stand picked", seed)


def write_meta(update: dict):
    p = OUT / "meta.json"
    meta = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    meta.update(update)
    meta["post"] = ("grid phase -> key magenta -> k_centroid -> foot y=61 -> region-locked quantize (raw region -> "
                    "master.gpl colours of that region; kmeans 48 + cloth 3) -> edge pixels = near-black outline -> "
                    "islands <=2px -> <=16 colours merged within regions jointly over all frames")
    meta["regions"] = "outline v<0.11 | shirt s<0.07 & v>0.58 | pants hue 165-230 & s>0.15 | skin hue 70-165 & s>=0.07"
    p.write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------- walk

def walk_gen(seeds: list[int]):
    key = RAW / "stand_key_512.png"
    for s in seeds:
        print("walk", s, run([PY, "-I", ROOT / "tools/art/ai/run_comfy.py", ROOT / "art/ai/workflows/h3_video_i2v.json",
                              "--image", f"first={key}", "--image", f"last={key}",
                              "--set", "scale_first.width=512", "--set", "scale_first.height=512",
                              "--set", "scale_last.width=512", "--set", "scale_last.height=512",
                              "--set", "cond.width=512", "--set", "cond.height=512", "--set", "cond.length=56",
                              "--set", f"noise.noise_seed={s}", "--set", f"cond.prompt={WALK_PROMPT}",
                              "--set", f"save.filename_prefix=ai_art/zombie9_walk_s{s}",
                              "--out", RAW / f"walk_s{s}", "--tag", f"r9 zombie walk seed {s}"]), flush=True)


def walk_frames(s: int, rp, stand_h8: int) -> tuple[list[Image.Image], list[Image.Image], dict]:
    d = RAW / f"walk_s{s}"
    frames = sorted(d.glob("zombie9_walk_*.png"))
    pick = d / "pick"
    if pick.exists():
        shutil.rmtree(pick)
    info = json.loads(subprocess.run([str(PY), "-I", str(ROOT / "tools/art/ai/pick_frames.py"), "loop",
                                      *map(str, frames), "-n", "8", "--min-period", "16", "--max-period", "48",
                                      "--out", str(pick)], capture_output=True, text=True, cwd=ROOT,
                                     encoding="utf-8").stdout.strip().splitlines()[-1])
    picked = sorted(pick.glob("[0-9][0-9].png"))
    # scale: the first video frame is the stand key (56 px tall at 8x) -> keep that size
    k0 = key_magenta(Image.open(frames[0]))
    ys = np.where(np.array(k0)[..., 3] > 128)[0]
    scale = stand_h8 / (ys.max() - ys.min() + 1)
    ds = d / "ds"
    if ds.exists():
        shutil.rmtree(ds)
    downscale(picked, ds, scale, align="hybrid")
    small = [largest_blob(Image.open(ds / f"{i:02d}.png").convert("RGBA")) for i in range(len(picked))]
    q = [quantize_regions(f, rp) for f in small]
    fin, tinfo = tidy_frames(q)
    info.update(tinfo, scale=round(float(scale), 4))
    return small, fin, info


def walk_post():
    rp = region_palettes()
    stand = Image.open(OUT / "stand.png")
    stand_h8 = measure(stand)["height"] * 8
    rows, summary = [], {}
    for d in sorted(p for p in RAW.glob("walk_s*") if p.is_dir()):
        s = int(d.name.split("_s")[-1])
        if not list(d.glob("zombie9_walk_*.png")):
            continue
        small, fin, info = walk_frames(s, rp, stand_h8)
        fd = d / "final"
        fd.mkdir(exist_ok=True)
        for i, f in enumerate(fin):
            f.save(fd / f"{i:02d}.png")
        hs = [measure(f)["height"] for f in fin]
        st = strip(fin)
        st.save(fd / "walk.png")
        info.update(heights=hs, regions=region_stats(st),
                    outside_palette=check(fd / "walk.png")["outside_palette"])
        summary[s] = info
        rows.append((s, fin, info))
    sc = 3
    cw = 64 * sc
    out = Image.new("RGB", (8 * cw, len(rows) * (cw + 16)), (20, 20, 20))
    dd = ImageDraw.Draw(out)
    for r, (s, fin, info) in enumerate(rows):
        y = r * (cw + 16)
        dd.text((3, y + 2), f"seed {s}  period {info.get('period')} start {info.get('start')}  "
                            f"{info['colours'][1]}c  h {min(info['heights'])}-{max(info['heights'])}", fill=(255, 255, 255))
        for i, f in enumerate(fin):
            out.paste(tile(f, sc), (i * cw, y + 16))
    out.save(OUT / "walk_seeds_x3.png")
    (RAW / "walk_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    for s, v in summary.items():
        print(s, "period", v.get("period"), "start", v.get("start"), "colours", v["colours"], "h", v["heights"],
              "regions", v["regions"], "out", v["outside_palette"])


def walk_pick(seed: int):
    fd = RAW / f"walk_s{seed}" / "final"
    meta_in = {"seed": seed, "prompt": WALK_PROMPT, "first_last": "stand.png x8 on magenta (stand_key_512.png)",
               "workflow": "art/ai/workflows/h3_video_i2v.json 512x512, 56 frames",
               "seeds": json.loads((RAW / "walk_summary.json").read_text(encoding="utf-8")),
               "generation": json.loads((RAW / f"walk_s{seed}" / "meta.json").read_text(encoding="utf-8"))[-1]}
    mp = RAW / "walk_meta.json"
    mp.write_text(json.dumps(meta_in, ensure_ascii=False), encoding="utf-8")
    subprocess.run([str(PY), "-I", str(ROOT / "tools/art/ai/build_sheet.py"), str(fd), "--name", "walk", "--fps", "8",
                    "--loop", "--out", str(OUT)], check=True, cwd=ROOT)
    frames = [Image.open(fd / f"{i:02d}.png") for i in range(8)]
    strip([region_map(f) for f in frames]).resize((64 * 8 * 4, 256), Image.NEAREST).save(OUT / "walk_regions_x4.png")
    write_meta({"walk": meta_in})
    print("walk picked", seed)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["refs", "stand-gen", "stand-post", "stand-pick", "walk-gen", "walk-post", "walk-pick"])
    ap.add_argument("seed", nargs="?", type=int)
    ap.add_argument("--seeds", nargs="*", type=int, default=[1, 2, 3, 4])
    a = ap.parse_args()
    {"refs": lambda: refs(), "stand-gen": lambda: stand_gen(a.seeds), "stand-post": stand_post,
     "stand-pick": lambda: stand_pick(a.seed), "walk-gen": lambda: walk_gen(a.seeds), "walk-post": walk_post,
     "walk-pick": lambda: walk_pick(a.seed)}[a.cmd]()


if __name__ == "__main__":
    main()
