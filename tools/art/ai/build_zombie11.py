"""Round 11: tool comparison on the round 10 fog zombie walk (same first/last frame, prompt, seeds).

  python tools/art/ai/build_zombie11.py gen VARIANT [--seeds 1 2 3 4]
  python tools/art/ai/build_zombie11.py post
  python tools/art/ai/build_zombie11.py sheet

Variants (see art/ai/workflows/README.md):
  A  current h3_video_i2v.json: 8-step turbo LoRA, 8 steps. Not regenerated: same workflow, key, prompt and seeds
     as round 10, so the round 10 frames (art/ai/raw/zombie10/walk_s*) are reused, with their recorded timings.
  D  h3_video_i2v.json with the official 4-step LoRA (minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16), 4 steps.
  B4/B2 pi-H3 DWD adapters (ComfyUI-piFlow), 4 and 2 steps: art/ai/workflows/h3_video_pih3_dwd.json.
  C  pixelart8x_h3_v3 LoRA: skipped, the model does not exist on Hugging Face.

Post-processing and checks are exactly round 10's (build_zombie10.walk_frames): gait pick, head lock, region quantize,
speck clean-up, <=16 colours. Pass/fail per seed:
  head  : 8 frames have pixel-identical heads (dy 0/-1 only)
  gait  : frames 0/4 are the two widest leg spreads, 2/6 the two narrowest, |s0-s4| <= 3 and |s2-s6| <= 3,
          contact - crossing >= 12 px (a real step)
  region: 0 colours outside master.gpl, <= 16 colours, height 56-57, feet on y=61
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1]))
import build_zombie9 as z9  # noqa: E402
import build_zombie10 as z10  # noqa: E402
from build_palette import check  # noqa: E402

ROOT = z9.ROOT
RAW = ROOT / "art/ai/raw/zombie11"
OUT = ROOT / "art/ai/out/zombie_m/r11"
PY = z9.PY
LORA4 = "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"
VARIANTS = {
    "A": {"label": "A current (8-step LoRA, 8 steps)", "dir": lambda s: ROOT / f"art/ai/raw/zombie10/walk_s{s}",
          "pattern": "zombie10_walk_*.png"},
    "D": {"label": "D official 4-step LoRA, 4 steps", "dir": lambda s: RAW / f"D_s{s}", "pattern": "zombie11_D_*.png",
          "set": [f"lora.lora_name={LORA4}", "sched.steps=4"]},
    "B4": {"label": "B pi-H3 DWD 4 steps", "dir": lambda s: RAW / f"B4_s{s}", "pattern": "zombie11_B4_*.png",
           "workflow": "h3_video_pih3_dwd.json",
           "set": ["adapter.adapter_name=pi_h3_4step_dwd_adapter_int8_convrot.safetensors", "sched.steps=4",
                   "sched.max_raw_t=0.96"]},
    "B2": {"label": "B pi-H3 DWD 2 steps", "dir": lambda s: RAW / f"B2_s{s}", "pattern": "zombie11_B2_*.png",
           "workflow": "h3_video_pih3_dwd.json",
           "set": ["adapter.adapter_name=pi_h3_2step_dwd_adapter_int8_convrot.safetensors", "sched.steps=2",
                   "sched.max_raw_t=0.93"]},
}


def gen(variant: str, seeds: list[int]):
    v = VARIANTS[variant]
    if "set" not in v:
        raise SystemExit(f"variant {variant} reuses existing frames")
    key = ROOT / "art/ai/raw/zombie10/key_512.png"
    for s in seeds:
        cmd = [PY, "-I", ROOT / "tools/art/ai/run_comfy.py", ROOT / "art/ai/workflows" / v.get("workflow", "h3_video_i2v.json"),
               "--image", f"first={key}", "--image", f"last={key}",
               "--set", "scale_first.width=512", "--set", "scale_first.height=512",
               "--set", "scale_last.width=512", "--set", "scale_last.height=512",
               "--set", "cond.width=512", "--set", "cond.height=512", "--set", "cond.length=56",
               "--set", f"noise.noise_seed={s}", "--set", f"cond.prompt={z10.WALK_PROMPT}",
               "--set", f"save.filename_prefix=ai_art/zombie11_{variant}_s{s}"]
        for kv in v["set"]:
            cmd += ["--set", kv]
        cmd += ["--out", v["dir"](s), "--tag", f"r11 {variant} zombie walk seed {s}"]
        r = z9.run(cmd)
        print(variant, s, r[:160], flush=True)


def gen_stats(d: Path) -> dict:
    m = json.loads((d / "meta.json").read_text(encoding="utf-8"))[-1]
    return {"seconds": m.get("seconds"), "vram_peak_mib": m.get("vram_peak_mib")}


def verdict(info: dict) -> dict:
    sp = info["out_spread"]
    order = np.argsort(sp)
    widest, narrowest = set(order[-2:].tolist()), set(order[:2].tolist())
    gait = (widest == {0, 4} and narrowest == {2, 6} and abs(sp[0] - sp[4]) <= 3 and abs(sp[2] - sp[6]) <= 3
            and min(sp[0], sp[4]) - max(sp[2], sp[6]) >= 12)
    region = (info["outside_palette"] == 0 and info["colours"][1] <= 16 and
              all(56 <= h <= 57 for h in info["heights"]) and all(f == 61 for f in info["feet"]))
    return {"head": bool(info["head_identical"]), "gait": bool(gait), "region": bool(region)}


def gait_score(sp: list[int]) -> int:
    """Step size minus asymmetry: min contact - max crossing - |contact diff| - |crossing diff|."""
    return min(sp[0], sp[4]) - max(sp[2], sp[6]) - abs(sp[0] - sp[4]) - abs(sp[2] - sp[6])


def post():
    rp = z9.region_palettes()
    key = Image.open(ROOT / "art/ai/raw/zombie10/key.png")
    key_h8 = z9.measure(key)["height"] * 8
    summary = {}
    for name, v in VARIANTS.items():
        for s in (1, 2, 3, 4):
            d = v["dir"](s)
            if not list(d.glob(v["pattern"])):
                continue
            _, fin, info = z10.walk_frames(s, rp, key, key_h8, d=d, pattern=v["pattern"])
            fd = RAW / "final" / f"{name}_s{s}"
            fd.mkdir(parents=True, exist_ok=True)
            for i, f in enumerate(fin):
                f.save(fd / f"{i:02d}.png")
            st = z9.strip(fin)
            st.save(fd / "walk.png")
            info.update(heights=[z9.measure(f)["height"] for f in fin],
                        feet=[int(np.where(np.array(f)[..., 3] > 0)[0].max()) for f in fin],
                        outside_palette=check(fd / "walk.png")["outside_palette"],
                        head_identical=z10.head_identical(fin, z10.fin_key(key, fin), info["head_dy"]),
                        out_spread=[z10.leg_spread_small(f) for f in fin], regions=z9.region_stats(st))
            info.update(gen_stats(d))
            info["pass"] = verdict(info)
            summary[f"{name}_s{s}"] = info
            print(name, s, info["seconds"], info["vram_peak_mib"], "spread", info["out_spread"], info["pass"],
                  "fixed", info["region_px_fixed"], flush=True)
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")


def sheet():
    summary = json.loads((RAW / "summary.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    sc, cw = 3, 64 * 3
    keys = list(summary)
    out = Image.new("RGB", (8 * cw, len(keys) * (cw + 18)), (20, 20, 20))
    dd = ImageDraw.Draw(out)
    for r, k in enumerate(keys):
        info = summary[k]
        y = r * (cw + 18)
        p = info["pass"]
        dd.text((3, y + 3), f"{k}  {info['seconds']}s  {info['vram_peak_mib']}MiB  spread {info['out_spread']}  "
                            f"head {'OK' if p['head'] else 'NG'} gait {'OK' if p['gait'] else 'NG'} "
                            f"region {'OK' if p['region'] else 'NG'}", fill=(255, 255, 255))
        for i in range(8):
            out.paste(z9.tile(Image.open(RAW / "final" / k / f"{i:02d}.png"), sc), (i * cw, y + 18))
    out.save(OUT / "compare_all_x3.png")
    # side-by-side GIF: one column per variant (same seed 3 + each variant's best passing seed), 4x, 8 fps
    cols = []
    for name in VARIANTS:
        cand = [k for k in keys if k.startswith(name + "_")]
        if not cand:
            continue
        best = max(cand, key=lambda k: (sum(summary[k]["pass"].values()), gait_score(summary[k]["out_spread"])))
        for k in dict.fromkeys([f"{name}_s3", best]):
            if k in summary:
                cols.append(k)
    W = 64 * 4
    frames = []
    for i in range(8):
        f = Image.new("RGB", (W * len(cols), W + 16), (58, 62, 74))
        d = ImageDraw.Draw(f)
        for c, k in enumerate(cols):
            im = Image.open(RAW / "final" / k / f"{i:02d}.png").convert("RGBA")
            bg = Image.new("RGBA", im.size, (58, 62, 74, 255))
            bg.alpha_composite(im)
            f.paste(bg.convert("RGB").resize((W, W), Image.NEAREST), (c * W, 16))
            d.text((c * W + 3, 2), k, fill=(255, 255, 255))
        frames.append(f)
    frames[0].save(OUT / "compare.gif", save_all=True, append_images=frames[1:], duration=125, loop=0)
    # strip of the same columns for the report
    st = Image.new("RGB", (8 * cw, len(cols) * (cw + 18)), (20, 20, 20))
    dd = ImageDraw.Draw(st)
    for r, k in enumerate(cols):
        dd.text((3, r * (cw + 18) + 3), k, fill=(255, 255, 255))
        for i in range(8):
            st.paste(z9.tile(Image.open(RAW / "final" / k / f"{i:02d}.png"), sc), (i * cw, r * (cw + 18) + 18))
    st.save(OUT / "compare_x3.png")
    (OUT / "summary.json").write_text(json.dumps({k: {x: summary[k][x] for x in (
        "seconds", "vram_peak_mib", "period", "out_spread", "heights", "head_dy", "colours", "region_px_fixed",
        "outside_palette", "pass")} | {"gait_score": gait_score(summary[k]["out_spread"])} for k in keys}, indent=1), encoding="utf-8")
    print("columns", cols)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["gen", "post", "sheet"])
    ap.add_argument("variant", nargs="?")
    ap.add_argument("--seeds", nargs="*", type=int, default=[1, 2, 3, 4])
    a = ap.parse_args()
    {"gen": lambda: gen(a.variant, a.seeds), "post": post, "sheet": sheet}[a.cmd]()


if __name__ == "__main__":
    main()
