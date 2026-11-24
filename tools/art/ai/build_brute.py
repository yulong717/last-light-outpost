"""Round 14: brute (big zombie) on the XL-strong mannequin, full 26-frame set for the game's brute.

Canvas 72x72, foot row y=69, centre x=36 (XL rule is 64x72 / y=69; the brute with arms reaching forward and a long
stride is wider than 64, so the frame is widened to 72x72 - see REPORT round 14). Generation sizes: H3 Image
1152x1152 (/16 = 72), H3 video 576x576 (/8 = 72).

  python tools/art/ai/build_brute.py refs
  python tools/art/ai/build_brute.py still-gen NAME [--seeds 1 2 3 4]     # stand, walkkey, down, hitA, hitB, rise, fall, bounce
  python tools/art/ai/build_brute.py still-post NAME
  python tools/art/ai/build_brute.py still-pick NAME SEED
  python tools/art/ai/build_brute.py video-gen ACTION [--seeds 1 2 3 4]   # walk, attack, death, getup
  python tools/art/ai/build_brute.py video-post ACTION
  python tools/art/ai/build_brute.py video-pick ACTION SEED
  python tools/art/ai/build_brute.py hit-build SEED_A SEED_B | react-build R F B GETUP | sheet26

Post-processing and rules are rounds 10-13 (build_zombie9/10/12): region-locked quantize to master.gpl (three-region
ZombieComposer rule), outline, speck clean-up, <=16 colours (all actions snapped to the walk's 16), walk head lock,
gait pick, stray-object detection, unblur. Only the canvas size differs, so the size-dependent helpers live here.
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
import build_zombie10 as z10  # noqa: E402
import build_zombie12 as z12  # noqa: E402
from build_palette import check  # noqa: E402
from pixelize import despill, remove_islands  # noqa: E402
from sprite_utils import k_centroid, key_magenta  # noqa: E402

ROOT = z9.ROOT
RAW = ROOT / "art/ai/raw/brute"
OUT = ROOT / "art/ai/out/zombie_xl"
PY = z9.PY
S, FOOT, MID = 72, 69, 36
G = 16                      # image: 1152 / 72
IMG, VID = S * 16, S * 8    # 1152, 576
BODY_H = 62                 # XL height

LOOK = ("a huge brute fog zombie: massive, much bigger and heavier than a normal zombie, very broad shoulders, thick "
        "barrel chest and thick arms, narrow waist, no belly, small head (3.5 heads tall, not chibi), grey-green "
        "rotting skin, sunken dark eyes, bald head with a few stray hairs, a torn ragged plain light grey shirt "
        "(neutral grey, not greenish) stretched over the chest, dark navy blue-grey long trousers, dark heavy boots")
STYLE = ("Draw it in exactly the pixel art style of <Picture 3>, as if by the same artist: a single light source from "
         "the upper left, 3 to 4 shading steps, a 1 pixel near-black outline, muted grey-green colours. Only the "
         "zombie: no weapon, no bat, no attacker, no object, no effects, no blood. Plain solid magenta background, "
         "no ground, no floor line, no cast shadow, no text.")
STILLS = {
    # name: (Picture 1 layout, Picture 2 identity, prompt)
    "stand": ("mannequin", "zombie_m_stand",
              "Redraw <Picture 1> as a clean pixel art game sprite for a 2D side-scrolling zombie game: dress the grey "
              "mannequin as " + LOOK + ", in the colours of the fog zombie from <Picture 2>. Keep exactly the "
              "mannequin's position, total height, small head, broad body width and three-quarter view facing right. "
              "Hunched standing pose, head pushed forward, both arms hanging forward heavily, feet on the same ground "
              "line. Nothing on the head. "),
    "walkkey": ("walk_layout", "stand",
                "Redraw the zombie of <Picture 2> in exactly the pose and position of <Picture 1>, as a clean pixel art "
                "game sprite: " + LOOK + ". Pose from <Picture 1>: a heavy shambling zombie walk, strongly hunched "
                "with a rounded back, head pushed forward low in front of the shoulders, BOTH thick arms stretched "
                "straight forward at shoulder height reaching to the right, hands drooping, legs wide apart in a long "
                "heavy dragging step. Keep the size, small head and broad build of <Picture 2>. Three-quarter view "
                "facing right. "),
    "down": ("down_layout", "walkkey",
             "Redraw <Picture 1> as a clean pixel art game sprite: the dead brute zombie from <Picture 2> lying flat on "
             "its back on the ground, seen from the side, head on the LEFT, feet on the RIGHT, face up, thick arms "
             "lying limp beside the body, legs straight, exactly the position and size of the grey figure in "
             "<Picture 1>. Keep its look: " + LOOK + ". "),
    "hitA": ("walkkey_lay", "walkkey",
             "Redraw the brute zombie of <Picture 2> at exactly the position, size and three-quarter view facing right "
             "of <Picture 1>, keeping its feet on the same ground line, but change its pose: its head has just "
             "snapped backward from a blow to the face, the chin up and the face turned up toward the upper right, "
             "the shoulders pushed back a little, the thick arms still reaching forward but jerked slightly up, the "
             "legs and feet stay exactly where they are. Keep its look: " + LOOK + ". "),
    "hitB": ("walkkey_lay", "walkkey",
             "Redraw the brute zombie of <Picture 2> at exactly the position, size and three-quarter view facing right "
             "of <Picture 1>, keeping its feet on the same ground line, but change its pose: it recoils from a heavy "
             "blow to the face, the whole massive upper body bent backward to the left with the chest pushed out, "
             "the head thrown back, both arms flung loosely forward and up, the knees slightly bent, the feet stay "
             "exactly where they are. Keep its look: " + LOOK + ". "),
    "rise": ("rise_layout", "walkkey",
             "Redraw the grey silhouette in <Picture 1> as the brute zombie from <Picture 2>, at exactly the position, "
             "size and angle of the silhouette: it has just been knocked off its feet by a huge blow from the right, "
             "the whole heavy body in the air leaning backward to the left, head thrown back, both arms flung "
             "forward (not above the head), legs kicked forward, both feet clearly off the ground. Seen from the side. Keep its look: "
             + LOOK + ". "),
    "fall": ("fall_layout", "walkkey",
             "Redraw the grey silhouette in <Picture 1> as the brute zombie from <Picture 2>, at exactly the position, "
             "size and angle of the silhouette: it is flying backward through the air almost horizontal, back toward "
             "the ground, head on the left slightly lower than the feet on the right, arms and legs flung loosely "
             "upward a little, not touching the ground yet. Seen from the side. Keep its look: " + LOOK + ". "),
    "bounce": ("bounce_layout", "walkkey",
               "Redraw the grey silhouette in <Picture 1> as the brute zombie from <Picture 2>, at exactly the "
               "position, size and angle of the silhouette: it has just slammed onto its back and bounces slightly, "
               "lying almost flat with the head on the left and the feet on the right, the back just above the "
               "ground, legs and arms jolted upward, head jerked up. Seen from the side. Keep its look: " + LOOK + ". "),
}
LIFT = {"rise": 3, "fall": 5, "bounce": 2}
ROT = {"rise": 35, "fall": 15}   # rise: the stand pose leaning back; fall: the lying (down) pose, feet up

VCOMMON = ("Pixel art game sprite animation of the huge brute fog zombie from <Picture 1>: keep its massive build, broad "
           "shoulders, thick arms, small head, grey-green skin, torn light grey shirt, dark navy trousers, dark boots, "
           "colours and near-black outlines exactly. Three-quarter view facing right, fixed camera, no zoom, no pan, "
           "full body visible at all times. The background stays plain solid magenta in every frame. Only the zombie, "
           "nothing else appears: no weapon, no object, no person. ")
VIDEOS = {
    "walk": {"length": 56, "first": "walkkey", "last": "walkkey", "prompt": VCOMMON + (
        "It lumbers forward in place on a treadmill with a slow, very heavy zombie walk: strongly hunched the whole "
        "time, head pushed forward, both thick arms stay stretched forward at shoulder height reaching to the right "
        "and only sway, the heavy body rocks from side to side with every step, long dragging strides, the legs "
        "clearly alternate with even, equal steps, the feet stomp and scrape along the ground line. Two full steps at "
        "a constant pace. Seamless loop. No effects. Flat colors.")},
    "attack": {"length": 56, "first": "walk0", "last": "walk0", "prompt": VCOMMON + (
        "The hunched brute attacks empty air just in front of it to the right (there is nothing there): it pulls "
        "back, then lunges forward with both huge arms outstretched, grabs at the air with both hands, pulls them in "
        "and bites with its head thrust forward and mouth wide open, then slowly returns to its hunched stance with "
        "arms forward. The feet stay planted on the ground line. One single attack. No effects, no blood. Flat colors.")},
    "death": {"length": 56, "first": "walk0", "last": "down", "prompt": VCOMMON + (
        "The hunched brute is killed by an invisible blow from the right: its head snaps back, it staggers backward "
        "to the left, the knees buckle and the heavy body falls backward to the left, landing flat on its back on the "
        "ground line with the head on the left and the feet on the right, a small bounce, then it lies completely "
        "still. No effects, no blood. Flat colors.")},
    "getup": {"length": 56, "first": "down", "last": "walk0", "prompt": VCOMMON + (
        "The brute lies flat on its back on the ground line, head on the left, feet on the right. It slowly comes back "
        "to life: it pushes its heavy upper body up on its arms, sits up, pulls its legs in and gets onto one knee, "
        "then stands up into its hunched walking stance with both arms reaching forward to the right. Slow, heavy, "
        "jerky movement. No effects, no blood. Flat colors.")},
}
N = {"walk": 8, "attack": 6, "death": 9, "getup": 4}


# ---------------------------------------------------------------- canvas helpers (72x72)

def canvas(img: Image.Image | None = None, dx: int = 0, dy: int = 0) -> Image.Image:
    c = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    if img is not None:
        c.alpha_composite(img.convert("RGBA"), (dx, dy))
    return c


def bbox(img: Image.Image):
    ys, xs = np.where(np.array(img.convert("RGBA"))[..., 3] > 0)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def on_mag(img: Image.Image, size: int) -> Image.Image:
    c = Image.new("RGBA", img.size, (255, 0, 255, 255))
    c.alpha_composite(img.convert("RGBA"))
    return c.convert("RGB").resize((size, size), Image.NEAREST)


def to_foot(img: Image.Image, foot: int = FOOT) -> Image.Image:
    x0, y0, x1, y1 = bbox(img)
    return canvas(img, 0, foot - y1)


def strip(frames):
    s = Image.new("RGBA", (S * len(frames), S), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        s.paste(f, (S * i, 0))
    return s


def frames_of(path: Path):
    st = Image.open(path).convert("RGBA")
    return [st.crop((S * i, 0, S * i + S, S)) for i in range(st.width // S)]


def tile(img: Image.Image, sc: int = 3) -> Image.Image:
    t = on_mag(img, S * sc)
    d = ImageDraw.Draw(t)
    d.line([(0, (FOOT + 1) * sc), (t.width, (FOOT + 1) * sc)], fill=(0, 255, 0))
    d.line([(0, (FOOT + 1 - BODY_H) * sc), (t.width, (FOOT + 1 - BODY_H) * sc)], fill=(255, 255, 255))
    return t


def tidy(frames):
    fixed, tmp = 0, []
    for f in frames:
        f, n = remove_islands(f, 2)
        fixed += n
        tmp.append(f)
    from pixelize import limit_colours
    st, cc = limit_colours(strip(tmp), 16, group=lambda r, g, b: z9.classify(r, g, b) if hasattr(z9, "classify")
                           else z9.region_of((r, g, b)))
    return [st.crop((S * i, 0, S * i + S, S)) for i in range(len(frames))], {"colours": cc, "island_px_fixed": fixed}


def walk_ref() -> list[Image.Image]:
    return frames_of(OUT / "walk.png")


def snap(frames, ref):
    return [z10.fin_key(f, ref) for f in frames]


# ---------------------------------------------------------------- refs / layouts

def refs():
    RAW.mkdir(parents=True, exist_ok=True)
    m = Image.open(ROOT / "art/ai/mannequins/XL_strong/stand34_64.png").convert("RGBA")
    x0, y0, x1, y1 = bbox(m)
    fig = m.crop((x0, y0, x1 + 1, y1 + 1))
    lay = canvas(fig, MID - fig.width // 2, FOOT + 1 - fig.height)
    lay.save(RAW / "mannequin.png")
    on_mag(lay, IMG).save(RAW / "mannequin_x16.png")
    zs = Image.open(ROOT / "art/ai/out/zombie_m/stand.png").convert("RGBA")
    x0, y0, x1, y1 = bbox(zs)
    f = zs.crop((x0, y0, x1 + 1, y1 + 1))
    on_mag(canvas(f, MID - f.width // 2, FOOT + 1 - f.height), IMG).save(RAW / "zombie_m_stand_x16.png")
    a = Image.open(ROOT / "art/ai/raw/zombie9/ref_anchor_1024.png").convert("RGB")
    c = Image.new("RGB", (IMG, IMG), (255, 0, 255))
    c.paste(a, ((IMG - 1024) // 2, (IMG - 1024) // 2))
    c.save(RAW / "anchor_x16.png")
    # walk layout: the M walk key pose, stretched to the XL build (height 62, width x1.3), coloured (pose reference)
    k = Image.open(ROOT / "art/ai/out/zombie_m/walk_key.png").convert("RGBA")
    x0, y0, x1, y1 = bbox(k)
    f = k.crop((x0, y0, x1 + 1, y1 + 1))
    sy = BODY_H / f.height
    f = f.resize((min(S - 2, round(f.width * sy * 1.18)), BODY_H), Image.NEAREST)
    cx = MID + (bbox(k)[0] + bbox(k)[2]) / 2 - 32
    lay = canvas(f, int(round(cx - f.width / 2)), FOOT + 1 - BODY_H)
    lay.save(RAW / "walk_layout.png")
    on_mag(lay, IMG).save(RAW / "walk_layout_x16.png")
    print("refs ->", RAW)


def grey(img: Image.Image) -> Image.Image:
    g = np.array(img.convert("RGBA"))
    g[..., :3] = np.where(g[..., 3:] > 0, 150, 0)
    return Image.fromarray(g, "RGBA")


def derived_layouts():
    """Layouts that need the picked stand / walk key / down pose."""
    key = Image.open(RAW / "walkkey.png").convert("RGBA")
    on_mag(key, IMG).save(RAW / "walkkey_x16.png")
    on_mag(key, IMG).save(RAW / "walkkey_lay_x16.png")
    on_mag(key, VID).save(RAW / "walkkey_vid.png")
    x0, y0, x1, y1 = bbox(key)
    fig = key.crop((x0, y0, x1 + 1, y1 + 1))
    cx = (x0 + x1) / 2
    # down: the walk key rotated 90 degrees counter-clockwise (head left), back on the foot row
    st = Image.open(RAW / "stand.png").convert("RGBA")
    a0, b0, a1, b1 = bbox(st)
    d = st.crop((a0, b0, a1 + 1, b1 + 1)).rotate(90, expand=True)
    lay = grey(canvas(d, max(1, MID - d.width // 2), FOOT + 1 - d.height))
    lay.save(RAW / "down_layout.png")
    on_mag(lay, IMG).save(RAW / "down_layout_x16.png")
    for name, rot in ROT.items():
        # round 14 v2: the first rise/fall layouts (walk key rotated 55 / 100 degrees) came out too tall (rise
        # touched the top of the canvas, fall was diagonal, not near horizontal)
        if name == "fall" and not (RAW / "down.png").exists():
            continue
        src = Image.open(RAW / ("stand.png" if name == "rise" else "down.png")).convert("RGBA")
        a0, b0, a1, b1 = bbox(src)
        src = src.crop((a0, b0, a1 + 1, b1 + 1))
        r = src.rotate(rot, expand=True, resample=Image.NEAREST)
        rx0, ry0, rx1, ry1 = bbox(r)
        r = r.crop((rx0, ry0, rx1 + 1, ry1 + 1))
        x = max(1, min(S - 1 - r.width, MID - r.width // 2 - (4 if name == "rise" else 0)))
        lay = grey(canvas(r, x, max(1, FOOT + 1 - LIFT[name] - r.height)))
        lay.save(RAW / f"{name}_layout.png")
        on_mag(lay, IMG).save(RAW / f"{name}_layout_x16.png")
    if (RAW / "down.png").exists():
        dn = Image.open(RAW / "down.png").convert("RGBA")
        on_mag(dn, IMG).save(RAW / "down_x16.png")
        on_mag(dn, VID).save(RAW / "down_vid.png")
        x0, y0, x1, y1 = bbox(dn)
        f = dn.crop((x0, y0, x1 + 1, y1 + 1))
        lay = grey(canvas(f, x0, FOOT + 1 - LIFT["bounce"] - f.height))
        lay.save(RAW / "bounce_layout.png")
        on_mag(lay, IMG).save(RAW / "bounce_layout_x16.png")


# ---------------------------------------------------------------- stills

def ref_path(name: str) -> Path:
    special = {"mannequin": "mannequin_x16.png", "zombie_m_stand": "zombie_m_stand_x16.png",
               "walk_layout": "walk_layout_x16.png", "stand": "stand_x16.png", "walkkey": "walkkey_x16.png",
               "walkkey_lay": "walkkey_lay_x16.png"}
    return RAW / special.get(name, f"{name}_x16.png")


def still_gen(name: str, seeds):
    p1, p2, prompt = STILLS[name]
    if name == "walkkey" or name == "down":
        if (RAW / "stand.png").exists():
            on_mag(Image.open(RAW / "stand.png"), IMG).save(RAW / "stand_x16.png")
    if name not in ("stand", "walkkey"):
        derived_layouts()
    for s in seeds:
        d = RAW / f"{name}_s{s}"
        if list(d.glob("brute_*.png")):
            continue
        print(name, s, z9.run([PY, "-I", ROOT / "tools/art/ai/run_comfy.py", ROOT / "art/ai/workflows/h3_image_edit_3ref.json",
                               "--image", f"load1={ref_path(p1)}", "--image", f"load2={ref_path(p2)}",
                               "--image", f"load3={RAW / 'anchor_x16.png'}",
                               "--set", f"scale1.width={IMG}", "--set", f"scale1.height={IMG}",
                               "--set", f"scale2.width={IMG}", "--set", f"scale2.height={IMG}",
                               "--set", f"scale3.width={IMG}", "--set", f"scale3.height={IMG}",
                               "--set", f"cond.width={IMG}", "--set", f"cond.height={IMG}",
                               "--set", f"sampler.seed={s}", "--set", f"cond.prompt={prompt + STYLE}",
                               "--set", f"save.filename_prefix=ai_art/brute_{name}_s{s}",
                               "--out", d, "--tag", f"r14 brute {name} seed {s}"])[:90], flush=True)


def post_still_raw(raw: Path, rp) -> tuple[Image.Image, Image.Image]:
    img = Image.open(raw).convert("RGB")
    ox, oy = z9.grid_phase(img, G)
    if ox or oy:
        pad = Image.new("RGB", img.size, (255, 0, 255))
        pad.paste(img.crop((ox, oy, img.width, img.height)), (0, 0))
        img = pad
    small = to_foot(z9.largest_blob(k_centroid(despill(key_magenta(img)), G)))
    return small, quantize_regions(small, rp)


def quantize_regions(img: Image.Image, rp) -> Image.Image:
    """build_zombie9.quantize_regions with a different head rule. Round 9 said 'the top 28% of the figure is never
    shirt' (head highlights). The hunched brute's shoulders are inside that band, so the upper shirt turned into
    skin. Here: only the largest 8-connected shirt piece(s) are shirt; small shirt-coloured pieces (< 15 px) in the
    top 40% of the figure are head highlights -> skin."""
    from scipy import ndimage
    a = np.array(img.convert("RGBA"))
    op = a[..., 3] > 0
    reg = z9.raw_region(a[..., :3])
    sh = op & (reg == "shirt")
    lab, n = ndimage.label(sh, structure=np.ones((3, 3)))
    ys = np.where(op.any(1))[0]
    if n and len(ys):
        top_band = ys.min() + int((ys.max() - ys.min() + 1) * 0.40)
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        for i, sz in enumerate(sizes, 1):
            m = lab == i
            if sz < 15 and np.where(m)[0].mean() < top_band:
                reg[m] = "skin"
    from pixelize import N4, shifted, srgb_to_oklab
    lab3 = srgb_to_oklab(a[..., :3].reshape(-1, 3)).reshape(a.shape[0], a.shape[1], 3)
    out = a.copy()
    for name in set(reg[op]):
        pal = rp.get(name)
        if pal is None or not len(pal):
            pal = np.concatenate(list(rp.values()))
        m = op & (reg == name)
        pl = srgb_to_oklab(pal)
        d = ((lab3[m][:, None, :] - pl[None]) ** 2).sum(-1)
        out[m, :3] = pal[d.argmin(1)]
    edge = op & (sum(shifted(~op, dy, dx, True) for dy, dx in N4) > 0)
    ol = rp["outline"]
    pl = srgb_to_oklab(ol)
    d = ((lab3[edge][:, None, :] - pl[None]) ** 2).sum(-1)
    out[edge, :3] = ol[d.argmin(1)]
    out[..., 3] = np.where(op, 255, 0)
    return Image.fromarray(out, "RGBA")


def lift(img, n):
    return canvas(img, 0, -n)


def still_post(name: str):
    rp = z9.region_palettes()
    ref = walk_ref() if (OUT / "walk.png").exists() else None
    rows, summary = [], {}
    for d in sorted(RAW.glob(f"{name}_s*")):
        raws = sorted(d.glob("brute_*.png"))
        if not raws:
            continue
        s = int(d.name.split("_s")[-1])
        small, q = post_still_raw(raws[-1], rp)
        q, _ = remove_islands(q, 2)
        q, nfix = z10.region_islands(q)
        if ref:
            (fin,) = snap([q], ref)
        else:
            (fin,), _ = tidy([q])
        fin = lift(fin, LIFT.get(name, 0))
        fin.save(d / "pose.png")
        x0, y0, x1, y1 = bbox(fin)
        info = {"w": x1 - x0 + 1, "h": y1 - y0 + 1, "bottom": y1, "top": y0, "left": x0, "right": x1,
                "regions": z9.region_stats(fin), "region_px_fixed": nfix,
                "outside_palette": check(d / "pose.png")["outside_palette"], "stray_object": z12.stray_object(raws[-1])}
        if name in ("stand", "walkkey"):
            info["measure"] = z9.measure(fin)
        summary[s] = info
        rows.append((s, small, fin, info))
        print(name, s, info)
    sc = 3
    out = Image.new("RGB", (len(rows) * (S * sc + 6), 3 * (S * sc + 14)), (20, 20, 20))
    dd = ImageDraw.Draw(out)
    for i, (s, small, fin, info) in enumerate(rows):
        x = i * (S * sc + 6)
        for j, (lab, im) in enumerate((("raw/16", small), (f"{info['w']}x{info['h']}", fin), ("regions", z9.region_map(fin)))):
            dd.text((x + 3, j * (S * sc + 14) + 1), f"{name} s{s} {lab}", fill=(255, 255, 255))
            out.paste(tile(im, sc), (x, j * (S * sc + 14) + 14))
    OUT.mkdir(parents=True, exist_ok=True)
    out.save(OUT / f"{name}_seeds_x3.png")
    (RAW / f"{name}_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")


def still_pick(name: str, seed: int):
    img = Image.open(RAW / f"{name}_s{seed}" / "pose.png")
    img.save(RAW / f"{name}.png")
    meta = json.loads((RAW / "picks.json").read_text()) if (RAW / "picks.json").exists() else {}
    meta[name] = seed
    (RAW / "picks.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    if name == "stand":
        img.save(OUT / "stand.png")
        z9.region_map(img).resize((S * 4, S * 4), Image.NEAREST).save(OUT / "stand_regions_x4.png")
    print(name, "picked", seed)


# ---------------------------------------------------------------- video

def vid_ref(name: str) -> Path:
    if name == "walkkey":
        return RAW / "walkkey_vid.png"
    if name == "walk0":
        on_mag(walk_ref()[0], VID).save(RAW / "walk0_vid.png")
        return RAW / "walk0_vid.png"
    return RAW / f"{name}_vid.png"


def video_gen(action: str, seeds):
    derived_layouts()
    v = VIDEOS[action]
    first, last = vid_ref(v["first"]), vid_ref(v["last"])
    for s in seeds:
        d = RAW / f"{action}_s{s}"
        if list(d.glob("brute_*.png")):
            continue
        print(action, s, z9.run([PY, "-I", ROOT / "tools/art/ai/run_comfy.py", ROOT / "art/ai/workflows/h3_video_i2v.json",
                                 "--image", f"first={first}", "--image", f"last={last}",
                                 "--set", f"scale_first.width={VID}", "--set", f"scale_first.height={VID}",
                                 "--set", f"scale_last.width={VID}", "--set", f"scale_last.height={VID}",
                                 "--set", f"cond.width={VID}", "--set", f"cond.height={VID}",
                                 "--set", f"cond.length={v['length']}",
                                 "--set", f"noise.noise_seed={s}", "--set", f"cond.prompt={v['prompt']}",
                                 "--set", f"save.filename_prefix=ai_art/brute_{action}_s{s}",
                                 "--out", d, "--tag", f"r14 brute {action} seed {s}"])[:90], flush=True)


def downscale(frames: list[Path], scale_ref: Path, ref_h: int) -> list[Image.Image]:
    """Hybrid alignment (one centre for the whole action, per-frame foot), nearest scale, k-centroid /8."""
    keyed = [despill(key_magenta(Image.open(f))) for f in frames]
    k0 = key_magenta(Image.open(scale_ref))
    ys = np.where(np.array(k0)[..., 3] > 128)[0]
    scale = ref_h * 8 / (ys.max() - ys.min() + 1)
    cx_all = []
    for k in keyed:
        a = np.array(k)[..., 3] > 128
        yy, xx = np.where(a)
        band = a[yy.min() + int((yy.max() - yy.min()) * 0.35): yy.min() + int((yy.max() - yy.min()) * 0.6)]
        bx = np.where(band)[1]
        cx_all.append(float(np.median(bx)) if len(bx) else a.shape[1] / 2)
    cx = float(np.median(cx_all))
    out = []
    for k in keyed:
        a = np.array(k)[..., 3] > 128
        foot = int(np.where(a.any(1))[0].max()) + 1
        nw, nh = round(k.width * scale), round(k.height * scale)
        sc = k.resize((nw, nh), Image.NEAREST)
        big = Image.new("RGBA", (VID, VID), (0, 0, 0, 0))
        big.paste(sc, (round(MID * 8 - cx * scale), round((FOOT + 1) * 8 - foot * scale)), sc)
        out.append(z9.largest_blob(k_centroid(big)))
    return out


def track_head(frame, head_px, head_rgb, rx=10, ry=8):
    a = np.array(frame.convert("RGBA")).astype(np.int32)
    ys, xs = head_px
    best = (0, 0, 1e9)
    for dy in range(-ry, ry + 1):
        for dx in range(-rx, rx + 1):
            ty, tx = ys + dy, xs + dx
            ok = (ty >= 0) & (ty < S) & (tx >= 0) & (tx < S)
            if ok.mean() < 0.98:
                continue
            px = a[ty[ok], tx[ok]]
            err = np.where(px[:, 3:] > 0, np.abs(px[:, :3] - head_rgb[ok]).mean(1, keepdims=True), 255).mean()
            if err < best[2]:
                best = (dx, dy, float(err))
    return best


def paste_head(frame, key, hm, neck, dx, dy):
    a = np.array(frame.convert("RGBA"))
    k = np.array(key.convert("RGBA"))
    ys, xs = np.where(hm)
    reg = z9.raw_region(a[..., :3])
    clr = np.zeros(a.shape[:2], bool)
    clr[max(0, ys.min() + dy - 2):neck + dy, max(0, xs.min() + dx - 1):min(S, xs.max() + dx + 2)] = True
    clr &= reg != "shirt"
    a[clr] = 0
    ty, tx = ys + dy, xs + dx
    ok = (ty >= 0) & (ty < S) & (tx >= 0) & (tx < S)
    a[ty[ok], tx[ok]] = k[ys[ok], xs[ok]]
    return fill_holes(Image.fromarray(a, "RGBA"))


def head_mask(key: Image.Image) -> tuple[np.ndarray, int]:
    """Head of a hunched brute. build_zombie10.head_mask takes every non-shirt pixel above the neck row that is
    connected to the skull; on the hunched brute the back's outline and the raised forearms are above the neck row
    too, so they were pasted with the head (a floating arc behind the head and a stick in front of it). Here the
    head is a box: rows from the top of the skull to the neck, columns of the skull's skin in its top 10 rows
    (+-1 for the outline); inside the box, everything that is not shirt."""
    a = np.array(key.convert("RGBA"))
    op = a[..., 3] > 0
    reg = z9.raw_region(a[..., :3])
    _, neck = z10.head_mask(key)
    ys = np.where(op.any(1))[0]
    top = int(ys.min())
    skin = op & (reg == "skin")
    rows = skin[top:top + 10]
    xs = np.where(rows.any(0))[0]
    # the skull is the skin run around the topmost skin pixel (the arms are further right / lower)
    ty, tx = np.argwhere(skin)[0]
    x0 = x1 = tx
    while x0 - 1 >= 0 and rows[:, x0 - 1].any():
        x0 -= 1
    while x1 + 1 < a.shape[1] and rows[:, x1 + 1].any():
        x1 += 1
    m = np.zeros_like(op)
    m[max(0, top - 1):neck, max(0, x0 - 1):x1 + 2] = True
    m &= op & (reg != "shirt")
    return m, neck


def fill_holes(img: Image.Image) -> Image.Image:
    """Transparent pixels with >= 3 opaque 4-neighbours (left behind where a frame's own head was cleared and the
    pasted head is a little smaller) take the most common neighbour colour."""
    a = np.array(img.convert("RGBA"))
    for _ in range(2):
        op = a[..., 3] > 0
        for y, x in zip(*np.where(~op)):
            nb = [a[yy, xx] for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1))
                  if 0 <= yy < a.shape[0] and 0 <= xx < a.shape[1] and op[yy, xx]]
            if len(nb) >= 3:
                cols = [tuple(c) for c in nb]
                a[y, x] = max(set(cols), key=lambda c: (cols.count(c), c))
    return Image.fromarray(a, "RGBA")


def head_setup(key):
    hm, neck = head_mask(key)
    neck -= z12.NECK_STUB
    hm[neck:] = False
    return hm, neck


def head_lock(frames, key, force_dy=None):
    """build_zombie10.head_lock with the box head mask: clears and pastes only inside the head box."""
    hm, neck = head_mask(key)
    k = np.array(key.convert("RGBA"))
    ref_sh = z10.shoulder_row(key, neck)
    ys, xs = np.where(hm)
    x0, x1 = xs.min(), xs.max()
    out, dys = [], []
    for i, f in enumerate(frames):
        a = np.array(f.convert("RGBA"))
        dy = force_dy[i] if force_dy is not None else int(np.clip(round(z10.shoulder_row(f, neck - 2) - ref_sh), 0, 1))
        dys.append(dy)
        reg = z9.raw_region(a[..., :3])
        clr = np.zeros(a.shape[:2], bool)
        clr[max(0, ys.min() + dy - 2):neck + dy, x0:x1 + 1] = True
        clr &= reg != "shirt"
        a[clr] = 0
        a[ys + dy, xs] = k[ys, xs]
        out.append(Image.fromarray(a, "RGBA"))
    return out, dys


def head_identical(fin, key, dys):
    hm, _ = head_mask(key)
    ys, xs = np.where(hm)
    ref = np.array(fin[0])[ys + dys[0], xs]
    return all((np.array(f)[ys + dy, xs] == ref).all() for f, dy in zip(fin, dys))


def video_post(action: str):
    rp = z9.region_palettes()
    rows, summary = [], {}
    key = Image.open(RAW / "walkkey.png").convert("RGBA")
    key_h = z9.measure(key)["height"]
    for d in sorted(RAW.glob(f"{action}_s*")):
        frames = sorted(d.glob("brute_*.png"))
        if not frames:
            continue
        s = int(d.name.split("_s")[-1])
        if action == "walk":
            info = z10.gait_pick(frames)
            idx = [i % len(frames) for i in info["picked"]]
        else:
            idx, info = z12.pick_indices(action, frames)
            info.pop("d_start", None)
        scale_ref = frames[-1] if VIDEOS[action]["first"] == "down" else frames[0]
        small = downscale([frames[i] for i in idx], scale_ref, key_h)
        q = [quantize_regions(f, rp) for f in small]
        if action == "walk":
            # brute sways: the head follows the body sideways too. Track the key head in every frame (translation),
            # paste the key head there (dy limited to the tracked bob); pixel-identical head, moving with the body
            hm, neck = head_setup(key)
            hp = np.where(hm)
            hrgb = np.array(key)[hp][:, :3].astype(np.int32)
            q = [remove_islands(f, 2)[0] for f in q]
            trk = [track_head(f, hp, hrgb, rx=8, ry=4) for f in q]
            q = [paste_head(f, key, hm, neck, dx, dy) for f, (dx, dy, _) in zip(q, trk)]
            fin, tinfo = tidy(q)
            cl = [z10.region_islands(f) for f in fin]
            fin = [c for c, _ in cl]
            kf = z10.fin_key(key, fin)
            fin = [paste_head(f, kf, hm, neck, dx, dy) for f, (dx, dy, _) in zip(fin, trk)]
            ys_, xs_ = hp
            ref = np.array(kf)[ys_, xs_]
            ident = all((np.array(f)[ys_ + dy, xs_ + dx] == ref).all() for f, (dx, dy, _) in zip(fin, trk))
            info.update(tinfo, head_track=[{"dx": dx, "dy": dy, "err": round(e, 1)} for dx, dy, e in trk],
                        region_px_fixed=sum(n for _, n in cl),
                        out_spread=[z10.leg_spread_small(f) for f in fin], head_identical=bool(ident))
        else:
            walk = walk_ref()
            k0 = walk[0]
            hm, neck = head_setup(k0)
            hp = np.where(hm)
            hrgb = np.array(k0)[hp][:, :3].astype(np.int32)
            q = snap([remove_islands(f, 2)[0] for f in q], walk)
            heads, outf = [], []
            for f in q:
                dx, dy, err = track_head(f, hp, hrgb)
                use = err < 40
                heads.append({"dx": dx, "dy": dy, "err": round(err, 1), "locked": bool(use)})
                outf.append(paste_head(f, k0, hm, neck, dx, dy) if use else f)
            cl = [z10.region_islands(f) for f in outf]
            fin = snap([c for c, _ in cl], walk)
            fin = [paste_head(f, k0, hm, neck, h["dx"], h["dy"]) if h["locked"] else f for f, h in zip(fin, heads)]
            info.update(heads=heads, region_px_fixed=sum(n for _, n in cl))
        fd = d / "final"
        fd.mkdir(exist_ok=True)
        for i, f in enumerate(fin):
            f.save(fd / f"{i:02d}.png")
        st = strip(fin)
        st.save(fd / "sheet.png")
        info.update(heights=[z9.measure(f)["height"] for f in fin], feet=[bbox(f)[3] for f in fin],
                    widths=[bbox(f)[2] - bbox(f)[0] + 1 for f in fin], regions=z9.region_stats(st),
                    outside_palette=check(fd / "sheet.png")["outside_palette"],
                    n_colours=int(len(np.unique(np.array(st).reshape(-1, 4)[np.array(st).reshape(-1, 4)[:, 3] > 0][:, :3], axis=0))))
        info.update({k: v for k, v in json.loads((d / "meta.json").read_text(encoding="utf-8"))[-1].items()
                     if k in ("seconds", "vram_peak_mib")})
        summary[d.name] = info
        rows.append((d.name, fin, info))
        print(d.name, "picked", info.get("picked"), "h", info["heights"], "w", info["widths"], "feet", info["feet"],
              "c", info["n_colours"], "spread", info.get("out_spread"), "t", info.get("seconds"), flush=True)
    n = N[action]
    sc, cw = 3, S * 3
    sheet = Image.new("RGB", (n * cw, len(rows) * (2 * cw + 18)), (20, 20, 20))
    dd = ImageDraw.Draw(sheet)
    for r, (tag, fin, info) in enumerate(rows):
        y = r * (2 * cw + 18)
        extra = f"spread {info['out_spread']}" if action == "walk" else \
            "head " + "".join("L" if h["locked"] else "-" for h in info["heads"])
        dd.text((3, y + 3), f"{tag} frames {info.get('picked')} h {min(info['heights'])}-{max(info['heights'])} "
                            f"w<={max(info['widths'])} {info['n_colours']}c {extra}", fill=(255, 255, 255))
        for i, f in enumerate(fin):
            sheet.paste(tile(f, sc), (i * cw, y + 18))
            sheet.paste(tile(z9.region_map(f), sc), (i * cw, y + 18 + cw))
    sheet.save(OUT / f"{action}_seeds_x3.png")
    (RAW / f"{action}_summary.json").write_text(json.dumps(summary, indent=1, default=str), encoding="utf-8")


def build_action(name: str, frames: list[Image.Image], fps: int, loop: bool, meta: dict):
    fd = RAW / f"{name}_final"
    if fd.exists():
        shutil.rmtree(fd)
    fd.mkdir()
    for i, f in enumerate(frames):
        f.save(fd / f"{i:02d}.png")
    subprocess.run([str(PY), "-I", str(ROOT / "tools/art/ai/build_sheet.py"), str(fd), "--name", name, "--fps", str(fps),
                    *(["--loop"] if loop else []), "--foot-row", str(FOOT), "--out", str(OUT)], check=True, cwd=ROOT)
    strip([z9.region_map(f) for f in frames]).resize((S * len(frames) * 4, S * 4), Image.NEAREST).save(
        OUT / f"{name}_regions_x4.png")
    p = OUT / "meta.json"
    m = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    m[name] = meta
    m["canvas"] = {"w": S, "h": S, "foot_row": FOOT, "centre_x": MID}
    p.write_text(json.dumps(m, indent=1, ensure_ascii=False, default=str), encoding="utf-8")


def video_pick(action: str, seed: int):
    fd = RAW / f"{action}_s{seed}" / "final"
    frames = [Image.open(fd / f"{i:02d}.png").convert("RGBA") for i in range(N[action])]
    summ = json.loads((RAW / f"{action}_summary.json").read_text(encoding="utf-8"))
    v = VIDEOS[action]
    meta = {"round": 14, "seed": seed, "prompt": v["prompt"], "first": v["first"], "last": v["last"],
            "workflow": f"art/ai/workflows/h3_video_i2v.json {VID}x{VID}, {v['length']} frames, 8-step LoRA, 8 steps",
            "pick": summ[f"{action}_s{seed}"], "seeds": summ}
    fps, loop = {"walk": (8, True), "attack": (10, True), "death": (8, False), "getup": (10, False)}[action]
    if action == "getup":
        (RAW / "getup_pick.json").write_text(json.dumps(meta, default=str), encoding="utf-8")
        for i, f in enumerate(frames):
            f.save(RAW / f"getup_{i}.png")
        print("getup picked", seed)
        return
    build_action(action, frames, fps, loop, meta)
    print(action, "picked", seed)


def hit_build(sa: int, sb: int):
    a = Image.open(RAW / f"hitA_s{sa}" / "pose.png")
    b = Image.open(RAW / f"hitB_s{sb}" / "pose.png")
    build_action("hit", [a, b, a], 10, False, {"round": 14, "method": "H3 Image stills hitA / hitB / hitA",
                                               "seeds": {"hitA": sa, "hitB": sb}, "prompts": {k: STILLS[k][2] for k in ("hitA", "hitB")}})


def react_build(r: int, f: int, b: int, g: int):
    fr = [Image.open(RAW / f"{n}_s{s}" / "pose.png") for n, s in (("rise", r), ("fall", f), ("bounce", b))]
    fr.append(frames_of(OUT / "death.png")[-1])
    fr += [Image.open(RAW / f"getup_{i}.png") for i in range(4)]
    build_action("react", fr, 10, False, {"round": 14, "order": "rise, fall, bounce, down (= death frame 8), getup x4",
                                          "seeds": {"rise": r, "fall": f, "bounce": b, "getup": g},
                                          "prompts": {k: STILLS[k][2] for k in ("rise", "fall", "bounce")},
                                          "lift_px": LIFT, "getup": json.loads((RAW / "getup_pick.json").read_text())})


def sheet26():
    walk, attack, death = frames_of(OUT / "walk.png"), frames_of(OUT / "attack.png"), frames_of(OUT / "death.png")
    hit, react_f = frames_of(OUT / "hit.png"), frames_of(OUT / "react.png")
    reach = [bbox(f)[2] for f in attack]
    # frame 0 is the walk pose (its arms already reach to x=70) and 5 is the return, so pick the lunge among 1-4
    two = sorted(sorted(range(1, len(attack) - 1), key=lambda i: (-reach[i], i))[:2])
    layout = ([("walk", i) for i in (0, 2, 4, 6)] + [("attack", i) for i in two] + [("death", i) for i in range(9)] +
              [("hit", i) for i in range(3)] + [("react", i) for i in range(8)])
    src = {"walk": walk, "attack": attack, "death": death, "hit": hit, "react": react_f}
    frames = [src[k][i] for k, i in layout]
    sheet = strip(frames)
    sheet.save(OUT / "zombie_brute_26.png")
    strip(walk).save(OUT / "zombie_brute_walk8.png")
    strip(attack).save(OUT / "zombie_brute_attack6.png")
    names = ["walk"] * 4 + ["attack"] * 2 + ["death"] * 9 + ["hit"] * 3 + ["rise", "fall", "bounce", "down"] + ["getup"] * 4
    meta = {"frameWidth": S, "frameHeight": S, "frames": 26, "foot_row": FOOT, "centre_x": MID,
            "ranges": {"walk": [0, 3], "attack": [4, 5], "death": [6, 14], "hit": [15, 17], "rise": [18, 18],
                       "fall": [19, 19], "bounce": [20, 20], "down": [21, 21], "getup": [22, 25]},
            "source": [f"{k}.png frame {i}" for k, i in layout], "attack_frames_used": two,
            "lowest_pixel_row": [bbox(f)[3] for f in frames], "bbox": [list(bbox(f)) for f in frames],
            "extra": {"zombie_brute_walk8.png": "walk.png 8 frames", "zombie_brute_attack6.png": "attack.png 6 frames"}}
    (OUT / "zombie_brute_26.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    sc, cw = 3, S * 3
    con = Image.new("RGB", (13 * cw, 2 * (cw + 16)), (58, 62, 74))
    d = ImageDraw.Draw(con)
    for i, f in enumerate(frames):
        x, y = (i % 13) * cw, (i // 13) * (cw + 16)
        bg = Image.new("RGBA", (S, S), (58, 62, 74, 255))
        bg.alpha_composite(f)
        con.paste(bg.convert("RGB").resize((cw, cw), Image.NEAREST), (x, y + 16))
        d.line([(x, y + 16 + FOOT * sc + sc), (x + cw, y + 16 + FOOT * sc + sc)], fill=(0, 255, 0))
        d.text((x + 3, y + 2), f"{i} {names[i]}", fill=(255, 255, 255))
    con.save(OUT / "contact_zombie_brute_26.png")
    cols = np.unique(np.array(sheet).reshape(-1, 4)[np.array(sheet).reshape(-1, 4)[:, 3] > 0][:, :3], axis=0)
    print("brute26 colours", len(cols), "outside", check(OUT / "zombie_brute_26.png")["outside_palette"], "attack", two)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd")
    ap.add_argument("args", nargs="*")
    ap.add_argument("--seeds", nargs="*", type=int, default=[1, 2, 3, 4])
    a = ap.parse_args()
    c, x = a.cmd, a.args
    if c == "refs":
        refs()
    elif c == "still-gen":
        still_gen(x[0], a.seeds)
    elif c == "still-post":
        still_post(x[0])
    elif c == "still-pick":
        still_pick(x[0], int(x[1]))
    elif c == "video-gen":
        video_gen(x[0], a.seeds)
    elif c == "video-post":
        video_post(x[0])
    elif c == "video-pick":
        video_pick(x[0], int(x[1]))
    elif c == "hit-build":
        hit_build(int(x[0]), int(x[1]))
    elif c == "react-build":
        react_build(*map(int, x[:4]))
    elif c == "sheet26":
        sheet26()
    elif c == "layouts":
        derived_layouts()


if __name__ == "__main__":
    main()
