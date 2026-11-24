"""Round 13: fog zombie M knock-back reaction (8 frames) and the 26-frame game sheet.

  python tools/art/ai/build_zombie13.py react RISE_SEED FALL_SEED BOUNCE_SEED GETUP_SEED
  python tools/art/ai/build_zombie13.py sheet26

react: frames match the game's REACT_FRAMES order rise(1) fall(1) bounce(1) down(1) getup(4):
  0 rise   H3 Image still (build_zombie12.py knock-gen), knocked off the feet, leaning back, feet off the ground
  1 fall   H3 Image still, almost horizontal in the air
  2 bounce H3 Image still, back just above the ground
  3 down   = death.png frame 8 (lying, head left, back on y=61)
  4-7      getup video (build_zombie12.py gen/post getup): first frame = death frame 8, last = walk frame 0
sheet26: 64x64 frames, foot row y=62 (everything moved down 1 px for the game's ZombieComposer FOOT_ROW = 62)
  0-3 walk (walk frames 0,2,4,6) | 4-5 attack (the two most extended lunge frames) | 6-14 death | 15-17 hit |
  18 rise | 19 fall | 20 bounce | 21 down | 22-25 getup
  plus the full 8-frame walk and 6-frame attack at y=62 (zombie_basic_walk8.png, zombie_basic_attack6.png).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1]))
import build_zombie9 as z9  # noqa: E402
from build_palette import check  # noqa: E402

ROOT = z9.ROOT
RAW = ROOT / "art/ai/raw/zombie12"
OUT = ROOT / "art/ai/out/zombie_m"
PY = z9.PY


def frames_of(path: Path) -> list[Image.Image]:
    st = Image.open(path).convert("RGBA")
    return [st.crop((64 * i, 0, 64 * i + 64, 64)) for i in range(st.width // 64)]


def react(rise: int, fall: int, bounce: int, getup: int):
    fr = [Image.open(RAW / f"{p}_s{s}" / "pose_64.png").convert("RGBA") for p, s in
          (("rise", rise), ("fall", fall), ("bounce", bounce))]
    fr.append(frames_of(OUT / "death.png")[-1])
    gu = RAW / f"getup_s{getup}" / "final"
    fr += [Image.open(gu / f"{i:02d}.png").convert("RGBA") for i in range(4)]
    fd = RAW / "react_final"
    fd.mkdir(exist_ok=True)
    for i, f in enumerate(fr):
        f.save(fd / f"{i:02d}.png")
    subprocess.run([str(PY), "-I", str(ROOT / "tools/art/ai/build_sheet.py"), str(fd), "--name", "react", "--fps", "10",
                    "--out", str(OUT)], check=True, cwd=ROOT)
    z9.strip([z9.region_map(f) for f in fr]).resize((64 * 8 * 4, 256), Image.NEAREST).save(OUT / "react_regions_x4.png")
    knock = json.loads((RAW / "knock_summary.json").read_text(encoding="utf-8"))
    gsum = json.loads((RAW / "getup_summary.json").read_text(encoding="utf-8"))
    import build_zombie12 as z12
    z9.OUT = OUT
    z9.write_meta({"react": {
        "round": 13, "order": "rise, fall, bounce, down, getup x4 (game REACT_FRAMES)",
        "rise_fall_bounce": {"method": "H3 Image stills, art/ai/workflows/h3_image_edit_3ref.json 1024x1024; Picture 1 = "
                                       "grey silhouette layout (walk frame 0 rotated 55 / 100 degrees, bounce = death "
                                       "frame 8), Picture 2 = walk frame 0 x16, Picture 3 = anchor",
                             "prompt": z12.KNOCK_PROMPT, "poses": {k: v[2] for k, v in z12.KNOCK_POSES.items()},
                             "lift_px": {k: v[1] for k, v in z12.KNOCK_POSES.items()},
                             "seeds": {"rise": rise, "fall": fall, "bounce": bounce}, "all_seeds": knock},
        "down": "death.png frame 8",
        "getup": {"seed": getup, "prompt": z12.ACTIONS["getup"]["prompt"],
                  "workflow": "art/ai/workflows/h3_video_i2v.json 512x512, 56 frames, 8-step LoRA, 8 steps",
                  "first_last": "death frame 8 -> walk frame 0", "pick": gsum[f"getup_s{getup}"], "all_seeds": gsum}}})
    print("react built", rise, fall, bounce, getup)


def down1(f: Image.Image) -> Image.Image:
    out = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    out.alpha_composite(f, (0, 1))
    return out


def sheet26():
    walk = frames_of(OUT / "walk.png")
    attack = frames_of(OUT / "attack.png")
    death = frames_of(OUT / "death.png")
    hit = frames_of(OUT / "hit.png")
    react_f = frames_of(OUT / "react.png")
    # attack: the two frames reaching furthest to the right (lunge), kept in time order
    reach = [int(np.where(np.array(f)[..., 3] > 0)[1].max()) for f in attack]
    two = sorted(sorted(range(len(attack)), key=lambda i: (-reach[i], i))[:2])
    layout = ([("walk", i) for i in (0, 2, 4, 6)] + [("attack", i) for i in two] + [("death", i) for i in range(9)] +
              [("hit", i) for i in range(3)] + [("react", i) for i in range(8)])
    src = {"walk": walk, "attack": attack, "death": death, "hit": hit, "react": react_f}
    frames = [down1(src[k][i]) for k, i in layout]
    assert len(frames) == 26
    sheet = z9.strip(frames)
    sheet.save(OUT / "zombie_basic_26.png")
    z9.strip([down1(f) for f in walk]).save(OUT / "zombie_basic_walk8.png")
    z9.strip([down1(f) for f in attack]).save(OUT / "zombie_basic_attack6.png")
    names = ["walk"] * 4 + ["attack"] * 2 + ["death"] * 9 + ["hit"] * 3 + ["rise", "fall", "bounce", "down"] + ["getup"] * 4
    feet = [int(np.where(np.array(f)[..., 3] > 0)[0].max()) for f in frames]
    meta = {"frameWidth": 64, "frameHeight": 64, "frames": 26, "foot_row": 62,
            "ranges": {"walk": [0, 3], "attack": [4, 5], "death": [6, 14], "hit": [15, 17], "rise": [18, 18],
                       "fall": [19, 19], "bounce": [20, 20], "down": [21, 21], "getup": [22, 25]},
            "source": [f"{k}.png frame {i}" for k, i in layout], "attack_reach_x": reach, "attack_frames_used": two,
            "lowest_pixel_row": feet,
            "extra": {"zombie_basic_walk8.png": "walk.png 8 frames, y+1", "zombie_basic_attack6.png": "attack.png 6 frames, y+1"}}
    (OUT / "zombie_basic_26.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    # contact sheet: 2 rows of 13, 3x, foot line y=62, numbers and names
    sc, cw = 3, 64 * 3
    con = Image.new("RGB", (13 * cw, 2 * (cw + 16)), (58, 62, 74))
    d = ImageDraw.Draw(con)
    for i, f in enumerate(frames):
        x, y = (i % 13) * cw, (i // 13) * (cw + 16)
        bg = Image.new("RGBA", (64, 64), (58, 62, 74, 255))
        bg.alpha_composite(f)
        con.paste(bg.convert("RGB").resize((cw, cw), Image.NEAREST), (x, y + 16))
        d.line([(x, y + 16 + 63 * sc), (x + cw, y + 16 + 63 * sc)], fill=(0, 255, 0))
        d.text((x + 3, y + 2), f"{i} {names[i]}", fill=(255, 255, 255))
    con.save(OUT / "contact_zombie_basic_26.png")
    cols = np.unique(np.array(sheet).reshape(-1, 4)[np.array(sheet).reshape(-1, 4)[:, 3] > 0][:, :3], axis=0)
    print("sheet26 colours", len(cols), "outside", check(OUT / "zombie_basic_26.png")["outside_palette"],
          "attack used", two, "reach", reach, "feet", feet)


def main():
    cmd = sys.argv[1]
    if cmd == "react":
        react(*map(int, sys.argv[2:6]))
    elif cmd == "sheet26":
        sheet26()


if __name__ == "__main__":
    main()
