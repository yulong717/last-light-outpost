"""Master palette (STYLE_ANCHOR §1): 48 colours + 10 reserved -> art/ai/palette/master.gpl + swatch.

  python tools/art/ai/build_palette.py            # build master.gpl, palette_swatch.png
  python tools/art/ai/build_palette.py check IMG  # report colours of IMG not in master.gpl

Reserved: 10 (blood 2, fire 2, fog white, hint yellow, UI 2, hero identity 2: jersey red + stripe blue).

Sources (unique colours, each source weighted equally so the 1664-px zombie strip does not
dominate): akai_ai_idle.png, zombie_basic.png, refs/zombie_basic_palette.png, plus small seed
ramps for the props the characters do not cover (crate wood, oil-drum rust, lamp steel).
OKLab k-means (lightness weighted 1.5x) -> 48 centres, then:
  * lightness clamped to CIE L* 8..90 (highlights only in the reserved 8)
  * HSV saturation capped at 0.6 (spec §2: hero / interactive props <= 0.6)
  * near-neutral greys tinted slightly grey-green (apocalypse tone)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from pixelize import oklab_to_srgb, srgb_to_oklab  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "art/ai/palette"
SOURCES = {
    "akai_ai_idle": ROOT / "public/assets/sprites/akai_ai_idle.png",
    "zombie_basic": ROOT / "public/assets/sprites/zombie_basic.png",
    "zombie_basic_palette": ROOT / "art/ai/refs/zombie_basic_palette.png",
}
# prop seed ramps (dark -> light), muted; drum a bit more saturated (interactive prop)
PROP_SEEDS = {
    "crate_wood": ["3a2a1e", "5c4330", "7f6045", "a08260"],
    "drum_rust": ["3e1f19", "6a3326", "93492f", "b0653f"],
    "lamp_steel": ["262b29", "3d4542", "5a6460", "7e8984"],
}
WEIGHTS = {"akai_ai_idle": 0.3, "zombie_basic": 0.3, "zombie_basic_palette": 0.15, "props": 0.25}
RESERVED = [  # name, hex
    ("blood dark", "6b1a1c"), ("blood", "b02a2a"),
    ("fire", "e0702a"), ("fire light", "ffc24a"),
    ("fog white", "e8ece6"), ("hint yellow", "f2d64e"),
    ("ui amber", "f2c14e"), ("ui ink", "0a0a0c"),
    # hero identity colours (round 7 review): exact akai_ai_idle values, exempt from the 0.6 saturation cap
    ("hero jersey red", "ee333a"), ("hero stripe blue", "7a8cc0"),
]
IDENTITY = ["ee333a", "7a8cc0"]  # never merged / removed by post-processing
# round 9 review: main colours appended after the 48 k-means colours (indices 0-47 unchanged)
DANGER = [("danger red dark", "6e1c1c"), ("danger red", "a8302a"), ("danger red light", "d84a3a")]
DANGER_SAT_MAX = 0.75  # only for interactive / dangerous objects (oil drum, fuse box, ...)
# round 9: neutral cloth greys for the zombie shirt region (ZombieComposer: s < 0.07 and v > 0.58);
# the 48 k-means greys were tinted grey-green (s 0.08-0.11) so only one of them qualified as shirt
CLOTH = [("cloth grey dark", "979b96"), ("cloth grey", "b3b7b2"), ("cloth grey light", "cdd1cc")]
N_MAIN = 48 + len(DANGER) + len(CLOTH)  # 54
K = 48
LSTAR_MIN, LSTAR_MAX = 8.0, 90.0
SAT_MAX = 0.6


def hx(h: str) -> np.ndarray:
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.uint8)


def lstar(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float64) / 255
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    Y = 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]
    return np.where(Y > 216 / 24389, 116 * np.cbrt(Y) - 16, Y * 24389 / 27)


def hsv_sat(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float64)
    mx = c.max(-1)
    return (mx - c.min(-1)) / np.maximum(mx, 1)


def gather():
    cols, wts = [], []
    for name, p in SOURCES.items():
        a = np.array(Image.open(p).convert("RGBA")).reshape(-1, 4)
        u, cnt = np.unique(a[a[:, 3] > 0][:, :3], axis=0, return_counts=True)
        w = np.sqrt(cnt)
        cols.append(u)
        wts.append(w / w.sum() * WEIGHTS[name])
    seeds = np.array([hx(h) for r in PROP_SEEDS.values() for h in r])
    cols.append(seeds)
    wts.append(np.full(len(seeds), WEIGHTS["props"] / len(seeds)))
    return np.concatenate(cols), np.concatenate(wts)


def fix(rgb: np.ndarray) -> np.ndarray:
    """Clamp L*, cap saturation, tint greys; iterate a few times (they interact through rounding)."""
    out = rgb.copy()
    for i in range(len(out)):
        c = out[i:i + 1]
        lab = srgb_to_oklab(c)[0]
        chroma = np.hypot(lab[1], lab[2])
        if chroma < 0.025:  # neutral grey -> slightly grey-green
            lab[1] -= 0.008
            lab[2] += 0.006
        for _ in range(200):
            c = oklab_to_srgb(lab[None])
            L = lstar(c)[0]
            s = hsv_sat(c)[0]
            if L < LSTAR_MIN:
                lab[0] += 0.005
            elif L > LSTAR_MAX:
                lab[0] -= 0.005
            elif s > SAT_MAX:
                lab[1:] *= 0.95
            else:
                break
        out[i] = c[0]
    return out


def ramp_order(rgb: np.ndarray):
    """Group into hue families, each sorted dark -> light (for swatch / gpl readability)."""
    lab = srgb_to_oklab(rgb)
    chroma = np.hypot(lab[:, 1], lab[:, 2])
    hue = (np.degrees(np.arctan2(lab[:, 2], lab[:, 1])) + 360) % 360
    fam = []
    for c, h in zip(chroma, hue):
        if c < 0.03:
            fam.append("grey")
        elif h < 45 or h >= 340:
            fam.append("red")
        elif h < 100:
            fam.append("warm")
        elif h < 190:
            fam.append("green")
        else:
            fam.append("blue")
    order_f = ["grey", "green", "warm", "red", "blue"]
    idx = sorted(range(len(rgb)), key=lambda i: (order_f.index(fam[i]), lab[i, 0]))
    return idx, fam


def build():
    from sklearn.cluster import KMeans
    cols, wts = gather()
    cols = fix(cols)  # clamp sources first so the darks merge instead of piling up at L*=8
    w = np.array([1.5, 1.0, 1.0])
    X = srgb_to_oklab(cols) * w
    # identity colours live in the reserved block: if a main centre lands on one (within OKLab 0.03),
    # ask k-means for one more cluster and drop that centre, so the 48 main colours stay distinct
    ident = srgb_to_oklab(np.array([hx(h) for h in IDENTITY]))
    for k in range(K, K + len(IDENTITY) + 1):
        km = KMeans(n_clusters=k, n_init=16, random_state=0).fit(X, sample_weight=wts)
        centres = fix(oklab_to_srgb(km.cluster_centers_ / w))
        d = np.sqrt(((srgb_to_oklab(centres)[:, None] - ident[None]) ** 2).sum(-1)).min(1)
        centres = centres[d >= 0.03]
        if len(centres) >= K:
            if len(centres) > K:  # drop the extra centres closest to the identity colours
                d = d[d >= 0.03]
                centres = centres[np.sort(np.argsort(-d)[:K])]
            break
    centres = np.unique(centres, axis=0)
    assert len(centres) == K, f"collapsed to {len(centres)} colours"
    idx, fam = ramp_order(centres)
    main = [(f"{fam[i]} {n + 1:02d}", centres[i]) for n, i in enumerate(idx)]
    res = [(f"reserved {n}", hx(h)) for n, h in RESERVED]
    extra = [(n, hx(h)) for n, h in DANGER + CLOTH]
    for n, c in extra:
        assert hsv_sat(c[None])[0] <= DANGER_SAT_MAX + 1e-6 and LSTAR_MIN <= lstar(c[None])[0] <= LSTAR_MAX, n
    entries = main + extra + res

    OUT.mkdir(parents=True, exist_ok=True)
    lines = ["GIMP Palette", "Name: Last Light Outpost master", "Columns: 8",
             "# 54 main colours: 0-47 k-means (grouped by hue family, dark -> light), 48-50 danger red "
             "(interactive / dangerous objects only, saturation <= 0.75), 51-53 neutral cloth grey; "
             "54-63 reserved (UI/FX 8 + hero identity 2)",
             "# built by tools/art/ai/build_palette.py"]
    for name, c in entries:
        lines.append(f"{c[0]:3d} {c[1]:3d} {c[2]:3d}\t{name}")
    (OUT / "master.gpl").write_text("\n".join(lines) + "\n", encoding="utf-8")

    # swatch: 8 columns, 16x16 per colour, index label strip under each row
    cell, lab_h, cols_n = 16, 9, 8
    rows = (len(entries) + cols_n - 1) // cols_n
    sw = Image.new("RGB", (cols_n * cell, rows * (cell + lab_h)), (16, 16, 16))
    d = ImageDraw.Draw(sw)
    for i, (_, c) in enumerate(entries):
        x, y = (i % cols_n) * cell, (i // cols_n) * (cell + lab_h)
        d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=tuple(int(v) for v in c))
        d.text((x + 1, y + cell - 1), f"{i}", fill=(220, 220, 220) if i < 48 else (120, 230, 255) if i < N_MAIN else (255, 200, 80))
    sw.save(OUT / "palette_swatch.png")
    sw.resize((sw.width * 4, sw.height * 4), Image.NEAREST).save(OUT / "palette_swatch_x4.png")

    arr = np.array([c for _, c in entries])
    stats = {
        "colours": len(entries), "main": N_MAIN, "main_kmeans": K, "danger": [h for _, h in DANGER],
        "cloth": [h for _, h in CLOTH], "reserved": len(RESERVED),
        "main_lstar_min": round(float(lstar(arr[:K]).min()), 1),
        "main_lstar_max": round(float(lstar(arr[:K]).max()), 1),
        "main_sat_max": round(float(hsv_sat(arr[:K]).max()), 2),
        "families": {f: int(sum(1 for n, _ in main if n.startswith(f))) for f in
                     ["grey", "green", "warm", "red", "blue"]},
        "sources": {k: str(v.relative_to(ROOT)).replace("\\", "/") for k, v in SOURCES.items()},
        "prop_seeds": PROP_SEEDS, "weights": WEIGHTS,
    }
    (OUT / "palette.json").write_text(json.dumps(stats, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False))


def part(name: str) -> np.ndarray:
    """Named slices of master.gpl: kmeans (0-47), danger, cloth, identity."""
    if name == "kmeans":
        return load_gpl()[:48]
    src = {"danger": DANGER, "cloth": CLOTH,
           "identity": [(h, h) for h in IDENTITY]}[name]
    return np.array([hx(h) for _, h in src], np.uint8)


def load_gpl(path: Path = OUT / "master.gpl") -> np.ndarray:
    cols = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) >= 3 and all(p.isdigit() for p in parts[:3]):
            cols.append([int(p) for p in parts[:3]])
    return np.array(cols, np.uint8)


def check(img_path: Path, pal: np.ndarray | None = None) -> dict:
    pal = load_gpl() if pal is None else pal
    a = np.array(Image.open(img_path).convert("RGBA")).reshape(-1, 4)
    u = np.unique(a[a[:, 3] > 0][:, :3], axis=0)
    pset = {tuple(c) for c in pal}
    bad = [c for c in map(tuple, u) if c not in pset]
    return {"file": str(img_path), "colours": len(u), "outside_palette": len(bad),
            "bad": ["%02x%02x%02x" % tuple(int(v) for v in c) for c in bad[:10]]}


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "check":
        for p in sys.argv[2:]:
            print(json.dumps(check(Path(p))))
    else:
        build()
