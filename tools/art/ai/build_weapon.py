"""Build one melee weapon's Akai sprite set (docs/ai-art/MELEE_WEAPONS.md).

  python tools/art/ai/build_weapon.py art/ai/raw/<id>/picks.json

picks.json:
{
  "id": "knife",
  "raw": "art/ai/raw/knife",                 # video folders <raw>/<action>_s<seed>/
  "out": "art/ai/out/akai_knife",
  "actions": {
    "idle": {"seed": 2, "loop": 4, "fps": 10},
    "walk": {"seed": 3, "loop": 8, "fps": 10},
    "m1":   {"seed": 1, "frames": [3, 6, 9, 12, 20, 30], "fps": 12},
    ...
    "dash": {...}
  },
  "meta": {...}                                # free-form, copied into meta.json
}
Each action: pick frames (loop -> pick_frames.py loop, else the listed video frame numbers),
downscale to 64x72 (feet row 69, fixed ground 560 / centre 256 of the 512x576 video), map to the
Akai palette, keep outline, harmonize jersey + 7 to akai_ai_melee.png frames with the idle stripe
pattern, keep largest blob, then build strip/json/contact. Output names follow the doc:
akai_ai_idle_<id>, akai_ai_walk_<id>, akai_ai_melee_<id>_<n>, akai_ai_melee_<id>_dash.
Also writes <id>_all.gif (3x, 12 fps, every action once) and a side-by-side contact.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
PY = [sys.executable, "-I"]
TOOLS = ROOT / "tools/art/ai"
PALETTE = ROOT / "art/ai/out/akai_v4/palette.png"
MELEE_SHEET = ROOT / "public/assets/sprites/akai_ai_melee.png"  # move 1 = colour reference
OLDLOOK = ROOT / "art/ai/refs/akai_oldlook_64.png"


def sh(*args):
    r = subprocess.run([*PY, *map(str, args)], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        raise SystemExit(f"failed: {args}\n{r.stdout}\n{r.stderr}")
    return r.stdout.strip()


def out_name(wid: str, action: str) -> str:
    if action in ("idle", "walk"):
        return f"akai_ai_{action}_{wid}"
    if action == "dash":
        return f"akai_ai_melee_{wid}_dash"
    return f"akai_ai_melee_{wid}_{action.lstrip('m')}"


def main():
    cfg_path = Path(sys.argv[1])
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    wid, raw, out = cfg["id"], ROOT / cfg["raw"], ROOT / cfg["out"]
    work = raw / "work"
    if work.exists():
        shutil.rmtree(work)
    out.mkdir(parents=True, exist_ok=True)
    melee_ref = work / "ref_melee1"
    melee_ref.mkdir(parents=True)
    sheet1 = Image.open(MELEE_SHEET).convert("RGBA")
    for i in range(sheet1.width // 64):
        sheet1.crop((i * 64, 0, i * 64 + 64, 72)).save(melee_ref / f"{i:02d}.png")
    meta = {"weapon": wid, "canvas": "64x72, feet row 69, facing right", "palette": str(PALETTE.relative_to(ROOT)),
            "workflow": "art/ai/workflows/h3_video_i2v.json (512x576, 8-step turbo)", **cfg.get("meta", {}), "actions": {}}
    strips = []
    for action, a in cfg["actions"].items():
        vid = raw / f"{action}_s{a['seed']}"
        frames = sorted(vid.glob("*.png"))
        pick = work / action / "pick"
        if "loop" in a:
            info = json.loads(sh(TOOLS / "pick_frames.py", "loop", *frames, "-n", a["loop"],
                                 "--min-period", a.get("min_period", 12 if a["loop"] == 4 else 16),
                                 "--max-period", 48, "--out", pick))
            picked = info["picked"]
        else:
            picked = a["frames"]
            pick.mkdir(parents=True, exist_ok=True)
            for k, i in enumerate(picked):
                shutil.copy(frames[i], pick / f"{k:02d}.png")
        d = work / action
        sh(TOOLS / "pixelize.py", "downscale", *sorted(pick.glob("[0-9][0-9].png")), "--out", d / "ds", "--scale", 1.0,
           "--height", 72, "--foot-row", 69, "--fixed-center", 256,
           *([] if a.get("per_frame_foot") else ["--fixed-foot", 560]))
        sh(TOOLS / "pixelize.py", "apply", d / "ds", "--palette", PALETTE, "--out", d / "q", "--keep-outline",
           *(["--lock-rows", a["lock_rows"]] if a.get("lock_rows") else []))
        sh(TOOLS / "pixelize.py", "harmonize", d / "q", "--ref", melee_ref, "--feet", 69, "--ref-feet", 69,
           "--stripe-pattern", "10100", "--out", d / "h")
        sh(TOOLS / "pixelize.py", "region", d / "h", "--ref", OLDLOOK, "--keep-largest", "--out", d / "final")
        name = out_name(wid, action)
        loop = "loop" in a
        mpath = d / "meta_in.json"
        entry = {"seed": a["seed"], "video": str(vid.relative_to(ROOT)).replace("\\", "/"), "picked": picked,
                 **{k: v for k, v in a.items() if k not in ("seed", "frames", "loop")}}
        mpath.write_text(json.dumps(entry, ensure_ascii=False), encoding="utf-8")
        res = json.loads(sh(TOOLS / "build_sheet.py", d / "final", "--name", name, "--fps", a.get("fps", 12),
                            *(["--loop"] if loop else []), "--foot-row", 69, "--out", out, "--meta", mpath))
        (out / f"{name}.gif").unlink(missing_ok=True)  # one combined GIF instead (below)
        meta["actions"][name] = {**entry, "foot_rows": res["foot_rows"], "colours": res["colours"]}
        strips.append((name, Image.open(out / f"{name}.png").convert("RGBA")))
        print(name, res["foot_rows"])

    (out / "meta.json").unlink(missing_ok=True)
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    # combined GIF: every action once, 3x, 12 fps, hold the last frame 0.5 s
    z, bgc = 3, (58, 62, 74, 255)
    gif = []
    for _, s in strips:
        for i in range(s.width // 64):
            bg = Image.new("RGBA", (64, 72), bgc)
            bg.alpha_composite(s.crop((i * 64, 0, i * 64 + 64, 72)))
            gif.append(bg.convert("RGB").resize((64 * z, 72 * z), Image.NEAREST))
    dur = [round(1000 / 12)] * (len(gif) - 1) + [round(1000 / 12) + 500]
    gif[0].save(out / f"{wid}_all.gif", save_all=True, append_images=gif[1:], duration=dur, disposal=1)

    # side-by-side overview
    z = 3
    W = 90 + 64 * z * max(s.width // 64 for _, s in strips)
    sheet = Image.new("RGB", (W, (72 * z + 4) * len(strips)), (20, 20, 20))
    dr = ImageDraw.Draw(sheet)
    for r, (name, s) in enumerate(strips):
        dr.text((4, r * (72 * z + 4) + 4), name.replace("akai_ai_", ""), fill="white")
        for i in range(s.width // 64):
            bg = Image.new("RGBA", (64, 72), bgc)
            bg.alpha_composite(s.crop((i * 64, 0, i * 64 + 64, 72)))
            tile = bg.convert("RGB").resize((64 * z, 72 * z), Image.NEAREST)
            ImageDraw.Draw(tile).line([(0, 70 * z - 1), (64 * z, 70 * z - 1)], fill=(0, 255, 0))
            sheet.paste(tile, (90 + i * 64 * z, r * (72 * z + 4)))
    sheet.save(out / f"compare_{wid}.png")
    print(f"{len(gif)} frames in {wid}_all.gif")


if __name__ == "__main__":
    main()
