"""
從一張霧屍走路精靈圖（4 格 64×64）用程式產生：
  - 三種霧屍（一般 / 疾行 / 腫脹）的配色與體型變體（調色盤替換，不靠遊戲內 tint）
  - 每種額外 2 格攻擊動作（蓄力後仰、前撲），用逐列位移做出上半身的傾斜

只需要 Python 3 + Pillow（pip install pillow），完全免費、可重跑。
用法（在 repo 根目錄）：
  python3 tools/art/make_zombie_variants.py
輸出到 public/assets/sprites/zombie_<type>.png，每張 6 格：0–3 走路、4 蓄力、5 前撲。
"""
from __future__ import annotations

import colorsys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "art/source/zombie_walk.png"
OUT = ROOT / "public/assets/sprites"
F = 64  # 影格大小
WAIST = 36  # 腰部所在列；這列以上算上半身


def classify(r: int, g: int, b: int) -> str:
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    hd = h * 360
    if v < 0.11:
        return "outline"
    if s < 0.07 and v > 0.58:
        return "shirt"
    if 165 <= hd <= 230 and s > 0.15:
        return "pants"
    if 70 <= hd <= 165 and s >= 0.07:
        return "skin"
    return "other"


def recolor(px: tuple[int, int, int, int], scheme: dict[str, tuple[float, float, float]]) -> tuple[int, int, int, int]:
    r, g, b, a = px
    if a == 0:
        return px
    part = classify(r, g, b)
    if part not in scheme:
        return px
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    nh, s_mul, v_mul = scheme[part]
    # 保留原本的明暗層次，只換色相與飽和度
    ns = min(1.0, max(s, 0.05) * s_mul)
    nv = min(1.0, v * v_mul)
    nr, ng, nb = colorsys.hsv_to_rgb(nh / 360, ns, nv)
    return (round(nr * 255), round(ng * 255), round(nb * 255), a)


SCHEMES: dict[str, dict] = {
    # 一般：保留原色
    "basic": {"colors": {}, "widen": 1.0},
    # 疾行：病黃皮膚、沾血的紅褐上衣
    "runner": {
        "colors": {"skin": (58, 2.2, 1.0), "shirt": (8, 6.0, 0.62), "pants": (220, 0.6, 0.9)},
        "widen": 0.92,
    },
    # 腫脹：紫灰浮腫皮膚、髒黃背心、身形加寬
    "brute": {
        "colors": {"skin": (285, 1.8, 0.92), "shirt": (45, 5.0, 0.7), "pants": (30, 1.4, 0.8)},
        "widen": 1.22,
    },
}


def widen(frame: Image.Image, k: float) -> Image.Image:
    """以身體中心為軸水平縮放（最近鄰，保持像素硬邊）。"""
    if k == 1.0:
        return frame
    bbox = frame.getbbox()
    if not bbox:
        return frame
    cx = (bbox[0] + bbox[2]) / 2
    w = round(F * k)
    scaled = frame.resize((w, F), Image.NEAREST)
    out = Image.new("RGBA", (F, F))
    out.paste(scaled, (round(cx - cx * k), 0), scaled)
    return out


def lean(frame: Image.Image, top_shift: int, drop: int = 0) -> Image.Image:
    """上半身逐列平移：越靠近頭位移越多，做出前傾 / 後仰；drop 讓上半身往下沉。"""
    out = Image.new("RGBA", (F, F))
    src = frame.load()
    dst = out.load()
    for y in range(F):
        t = max(0.0, (WAIST - y) / WAIST)  # 腰部 0 → 頭頂 1
        dx = round(top_shift * t)
        dy = round(drop * t)
        for x in range(F):
            p = src[x, y]
            if p[3] == 0:
                continue
            nx, ny = x + dx, y + dy
            if 0 <= nx < F and 0 <= ny < F:
                dst[nx, ny] = p
    return out


def build(kind: str, cfg: dict, walk: list[Image.Image]) -> Image.Image:
    frames = []
    for fr in walk:
        fr = fr.copy()
        pix = fr.load()
        for y in range(F):
            for x in range(F):
                pix[x, y] = recolor(pix[x, y], cfg["colors"])
        frames.append(widen(fr, cfg["widen"]))
    # 攻擊：取手往前伸最明顯的第 0 格
    frames.append(lean(frames[0], -5, -1))  # 4 蓄力後仰
    frames.append(lean(frames[0], 8, 3))  # 5 前撲
    sheet = Image.new("RGBA", (F * len(frames), F))
    for i, fr in enumerate(frames):
        sheet.paste(fr, (i * F, 0))
    return sheet


def main() -> None:
    src = Image.open(SRC).convert("RGBA")
    walk = [src.crop((i * F, 0, i * F + F, F)) for i in range(src.width // F)]
    OUT.mkdir(parents=True, exist_ok=True)
    for kind, cfg in SCHEMES.items():
        path = OUT / f"zombie_{kind}.png"
        build(kind, cfg, walk).save(path)
        print("wrote", path.relative_to(ROOT))


if __name__ == "__main__":
    main()
