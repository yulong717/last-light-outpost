"""Generate pose-template candidates from a poses.yaml with H3 Image edit.

Usage:
  python tools/art/ai/gen_poses.py art/ai/mannequins/M/poses.yaml \
      --base stand=art/ai/raw/mannequin/stand3h_pick.png --base noarm=... \
      --seeds 1 2 --out art/ai/raw/mannequin/poses [--only melee_1 melee_2]
Writes <out>/<pose>/... and <out>/<pose>_contact.png, plus <out>/all_contact.png.
"""
from __future__ import annotations

import argparse
import glob
import subprocess
import sys
from pathlib import Path

import yaml
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from sprite_utils import guides  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("poses", type=Path)
    ap.add_argument("--base", action="append", required=True, metavar="NAME=PATH")
    ap.add_argument("--seeds", type=int, nargs="+", default=[1, 2])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--workflow", default="art/ai/workflows/h3_image_edit.json")
    a = ap.parse_args()

    spec = yaml.safe_load(a.poses.read_text(encoding="utf-8"))
    bases = dict(b.split("=", 1) for b in a.base)
    names = a.only or list(spec["poses"])
    tiles = []
    for name in names:
        p = spec["poses"][name]
        prompt = f"Redraw <Picture 1> in a new pose. {p['pose']} {spec['common']}"
        for seed in a.seeds:
            cmd = [sys.executable, "-I", str(ROOT / "tools/art/ai/run_comfy.py"), a.workflow,
                   "--image", f"load1={bases[p['base']]}", "--set", "cond.images.image_2=null", "--set", f"cond.prompt={prompt}",
                   "--set", f"sampler.seed={seed}", "--set", f"save.filename_prefix=ai_art/pose_{name}_s{seed}",
                   "--out", str(a.out / name), "--tag", f"pose {name} seed {seed}"]
            r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", cwd=ROOT)
            if r.returncode:
                print(f"{name} s{seed} FAILED: {r.stderr[-500:]}{r.stdout[-500:]}")
            else:
                print(f"{name} s{seed}: {r.stdout.strip()[:60]}")
        files = sorted(glob.glob(str(a.out / name / f"pose_{name}_s*.png")))
        for f in files:
            tiles.append((Path(f).stem.replace("pose_", "").rsplit("_", 1)[0], Image.open(f)))

    cell = 256
    cols = 2 * len(a.seeds) if len(a.seeds) <= 2 else len(a.seeds)
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cell * cols, (cell + 14) * rows), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    for i, (label, im) in enumerate(tiles):
        x, y = (i % cols) * cell, (i // cols) * (cell + 14)
        sheet.paste(guides(im.convert("RGB").resize((cell, cell), Image.LANCZOS)), (x, y + 14))
        d.text((x + 3, y + 1), label, fill="white")
    a.out.mkdir(parents=True, exist_ok=True)
    sheet.save(a.out / "all_contact.png")


if __name__ == "__main__":
    main()
