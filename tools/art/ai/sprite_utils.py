"""Shared helpers for the AI sprite pipeline (magenta key, bounds, alignment, contact sheets).

Canvas spec (TEST_SPEC.md §1), in 8x space (512 canvas):
  foot line  y = 488 (64-px y=61)   -> FOOT_Y8
  centerline x = 256 (64-px x=32)   -> MID_X8
  M height   448 px (56 px)         -> M_HEIGHT8
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SCALE = 8
CANVAS = 64
CANVAS8 = CANVAS * SCALE
FOOT_Y = 61
MID_X = 32
M_HEIGHT = 56
FOOT_Y8 = FOOT_Y * SCALE
MID_X8 = MID_X * SCALE
M_HEIGHT8 = M_HEIGHT * SCALE
MAGENTA = (255, 0, 255)


def magenta_mask(rgb: np.ndarray) -> np.ndarray:
    """True where the pixel is background magenta (hue ~300deg, high saturation)."""
    a = rgb.astype(np.int32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / np.maximum(mx, 1)
    # magenta: r and b both high and close, g clearly lowest
    return (r > 120) & (b > 120) & (np.abs(r - b) < 90) & (g < np.minimum(r, b) - 70) & (sat > 0.45)


def key_magenta(img: Image.Image) -> Image.Image:
    """RGB/RGBA -> RGBA with magenta made transparent; keeps the largest connected blob region set."""
    rgba = img.convert("RGBA")
    a = np.array(rgba)
    bg = magenta_mask(a[..., :3])
    a[..., 3] = np.where(bg, 0, a[..., 3])
    return Image.fromarray(a, "RGBA")


def alpha_bounds(img: Image.Image, thresh: int = 128):
    """(left, top, right, bottom) inclusive bounds of opaque pixels, or None."""
    a = np.array(img.convert("RGBA"))[..., 3] > thresh
    ys, xs = np.where(a)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def torso_center_x(img: Image.Image, top: int, bottom: int) -> float:
    """Median x of opaque pixels in the torso band (35%-60% of body height from the top)."""
    a = np.array(img.convert("RGBA"))[..., 3] > 128
    h = bottom - top
    band = a[top + int(h * 0.35): top + int(h * 0.60)]
    ys, xs = np.where(band)
    return float(np.median(xs)) if len(xs) else (a.shape[1] / 2)


def place(img: Image.Image, scale: float, foot_y: int, center_x: float,
          canvas: int = CANVAS8) -> Image.Image:
    """Scale an RGBA image by `scale` (nearest) and paste it so that its foot row lands on
    FOOT_Y8 and center_x lands on MID_X8 of a transparent canvas."""
    w, h = img.size
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    scaled = img.resize((nw, nh), Image.NEAREST)
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    dx = round(MID_X8 - center_x * scale)
    # foot_y is the bottom EDGE (last opaque row + 1); row FOOT_Y spans [FOOT_Y8, FOOT_Y8+SCALE)
    dy = round(FOOT_Y8 + SCALE - foot_y * scale)
    out.paste(scaled, (dx, dy), scaled)
    return out


def on_magenta(img: Image.Image) -> Image.Image:
    bg = Image.new("RGBA", img.size, MAGENTA + (255,))
    bg.alpha_composite(img.convert("RGBA"))
    return bg.convert("RGB")


def guides(img: Image.Image, scale_to_64: bool = False) -> Image.Image:
    """Draw foot line (green), centerline (blue), M head line (white) on an RGB copy."""
    im = img.convert("RGB").copy()
    s = im.size[0] / CANVAS
    d = ImageDraw.Draw(im)
    fy = (FOOT_Y + 0.5) * s if s >= 2 else FOOT_Y
    d.line([(0, fy), (im.size[0], fy)], fill=(0, 255, 0))
    d.line([(MID_X * s, 0), (MID_X * s, im.size[1])], fill=(0, 128, 255))
    hy = (FOOT_Y - M_HEIGHT + 1) * s
    d.line([(0, hy), (im.size[0], hy)], fill=(255, 255, 255))
    return im


def contact_sheet(images: list[Image.Image], labels: list[str] | None = None, cell: int = 256,
                  cols: int | None = None, with_guides: bool = True, bg=MAGENTA) -> Image.Image:
    cols = cols or len(images)
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new("RGB", (cell * cols, cell * rows + 14 * rows), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    for i, im in enumerate(images):
        im = im.convert("RGBA")
        base = Image.new("RGBA", im.size, bg + (255,))
        base.alpha_composite(im)
        tile = base.convert("RGB").resize((cell, cell), Image.NEAREST)
        if with_guides:
            tile = guides(tile)
        x, y = (i % cols) * cell, (i // cols) * (cell + 14)
        sheet.paste(tile, (x, y + 14))
        if labels:
            d.text((x + 3, y + 1), labels[i], fill=(255, 255, 255))
    return sheet


def k_centroid(img: Image.Image, factor: int = SCALE, alpha_thresh: int = 128) -> Image.Image:
    """Downscale RGBA by `factor`: each block takes its dominant (most frequent, quantized) opaque
    color; block is transparent if fewer than half its pixels are opaque."""
    a = np.array(img.convert("RGBA"))
    H, W = a.shape[0] // factor, a.shape[1] // factor
    out = np.zeros((H, W, 4), np.uint8)
    for y in range(H):
        for x in range(W):
            blk = a[y * factor:(y + 1) * factor, x * factor:(x + 1) * factor].reshape(-1, 4)
            op = blk[blk[:, 3] > alpha_thresh]
            if len(op) * 2 < len(blk):
                continue
            q = (op[:, :3] // 16).astype(np.int32)
            keys = q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2]
            vals, counts = np.unique(keys, return_counts=True)
            k = vals[counts.argmax()]
            sel = op[keys == k][:, :3]
            out[y, x, :3] = sel.mean(axis=0).round().astype(np.uint8)
            out[y, x, 3] = 255
    return Image.fromarray(out, "RGBA")


def save(img: Image.Image, path: str | Path) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    img.save(p)
