"""Pick N frames from a generated video frame sequence (TEST_SPEC §6 step 1).

loop mode (idle/walk/run): find the period P and start i whose frames i and i+P match best
(seamless loop), then sample N evenly spaced frames from [i, i+P).
  python tools/art/ai/pick_frames.py loop FRAME... -n 8 --min-period 12 --max-period 40 --out DIR
template mode (short actions): for each template image, pick the frame with the most similar
silhouette (in order, monotonically increasing).
  python tools/art/ai/pick_frames.py template FRAME... --templates T1.png T2.png ... --out DIR
Copies picks to DIR/00.png.. and writes DIR/picks.json.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from sprite_utils import key_magenta  # noqa: E402

FEAT = 64


def features(path: Path, lower_weight: float = 2.0) -> np.ndarray:
    """Silhouette + luminance at 64x64; the lower half (legs) is weighted more."""
    k = key_magenta(Image.open(path)).resize((FEAT, FEAT), Image.BILINEAR)
    a = np.array(k).astype(np.float32) / 255
    alpha = a[..., 3]
    lum = (a[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)) * alpha
    w = np.ones((FEAT, 1), np.float32)
    w[FEAT // 2:] = lower_weight
    return np.concatenate([(alpha * w).ravel(), (lum * w).ravel()])


def dist_matrix(feats: np.ndarray) -> np.ndarray:
    sq = (feats ** 2).sum(1)
    return np.sqrt(np.maximum(sq[:, None] + sq[None, :] - 2 * feats @ feats.T, 0)) / np.sqrt(feats.shape[1])


def pick_loop(frames: list[Path], n: int, pmin: int, pmax: int, skip: int):
    f = np.stack([features(p) for p in frames])
    D = dist_matrix(f)
    T = len(frames)
    best = None
    for P in range(pmin, min(pmax, T - 1 - skip) + 1):
        for i in range(skip, T - P):
            # closure error, plus a penalty if the loop barely moves (idle/walk must animate)
            motion = np.mean([D[i + k, i + (k + 1) % P] for k in range(0, P, max(1, P // 8))])
            score = D[i, i + P] - 0.15 * motion
            if best is None or score < best[0]:
                best = (score, P, i, D[i, i + P], motion)
    _, P, i, closure, motion = best
    idx = [i + round(k * P / n) for k in range(n)]
    return idx, {"period": P, "start": i, "closure": float(closure), "motion": float(motion)}


def pick_template(frames: list[Path], templates: list[Path]):
    f = np.stack([features(p, 1.0) for p in frames])
    t = np.stack([features(p, 1.0) for p in templates])
    D = np.sqrt(((t[:, None, :] - f[None, :, :]) ** 2).mean(-1))
    # monotonic assignment via DP
    K, T = D.shape
    cost = np.full((K, T), np.inf)
    back = np.zeros((K, T), int)
    cost[0] = D[0]
    for k in range(1, K):
        run = np.minimum.accumulate(cost[k - 1])
        arg = np.array([int(np.argmin(cost[k - 1][: j + 1])) for j in range(T)])
        cost[k, 1:] = run[:-1] + D[k, 1:]
        back[k, 1:] = arg[:-1]
    j = int(np.argmin(cost[-1]))
    idx = [j]
    for k in range(K - 1, 0, -1):
        j = back[k, j]
        idx.append(int(j))
    idx = idx[::-1]
    return idx, {"distances": [float(D[k, i]) for k, i in enumerate(idx)]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["loop", "template"])
    ap.add_argument("frames", nargs="+", type=Path)
    ap.add_argument("-n", type=int, default=8)
    ap.add_argument("--min-period", type=int, default=12)
    ap.add_argument("--max-period", type=int, default=48)
    ap.add_argument("--skip", type=int, default=2, help="ignore the first frames (I2V warm-up)")
    ap.add_argument("--templates", nargs="*", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    frames = sorted(a.frames)
    if a.mode == "loop":
        idx, info = pick_loop(frames, a.n, a.min_period, a.max_period, a.skip)
    else:
        idx, info = pick_template(frames, a.templates)
    a.out.mkdir(parents=True, exist_ok=True)
    for k, i in enumerate(idx):
        shutil.copy(frames[i], a.out / f"{k:02d}.png")
    info.update({"mode": a.mode, "picked": idx, "files": [str(frames[i]).replace("\\", "/") for i in idx]})
    (a.out / "picks.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in info.items() if k != "files"}))


if __name__ == "__main__":
    main()
