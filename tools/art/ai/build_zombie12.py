"""Round 12: fog zombie M actions: attack (grab-bite, 6), hit (3), death (9).

  python tools/art/ai/build_zombie12.py refs
  python tools/art/ai/build_zombie12.py down-gen [--seeds 1 2 3 4]     # lying pose key (H3 Image) for death
  python tools/art/ai/build_zombie12.py down-post
  python tools/art/ai/build_zombie12.py down-pick SEED
  python tools/art/ai/build_zombie12.py gen ACTION [--seeds 1 2 3 4] [--steps 8|4]
  python tools/art/ai/build_zombie12.py post ACTION
  python tools/art/ai/build_zombie12.py pick ACTION SEED

Base frames: round 10 walk frame 0 (art/ai/out/zombie_m/walk.png, frame 0) = start pose of every action, and the
end pose of attack/hit (they return to the walk). Death ends on a lying key (back on y=61, head left, feet right).
Video: art/ai/workflows/h3_video_i2v.json (8-step turbo LoRA, 8 steps; --steps 4 = official 4-step LoRA).

Frame pick (per action, from the 56 video frames): d(t) = silhouette distance of frame t to the start frame.
  attack: peak = argmax d; 0..3 = start..peak evenly (wind-up, lunge, grab, bite = peak), 4..5 = back toward start
  hit   : peak = argmax d in the first half; 0 = halfway to the peak, 1 = peak, 2 = halfway back
  death : end = first frame whose distance to the last (lying) frame is small; 9 frames evenly from the first moving
          frame to the end
Post: round 10 pipeline (hybrid downscale at the walk scale, region quantize, outline, speck clean-up). Colours are
snapped to the walk sheet's 16 colours (same region, nearest), so all actions share one 16-colour set.
Head: the walk head is searched in each frame (translation +-10/+-8 px, colour error); where it matches, the walk
head pixels are pasted at that position, so the face stays the same set of pixels. Frames where the head is
rotated (falling, lying) keep the generated head.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1]))
import build_zombie9 as z9  # noqa: E402
import build_zombie10 as z10  # noqa: E402
from build_palette import check  # noqa: E402
from pick_frames import dist_matrix, features  # noqa: E402
from pixelize import downscale, remove_islands  # noqa: E402

ROOT = z9.ROOT
RAW = ROOT / "art/ai/raw/zombie12"
OUT = ROOT / "art/ai/out/zombie_m"
PY = z9.PY
FOOT = z9.FOOT
NECK_STUB = 3
LORA4 = "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"

COMMON = ("Pixel art game sprite animation of the fog zombie from <Picture 1>: keep its grey-green skin, small head, "
          "torn light grey shirt, dark blue-grey trousers, dark shoes, colours and near-black outlines exactly. "
          "Three-quarter view facing right, fixed camera, no zoom, no pan, full body visible at all times. The "
          "background stays plain solid magenta in every frame. ")
ACTIONS = {
    "attack": {"n": 6, "length": 56, "end": "walk0", "prompt": COMMON + (
        "The hunched zombie attacks empty air just in front of it to the right (there is nothing there: no victim, "
        "no person, no object, no wall, only the zombie and the magenta background): it pulls back slightly, then "
        "lunges forward with both arms outstretched, claws and grabs at the air with both hands, pulls them in and "
        "bites with its head thrust forward and mouth wide open, then slowly returns to its hunched stance with arms "
        "forward. The feet stay planted on the ground line. One single attack. No effects, no blood spray. Flat colors.")},
    "hit": {"n": 3, "length": 39, "end": "walk0", "prompt": COMMON + (
        "The hunched zombie recoils from an invisible blow to the face from the right (no weapon, no bat, no object, "
        "no person, nothing else appears, only the zombie and the magenta background): its head snaps back, its "
        "upper body bends backward a little, the arms jerk but stay forward, the feet stay planted on the ground "
        "line, then it quickly hunches forward again into its walking stance with both arms reaching forward. One "
        "single hit. No effects, no blood. Flat colors.")},
    "death": {"n": 9, "length": 56, "end": "down", "prompt": COMMON + (
        "The hunched zombie is killed by an invisible blow from the right (no weapon, no object, no person, nothing "
        "else appears, only the zombie and the magenta background): its head snaps back, it staggers backward to the "
        "left, the knees buckle and it falls backward to the left, landing flat on its back on the ground line with "
        "the head on the left and the feet on the right, a small bounce, then it lies completely still. No effects, "
        "no blood. Flat colors.")},
    # round 13: get up from the death pose (death.png frame 8) back to the walk stance
    "getup": {"n": 4, "length": 56, "start": "deathlast", "end": "walk0", "prompt": COMMON + (
        "The zombie lies flat on its back on the ground line, head on the left, feet on the right. It slowly comes "
        "back to life: it pushes its upper body up on its arms, sits up, pulls its legs in and gets onto one knee, "
        "then stands up into its hunched walking stance with both arms reaching forward to the right. Slow, heavy, "
        "jerky zombie movement. Only the zombie, nothing else appears. No effects, no blood. Flat colors.")},
}
DOWN_PROMPT = (
    "Redraw <Picture 1> as a clean pixel art game sprite for a 2D side-scrolling zombie game: the dead fog zombie "
    "from <Picture 2> lying flat on its back on the ground, seen from the side, head on the LEFT, feet on the RIGHT, "
    "face up, arms lying limp beside the body, legs straight, exactly the position and size of the grey figure in "
    "<Picture 1>. Keep its grey-green rotting skin, small head (3.5 heads tall), sunken dark eyes, torn plain light "
    "grey shirt (neutral grey), dark blue-grey trousers, dark worn shoes. Draw it in exactly the pixel art style of "
    "<Picture 3>: light from the upper left, 3 to 4 shading steps, a 1 pixel near-black outline, muted grey-green "
    "colours. Plain solid magenta background, no ground, no floor line, no cast shadow, no blood, no text."
)


KNOCK_POSES = {
    # name: (rotation of the walk-0 silhouette, counter-clockwise degrees; lift of the lowest pixel above y=61; text)
    "rise": (55, 3, "it has just been knocked off its feet by a heavy blow from the right: the whole body is in the "
                    "air leaning far backward to the left, about 30 degrees, head thrown back, arms flung forward and "
                    "up, legs kicked forward, both feet clearly off the ground"),
    "fall": (100, 5, "it is flying backward through the air almost horizontal, back toward the ground, head on the "
                    "left slightly lower than the feet on the right, arms and legs flung up, falling onto its back, "
                    "not touching the ground yet"),
    "bounce": (90, 2, "it has just slammed onto its back and bounces slightly: lying almost flat with the head on the "
                      "left and the feet on the right, the back just above the ground, legs and arms jolted upward, "
                      "head jerked up"),
}
KNOCK_PROMPT = (
    "Redraw the grey silhouette in <Picture 1> as the fog zombie from <Picture 2>, as a clean pixel art game sprite "
    "for a 2D side-scrolling zombie game, at exactly the position, size and angle of the silhouette: {pose}. Keep "
    "the character of <Picture 2> (small head 3.5 heads tall, grey-green rotting skin, sunken dark eyes, torn plain "
    "light grey shirt, dark blue-grey trousers, dark shoes), seen from the side. Draw it in exactly the pixel art "
    "style of <Picture 3>: light from the upper left, 3 to 4 shading steps, a 1 pixel near-black outline. Only the "
    "zombie: no weapon, no bat, no attacker, no object, no ground, no floor line, no cast shadow, no effects, no "
    "blood, no motion lines. Plain solid magenta background, no text."
)


def knock_layouts():
    w0 = walk_frames_final()[0]
    a = np.array(w0)[..., 3] > 0
    ys, xs = np.where(a)
    fig = w0.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    cx = (xs.min() + xs.max()) / 2
    for name, (rot, lf, _) in KNOCK_POSES.items():
        # bounce: the lying death pose (death frame 8), lifted; the others: the walk pose rotated backward
        src = Image.open(RAW / "deathlast.png").convert("RGBA") if name == "bounce" else fig
        if name == "bounce":
            yy, xx = np.where(np.array(src)[..., 3] > 0)
            src = src.crop((xx.min(), yy.min(), xx.max() + 1, yy.max() + 1))
        r = src.rotate(0 if name == "bounce" else rot, expand=True, resample=Image.NEAREST)
        ry, rx = np.where(np.array(r)[..., 3] > 0)
        r = r.crop((rx.min(), ry.min(), rx.max() + 1, ry.max() + 1))
        lay = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        x0 = int(round(cx - r.width / 2)) - (6 if rot >= 75 else 3)
        x0 = max(1, min(63 - r.width, x0))
        if name == "bounce":
            x0 = int(np.where(np.array(Image.open(RAW / "deathlast.png"))[..., 3] > 0)[1].min())
        lay.alpha_composite(r, (x0, max(1, FOOT + 1 - lf - r.height)))
        g = np.array(lay)
        g[..., :3] = np.where(g[..., 3:] > 0, 150, 0)
        Image.fromarray(g, "RGBA").save(RAW / f"{name}_layout.png")
        _x16(Image.fromarray(g, "RGBA"), RAW / f"{name}_layout_x16.png")


def knock_gen(seeds):
    knock_layouts()
    for pose, (_, _, desc) in KNOCK_POSES.items():
        for s in seeds:
            if list((RAW / f"{pose}_s{s}").glob("zombie12_*.png")):
                continue
            print(pose, s, z9.run([PY, "-I", ROOT / "tools/art/ai/run_comfy.py", ROOT / "art/ai/workflows/h3_image_edit_3ref.json",
                                   "--image", f"load1={RAW / (pose + '_layout_x16.png')}", "--image", f"load2={RAW / 'walk0_x16.png'}",
                                   "--image", f"load3={RAW / 'ref_anchor_1024.png'}",
                                   "--set", "scale1.width=1024", "--set", "scale1.height=1024",
                                   "--set", "cond.width=1024", "--set", "cond.height=1024",
                                   "--set", f"sampler.seed={s}", "--set", f"cond.prompt={KNOCK_PROMPT.format(pose=desc)}",
                                   "--set", f"save.filename_prefix=ai_art/zombie12_{pose}_s{s}",
                                   "--out", RAW / f"{pose}_s{s}", "--tag", f"r13 zombie react {pose} seed {s}"])[:90], flush=True)


def lift(img: Image.Image, n: int) -> Image.Image:
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(img, (0, -n))
    return out


def knock_post():
    rp = z9.region_palettes()
    walk = walk_frames_final()
    rows, summary = [], {}
    for pose, (rot, lf, _) in KNOCK_POSES.items():
        for s in range(1, 9):
            raws = sorted((RAW / f"{pose}_s{s}").glob("zombie12_*.png"))
            if not raws:
                continue
            _, q = z9.post_stand_raw(raws[-1], rp)
            q, _ = remove_islands(q, 2)
            q, nfix = z10.region_islands(q)
            (f,) = snap([q], walk)
            f = lift(f, lf)
            fd = RAW / f"{pose}_s{s}"
            f.save(fd / "pose_64.png")
            ys, xs = np.where(np.array(f)[..., 3] > 0)
            info = {"w": int(xs.max() - xs.min() + 1), "h": int(ys.max() - ys.min() + 1), "bottom": int(ys.max()),
                    "regions": z9.region_stats(f), "region_px_fixed": nfix,
                    "outside_palette": check(fd / "pose_64.png")["outside_palette"],
                    "stray_object": stray_object(raws[-1])}
            summary[f"{pose}_s{s}"] = info
            rows.append((pose, s, f, info))
            print(pose, s, info)
    poses = list(KNOCK_POSES)
    seeds = sorted({s for _, s, _, _ in rows})
    sc, cw = 3, 64 * 3
    sheet = Image.new("RGB", (len(poses) * 2 * cw, len(seeds) * (cw + 18)), (20, 20, 20))
    dd = ImageDraw.Draw(sheet)
    for pose, s, f, info in rows:
        c, r = poses.index(pose), seeds.index(s)
        x, y = c * 2 * cw, r * (cw + 18)
        dd.text((x + 3, y + 3), f"{pose} s{s} {info['w']}x{info['h']} bottom {info['bottom']} obj {info['stray_object']}",
                fill=(255, 255, 255))
        sheet.paste(z9.tile(f, sc), (x, y + 18))
        sheet.paste(z9.tile(z9.region_map(f), sc), (x + cw, y + 18))
    sheet.save(OUT / "react_knock_seeds_x3.png")
    (RAW / "knock_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")


HIT_POSES = {
    "hitA": ("its head has just snapped backward from a blow to the face: the head is tilted back with the chin up "
             "and the face turned up toward the upper right, the shoulders are pushed back a little, the arms are "
             "still reaching forward but jerked slightly up, the legs and feet stay exactly where they are"),
    "hitB": ("it recoils from a heavy blow to the face: the whole upper body is bent backward to the left with the "
             "chest pushed out, the head thrown back, both arms flung loosely forward and up, the knees slightly "
             "bent, the feet stay exactly where they are on the ground line"),
}
HIT_STILL_PROMPT = (
    "Redraw the fog zombie of <Picture 1> as a clean pixel art game sprite for a 2D side-scrolling zombie game, at "
    "exactly the same position, size, colours and three-quarter view facing right, keeping its feet on the same "
    "ground line, but change its pose: {pose}. Keep the character of <Picture 2> (small head, grey-green rotting "
    "skin, torn plain light grey shirt, dark blue-grey trousers, dark shoes). Draw it in exactly the pixel art style "
    "of <Picture 3>: light from the upper left, 3 to 4 shading steps, a 1 pixel near-black outline. Only the "
    "zombie: no weapon, no bat, no hand of an attacker, no object, no effects, no blood. Plain solid magenta "
    "background, no ground, no floor line, no cast shadow, no text."
)


def hit_still_gen(seeds):
    _x16(Image.open(OUT / "stand.png"), RAW / "stand_x16.png")
    for pose, desc in HIT_POSES.items():
        for s in seeds:
            if list((RAW / f"{pose}_s{s}").glob("zombie12_*.png")):
                continue
            print(pose, s, z9.run([PY, "-I", ROOT / "tools/art/ai/run_comfy.py", ROOT / "art/ai/workflows/h3_image_edit_3ref.json",
                                   "--image", f"load1={RAW / 'walk0_x16.png'}", "--image", f"load2={RAW / 'stand_x16.png'}",
                                   "--image", f"load3={RAW / 'ref_anchor_1024.png'}",
                                   "--set", "scale1.width=1024", "--set", "scale1.height=1024",
                                   "--set", "cond.width=1024", "--set", "cond.height=1024",
                                   "--set", f"sampler.seed={s}", "--set", f"cond.prompt={HIT_STILL_PROMPT.format(pose=desc)}",
                                   "--set", f"save.filename_prefix=ai_art/zombie12_{pose}_s{s}",
                                   "--out", RAW / f"{pose}_s{s}", "--tag", f"r12 zombie {pose} seed {s}"])[:100], flush=True)


def hit_still_post():
    """hit = [hitA, hitB, hitA] per seed (head snaps back, body bends back, eases back = hitA again)."""
    rp = z9.region_palettes()
    walk = walk_frames_final()
    rows, summary = [], {}
    for s in range(1, 9):
        imgs = {}
        for pose in HIT_POSES:
            raws = sorted((RAW / f"{pose}_s{s}").glob("zombie12_*.png"))
            if not raws:
                break
            _, q = z9.post_stand_raw(raws[-1], rp)
            q, _ = remove_islands(q, 2)
            q, nfix = z10.region_islands(q)
            (imgs[pose],) = snap([q], walk)
        if len(imgs) < 2:
            continue
        fin = [imgs["hitA"], imgs["hitB"], imgs["hitA"]]
        tag = f"hitstill_s{s}"
        fd = RAW / tag / "final"
        fd.mkdir(parents=True, exist_ok=True)
        for i, f in enumerate(fin):
            f.save(fd / f"{i:02d}.png")
        st = z9.strip(fin)
        st.save(fd / "sheet.png")
        cols = np.unique(np.array(st).reshape(-1, 4)[np.array(st).reshape(-1, 4)[:, 3] > 0][:, :3], axis=0)
        info = {"heights": [z9.measure(f)["height"] for f in fin],
                "feet": [int(np.where(np.array(f)[..., 3] > 0)[0].max()) for f in fin], "colours": int(len(cols)),
                "regions": z9.region_stats(st), "outside_palette": check(fd / "sheet.png")["outside_palette"],
                "picked": ["hitA", "hitB", "hitA"], "heads": [{"locked": False}] * 3}
        summary[tag] = info
        rows.append((tag, fin, info))
        print(tag, info["heights"], info["colours"], info["outside_palette"])
    sc, cw = 3, 64 * 3
    sheet = Image.new("RGB", (4 * cw, len(rows) * (2 * cw + 18)), (20, 20, 20))
    dd = ImageDraw.Draw(sheet)
    for r, (tag, fin, info) in enumerate(rows):
        y = r * (2 * cw + 18)
        dd.text((3, y + 3), f"{tag}  hitA/hitB/hitA + walk0  h {info['heights']}  {info['colours']}c", fill=(255, 255, 255))
        for i, f in enumerate(fin + [walk[0]]):
            sheet.paste(z9.tile(f, sc), (i * cw, y + 18))
            sheet.paste(z9.tile(z9.region_map(f), sc), (i * cw, y + 18 + cw))
    sheet.save(OUT / "hit_seeds_x3.png")
    (RAW / "hit_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")


def _x16(img: Image.Image, path: Path, size: int = 1024):
    c = Image.new("RGBA", (64, 64), (255, 0, 255, 255))
    c.alpha_composite(img.convert("RGBA"))
    c.convert("RGB").resize((size, size), Image.NEAREST).save(path)


def walk_frames_final() -> list[Image.Image]:
    st = Image.open(OUT / "walk.png").convert("RGBA")
    return [st.crop((64 * i, 0, 64 * i + 64, 64)) for i in range(st.width // 64)]


# ---------------------------------------------------------------- refs / lying key

def refs():
    RAW.mkdir(parents=True, exist_ok=True)
    w0 = walk_frames_final()[0]
    w0.save(RAW / "walk0.png")
    _x16(w0, RAW / "walk0_x16.png")
    _x16(w0, RAW / "walk0_512.png", 512)
    # lying layout: stand rotated 90 degrees counter-clockwise (head left, face up), back on the foot row
    st = Image.open(OUT / "stand.png").convert("RGBA")
    a = np.array(st)[..., 3] > 0
    ys, xs = np.where(a)
    fig = st.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)).rotate(90, expand=True)
    lay = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    lay.alpha_composite(fig, ((64 - fig.width) // 2, FOOT + 1 - fig.height))
    grey = np.array(lay)
    g = grey[..., :3].mean(-1, keepdims=True).astype(np.uint8)
    grey[..., :3] = np.where(grey[..., 3:] > 0, np.clip(g * 0 + 150, 0, 255), 0)  # flat grey silhouette
    Image.fromarray(grey, "RGBA").save(RAW / "down_layout.png")
    _x16(Image.fromarray(grey, "RGBA"), RAW / "down_layout_x16.png")
    shutil.copy(ROOT / "art/ai/raw/zombie9/ref_anchor_1024.png", RAW / "ref_anchor_1024.png")
    print("refs ->", RAW)


def refs13():
    d = Image.open(OUT / "death.png").convert("RGBA")
    last = d.crop((d.width - 64, 0, d.width, 64))
    last.save(RAW / "deathlast.png")
    _x16(last, RAW / "deathlast_512.png", 512)


def down_gen(seeds):
    for s in seeds:
        print("down", s, z9.run([PY, "-I", ROOT / "tools/art/ai/run_comfy.py", ROOT / "art/ai/workflows/h3_image_edit_3ref.json",
                                 "--image", f"load1={RAW / 'down_layout_x16.png'}", "--image", f"load2={RAW / 'walk0_x16.png'}",
                                 "--image", f"load3={RAW / 'ref_anchor_1024.png'}",
                                 "--set", "scale1.width=1024", "--set", "scale1.height=1024",
                                 "--set", "cond.width=1024", "--set", "cond.height=1024",
                                 "--set", f"sampler.seed={s}", "--set", f"cond.prompt={DOWN_PROMPT}",
                                 "--set", f"save.filename_prefix=ai_art/zombie12_down_s{s}",
                                 "--out", RAW / f"down_s{s}", "--tag", f"r12 zombie down seed {s}"])[:120], flush=True)


def snap(frames: list[Image.Image], ref: list[Image.Image]) -> list[Image.Image]:
    """Every pixel -> nearest colour of the reference sheet within the same region."""
    return [z10.fin_key(f, ref) for f in frames]


def down_post():
    rp = z9.region_palettes()
    walk = walk_frames_final()
    rows, summary = [], {}
    for d in sorted(p for p in RAW.glob("down_s*") if p.is_dir()):
        s = int(d.name.split("_s")[-1])
        raws = sorted(d.glob("zombie12_down_*.png"))
        if not raws:
            continue
        small, q = z9.post_stand_raw(raws[-1], rp)
        q, _ = remove_islands(q, 2)
        q, nfix = z10.region_islands(q)
        (fin,) = snap([q], walk)
        fin.save(d / "down_64.png")
        a = np.array(fin)[..., 3] > 0
        ys, xs = np.where(a)
        info = {"w": int(xs.max() - xs.min() + 1), "h": int(ys.max() - ys.min() + 1), "x0": int(xs.min()),
                "x1": int(xs.max()), "regions": z9.region_stats(fin), "region_px_fixed": nfix}
        summary[s] = info
        rows.append((s, small, fin, info))
    sc = 4
    out = Image.new("RGB", (len(rows) * (64 * sc + 6), 3 * (64 * sc + 14)), (20, 20, 20))
    dd = ImageDraw.Draw(out)
    for i, (s, small, fin, info) in enumerate(rows):
        x = i * (64 * sc + 6)
        for j, (lab, im) in enumerate((("raw/16", small), (f"{info['w']}x{info['h']}", fin), ("regions", z9.region_map(fin)))):
            dd.text((x + 3, j * (64 * sc + 14) + 1), f"s{s} {lab}", fill=(255, 255, 255))
            out.paste(z9.tile(im, sc), (x, j * (64 * sc + 14) + 14))
    out.save(RAW / "down_seeds_x4.png")
    (RAW / "down_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    for s, v in summary.items():
        print(s, v)


def down_pick(seed: int):
    img = Image.open(RAW / f"down_s{seed}" / "down_64.png")
    img.save(RAW / "down.png")
    _x16(img, RAW / "down_512.png", 512)
    (RAW / "down_pick.json").write_text(json.dumps({"seed": seed}), encoding="utf-8")
    print("down picked", seed)


# ---------------------------------------------------------------- video

def gen(action: str, seeds, steps: int):
    a = ACTIONS[action]
    first = RAW / ("deathlast_512.png" if a.get("start") == "deathlast" else "walk0_512.png")
    last = RAW / "walk0_512.png" if a["end"] == "walk0" else RAW / "down_512.png"
    tag = "" if steps == 8 else f"_q{steps}"
    for s in seeds:
        cmd = [PY, "-I", ROOT / "tools/art/ai/run_comfy.py", ROOT / "art/ai/workflows/h3_video_i2v.json",
               "--image", f"first={first}", "--image", f"last={last}",
               "--set", "scale_first.width=512", "--set", "scale_first.height=512",
               "--set", "scale_last.width=512", "--set", "scale_last.height=512",
               "--set", "cond.width=512", "--set", "cond.height=512", "--set", f"cond.length={a['length']}",
               "--set", f"noise.noise_seed={s}", "--set", f"cond.prompt={a['prompt']}",
               "--set", f"save.filename_prefix=ai_art/zombie12_{action}{tag}_s{s}"]
        if steps == 4:
            cmd += ["--set", f"lora.lora_name={LORA4}", "--set", "sched.steps=4"]
        cmd += ["--out", RAW / f"{action}{tag}_s{s}", "--tag", f"r12 zombie {action} {steps} steps seed {s}"]
        print(action, steps, s, z9.run(cmd)[:110], flush=True)


def stray_object(path: Path) -> int:
    """Saturated brown pixels above the knees (H3 sometimes draws the bat/plank that hits the zombie).
    Baseline for a clean standing frame is ~24 (the brown shoes' highlights); a weapon adds hundreds."""
    a = np.array(z10.key_magenta(Image.open(path)).resize((128, 128), Image.NEAREST)).astype(float)
    op = a[..., 3] > 128
    ys = np.where(op.any(1))[0]
    if not len(ys):
        return 0
    top, bot = ys.min(), ys.max()
    r, g, b = a[..., 0] / 255, a[..., 1] / 255, a[..., 2] / 255
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    br = (r > g) & (g >= b) & (s > 0.3) & (mx > 0.2) & op
    br[int(bot - 0.3 * (bot - top)):] = False
    return int(br.sum())


def sharpness(path: Path) -> float:
    """Mean absolute 4-neighbour colour difference inside the figure (motion-blurred frames score low)."""
    k = np.array(z10.key_magenta(Image.open(path))).astype(np.float32)
    op = k[..., 3] > 128
    c = k[..., :3]
    dx = np.abs(np.diff(c, axis=1)).sum(-1)
    dy = np.abs(np.diff(c, axis=0)).sum(-1)
    m1 = op[:, 1:] & op[:, :-1]
    m2 = op[1:] & op[:-1]
    return float((dx[m1].sum() + dy[m2].sum()) / max(1, m1.sum() + m2.sum()))


def unblur(idx: list[int], frames: list[Path], bad: list[int]) -> tuple[list[int], list]:
    """Round 13: every inner pick may move one video frame (t-1, t, t+1) to the sharpest one, so a fast frame
    (death frame 5: the head smeared into one blob) is replaced by its sharp neighbour. Order is kept."""
    out, moves = list(idx), []
    for i in range(1, len(idx) - 1):
        lo, hi = out[i - 1] + 1, idx[i + 1] - 1
        cand = [t for t in (idx[i] - 1, idx[i], idx[i] + 1) if lo <= t <= hi and t not in bad and 0 <= t < len(frames)]
        if not cand:
            continue
        sh = {t: sharpness(frames[t]) for t in cand}
        best = max(cand, key=lambda t: sh[t])
        if best != idx[i] and sh[best] > 1.1 * sh.get(idx[i], 0):
            moves.append({"frame": i, "from": idx[i], "to": best,
                          "sharpness": {str(t): round(v, 1) for t, v in sh.items()}})
            out[i] = best
    return out, moves


def pick_indices(action: str, frames: list[Path]) -> tuple[list[int], dict]:
    f = np.stack([features(p, 1.0) for p in frames])
    D = dist_matrix(f)
    T = len(frames)
    n = ACTIONS[action]["n"]
    # frames with a stray object are never picked: their distance is set to 0 for peak finding and the action
    # window starts after the last such frame in the first 60% (death: before the body is low anyway)
    obj = [stray_object(p) for p in frames]
    bad = [t for t in range(int(T * 0.6)) if obj[t] > 150]
    d0 = D[0].copy()
    for t in bad:
        d0[t] = 0
    first_ok = (max(bad) + 1) if bad else 0
    if action == "attack":
        pk = int(np.argmax(d0[: T - 4]))
        thr = 0.25 * d0[pk]
        st = max([t for t in range(first_ok, pk) if d0[t] <= thr] or [first_ok])
        en = min([t for t in range(pk + 1, T) if d0[t] <= thr] or [T - 1])
        idx = [round(st + (pk - st) * k / 3) for k in range(4)] + [round(pk + (en - pk) * k / 3) for k in (1, 2)]
        info = {"start": st, "peak": pk, "end": en}
    elif action == "hit":
        pk = int(np.argmax(d0[: T * 2 // 3]))
        thr = 0.25 * d0[pk]
        st = max([t for t in range(pk) if d0[t] <= thr and t not in bad] or [pk])
        en = min([t for t in range(pk + 1, T) if d0[t] <= thr] or [T - 1])
        mid = [t for t in range(st, pk) if t not in bad]
        idx = [mid[len(mid) // 2] if mid else pk, pk, round((pk + en) / 2)]
        info = {"start": st, "peak": pk, "end": en}
    elif action == "getup":
        # figure height relative to the final standing frame: pushed up 0.55, sitting 0.75, one knee 0.9,
        # standing = the last frame whose height is >= 0.98 before the video settles on the walk pose
        hs = []
        for p in frames:
            ys_ = np.where((np.array(z10.key_magenta(Image.open(p)))[..., 3] > 128).any(1))[0]
            hs.append(float(ys_.max() - ys_.min() + 1) if len(ys_) else 0.0)
        # round 14: normalised between the lying start and the standing end (the brute lies 39 px tall = 0.7 of
        # standing, so absolute ratios picked the lying frame); targets equal round 13's for the M zombie
        h0 = float(np.median(hs[:3]))
        r = (np.array(hs) - h0) / max(hs[-1] - h0, 1)
        idx, last = [], 0
        for tgt in (0.2, 0.55, 0.82, 0.96):
            cand = [t for t in range(last + 1, T) if t not in bad and r[t] >= tgt]
            t = cand[0] if cand else T - 1
            idx.append(t)
            last = t
        info = {"height_ratio": [round(float(x), 3) for x in r]}
    else:  # death
        dl = D[-1]
        thr0 = 0.15 * d0.max()
        st = max(first_ok, min([t for t in range(T) if d0[t] > thr0] or [0]) - 1)
        thr1 = 0.08 * d0.max()
        en = min([t for t in range(st + 1, T) if all(dl[u] <= thr1 for u in range(t, T))] or [T - 1])
        idx = [round(st + 1 + (en - st - 1) * k / (n - 1)) for k in range(n)]
        info = {"start": st, "end": en}
    if action in ("death", "getup", "knock"):
        idx, moves = unblur([int(i) for i in idx], frames, bad)
        info["unblur"] = moves
    info.update(picked=[int(i) for i in idx], d_start=[round(float(x), 3) for x in d0],
                stray_object_frames=bad, stray_in_picked=[int(i) for i in idx if obj[i] > 150])
    return [int(i) for i in idx], info


def track_head(frame: Image.Image, head_px: np.ndarray, head_rgb: np.ndarray, rx=10, ry=8) -> tuple[int, int, float]:
    """Best translation of the walk head inside the frame (mean RGB error over head pixels, transparent = 255)."""
    a = np.array(frame.convert("RGBA")).astype(np.int32)
    ys, xs = head_px
    best = (0, 0, 1e9)
    for dy in range(-ry, ry + 1):
        for dx in range(-rx, rx + 1):
            ty, tx = ys + dy, xs + dx
            ok = (ty >= 0) & (ty < 64) & (tx >= 0) & (tx < 64)
            if ok.mean() < 0.98:
                continue
            px = a[ty[ok], tx[ok]]
            err = np.where(px[:, 3:] > 0, np.abs(px[:, :3] - head_rgb[ok]).mean(1, keepdims=True), 255).mean()
            if err < best[2]:
                best = (dx, dy, float(err))
    return best


def paste_head(frame: Image.Image, key: Image.Image, hm: np.ndarray, neck: int, dx: int, dy: int) -> Image.Image:
    a = np.array(frame.convert("RGBA"))
    k = np.array(key.convert("RGBA"))
    ys, xs = np.where(hm)
    # clear this frame's own head area (rows above the shifted neck, columns of the shifted head +-1), not shirt
    reg = z9.raw_region(a[..., :3])
    clr = np.zeros(a.shape[:2], bool)
    clr[max(0, ys.min() + dy - 2):neck + dy, max(0, xs.min() + dx - 1):min(64, xs.max() + dx + 2)] = True
    clr &= reg != "shirt"
    a[clr] = 0
    a[ys + dy, xs + dx] = k[ys, xs]
    return Image.fromarray(a, "RGBA")


def post(action: str):
    rp = z9.region_palettes()
    walk = walk_frames_final()
    key = walk[0]
    hm, neck = z10.head_mask(key)
    # round 13: paste only the skull, not the walk's 3-row neck stub. With the head shifted (attack lunge) the
    # stub landed on the shirt/shoulder and showed as a green (skin-region) streak left of the neck; the frame's
    # own neck pixels below the cut are kept instead
    neck -= NECK_STUB
    hm[neck:] = False
    head_px = np.where(hm)
    head_rgb = np.array(key)[head_px][:, :3].astype(np.int32)
    key_h8 = z9.measure(Image.open(ROOT / "art/ai/raw/zombie10/key.png"))["height"] * 8
    rows, summary = [], {}
    for d in sorted(p for p in RAW.glob(f"{action}*_s*") if p.is_dir()):
        tag = d.name
        frames = sorted(d.glob("zombie12_*.png"))
        if not frames:
            continue
        idx, info = pick_indices(action, frames)
        # scale from the standing walk-0 frame: first frame for attack/hit/death, last frame for getup (starts lying)
        k0 = z10.key_magenta(Image.open(frames[-1] if ACTIONS[action].get("start") == "deathlast" else frames[0]))
        ys = np.where(np.array(k0)[..., 3] > 128)[0]
        scale = key_h8 / (ys.max() - ys.min() + 1)
        ds = d / "ds"
        if ds.exists():
            shutil.rmtree(ds)
        downscale([frames[i] for i in idx], ds, scale, align="hybrid")
        small = [z9.largest_blob(Image.open(ds / f"{i:02d}.png").convert("RGBA")) for i in range(len(idx))]
        q = [z9.quantize_regions(f, rp) for f in small]
        q = [remove_islands(f, 2)[0] for f in q]
        q = snap(q, walk)
        heads = []
        out = []
        for f in q:
            dx, dy, err = track_head(f, head_px, head_rgb)
            use = err < 40
            heads.append({"dx": dx, "dy": dy, "err": round(err, 1), "locked": bool(use)})
            out.append(paste_head(f, key, hm, neck, dx, dy) if use else f)
        cleaned = [z10.region_islands(f) for f in out]
        fin = snap([c for c, _ in cleaned], walk)
        # re-paste the locked heads after the clean-up so they stay pixel-identical to the walk head
        fin = [paste_head(f, key, hm, neck, h["dx"], h["dy"]) if h["locked"] else f for f, h in zip(fin, heads)]
        fd = d / "final"
        fd.mkdir(exist_ok=True)
        for i, f in enumerate(fin):
            f.save(fd / f"{i:02d}.png")
        st = z9.strip(fin)
        st.save(fd / "sheet.png")
        cols = np.unique(np.array(st).reshape(-1, 4)[np.array(st).reshape(-1, 4)[:, 3] > 0][:, :3], axis=0)
        info.update(scale=round(float(scale), 4), heads=heads, colours=int(len(cols)),
                    heights=[z9.measure(f)["height"] for f in fin],
                    feet=[int(np.where(np.array(f)[..., 3] > 0)[0].max()) for f in fin],
                    regions=z9.region_stats(st), region_px_fixed=sum(n for _, n in cleaned),
                    outside_palette=check(fd / "sheet.png")["outside_palette"])
        info.update({k: v for k, v in json.loads((d / "meta.json").read_text(encoding="utf-8"))[-1].items()
                     if k in ("seconds", "vram_peak_mib")})
        info.pop("d_start", None)
        summary[tag] = info
        rows.append((tag, fin, info))
        print(tag, "picked", info["picked"], "h", info["heights"], "feet", info["feet"], "c", info["colours"],
              "heads", [h["locked"] for h in heads], "t", info.get("seconds"), flush=True)
    n = ACTIONS[action]["n"]
    sc, cw = 3, 64 * 3
    sheet = Image.new("RGB", (n * cw, len(rows) * (2 * cw + 18)), (20, 20, 20))
    dd = ImageDraw.Draw(sheet)
    for r, (tag, fin, info) in enumerate(rows):
        y = r * (2 * cw + 18)
        dd.text((3, y + 3), f"{tag}  frames {info['picked']}  h {min(info['heights'])}-{max(info['heights'])}  "
                            f"{info['colours']}c  head lock {''.join('L' if h['locked'] else '-' for h in info['heads'])}"
                            f"  {info.get('seconds')}s", fill=(255, 255, 255))
        for i, f in enumerate(fin):
            sheet.paste(z9.tile(f, sc), (i * cw, y + 18))
            sheet.paste(z9.tile(z9.region_map(f), sc), (i * cw, y + 18 + cw))
    sheet.save(OUT / f"{action}_seeds_x3.png")
    (RAW / f"{action}_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")


def pick(action: str, seed: int, tag: str = ""):
    src = RAW / (f"hitstill_s{seed}" if action == "hit" else f"{action}{tag}_s{seed}")
    fd = src / "final"
    summ = json.loads((RAW / f"{action}_summary.json").read_text(encoding="utf-8"))
    a = ACTIONS[action]
    if action == "hit":
        meta_in = {"round": 12, "seed": seed, "method": "H3 Image stills (video attempts all drew the attacker's "
                   "weapon), frames = hitA / hitB / hitA", "prompt": HIT_STILL_PROMPT, "poses": HIT_POSES,
                   "references": {"Picture 1": "walk.png frame 0 x16", "Picture 2": "stand.png x16",
                                  "Picture 3": "art/ai/style/anchor.png x5"},
                   "workflow": "art/ai/workflows/h3_image_edit_3ref.json (1024x1024)", "seeds": summ,
                   "generation": {p: json.loads((RAW / f"{p}_s{seed}" / "meta.json").read_text(encoding="utf-8"))[-1]
                                  for p in HIT_POSES}}
        return _finish(action, seed, fd, a, meta_in)
    meta_in = {"round": 12, "seed": seed, "prompt": a["prompt"],
               "first": "walk.png frame 0", "last": "walk.png frame 0" if a["end"] == "walk0" else
               f"lying key (art/ai/raw/zombie12/down.png, H3 Image seed {json.loads((RAW / 'down_pick.json').read_text())['seed']})",
               "workflow": f"art/ai/workflows/h3_video_i2v.json 512x512, {a['length']} frames, 8-step LoRA, 8 steps",
               "pick": summ[src.name], "seeds": summ,
               "generation": json.loads((src / "meta.json").read_text(encoding="utf-8"))[-1]}
    if action == "death":
        meta_in["down_prompt"] = DOWN_PROMPT
    return _finish(action, seed, fd, a, meta_in)


def _finish(action, seed, fd, a, meta_in):
    subprocess_run([str(PY), "-I", str(ROOT / "tools/art/ai/build_sheet.py"), str(fd), "--name", action, "--fps",
                    "10" if action != "death" else "8", *(["--loop"] if action == "attack" else []), "--out", str(OUT)])
    frames = [Image.open(fd / f"{i:02d}.png") for i in range(a["n"])]
    z9.strip([z9.region_map(f) for f in frames]).resize((64 * a["n"] * 4, 256), Image.NEAREST).save(
        OUT / f"{action}_regions_x4.png")
    z9.OUT = OUT
    z9.write_meta({action: meta_in})
    print(action, "picked", seed)


def subprocess_run(cmd):
    import subprocess
    subprocess.run(cmd, check=True, cwd=ROOT)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["refs", "refs13", "down-gen", "down-post", "down-pick", "gen", "post", "pick", "hit-still-gen", "hit-still-post",
                                       "knock-gen", "knock-post"])
    ap.add_argument("arg", nargs="?")
    ap.add_argument("seed", nargs="?", type=int)
    ap.add_argument("--seeds", nargs="*", type=int, default=[1, 2, 3, 4])
    ap.add_argument("--steps", type=int, default=8)
    a = ap.parse_args()
    if a.cmd == "refs":
        refs()
    elif a.cmd == "refs13":
        refs13()
    elif a.cmd == "down-gen":
        down_gen(a.seeds)
    elif a.cmd == "down-post":
        down_post()
    elif a.cmd == "down-pick":
        down_pick(int(a.arg))
    elif a.cmd == "gen":
        gen(a.arg, a.seeds, a.steps)
    elif a.cmd == "post":
        post(a.arg)
    elif a.cmd == "knock-gen":
        knock_gen(a.seeds)
    elif a.cmd == "knock-post":
        knock_post()
    elif a.cmd == "hit-still-gen":
        hit_still_gen(a.seeds)
    elif a.cmd == "hit-still-post":
        hit_still_post()
    elif a.cmd == "pick":
        pick(a.arg, a.seed)


if __name__ == "__main__":
    main()
