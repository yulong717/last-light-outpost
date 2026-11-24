"""Style anchor (STYLE_ANCHOR §2): Akai + fog zombie + crate + oil drum + street lamp in one 192x64 strip.

  python tools/art/ai/build_anchor.py layout          # Picture 1 (layout, 8x) + refs 16x
  python tools/art/ai/build_anchor.py gen --seeds 1 2 3 4 [--prompt-file F]
  python tools/art/ai/build_anchor.py post            # every raw seed -> 192x64 on master.gpl + sheets
  python tools/art/ai/build_anchor.py pick SEED       # copy chosen seed to art/ai/style/anchor*.png

Why 192x64 instead of the 512x512 in the doc: the five objects are ~106 px wide side by side, they do
not fit a 64x64 cell; the strip keeps the doc's 8x rule (generate 1536x512, /8) and the 64 px height.
Each object gets its own slot; targets are the spec sizes at 32 px/m.
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
from build_palette import IDENTITY, check, load_gpl, lstar, part  # noqa: E402
from pixelize import cleanup, despill, limit_colours, quantize, remove_islands, srgb_to_oklab  # noqa: E402
from sprite_utils import k_centroid, key_magenta  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "art/ai/raw/style"
OUTD = ROOT / "art/ai/style"
W, H, S = 192, 64, 8
FOOT = 61  # last opaque row
# slot: name, x range in the 192 strip, target (w, h)
SLOTS = [
    ("akai", (0, 38), (28, 56)),  # 3.5-head paste-up of akai_ai_idle frame 0 (akai_35)
    ("zombie", (38, 98), (None, 56)),
    ("crate", (98, 126), (21, 19)),
    ("drum", (126, 154), (19, 28)),
    ("lamp", (154, 192), (14, 64)),
]

PROMPT = (
    "Pixel art game sprites for a 2D side-scrolling zombie survival game, five objects standing in one row "
    "on a plain solid magenta background. Redraw <Picture 1> and keep every object at exactly the same "
    "position and size, all feet and bottoms on the same ground line. "
    "From left to right: "
    "(1) the boy keeps exactly the body proportions he has in <Picture 1>: a small head and a long body, "
    "3.5 heads tall, not chibi, not big-headed; take only his face, clothes and colours from <Picture 2>: "
    "navy baseball cap, curly dark brown hair, white pinstripe baseball jersey with a red number 7, navy shorts, "
    "bandaged knees, red and white sneakers; three-quarter view facing right, relaxed standing pose, arms down. "
    "(2) the fog zombie from <Picture 3> in the same lurching pose with arms reaching forward: grey-green skin, "
    "torn pale grey shirt, dark blue-grey trousers. "
    "(3) a small wooden supply crate made of horizontal planks with a diagonal brace. "
    "(4) an upright red-brown painted steel oil drum, exactly as tall as in <Picture 1>, with two raised ribs, a rim on top, "
    "clean shaded paint with only a few small rust spots. "
    "(5) the lower part of a dark iron street lamp post: a heavy stepped base and the thin pole rising straight "
    "up out of the top edge of the picture. "
    "One consistent style for all five, as if drawn by the same artist: crisp pixel art, side view, a single light "
    "source from the upper left at 45 degrees, lit surfaces on the upper left and shadowed surfaces on the lower right, "
    "3 to 4 shading steps per surface, a 1 pixel dark coloured outline around every object that is darker on the bottom "
    "and right side, muted grey-green post-apocalyptic colours with low saturation, only the boy and the oil drum "
    "a little more colourful. No ground, no floor line, no cast shadows, no background scenery, no text, no frames."
)


# round 7 review: drum re-run with big flat rust shapes (seed 2 is kept for everything else)
PROMPT_DRUM = PROMPT.replace(
    "clean shaded paint with only a few small rust spots. ",
    "large flat rust patches, simple shapes, no small specks or noise. ")
assert PROMPT_DRUM != PROMPT

# round 8 review: Akai re-run for brown hair + visible pinstripes (only his slot is used)
PROMPT_AKAI = PROMPT.replace(
    "curly dark brown hair, white pinstripe baseball jersey with a red number 7,",
    "curly chestnut-brown hair that is clearly brown, not black, showing under the cap; a white baseball jersey "
    "with clearly visible thin vertical blue pinstripes evenly spaced across the whole jersey, and a red number 7;")
assert PROMPT_AKAI != PROMPT
# round 8 review: red painted drum with big rust patches, not an all-brown drum
PROMPT_DRUM8 = PROMPT_DRUM.replace(
    "(4) an upright red-brown painted steel oil drum,",
    "(4) an upright steel oil drum painted bright crimson red (the same red as the boy's number 7),").replace(
    "large flat rust patches, simple shapes, no small specks or noise. ",
    "the red paint covers most of the drum, with a few large flat brown rust patches, simple shapes, "
    "no small specks or noise; it must not look like a brown drum. ")
assert PROMPT_DRUM8 != PROMPT_DRUM and "crimson" in PROMPT_DRUM8 and "covers most" in PROMPT_DRUM8

# round 9 review: arms hanging at the sides with forearms and hands visible (layout_akai9 shows the pose)
PROMPT_AKAI9 = PROMPT_AKAI.replace(
    "(1) the boy keeps exactly the body proportions he has in <Picture 1>:",
    "(1) the boy keeps exactly the body proportions and the pose he has in <Picture 1>:").replace(
    "relaxed standing pose, arms down.",
    "relaxed standing pose with both arms hanging naturally straight down at his sides, his bare forearms and "
    "hands clearly visible in skin colour below the short sleeves, hands beside his thighs, not crossed, not "
    "behind his back.")
assert PROMPT_AKAI9 != PROMPT_AKAI and "forearms" in PROMPT_AKAI9
# round 9 review: danger-red drum with explicit cylinder shading
PROMPT_DRUM9 = PROMPT_DRUM8.replace(
    "the red paint covers most of the drum, with a few large flat brown rust patches, simple shapes, "
    "no small specks or noise; it must not look like a brown drum. ",
    "the red paint covers most of the drum, with a few large flat brown rust patches, simple shapes, no small "
    "specks or noise; clear cylinder shading: one bright lit vertical column along its left side, one dark shaded "
    "vertical column along its right side, and a bright highlight line along the top rim. ")
assert PROMPT_DRUM9 != PROMPT_DRUM8 and "lit vertical column" in PROMPT_DRUM9

# variant -> (raw dir prefix, prompt, slot shown in its sheet, layout file)
VARIANTS = {
    "base": ("s", PROMPT, None, "layout_8x.png"),
    "drum": ("drum_s", PROMPT_DRUM, "drum", "layout_8x.png"),
    "akai8": ("akai8_s", PROMPT_AKAI, "akai", "layout_8x.png"),
    "drum8": ("drum8_s", PROMPT_DRUM8, "drum", "layout_8x.png"),
    "akai9": ("akai9_s", PROMPT_AKAI9, "akai", "layout_akai9_8x.png"),
    "drum9": ("drum9_s", PROMPT_DRUM9, "drum", "layout_8x.png"),
}


# ---------------------------------------------------------------- layout

def _box(d, x0, y0, x1, y1, c):
    d.rectangle([x0, y0, x1, y1], fill=c)


def draw_props(img: Image.Image):
    """Rough placeholder props in 64-space, left-top lit, dark outline. H3 redraws them."""
    d = ImageDraw.Draw(img)
    ol = (34, 30, 26, 255)
    # crate 21x19 at x 102..122, y 43..61
    x0, y0, x1, y1 = 102, 43, 122, 61
    _box(d, x0, y0, x1, y1, ol)
    _box(d, x0 + 1, y0 + 1, x1 - 1, y1 - 1, (127, 96, 69, 255))
    _box(d, x0 + 1, y0 + 1, x1 - 1, y0 + 2, (160, 130, 96, 255))  # lit top
    _box(d, x0 + 1, y0 + 1, x0 + 2, y1 - 1, (160, 130, 96, 255))  # lit left
    _box(d, x1 - 2, y0 + 1, x1 - 1, y1 - 1, (92, 67, 48, 255))   # dark right
    for yy in (y0 + 6, y0 + 12):
        d.line([(x0 + 1, yy), (x1 - 1, yy)], fill=(92, 67, 48, 255))
    d.line([(x0 + 2, y1 - 2), (x1 - 2, y0 + 2)], fill=(92, 67, 48, 255))
    # drum 19x28 at x 130..148, y 34..61
    x0, y0, x1, y1 = 130, 34, 148, 61
    _box(d, x0, y0, x1, y1, (40, 22, 18, 255))
    _box(d, x0 + 1, y0 + 1, x1 - 1, y1 - 1, (147, 73, 47, 255))
    _box(d, x0 + 1, y0 + 1, x0 + 4, y1 - 1, (176, 101, 63, 255))
    _box(d, x1 - 5, y0 + 1, x1 - 1, y1 - 1, (106, 51, 38, 255))
    for yy in (y0 + 9, y0 + 18):
        d.line([(x0, yy), (x1, yy)], fill=(62, 31, 25, 255))
    d.line([(x0 + 1, y0 + 1), (x1 - 1, y0 + 1)], fill=(176, 101, 63, 255))
    # lamp: base 14 wide x 164..177, y 52..61; pole 6 wide x 168..173 up to y 0
    st = ((126, 137, 132, 255), (90, 100, 96, 255), (61, 69, 66, 255), (30, 34, 33, 255))
    _box(d, 164, 52, 177, 61, st[3])
    _box(d, 165, 53, 176, 60, st[1])
    _box(d, 165, 53, 166, 60, st[0])
    _box(d, 174, 53, 176, 60, st[2])
    _box(d, 166, 46, 175, 52, st[3])
    _box(d, 167, 47, 174, 51, st[1])
    _box(d, 168, 0, 173, 46, st[3])
    _box(d, 169, 0, 172, 45, st[1])
    _box(d, 169, 0, 169, 45, st[0])
    _box(d, 172, 0, 172, 45, st[2])


def paste_figure(canvas: Image.Image, fig: Image.Image, cx_target: int, height: int | None = None):
    a = np.array(fig)
    ys, xs = np.where(a[..., 3] > 0)
    crop = fig.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    if height and crop.height != height:
        crop = crop.resize((round(crop.width * height / crop.height), height), Image.NEAREST)
    # torso centre (35-60% band)
    b = np.array(crop)[..., 3] > 0
    band = b[int(crop.height * .35): int(crop.height * .6)]
    cx = int(np.median(np.where(band)[1]))
    canvas.alpha_composite(crop, (cx_target - cx, FOOT + 1 - crop.height))


NECK_Y = 23  # akai_ai_idle frame 0: narrowest row between head and shoulders


def akai_35(akai: Image.Image) -> Image.Image:
    """Akai frame 0 re-proportioned to 3.5 heads at 8x: head (rows top..NECK_Y) -> 16 px,
    body (NECK_Y+1..61) -> 40 px tall, x1.05 wide. Rough paste-up; H3 redraws it."""
    a = np.array(akai)
    ys, xs = np.where(a[..., 3] > 0)
    top = ys.min()
    big = akai.resize((64 * S, 64 * S), Image.NEAREST)
    head = big.crop((0, top * S, 64 * S, (NECK_Y + 1) * S))
    body = big.crop((0, (NECK_Y + 1) * S, 64 * S, (FOOT + 1) * S))
    hs = 16 / (NECK_Y + 1 - top)
    head = head.resize((round(head.width * hs), 16 * S), Image.LANCZOS)
    body = body.resize((round(body.width * 1.05), 40 * S), Image.LANCZOS)
    out = Image.new("RGBA", (64 * S, 64 * S), (0, 0, 0, 0))
    bx = (64 * S - body.width) // 2
    out.alpha_composite(body, (bx, (FOOT + 1 - 40) * S))
    # head: keep its horizontal position relative to the body (face centre over the torso)
    hx_src = 32 * S * hs
    out.alpha_composite(head, (round(32 * S - hx_src), (FOOT + 1 - 56) * S))
    al = np.array(out)
    al[..., 3] = np.where(al[..., 3] > 128, 255, 0)
    return Image.fromarray(al, "RGBA")


def layout():
    RAW.mkdir(parents=True, exist_ok=True)
    akai = Image.open(ROOT / "public/assets/sprites/akai_ai_idle.png").convert("RGBA").crop((0, 0, 64, 64))
    zomb = Image.open(ROOT / "public/assets/sprites/zombie_basic.png").convert("RGBA").crop((0, 0, 64, 64))
    mann = Image.open(ROOT / "art/ai/mannequins/M/stand_64.png").convert("RGBA")
    c = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    paste_figure(c, mann, 20)            # 56 tall, 3.5 heads
    paste_figure(c, zomb, 64, height=56)
    draw_props(c)
    mag = Image.new("RGBA", (W, H), (255, 0, 255, 255))
    mag.alpha_composite(c)
    big = mag.resize((W * S, H * S), Image.NEAREST)
    # akai slot: 3.5-head paste-up instead of the bare mannequin
    a35 = akai_35(akai)
    ys, xs = np.where(np.array(a35)[..., 3] > 0)
    big.paste(Image.new("RGBA", (38 * S, H * S), (255, 0, 255, 255)), (0, 0))
    big.alpha_composite(a35, (20 * S - int(np.median(xs)), 0))
    big.convert("RGB").save(RAW / "layout_8x.png")
    c.save(RAW / "layout_64.png")
    for name, im in (("akai_ref_16x.png", akai), ("zombie_ref_16x.png", zomb)):
        m = Image.new("RGBA", im.size, (255, 0, 255, 255))
        m.alpha_composite(im)
        m.convert("RGB").resize((1024, 1024), Image.NEAREST).save(RAW / name)
    print("layout ->", RAW / "layout_8x.png")


def layout_akai9():
    """Round 9: Akai slot = three-quarter M mannequin (stand34, arms hanging at the sides) with the head of the
    3.5-head Akai paste-up on top, so H3 keeps the arms-down pose; the other slots as layout_8x."""
    base = Image.open(RAW / "layout_8x.png").convert("RGBA")
    mann = Image.open(ROOT / "art/ai/mannequins/M/stand34_512.png").convert("RGBA")  # 8x, 56 tall, foot y=61
    akai = Image.open(ROOT / "public/assets/sprites/akai_ai_idle.png").convert("RGBA").crop((0, 0, 64, 64))
    a35 = akai_35(akai)
    ys, xs = np.where(np.array(mann)[..., 3] > 0)
    mcx = int(np.median(xs))
    out = base.copy()
    out.paste(Image.new("RGBA", (38 * S, H * S), (255, 0, 255, 255)), (0, 0))
    dx = 20 * S - mcx
    out.alpha_composite(mann, (dx, 0))
    head = a35.crop((0, 0, 64 * S, (FOOT + 1 - 40) * S))  # top 16 rows of the figure = the head
    hb = np.array(head)
    hys, hxs = np.where(hb[..., 3] > 0)
    # put the head's centre over the mannequin's head centre
    mhead = np.array(mann)[: (FOOT + 1 - 40) * S]
    mys, mxs = np.where(mhead[..., 3] > 0)
    hx = int(np.median(mxs)) + dx - int(np.median(hxs))
    # clear the mannequin head, then paste Akai's head
    cl = np.array(out)
    cl[: (FOOT + 1 - 40) * S, : 38 * S] = [255, 0, 255, 255]
    out = Image.fromarray(cl, "RGBA")
    out.alpha_composite(head, (hx, 0))
    out.convert("RGB").save(RAW / "layout_akai9_8x.png")
    print("layout ->", RAW / "layout_akai9_8x.png")


# ---------------------------------------------------------------- gen

def gen(seeds: list[int], prompt: str, tag: str, prefix: str = "s", layout_file: str = "layout_8x.png"):
    py = ROOT / ".venv-art/Scripts/python.exe"
    for s in seeds:
        out = RAW / f"{prefix}{s}"
        cmd = [str(py), "-I", str(ROOT / "tools/art/ai/run_comfy.py"), str(ROOT / "art/ai/workflows/h3_image_edit_3ref.json"),
               "--image", f"load1={RAW / layout_file}", "--image", f"load2={RAW / 'akai_ref_16x.png'}",
               "--image", f"load3={RAW / 'zombie_ref_16x.png'}",
               "--set", f"sampler.seed={s}", "--set", f"cond.prompt={prompt}",
               "--set", f"save.filename_prefix=ai_art/style_anchor_{prefix}{s}", "--out", str(out), "--tag", f"{tag} seed {s}"]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", cwd=ROOT)
        print(f"seed {s}:", (r.stdout.strip().splitlines() or [""])[-1], r.stderr[-500:] if r.returncode else "")


# ---------------------------------------------------------------- post

def components(alpha: np.ndarray):
    from scipy import ndimage
    lab, n = ndimage.label(alpha, structure=np.ones((3, 3)))
    return lab, n


def measure(img: Image.Image) -> dict:
    """Per slot: bbox (w, h), bottom row, of the opaque pixels whose column centre falls in the slot."""
    a = np.array(img)
    op = a[..., 3] > 0
    lab, n = components(op)
    res = {}
    for name, (x0, x1), tgt in SLOTS:
        m = np.zeros_like(op)
        for i in range(1, n + 1):
            ys, xs = np.where(lab == i)
            if len(xs) >= 6 and x0 <= xs.mean() < x1:
                m |= lab == i
        ys, xs = np.where(m)
        if not len(xs):
            res[name] = None
            continue
        res[name] = {"x": [int(xs.min()), int(xs.max())], "w": int(xs.max() - xs.min() + 1),
                     "h": int(ys.max() - ys.min() + 1), "top": int(ys.min()), "bottom": int(ys.max()),
                     "target": tgt}
    return res


def light_check(img: Image.Image) -> dict:
    """Mean OKLab L of the upper-left vs lower-right half of each slot's interior (lit side should be brighter)."""
    a = np.array(img)
    op = a[..., 3] > 0
    L = srgb_to_oklab(a[..., :3].reshape(-1, 3))[:, 0].reshape(op.shape)
    out = {}
    for name, (x0, x1), _ in SLOTS:
        m = op.copy()
        m[:, :x0] = False
        m[:, x1:] = False
        ys, xs = np.where(m)
        if not len(xs):
            continue
        cy, cx = ys.mean(), xs.mean()
        ul = m & (np.add.outer(np.arange(H) - cy, np.arange(W) - cx) < 0)
        lr = m & ~ul
        out[name] = round(float(L[ul].mean() - L[lr].mean()), 3)
    return out


def grid_phase(img: Image.Image) -> tuple[int, int]:
    """Offset (0..S-1) of H3's 8-px pixel grid: colour edges pile up on the block boundaries."""
    a = np.array(img.convert("RGB")).astype(np.int32)
    gx = np.abs(np.diff(a, axis=1)).sum(-1).sum(0)  # edge energy between column x and x+1
    gy = np.abs(np.diff(a, axis=0)).sum(-1).sum(1)
    px = [gx[(np.arange(len(gx)) % S) == (o - 1) % S].sum() for o in range(S)]
    py = [gy[(np.arange(len(gy)) % S) == (o - 1) % S].sum() for o in range(S)]
    return int(np.argmax(px)), int(np.argmax(py))


def snap_feet(img: Image.Image) -> tuple[Image.Image, dict]:
    """Shift each slot's object vertically so its bottom row is FOOT (lamp: also keeps touching the top)."""
    a = np.array(img)
    op = a[..., 3] > 0
    lab, n = components(op)
    out = np.zeros_like(a)
    shifts = {}
    for name, (x0, x1), _ in SLOTS:
        m = np.zeros_like(op)
        for i in range(1, n + 1):
            ys, xs = np.where(lab == i)
            if len(xs) >= 6 and x0 <= xs.mean() < x1:
                m |= lab == i
        ys, xs = np.where(m)
        if not len(xs):
            continue
        dy = FOOT - int(ys.max())
        shifts[name] = dy
        ty = ys + dy
        ok = (ty >= 0) & (ty < H)
        out[ty[ok], xs[ok]] = a[ys[ok], xs[ok]]
        if name == "lamp" and dy > 0:  # pole leaves the top edge: extend it upward
            for y in range(dy - 1, -1, -1):
                out[y, x0:x1] = out[y + 1, x0:x1]
    return Image.fromarray(out, "RGBA"), shifts


def post_one(raw: Path, pal: np.ndarray) -> tuple[Image.Image, Image.Image]:
    img = Image.open(raw).convert("RGB")
    if img.size != (W * S, H * S):
        img = img.resize((W * S, H * S), Image.LANCZOS)
    ox, oy = grid_phase(img)
    if ox or oy:  # shift so a block boundary sits at 0; pad the far edge with magenta
        pad = Image.new("RGB", img.size, (255, 0, 255))
        pad.paste(img.crop((ox, oy, img.width, img.height)), (0, 0))
        img = pad
    keyed = despill(key_magenta(img))
    small = k_centroid(keyed, S)
    small, post_one.shifts = snap_feet(small)
    post_one.phase = (ox, oy)
    # per object palette: reserved colours (blood, fire, UI, hero identity) are not for props;
    # only Akai may use the two hero identity colours on top of the 48 main colours
    out = np.zeros((H, W, 4), np.uint8)
    for name, (x0, x1), _ in SLOTS:
        sp = slot_palette(pal, name)
        crop = small.crop((x0, 0, x1, H))
        hw = HUE_WEIGHT.get(name, 1.0)
        q = quantize(crop, sp, hw)
        c = cleanup(q, sp, outline=True)
        c = quantize(c, sp, hw)  # cleanup may average; snap again
        out[:, x0:x1] = np.array(c)
    return small, Image.fromarray(out, "RGBA")


DANGER_SLOTS = {"drum"}  # round 9: danger red only for interactive / dangerous objects


def slot_palette(pal: np.ndarray, name: str) -> np.ndarray:
    """48 k-means colours + neutral cloth greys for everyone; danger red for the drum; identity for Akai."""
    parts = [part("kmeans"), part("cloth")]
    if name in DANGER_SLOTS:
        parts.append(part("danger"))
    if name == "akai":
        parts.append(part("identity"))
    return np.concatenate(parts)


# round 8 review: objects <= 10 colours; characters <= 16, hero identity colours not counted
CHARACTERS = {"akai", "zombie"}
MAX_OBJECT, MAX_CHARACTER = 10, 16
# round 8: drum red paint must land on the palette's reds, not a brown of similar lightness
HUE_WEIGHT = {"drum": 2.0}
ISLAND_PX = 2      # round 7 review: single-colour patches of <= 2 px are noise


def slot_mask(name: str) -> np.ndarray:
    x0, x1 = next(x for n, x, _ in SLOTS if n == name)
    m = np.zeros((H, W), bool)
    m[:, x0:x1] = True
    return m


def tidy(img: Image.Image) -> tuple[Image.Image, dict]:
    """Per slot: remove <=2 px islands, cap colours (objects 10, characters 16 + identity colours),
    remove islands the merge created. Identity colours and the darkest colour are protected."""
    stats = {}
    for name, _, _ in SLOTS:
        reg = slot_mask(name)
        img, n1 = remove_islands(img, ISLAND_PX, reg, IDENTITY)
        cap = MAX_CHARACTER if name in CHARACTERS else MAX_OBJECT
        img, cc = limit_colours(img, cap, reg, IDENTITY, uncounted=IDENTITY)
        img, n2 = remove_islands(img, ISLAND_PX, reg, IDENTITY)
        stats[name] = {"colours": cc, "cap": cap, "island_px_fixed": n1 + n2}
        if name in CYLINDERS:
            img, stats[name]["cylinder_px"] = shade_cylinder(img, name)
    return img, stats


CYLINDERS = {"drum"}  # round 9 review: lit column left, dark column right, highlight on the top rim


def shade_cylinder(img: Image.Image, name: str, step: float = 0.12) -> tuple[Image.Image, int]:
    """Enforce cylinder shading on a slot using only the colours the object already has (count unchanged):
    per row, the first interior pixel (right after the left outline) -> one step lighter, the last interior
    pixel -> one step darker; the first interior row under the top outline -> one step lighter (rim highlight).
    'One step' = the object's own colour of the same hue family (within 35 deg; greys with greys) whose OKLab L is
    closest to L +/- step."""
    x0, x1 = next(x for n, x, _ in SLOTS if n == name)
    a = np.array(img)
    blk = a[:, x0:x1]
    op = blk[..., 3] > 0
    keys = blk[..., 0].astype(np.int64) * 65536 + blk[..., 1].astype(np.int64) * 256 + blk[..., 2]
    u = np.unique(keys[op])
    rgb = np.stack([(u >> 16) & 255, (u >> 8) & 255, u & 255], 1).astype(np.uint8)
    lab = srgb_to_oklab(rgb)
    hue = np.degrees(np.arctan2(lab[:, 2], lab[:, 1]))
    chroma = np.hypot(lab[:, 1], lab[:, 2])
    outline = lab[:, 0] < 0.30
    idx = {int(k): i for i, k in enumerate(u)}

    def shifted_colour(k: int, d: float):
        i = idx[k]
        if outline[i]:
            return None
        same = [j for j in range(len(u)) if j != i and not outline[j] and
                ((chroma[i] < 0.03 and chroma[j] < 0.03) or
                 (chroma[i] >= 0.03 and chroma[j] >= 0.03 and abs((hue[i] - hue[j] + 180) % 360 - 180) < 35))]
        same = [j for j in same if (lab[j, 0] - lab[i, 0]) * d > 0.02]
        if not same:
            return None
        j = min(same, key=lambda j: abs(lab[j, 0] - (lab[i, 0] + d)))
        return rgb[j]

    out = blk.copy()
    n = 0
    ys = np.where(op.any(1))[0]
    top, bot = ys.min(), ys.max()
    for y in range(top + 1, bot):
        xs = np.where(op[y])[0]
        if len(xs) < 5:
            continue
        inner = [x for x in xs if not outline[idx[int(keys[y, x])]]]
        if len(inner) < 3:
            continue
        for x, d in ((inner[0], step), (inner[-1], -step)):
            c = shifted_colour(int(keys[y, x]), d)
            if c is not None:
                out[y, x, :3] = c
                n += 1
    # rim highlight: first row under the top outline that has interior pixels
    for y in range(top, bot):
        xs = [x for x in np.where(op[y])[0] if not outline[idx[int(keys[y, x])]]]
        if len(xs) >= 3:
            for x in xs[1:-1]:
                c = shifted_colour(int(keys[y, x]), step)
                if c is not None:
                    out[y, x, :3] = c
                    n += 1
            break
    a[:, x0:x1] = out
    return Image.fromarray(a, "RGBA"), n


def sheet(rows: list[tuple[str, Image.Image]], scale: int = 4) -> Image.Image:
    lab_h = 14
    out = Image.new("RGB", (W * scale, len(rows) * (H * scale + lab_h)), (20, 20, 20))
    d = ImageDraw.Draw(out)
    for i, (label, im) in enumerate(rows):
        y = i * (H * scale + lab_h)
        bg = Image.new("RGBA", im.size, (255, 0, 255, 255)) if im.mode == "RGBA" else None
        if bg is not None:
            bg.alpha_composite(im)
            im = bg
        t = im.convert("RGB").resize((W * scale, H * scale), Image.NEAREST)
        dd = ImageDraw.Draw(t)
        fy = (FOOT + 1) * scale
        dd.line([(0, fy), (t.width, fy)], fill=(0, 255, 0))
        hy = (FOOT + 1 - 56) * scale
        dd.line([(0, hy), (38 * scale, hy)], fill=(255, 255, 255))
        dd.line([(38 * scale, hy), (98 * scale, hy)], fill=(255, 255, 255))
        out.paste(t, (0, y + lab_h))
        d.text((3, y + 1), label, fill=(255, 255, 255))
    return out


def post(seeds: list[int] | None, prefix: str = "s"):
    pal = load_gpl()
    rows, summary = [], {}
    n0 = len(prefix)
    dirs = sorted((p for p in RAW.glob(f"{prefix}*") if p.is_dir() and p.name[n0:].isdigit()),
                  key=lambda p: int(p.name[n0:]))
    for d in dirs:
        s = int(d.name[n0:])
        if seeds and s not in seeds:
            continue
        raws = sorted(d.glob("style_anchor_*.png"))
        if not raws:
            continue
        small, clean = post_one(raws[-1], pal)
        clean, ncol = tidy(clean)
        clean.save(d / "anchor_64.png")
        small.save(d / "anchor_64_unquant.png")
        m = measure(clean)
        chk = check(d / "anchor_64.png", pal)
        summary[s] = {"grid_phase": post_one.phase, "foot_shift": post_one.shifts, "measure": m, "light_ul_minus_lr": light_check(clean),
                      "colours": chk["colours"], "colours_per_object": ncol, "outside_palette": chk["outside_palette"]}
        h = {k: (v["h"] if v else None) for k, v in m.items()}
        rows.append((f"seed {s}  raw/8", small))
        rows.append((f"seed {s}  master.gpl  {chk['colours']}c  h={h}", clean))
    OUTD.mkdir(parents=True, exist_ok=True)
    slot = next((v[2] for v in VARIANTS.values() if v[0] == prefix), None)
    if prefix == "s":
        sheet(rows).save(RAW / "seeds_detail_x4.png")
        sheet([r for r in rows if "master" in r[0]]).save(OUTD / "anchor_seeds_x4.png")
    elif prefix == "drum_s":
        drum_sheet(summary, prefix).save(OUTD / "drum_seeds_x4.png")
    else:
        slot_sheet(summary, prefix, slot).save(OUTD / f"{prefix[:-2]}_seeds_x4.png")
    (RAW / f"post_summary_{prefix}.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(json.dumps(summary, indent=1))


def drum_sheet(summary: dict, prefix: str, scale: int = 6) -> Image.Image:
    """Drum slot of every drum seed side by side (6x, magenta, foot line + 28/31 px guides)."""
    x0, x1 = next(x for n, x, _ in SLOTS if n == "drum")
    cw, top = x1 - x0, 24
    tiles = []
    for s, v in summary.items():
        im = Image.open(RAW / f"{prefix}{s}" / "anchor_64.png").crop((x0, top, x1, H))
        bg = Image.new("RGBA", im.size, (255, 0, 255, 255))
        bg.alpha_composite(im)
        t = bg.convert("RGB").resize((cw * scale, (H - top) * scale), Image.NEAREST)
        d = ImageDraw.Draw(t)
        for hh, col in ((0, (0, 255, 0)), (28, (255, 255, 255)), (31, (255, 255, 0))):
            y = (FOOT + 1 - hh - top) * scale
            d.line([(0, y), (t.width, y)], fill=col)
        m = v["measure"]["drum"]
        tiles.append((f"s{s} {m['w']}x{m['h']} {v['colours_per_object']['drum']['colours'][1]}c", t))
    out = Image.new("RGB", (len(tiles) * (cw * scale + 8), (H - top) * scale + 14), (20, 20, 20))
    d = ImageDraw.Draw(out)
    for i, (lab, t) in enumerate(tiles):
        out.paste(t, (i * (cw * scale + 8), 14))
        d.text((i * (cw * scale + 8) + 2, 1), lab, fill=(255, 255, 255))
    return out


def slot_sheet(summary: dict, prefix: str, slot: str, scale: int = 6) -> Image.Image:
    """One slot of every seed of a variant side by side: 64-px result (6x) over its unquantized /8 source."""
    x0, x1 = next(x for n, x, _ in SLOTS if n == slot)
    top = 0 if slot == "akai" else 24
    cw, ch = x1 - x0, H - top
    cols = []
    for s, v in summary.items():
        d = RAW / f"{prefix}{s}"
        pair = []
        for f in ("anchor_64_unquant.png", "anchor_64.png"):
            im = Image.open(d / f).convert("RGBA").crop((x0, top, x1, H))
            bg = Image.new("RGBA", im.size, (255, 0, 255, 255))
            bg.alpha_composite(im)
            t = bg.convert("RGB").resize((cw * scale, ch * scale), Image.NEAREST)
            dd = ImageDraw.Draw(t)
            dd.line([(0, (FOOT + 1 - top) * scale), (t.width, (FOOT + 1 - top) * scale)], fill=(0, 255, 0))
            pair.append(t)
        m = v["measure"][slot]
        cols.append((f"s{s} {m['w']}x{m['h']} {v['colours_per_object'][slot]['colours'][1]}c", pair))
    out = Image.new("RGB", (len(cols) * (cw * scale + 8), 2 * ch * scale + 30), (20, 20, 20))
    d = ImageDraw.Draw(out)
    for i, (lab, (raw, fin)) in enumerate(cols):
        x = i * (cw * scale + 8)
        d.text((x + 2, 1), lab + "  (top: /8, bottom: final)", fill=(255, 255, 255))
        out.paste(raw, (x, 14))
        out.paste(fin, (x, ch * scale + 28))
    return out


def pick(seed: int, drum: int | None = None, splice: dict | None = None):
    src = RAW / f"s{seed}"
    OUTD.mkdir(parents=True, exist_ok=True)
    img = Image.open(src / "anchor_64.png").convert("RGBA")
    if drum is not None:  # splice the re-run drum slot into the chosen anchor
        x0, x1 = next(x for n, x, _ in SLOTS if n == "drum")
        d = Image.open(RAW / f"drum_s{drum}" / "anchor_64.png").convert("RGBA")
        a, b = np.array(img), np.array(d)
        a[:, x0:x1] = b[:, x0:x1]
        img = Image.fromarray(a, "RGBA")
    for slot, (variant, vs) in (splice or {}).items():  # round 8: e.g. akai from akai8 seed 3
        x0, x1 = next(x for n, x, _ in SLOTS if n == slot)
        d = Image.open(RAW / f"{VARIANTS[variant][0]}{vs}" / "anchor_64.png").convert("RGBA")
        a, b = np.array(img), np.array(d)
        a[:, x0:x1] = b[:, x0:x1]
        img = Image.fromarray(a, "RGBA")
    img.save(OUTD / "anchor.png")
    img.resize((W * 4, H * 4), Image.NEAREST).save(OUTD / "anchor_x4.png")
    gen_meta = json.loads((src / "meta.json").read_text(encoding="utf-8"))
    summary = json.loads((RAW / "post_summary_s.json").read_text(encoding="utf-8"))
    meta = {
        "picked_seed": seed,
        "drum_from": (f"drum re-run seed {drum} (PROMPT_DRUM)" if drum is not None else "same seed"),
        "size": [W, H], "generated_at": [W * S, H * S], "downscale": S,
        "workflow": "art/ai/workflows/h3_image_edit_3ref.json",
        "references": {"Picture 1": "layout (tools/art/ai/build_anchor.py layout): akai frame 0 re-proportioned to 3.5 heads "
                                    "(head 16 / body 40) at akai slot, "
                                    "zombie_basic frame 0 scaled to 56, placeholder crate/drum/lamp; 8x",
                       "Picture 2": "public/assets/sprites/akai_ai_idle.png frame 0, 16x",
                       "Picture 3": "public/assets/sprites/zombie_basic.png frame 0, 16x"},
        "palette": "art/ai/palette/master.gpl",
        "slots": [{"name": n, "x": list(x), "target_wh": list(t)} for n, x, t in SLOTS],
        "post": "grid phase detect -> key magenta -> despill -> k_centroid /8 -> snap each object's bottom to y=61 "
                "-> per object quantize to master.gpl main 48 (+ hero identity 2 for akai) (OKLab) -> cleanup (orphans, specks, selout outline) -> quantize -> "
                "per object: remove <=2 px single-colour islands, <=10 colours (merge cheapest: pixels x distance^2), "
                "islands again; hero identity colours + darkest colour protected",
        "seeds": summary,
        "generation": gen_meta,
    }
    if drum is not None:
        meta["drum_seeds"] = json.loads((RAW / "post_summary_drum_s.json").read_text(encoding="utf-8"))
        meta["drum_generation"] = json.loads((RAW / f"drum_s{drum}" / "meta.json").read_text(encoding="utf-8"))
        meta["drum_prompt_change"] = ("clean shaded paint with only a few small rust spots -> "
                                      "large flat rust patches, simple shapes, no small specks or noise")
    if splice:
        meta["splice"] = {}
        for slot, (variant, vs) in splice.items():
            pre = VARIANTS[variant][0]
            meta["splice"][slot] = {
                "variant": variant, "seed": vs, "prompt": VARIANTS[variant][1],
                "seeds": json.loads((RAW / f"post_summary_{pre}.json").read_text(encoding="utf-8")),
                "generation": json.loads((RAW / f"{pre}{vs}" / "meta.json").read_text(encoding="utf-8")),
            }
    meta["post"] = meta["post"].replace(
        "<=10 colours (merge cheapest: pixels x distance^2)",
        "objects <=10 / characters <=16 colours, identity colours not counted (merge cheapest: pixels x "
        "distance^2, hue x2); drum quantized with hue weight 2")
    (OUTD / "meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    print("picked", seed)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["layout", "layout_akai9", "gen", "post", "pick"])
    ap.add_argument("seed", nargs="?", type=int)
    ap.add_argument("--seeds", nargs="*", type=int, default=[1, 2, 3, 4])
    ap.add_argument("--prompt-file", type=Path)
    ap.add_argument("--tag", default="style anchor")
    ap.add_argument("--drum", action="store_true", help="gen/post: drum re-run (PROMPT_DRUM, raw/style/drum_s*)")
    ap.add_argument("--drum-seed", type=int, help="pick: take the drum slot from this drum re-run seed")
    ap.add_argument("--variant", choices=list(VARIANTS), help="gen/post: which prompt variant (overrides --drum)")
    ap.add_argument("--splice", nargs="*", default=[], metavar="SLOT=VARIANT:SEED",
                    help="pick: replace a slot with another variant's seed, e.g. akai=akai8:3 drum=drum8:2")
    a = ap.parse_args()
    if a.cmd == "layout":
        layout()
    elif a.cmd == "layout_akai9":
        layout_akai9()
    elif a.cmd == "gen":
        prompt = a.prompt_file.read_text(encoding="utf-8").strip() if a.prompt_file else (
            VARIANTS[a.variant][1] if a.variant else (PROMPT_DRUM if a.drum else PROMPT))
        gen(a.seeds, prompt, a.tag, VARIANTS[a.variant][0] if a.variant else ("drum_s" if a.drum else "s"),
            VARIANTS[a.variant][3] if a.variant else "layout_8x.png")
    elif a.cmd == "post":
        post(a.seeds if a.seeds != [1, 2, 3, 4] else None,
             VARIANTS[a.variant][0] if a.variant else ("drum_s" if a.drum else "s"))
    else:
        sp = {}
        for spec in a.splice:
            slot, rest = spec.split("=")
            v, vs = rest.split(":")
            sp[slot] = (v, int(vs))
        pick(a.seed, a.drum_seed, sp)


if __name__ == "__main__":
    main()
