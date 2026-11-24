"""Faceless S/M/L/XL mannequins standing (AI_ART_PIPELINE §4.2), anchor.png as style ref.

Round 7: pure side view (art/ai/mannequins/<size>/side_stand_*.png, kept for reference).
Round 8: three-quarter view like Akai (all humanoids), XL split into XL_fat / XL_strong,
characters <= 16 colours -> art/ai/mannequins/<size>/stand34_*.png.

  python tools/art/ai/build_mannequins.py refs                 # proportion refs (1024, 16x) + anchor ref
  python tools/art/ai/build_mannequins.py gen [--sizes S M L XL] [--seeds 1 2 3 4]
  python tools/art/ai/build_mannequins.py post                 # 64x64 on master.gpl, measure, 4-seed sheets
  python tools/art/ai/build_mannequins.py pick S=2 M=1 L=3 XL_fat=4 XL_strong=1

Spec (§4.2): height 48/56/60/62, head 14/16/17/18, XL 1.4x as wide as M. Foot row y=61, centre x=32.
Source of the proportions (round 8): art/ai/mannequins/M/stand_512.png, the round-2 three-quarter M
mannequin (56 px, head 16, neck row 22, 28 px wide).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from build_palette import check, load_gpl  # noqa: E402
from pixelize import cleanup, despill, limit_colours, quantize, remove_islands  # noqa: E402
from sprite_utils import k_centroid, key_magenta  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "art/ai/raw/mannequins8"
OUT = ROOT / "art/ai/mannequins"
PY = ROOT / ".venv-art/Scripts/python.exe"
SRC = ROOT / "art/ai/mannequins/M/stand_512.png"  # three-quarter view
SRC_NECK_64 = 22          # narrowest neck row of the M profile (64 px space)
SRC_BODY_64 = 61 - 22 + 1  # body rows below the neck: 40
G = 16                     # generation scale: 1024 / 64
FOOT = 61
MAX_COLOURS = 16  # round 8: characters (humanoids) <= 16 colours; objects stay <= 10
OUT_NAME = "stand34"
SIZES = {  # height, head, width factor vs M (body), prompt extra
    "S": (48, 14, None, "a small, slim child-sized body"),
    "M": (56, 16, None, "an average adult body"),
    "L": (60, 17, None, "a tall, slightly broader adult body"),
    "XL_fat": (62, 18, 1.4, "a very heavy, broad, big-bellied body, 1.4 times as wide as an average adult"),
    "XL_strong": (62, 18, 1.4, "a huge, powerfully muscular body: very broad shoulders and a thick deep chest, the "
                               "waist clearly narrower than the shoulders, a flat stomach with no belly, thick arms and "
                               "legs, 1.4 times as wide as an average adult at the shoulders"),
}
REF_OF = {"XL_fat": "XL", "XL_strong": "XL"}  # both XL bodies start from the same 1.4x proportion ref

PROMPT = (
    "Redraw <Picture 1> as a clean pixel art game sprite for a 2D side-scrolling game: a faceless grey "
    "artist's mannequin with {extra}; no face, no eyes, no mouth, no hair, no clothes, no shoes, smooth plain "
    "head. Three-quarter view like the boy in <Picture 2>: the body faces right with the torso turned slightly "
    "toward the camera, so the chest and both shoulders are visible; standing upright and relaxed, arms hanging "
    "down at the sides, legs straight. Keep exactly the same position, total height, head size and body width as in <Picture 1>, "
    "feet on the same ground line. Draw it in exactly the pixel art style of <Picture 2>, as if by the same artist: "
    "a single light source from the upper left at 45 degrees, lit surfaces on the upper left and shadowed surfaces "
    "on the lower right, 3 to 4 shading steps, a 1 pixel dark coloured outline that is darker on the bottom and right "
    "side, muted grey-green colours. Plain solid magenta background, no ground, no floor line, no cast shadow, no text."
)


# ---------------------------------------------------------------- refs

def refs():
    RAW.mkdir(parents=True, exist_ok=True)
    m_w = None
    for size, (h, head, wf, _) in SIZES.items():
        if size in REF_OF:
            size = REF_OF[size]
            if (RAW / f"ref_{size}.png").exists():
                continue
        body = h - head
        bs = body / SRC_BODY_64
        body_width = 1.0 if wf is None else wf / bs  # XL: final body width = 1.4 x M
        out = RAW / f"ref_{size}.png"
        subprocess.run([str(PY), "-I", str(ROOT / "tools/art/ai/make_mannequin_ref.py"), str(SRC),
                        str(SRC_NECK_64 * 8), str(out), "--head", str(head), "--height", str(h),
                        "--body-width", f"{body_width:.4f}"], check=True, cwd=ROOT)
    a = Image.open(ROOT / "art/ai/style/anchor.png").convert("RGBA")
    big = a.resize((a.width * 5, a.height * 5), Image.NEAREST)
    c = Image.new("RGBA", (1024, 1024), (255, 0, 255, 255))
    c.alpha_composite(big, ((1024 - big.width) // 2, (1024 - big.height) // 2))
    c.convert("RGB").save(RAW / "anchor_ref_1024.png")
    sheet_refs()


def sheet_refs():
    tiles = []
    for size in dict.fromkeys(REF_OF.get(k, k) for k in SIZES):
        im = Image.open(RAW / f"ref_{size}.png").convert("RGB").resize((256, 256), Image.NEAREST)
        tiles.append((size, im))
    out = Image.new("RGB", (256 * len(tiles), 270), (20, 20, 20))
    d = ImageDraw.Draw(out)
    for i, (lab, im) in enumerate(tiles):
        out.paste(im, (i * 256, 14))
        d.text((i * 256 + 3, 1), f"ref {lab}", fill=(255, 255, 255))
    out.save(RAW / "refs_sheet.png")


# ---------------------------------------------------------------- gen

def gen(sizes: list[str], seeds: list[int], tag: str):
    for size in sizes:
        extra = SIZES[size][3]
        for s in seeds:
            out = RAW / f"{size}_s{s}"
            cmd = [str(PY), "-I", str(ROOT / "tools/art/ai/run_comfy.py"), str(ROOT / "art/ai/workflows/h3_image_edit.json"),
                   "--image", f"load1={RAW / f'ref_{REF_OF.get(size, size)}.png'}", "--image", f"load2={RAW / 'anchor_ref_1024.png'}",
                   "--set", f"sampler.seed={s}", "--set", f"cond.prompt={PROMPT.format(extra=extra)}",
                   "--set", f"save.filename_prefix=ai_art/mannequin_{size}_s{s}", "--out", str(out),
                   "--tag", f"{tag} {size} seed {s}"]
            r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", cwd=ROOT)
            print(f"{size} seed {s}:", (r.stdout.strip().splitlines() or [""])[-1], r.stderr[-400:] if r.returncode else "",
                  flush=True)


# ---------------------------------------------------------------- post

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
        keep = int(np.argmax(sizes)) + 1
        a[(lab != keep) & (lab > 0), 3] = 0
    return Image.fromarray(a, "RGBA")


def place_feet(img: Image.Image) -> tuple[Image.Image, int]:
    a = np.array(img)
    ys, xs = np.where(a[..., 3] > 0)
    dy = FOOT - int(ys.max())
    out = np.zeros_like(a)
    ty = ys + dy
    ok = (ty >= 0) & (ty < a.shape[0])
    out[ty[ok], xs[ok]] = a[ys[ok], xs[ok]]
    return Image.fromarray(out, "RGBA"), dy


def measure(img: Image.Image) -> dict:
    """Height, head height (top -> narrowest neck row in the upper 15-45%), torso width (rows 45-65%)."""
    a = np.array(img)[..., 3] > 0
    ys, xs = np.where(a)
    top, bot = int(ys.min()), int(ys.max())
    h = bot - top + 1
    widths = a.sum(1)
    # neck = last row of the narrow band below the head (width <= narrowest + 1) in the 25-45% window;
    # the head as specified runs from the top to that row (make_mannequin_ref cuts just below it)
    lo, hi = top + int(h * 0.25), top + int(h * 0.45)
    w = widths[lo:hi + 1]
    neck = lo + int(np.where(w <= w.min() + 1)[0].max()) + 1
    torso = a[top + int(h * 0.45): top + int(h * 0.65)].sum(1)
    return {"height": h, "head": neck - top, "neck_row": neck, "top": top, "bottom": bot,
            "width": int(xs.max() - xs.min() + 1), "torso_width": int(np.median(torso))}


def post_one(raw: Path, pal: np.ndarray) -> tuple[Image.Image, Image.Image, dict]:
    img = Image.open(raw).convert("RGB")
    ox, oy = grid_phase(img, G)
    if ox or oy:
        pad = Image.new("RGB", img.size, (255, 0, 255))
        pad.paste(img.crop((ox, oy, img.width, img.height)), (0, 0))
        img = pad
    small = largest_blob(k_centroid(despill(key_magenta(img)), G))
    small, dy = place_feet(small)
    q = quantize(small, pal)
    c = quantize(cleanup(q, pal, outline=True), pal)
    c, n1 = remove_islands(c, 2)
    c, cc = limit_colours(c, MAX_COLOURS)
    c, n2 = remove_islands(c, 2)
    return small, c, {"grid_phase": [ox, oy], "foot_shift": dy, "colours": cc, "island_px_fixed": n1 + n2}


def light(img: Image.Image) -> float:
    from pixelize import srgb_to_oklab
    a = np.array(img)
    op = a[..., 3] > 0
    L = srgb_to_oklab(a[..., :3].reshape(-1, 3))[:, 0].reshape(op.shape)
    ys, xs = np.where(op)
    ul = op & (np.add.outer(np.arange(64) - ys.mean(), np.arange(64) - xs.mean()) < 0)
    return round(float(L[ul].mean() - L[op & ~ul].mean()), 3)


def tile(img: Image.Image, scale: int, meas: dict | None, spec: tuple | None) -> Image.Image:
    bg = Image.new("RGBA", img.size, (255, 0, 255, 255))
    bg.alpha_composite(img.convert("RGBA"))
    t = bg.convert("RGB").resize((64 * scale, 64 * scale), Image.NEAREST)
    d = ImageDraw.Draw(t)
    d.line([(0, (FOOT + 1) * scale), (t.width, (FOOT + 1) * scale)], fill=(0, 255, 0))
    if spec:
        h, head = spec[0], spec[1]
        d.line([(0, (FOOT + 1 - h) * scale), (t.width, (FOOT + 1 - h) * scale)], fill=(255, 255, 255))
        d.line([(0, (FOOT + 1 - h + head) * scale), (16 * scale, (FOOT + 1 - h + head) * scale)], fill=(255, 255, 0))
    return t


def post():
    pal = load_gpl()[:48]  # mannequins: 48 main colours only
    summary = {}
    for size, spec in SIZES.items():
        rows = []
        for d in sorted(p for p in RAW.glob(f"{size}_s*") if p.name.split("_s")[-1].isdigit()):
            raws = sorted(d.glob("mannequin_*.png"))
            if not raws:
                continue
            s = int(d.name.split("_s")[-1])
            small, clean, info = post_one(raws[-1], pal)
            clean.save(d / "stand_64.png")
            small.save(d / "stand_64_unquant.png")
            m = measure(clean)
            chk = check(d / "stand_64.png", load_gpl())
            info.update(measure=m, light_ul_minus_lr=light(clean), outside_palette=chk["outside_palette"])
            summary.setdefault(size, {})[s] = info
            rows.append((s, small, clean, m, info))
        if not rows:
            continue
        sc = 4
        W1 = 64 * sc
        out = Image.new("RGB", (len(rows) * (W1 + 6), 2 * (W1 + 14) + 4), (20, 20, 20))
        dd = ImageDraw.Draw(out)
        for i, (s, small, clean, m, info) in enumerate(rows):
            x = i * (W1 + 6)
            dd.text((x + 3, 1), f"{size} s{s} raw/16", fill=(200, 200, 200))
            out.paste(tile(small, sc, None, spec), (x, 14))
            lab = f"h{m['height']} head{m['head']} w{m['torso_width']} {info['colours'][1]}c"
            dd.text((x + 3, W1 + 15), lab, fill=(255, 255, 255))
            out.paste(tile(clean, sc, m, spec), (x, W1 + 28))
        out.save(OUT / f"r8_{size}_seeds_x4.png")
    (RAW / "post_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    for size, v in summary.items():
        for s, info in v.items():
            m = info["measure"]
            print(size, s, "h", m["height"], "head", m["head"], "w", m["width"], "torso", m["torso_width"],
                  "c", info["colours"], "isl", info["island_px_fixed"], "light", info["light_ul_minus_lr"],
                  "out", info["outside_palette"])


def pick(choice: dict[str, int]):
    summary = json.loads((RAW / "post_summary.json").read_text(encoding="utf-8"))
    tiles, meta = [], {"spec": {k: {"height": v[0], "head": v[1], "width_vs_M": v[2]} for k, v in SIZES.items()},
                       "workflow": "art/ai/workflows/h3_image_edit.json",
                       "references": {"Picture 1": "art/ai/raw/mannequins8/ref_<size>.png: three-quarter M stand_512 cut "
                                                   "at the neck, head/body rescaled by make_mannequin_ref.py (1024, 16x); "
                                                   "XL_fat and XL_strong share ref_XL",
                                      "Picture 2": "art/ai/style/anchor.png x5 centred on 1024 magenta"},
                       "palette": "art/ai/palette/master.gpl (main 48 only)",
                       "post": "grid phase (16) -> key -> k_centroid /16 -> largest blob -> foot y=61 -> quantize -> "
                               "cleanup (selout outline) -> quantize -> islands <=2px -> <=16 colours -> islands",
                       "prompt": PROMPT, "picked": {}, "seeds": summary}
    for size, s in choice.items():
        src = RAW / f"{size}_s{s}"
        dst = OUT / size
        dst.mkdir(parents=True, exist_ok=True)
        img = Image.open(src / "stand_64.png")
        img.save(dst / f"{OUT_NAME}_64.png")
        img.resize((512, 512), Image.NEAREST).save(dst / f"{OUT_NAME}_512.png")
        meta["picked"][size] = {"seed": s, "generation": json.loads((src / "meta.json").read_text(encoding="utf-8"))[-1]}
        tiles.append((size, img, summary[size][str(s)]["measure"]))
    sc = 4
    out = Image.new("RGB", (len(tiles) * 64 * sc, 64 * sc + 14), (20, 20, 20))
    d = ImageDraw.Draw(out)
    for i, (size, img, m) in enumerate(tiles):
        out.paste(tile(img, sc, m, SIZES[size]), (i * 64 * sc, 14))
        d.text((i * 64 * sc + 3, 1), f"{size}: h{m['height']} w{m['width']} torso{m['torso_width']}", fill=(255, 255, 255))
    out.save(OUT / "r8_lineup_x4.png")
    # all four on one strip next to the anchor's Akai for scale
    strip = Image.new("RGBA", (64 * (len(tiles) + 1), 64), (0, 0, 0, 0))
    strip.alpha_composite(Image.open(ROOT / "art/ai/style/anchor.png").convert("RGBA").crop((0, 0, 38, 64)), (13, 0))
    for i, (_, img, _) in enumerate(tiles):
        strip.alpha_composite(img.convert("RGBA"), (64 * (i + 1), 0))
    bg = Image.new("RGBA", strip.size, (255, 0, 255, 255))
    bg.alpha_composite(strip)
    bg.convert("RGB").resize((strip.width * 4, 256), Image.NEAREST).save(OUT / "r8_with_akai_x4.png")
    (OUT / "r8_meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    print("picked", choice)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["refs", "gen", "post", "pick"])
    ap.add_argument("choice", nargs="*")
    ap.add_argument("--sizes", nargs="*", default=list(SIZES))
    ap.add_argument("--seeds", nargs="*", type=int, default=[1, 2, 3, 4])
    ap.add_argument("--tag", default="r8 mannequin 3/4")
    a = ap.parse_args()
    if a.cmd == "refs":
        refs()
    elif a.cmd == "gen":
        gen(a.sizes, a.seeds, a.tag)
    elif a.cmd == "post":
        post()
    else:
        pick({k: int(v) for k, v in (c.split("=") for c in a.choice)})


if __name__ == "__main__":
    main()
