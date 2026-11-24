"""Post-processing shared by both routes (TEST_SPEC §6 steps 2-6).

Subcommands:
  downscale  raw frames (magenta bg, any square size) -> aligned 64x64 RGBA (unquantized)
      python tools/art/ai/pixelize.py downscale FRAME... --out DIR --scale S
             [--align hybrid|frame|action] [--ref-height H]
      --scale: px-per-source-px in 512 (8x) space. Use one value per character (from its idle
      frame 0: 448 / source_height). --ref-height H computes it as 448/H.
  palette    collect opaque pixels of all 64px frames of a character -> <=K colors (OKLab k-means)
      python tools/art/ai/pixelize.py palette DIR... --k 16 --out palette.png
  apply      quantize to palette + cleanup (orphans, magenta remnants, 1px outline repair)
      python tools/art/ai/pixelize.py apply DIR --palette palette.png --out DIR2 [--headlock N]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from sprite_utils import (CANVAS, FOOT_Y8, M_HEIGHT8, MID_X8, SCALE, alpha_bounds, k_centroid,  # noqa: E402
                          key_magenta, magenta_mask, place, torso_center_x)

# ---------------------------------------------------------------- color space

def srgb_to_oklab(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    l = 0.4122214708 * c[:, 0] + 0.5363325363 * c[:, 1] + 0.0514459929 * c[:, 2]
    m = 0.2119034982 * c[:, 0] + 0.6806995451 * c[:, 1] + 0.1073969566 * c[:, 2]
    s = 0.0883024619 * c[:, 0] + 0.2817188376 * c[:, 1] + 0.6299787005 * c[:, 2]
    l, m, s = np.cbrt(l), np.cbrt(m), np.cbrt(s)
    return np.stack([
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ], axis=1)


def oklab_to_srgb(lab: np.ndarray) -> np.ndarray:
    L, a, b = lab[:, 0], lab[:, 1], lab[:, 2]
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    c = np.clip(np.stack([r, g, bb], axis=1), 0, 1)
    c = np.where(c <= 0.0031308, 12.92 * c, 1.055 * c ** (1 / 2.4) - 0.055)
    return np.clip(np.round(c * 255), 0, 255).astype(np.uint8)


# ---------------------------------------------------------------- downscale

def despill(rgba: Image.Image) -> Image.Image:
    """Replace magenta-tinted edge pixels (not keyed but pinkish) by the nearest solid neighbour."""
    a = np.array(rgba)
    rgb = a[..., :3].astype(int)
    op = a[..., 3] > 0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    pink = op & (r > g + 50) & (b > g + 50) & (np.abs(r - b) < 110)
    if not pink.any():
        return rgba
    # edge pink pixels touching transparency -> remove; interior pink -> neighbour colour
    tr = ~op
    near_tr = np.zeros_like(tr)
    near_tr[1:] |= tr[:-1]; near_tr[:-1] |= tr[1:]; near_tr[:, 1:] |= tr[:, :-1]; near_tr[:, :-1] |= tr[:, 1:]
    a[pink & near_tr, 3] = 0
    return Image.fromarray(a, "RGBA")


def remove_warm(rgba: Image.Image) -> Image.Image:
    """Make saturated orange/brown pixels transparent (a prop the video model added, e.g. a bat)."""
    import colorsys
    a = np.array(rgba)
    rgb = a[..., :3].astype(np.float64) / 255
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-6)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    warm = (r >= g) & (g >= b) & (sat > 0.45) & (mx > 0.35) & ((r - b) > 0.25)
    a[warm & (a[..., 3] > 0), 3] = 0
    return Image.fromarray(a, "RGBA")


def figure_metrics(keyed: Image.Image):
    l, t, r, b = alpha_bounds(keyed)
    return {"bounds": (l, t, r, b), "center_x": torso_center_x(keyed, t, b), "foot": b + 1}


def downscale(frames: list[Path], out: Path, scale: float, align: str = "hybrid",
              height: int = CANVAS, foot_row: int = 61, fixed_foot: float | None = None,
              fixed_center: float | None = None, drop_warm: bool = False) -> list[dict]:
    """align: frame  = per-frame torso centre + per-frame foot (stills / pose_swap)
              action = one centre + one foot for the whole action (keeps the original motion)
              hybrid = one centre for the action, per-frame foot (video loops: no drift, no bob)"""
    keyed = [despill(key_magenta(Image.open(f))) for f in frames]
    if drop_warm:
        keyed = [remove_warm(k) for k in keyed]
    metrics = [figure_metrics(k) for k in keyed]
    # sources may be 512 or 1024 etc: scale is defined for 512 space, convert per source size
    cx_all = float(np.median([m["center_x"] for m in metrics]))
    foot_all = float(np.median([m["foot"] for m in metrics]))
    out.mkdir(parents=True, exist_ok=True)
    info = []
    for i, (k, m) in enumerate(zip(keyed, metrics)):
        s = scale * (512 / k.width) if scale else 512 / k.width
        cx = m["center_x"] if align == "frame" else cx_all
        foot = foot_all if align == "action" else m["foot"]
        if fixed_center is not None:
            cx = fixed_center
        if fixed_foot is not None:
            foot = fixed_foot
        img512 = place(k, s, foot, cx, canvas_h=height * SCALE, foot_row=foot_row)
        img64 = k_centroid(img512)
        img64.save(out / f"{i:02d}.png")
        info.append({"src": str(frames[i]).replace("\\", "/"), "scale512": s, "center_x": cx, "foot": foot,
                     "bounds64": alpha_bounds(img64)})
    (out / "downscale.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
    return info


# ---------------------------------------------------------------- palette

def load_frames(dirs: list[Path]) -> list[Path]:
    files = []
    for d in dirs:
        files += sorted(p for p in Path(d).glob("[0-9][0-9].png"))
    return files


def hex_rgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.uint8)


def build_palette(dirs: list[Path], k: int, out: Path, dark_l: float = 0.25,
                  reserve: list[str] | None = None) -> np.ndarray:
    """k colours total: 1 outline colour (all pixels darker than OKLab L=dark_l merged into one),
    the reserved colours (e.g. dark skin outline, stripe colour), and k-means on the rest."""
    from sklearn.cluster import KMeans
    px = []
    for f in load_frames(dirs):
        a = np.array(Image.open(f).convert("RGBA")).reshape(-1, 4)
        px.append(a[a[:, 3] > 0][:, :3])
    px = np.concatenate(px)
    lab = srgb_to_oklab(px)
    dark = lab[:, 0] < dark_l
    fixed = []
    if dark.any():
        # one outline colour: median of the near-black pixels (keeps their slight tint)
        fixed.append(np.median(px[dark], axis=0).round().astype(np.uint8))
    for h in reserve or []:
        fixed.append(hex_rgb(h))
    rest = px[~dark]
    n = max(1, min(k - len(fixed), len(np.unique(rest, axis=0))))
    # weight lightness a bit more so shading ramps survive
    w = np.array([1.5, 1.0, 1.0])
    km = KMeans(n_clusters=n, n_init=8, random_state=0).fit(srgb_to_oklab(rest) * w)
    centers = np.concatenate([np.array(fixed, np.uint8).reshape(-1, 3), oklab_to_srgb(km.cluster_centers_ / w)])
    centers = centers[np.argsort(srgb_to_oklab(centers)[:, 0])]  # dark -> light
    img = Image.fromarray(centers.reshape(1, -1, 3).astype(np.uint8), "RGB")
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    return centers


def palette_from_image(base: Path, dirs: list[Path], extra: int, out: Path, min_dist: float = 0.08) -> np.ndarray:
    """Use an existing sprite's exact colours; add up to `extra` colours (k-means) only for frame
    pixels that are far (OKLab distance > min_dist) from every base colour (e.g. a new prop)."""
    a = np.array(Image.open(base).convert("RGBA")).reshape(-1, 4)
    pal = np.unique(a[a[:, 3] > 0][:, :3], axis=0)
    if extra > 0:
        from sklearn.cluster import KMeans
        px = []
        for f in load_frames(dirs):
            b = np.array(Image.open(f).convert("RGBA")).reshape(-1, 4)
            px.append(b[b[:, 3] > 0][:, :3])
        px = np.concatenate(px)
        lab = srgb_to_oklab(px)
        plab = srgb_to_oklab(pal)
        d = np.sqrt(((lab[:, None, :] - plab[None, :, :]) ** 2).sum(-1)).min(1)
        far = px[d > min_dist]
        if len(far) >= extra * 20:
            km = KMeans(n_clusters=extra, n_init=8, random_state=0).fit(srgb_to_oklab(far))
            pal = np.concatenate([pal, oklab_to_srgb(km.cluster_centers_)])
    pal = pal[np.argsort(srgb_to_oklab(pal)[:, 0])]
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pal.reshape(1, -1, 3).astype(np.uint8), "RGB").save(out)
    return pal


def quantize(img: Image.Image, pal: np.ndarray, hue_weight: float = 1.0) -> Image.Image:
    """Nearest palette colour in OKLab. hue_weight > 1 scales a/b so a saturated colour stays in its
    hue family (red paint -> the palette's reds, not a brown of similar lightness)."""
    a = np.array(img.convert("RGBA"))
    op = a[..., 3] > 0
    w = np.array([1.0, hue_weight, hue_weight])
    lab = srgb_to_oklab(a[..., :3].reshape(-1, 3)) * w
    plab = srgb_to_oklab(pal) * w
    d = ((lab[:, None, :] - plab[None, :, :]) ** 2).sum(-1)
    idx = d.argmin(1).reshape(a.shape[:2])
    out = np.zeros_like(a)
    out[..., :3] = pal[idx]
    out[..., 3] = np.where(op, 255, 0)
    return Image.fromarray(out, "RGBA")


# ---------------------------------------------------------------- cleanup

N4 = [(-1, 0), (1, 0), (0, -1), (0, 1)]
N8 = N4 + [(-1, -1), (-1, 1), (1, -1), (1, 1)]


def shifted(m: np.ndarray, dy: int, dx: int, fill=False):
    out = np.full_like(m, fill)
    H, W = m.shape[:2]
    ys, yd = (slice(max(dy, 0), H + min(dy, 0)), slice(max(-dy, 0), H + min(-dy, 0)))
    xs, xd = (slice(max(dx, 0), W + min(dx, 0)), slice(max(-dx, 0), W + min(-dx, 0)))
    out[yd, xd] = m[ys, xs]
    return out


def cleanup(img: Image.Image, pal: np.ndarray, outline: bool = True) -> Image.Image:
    a = np.array(img.convert("RGBA"))
    op = a[..., 3] > 0
    # 1. remove opaque pixels with no 4-neighbour (orphans) and fill transparent holes surrounded on 4 sides
    n4 = sum(shifted(op, dy, dx) for dy, dx in N4)
    a[op & (n4 == 0), 3] = 0
    op = a[..., 3] > 0
    n4 = sum(shifted(op, dy, dx) for dy, dx in N4)
    holes = (~op) & (n4 == 4)
    if holes.any():
        for y, x in zip(*np.where(holes)):
            a[y, x, :3] = a[y - 1, x, :3]
            a[y, x, 3] = 255
    op = a[..., 3] > 0
    # 2. single-pixel colour specks: a pixel whose colour differs from all 8 neighbours, and
    #    whose neighbours mostly agree, takes the majority colour (keeps 1px outlines intact)
    key = a[..., 0].astype(np.int64) * 65536 + a[..., 1].astype(np.int64) * 256 + a[..., 2]
    H, W = op.shape
    newa = a.copy()
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            if not op[y, x]:
                continue
            nb = [key[y + dy, x + dx] for dy, dx in N8 if op[y + dy, x + dx]]
            if len(nb) < 7 or key[y, x] in nb:
                continue
            vals, cnt = np.unique(nb, return_counts=True)
            if cnt.max() >= 5:
                v = vals[cnt.argmax()]
                newa[y, x, :3] = [(v >> 16) & 255, (v >> 8) & 255, v & 255]
    a = newa
    if not outline:
        return Image.fromarray(a, "RGBA")
    # 3. outline: every opaque pixel touching transparency (4-neighbour) gets the darkest palette
    #    colour of its hue family (selout-ish: darker variant of itself, never pure black)
    op = a[..., 3] > 0
    edge = op & (sum(shifted(~op, dy, dx, True) for dy, dx in N4) > 0)
    plab = srgb_to_oklab(pal)
    lab = srgb_to_oklab(a[..., :3].reshape(-1, 3)).reshape(H, W, 3)
    pchroma = np.hypot(plab[:, 1], plab[:, 2])
    phue = np.arctan2(plab[:, 2], plab[:, 1])
    darkest = int(np.argmin(plab[:, 0]))
    for y, x in zip(*np.where(edge)):
        c = lab[y, x]
        if c[0] < 0.35:  # already a dark outline pixel
            continue
        chroma = float(np.hypot(c[1], c[2]))
        darker = plab[:, 0] < c[0] - 0.08
        if chroma < 0.04:
            # neutral (white/grey): only neutral darker colours
            fam = darker & (pchroma < 0.05)
        else:
            # same hue family only (within ~30 deg) so skin never takes the red of the number
            dh = np.abs((phue - np.arctan2(c[2], c[1]) + np.pi) % (2 * np.pi) - np.pi)
            fam = darker & (pchroma > 0.02) & (dh < np.radians(30))
        cand = np.where(fam)[0]
        if len(cand) == 0:
            a[y, x, :3] = pal[darkest]
            continue
        target = max(c[0] - 0.45, 0.12)
        dd = (plab[cand, 0] - target) ** 2 + ((plab[cand, 1:] - c[1:]) ** 2).sum(1)
        a[y, x, :3] = pal[cand[dd.argmin()]]
    return Image.fromarray(a, "RGBA")


def _keys(a: np.ndarray) -> np.ndarray:
    return a[..., 0].astype(np.int64) * 65536 + a[..., 1].astype(np.int64) * 256 + a[..., 2]


def limit_colours(img: Image.Image, max_c: int, region: np.ndarray | None = None,
                  protect: list[str] | None = None, uncounted: list[str] | None = None,
                  group=None) -> tuple[Image.Image, list[int]]:
    """Reduce the colours inside `region` (bool mask, default all) to <= max_c: repeatedly merge the
    colour whose merge costs least (pixels x OKLab distance^2) into its nearest remaining one. Never merged away: the darkest colour
    (outline) and `protect` hex colours (e.g. hero identity red / stripe blue).
    `uncounted` hex colours do not count towards max_c (character rule: <=16 + identity colours).
    `group`: optional function (r, g, b) -> label; colours only merge within the same label
    (zombie regions: shirt / pants / skin / outline must not bleed into each other).
    Returns (image, [colours before, colours after]) - both counts exclude `uncounted`."""
    a = np.array(img.convert("RGBA"))
    op = a[..., 3] > 0
    if region is not None:
        op &= region
    keys = _keys(a)
    u, c = np.unique(keys[op], return_counts=True)
    free = {int(h, 16) for h in uncounted or []}
    n_free = sum(1 for k in u if int(k) in free)
    if len(u) - n_free <= max_c:
        return Image.fromarray(a, "RGBA"), [len(u) - n_free, len(u) - n_free]
    rgb = np.stack([(u >> 16) & 255, (u >> 8) & 255, u & 255], 1).astype(np.uint8)
    lab = srgb_to_oklab(rgb)
    keep = {int(np.argmin(lab[:, 0]))}
    lab = lab * np.array([1.0, 2.0, 2.0])  # hue counts double: dark brown hair != dark navy cap
    for h in protect or []:
        keep |= set(np.where(u == int(h, 16))[0].tolist())
    alive = list(range(len(u)))
    grp = None if group is None else [group(int(r), int(g), int(b)) for r, g, b in rgb]
    cnt = dict(enumerate(c.tolist()))
    remap = {i: i for i in alive}
    while len(alive) - n_free > max_c:
        cand = [j for j in alive if j not in keep]
        if not cand:
            break
        # drop the colour whose merge costs least: pixels x squared OKLab distance to its nearest
        # survivor (close shades merge first; a small but distinct colour, e.g. hair, survives)
        def near(j):
            pool = [o for o in alive if o != j and (grp is None or grp[o] == grp[j])]
            if not pool:
                return None
            return min(pool, key=lambda o: float(((lab[j] - lab[o]) ** 2).sum()))
        cand = [j for j in cand if near(j) is not None]
        if not cand:
            break
        i = min(cand, key=lambda j: cnt[j] * float(((lab[j] - lab[near(j)]) ** 2).sum()))
        k = near(i)
        alive.remove(i)
        cnt[k] += cnt[i]
        for src, dst in remap.items():
            if dst == i:
                remap[src] = k
    for src, dst in remap.items():
        if src != dst:
            a[op & (keys == u[src]), :3] = rgb[dst]
    return Image.fromarray(a, "RGBA"), [len(u) - n_free, len(alive) - n_free]


def remove_islands(img: Image.Image, max_px: int = 2, region: np.ndarray | None = None,
                   protect: list[str] | None = None, passes: int = 2, similar: float = 0.06,
                   dark_l: float = 0.35) -> tuple[Image.Image, int]:
    """Recolour isolated patches of <= max_px pixels (8-connected) inside the sprite.

    "Isolated" is judged on colour groups, not exact colours: palette colours closer than `similar`
    (OKLab) count as one group, so a line drawn in alternating shades (crate brace, plank seam) is one
    long patch and survives, while a speck that differs from everything around it is removed.
    Each removed pixel takes the most common colour of a different group among its opaque
    8-neighbours (edge pixels prefer edge neighbours, so the outline stays an outline).
    Never touched: dark colours (OKLab L < dark_l: outline, pupils) and `protect` colours."""
    from scipy import ndimage
    a = np.array(img.convert("RGBA"))
    H, W = a.shape[:2]
    total = 0
    prot = {int(h, 16) for h in protect or []}
    for _ in range(passes):
        op = a[..., 3] > 0
        if region is not None:
            op &= region
        keys = _keys(a)
        edge = op & (sum(shifted(~(a[..., 3] > 0), dy, dx, True) for dy, dx in N4) > 0)
        u = np.unique(keys[op])
        if not len(u):
            break
        lab = srgb_to_oklab(np.stack([(u >> 16) & 255, (u >> 8) & 255, u & 255], 1).astype(np.uint8))
        # union-find colour groups
        parent = list(range(len(u)))

        def root(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        d = np.sqrt(((lab[:, None] - lab[None]) ** 2).sum(-1))
        for i in range(len(u)):
            for j in range(i + 1, len(u)):
                if d[i, j] < similar:
                    parent[root(i)] = root(j)
        group_of = {int(k): root(i) for i, k in enumerate(u)}
        gmap = np.full(keys.shape, -1, np.int64)
        for k, g in group_of.items():
            gmap[op & (keys == k)] = g
        safe = {int(k) for i, k in enumerate(u) if lab[i, 0] < dark_l or int(k) in prot}
        changed = 0
        newa = a.copy()
        for g in set(group_of.values()):
            lbl, n = ndimage.label(gmap == g, structure=np.ones((3, 3)))
            if not n:
                continue
            sizes = ndimage.sum(np.ones_like(lbl), lbl, range(1, n + 1))
            for ci in np.where(sizes <= max_px)[0] + 1:
                for y, x in zip(*np.where(lbl == ci)):
                    if int(keys[y, x]) in safe:
                        continue
                    nb, nbe = [], []
                    for dy, dx in N8:
                        yy, xx = y + dy, x + dx
                        if 0 <= yy < H and 0 <= xx < W and a[yy, xx, 3] > 0 and gmap[yy, xx] != g:
                            nb.append(keys[yy, xx])
                            if edge[yy, xx]:
                                nbe.append(keys[yy, xx])
                    pool = nbe if edge[y, x] and nbe else nb
                    if not pool:
                        continue
                    vals, cnt = np.unique(pool, return_counts=True)
                    v = int(vals[cnt.argmax()])
                    newa[y, x, :3] = [(v >> 16) & 255, (v >> 8) & 255, v & 255]
                    changed += 1
        a = newa
        total += changed
        if not changed:
            break
    return Image.fromarray(a, "RGBA"), total


def draw_stripes(img: Image.Image, pal: np.ndarray, rows: tuple[int, int], color: np.ndarray,
                 every: int = 3, x0: int = 32) -> Image.Image:
    """Vertical pinstripes on the jersey: neutral light pixels (white / light-grey shade) inside the
    torso rows (relative to the figure's solid top), not on the outline. Columns x where
    (x - x0) % every == 0, anchored to the canvas centreline so they never crawl between frames."""
    a = np.array(img)
    op = a[..., 3] > 0
    rows_op = np.where(op.sum(1) >= 3)[0]
    if not len(rows_op):
        return img
    top = int(rows_op[0])
    lab = srgb_to_oklab(a[..., :3].reshape(-1, 3)).reshape(a.shape[0], a.shape[1], 3)
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    jersey = op & (lab[..., 0] > 0.70) & (chroma < 0.05)
    edge = op & (sum(shifted(~op, dy, dx, True) for dy, dx in N4) > 0)
    band = np.zeros_like(op)
    band[top + rows[0]: top + rows[1]] = True
    cols = np.zeros_like(op)
    cols[:, [x for x in range(a.shape[1]) if (x - x0) % every == 0]] = True
    m = jersey & band & cols & ~edge
    a[m, :3] = color
    return Image.fromarray(a, "RGBA")


def headlock(frames: list[Image.Image], head_rows: int, ref: Image.Image) -> list[Image.Image]:
    """Replace the top `head_rows` rows of the figure in every frame with the reference frame's head,
    shifted to follow each frame's own top row (keeps the bob)."""
    def solid_top(img: Image.Image):
        # first row with >= 3 opaque pixels (ignores stray specks above the head)
        rows = np.where((np.array(img)[..., 3] > 0).sum(1) >= 3)[0]
        return int(rows[0]) if len(rows) else None

    rt = solid_top(ref)
    rb = (0, rt) if rt is not None else None
    out = []
    for f in frames:
        t = solid_top(f)
        if t is None or rb is None:
            out.append(f)
            continue
        b = (0, t)
        dy = b[1] - rb[1]
        # clear anything above the new head position (old head remnants / specks)
        a0 = np.array(f)
        a0[: max(rb[1] + dy, 0)] = 0
        f = Image.fromarray(a0, "RGBA")
        a = np.array(f)
        r = np.array(ref)
        for y in range(rb[1], rb[1] + head_rows):
            ty = y + dy
            if 0 <= ty < a.shape[0]:
                a[ty] = r[y]
        out.append(Image.fromarray(a, "RGBA"))
    return out


# ---------------------------------------------------------------- harmonize (REVIEW-04 #3)

def _jersey_mask(a: np.ndarray, feet: int, top_off: int = 43, bot_off: int = 18) -> np.ndarray:
    """Jersey candidates: light neutral or bluish pixels in the band [feet-top_off, feet-bot_off)
    (skin, red and wood are excluded because they are clearly warmer: r > b + 40)."""
    H = a.shape[0]
    band = np.zeros(a.shape[:2], bool)
    band[max(feet - top_off, 0): max(feet - bot_off, 0)] = True
    op = a[..., 3] > 0
    px = a[..., :3].astype(int)
    lab = srgb_to_oklab(a[..., :3].reshape(-1, 3)).reshape(H, a.shape[1], 3)
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    return band & op & (lab[..., 0] > 0.55) & (chroma < 0.12) & ~(px[..., 0] > px[..., 2] + 40)


def _red_mask(a: np.ndarray, feet: int) -> np.ndarray:
    band = np.zeros(a.shape[:2], bool)
    band[max(feet - 43, 0): max(feet - 18, 0)] = True
    px = a[..., :3].astype(int)
    return band & (a[..., 3] > 0) & (px[..., 0] > 150) & (px[..., 1] < 110) & (px[..., 2] < 120)


def harmonize(frames: list[Image.Image], ref_frames: list[Image.Image], feet: int, ref_feet: int,
              paste_seven: bool = True, min_red: int = 4, stripe_pattern: str = "",
              stripe_x0: int = 32) -> tuple[list[Image.Image], dict]:
    """Map jersey colours of `frames` to the reference action's jersey colours by brightness quantile,
    and paste the reference frame-0 number 7 onto every frame where a 7 is visible."""
    def hist(imgs, ft):
        cnt = {}
        for im in imgs:
            a = np.array(im)
            for c in map(tuple, a[_jersey_mask(a, ft)][:, :3]):
                cnt[c] = cnt.get(c, 0) + 1
        cols = sorted(cnt, key=lambda c: -srgb_to_oklab(np.array([c], np.uint8))[0, 0])  # light -> dark
        tot = sum(cnt.values())
        cum, out = 0, []
        for c in cols:
            out.append((c, cum / tot, (cum + cnt[c]) / tot))
            cum += cnt[c]
        return out

    ref = hist(ref_frames, ref_feet)
    tgt = hist(frames, feet)
    mapping = {}
    for c, lo, hi in tgt:
        mid = (lo + hi) / 2
        for rc, rlo, rhi in ref:
            if rlo <= mid <= rhi:
                mapping[c] = rc
                break
        else:
            mapping[c] = ref[-1][0]

    r0 = np.array(ref_frames[0])
    rred = _red_mask(r0, ref_feet)
    ry, rx = np.where(rred)
    seven = r0[rred][:, :3] if len(ry) else None
    jersey_main = np.array(ref[0][0], np.uint8)  # most common light colour = jersey base
    # stripe colour = the most frequent non-base jersey colour of the reference
    stripe_rgb = np.array(max(ref[1:], key=lambda t: t[2] - t[1])[0] if len(ref) > 1 else ref[0][0], np.uint8)

    out, pasted = [], []
    for i, im in enumerate(frames):
        a = np.array(im)
        jm = _jersey_mask(a, feet)
        if jm.any():
            src = a[jm][:, :3]
            a[jm, :3] = np.array([mapping[tuple(c)] for c in src], np.uint8)
        if stripe_pattern:
            # refill pinstripes on plain jersey white with the reference spacing (e.g. "10100" = idle's
            # stripe, white, stripe, white, white), anchored to the canvas centreline so they never crawl
            op = a[..., 3] > 0
            edge = op & (sum(shifted(~op, dy, dx, True) for dy, dx in N4) > 0)
            white = _jersey_mask(a, feet) & (a[..., :3] == jersey_main).all(-1) & ~edge
            per = len(stripe_pattern)
            cols = np.array([stripe_pattern[(x - stripe_x0) % per] == "1" for x in range(a.shape[1])])
            a[white & cols[None, :], :3] = stripe_rgb
        if paste_seven and seven is not None:
            red = _red_mask(a, feet)
            if red.sum() >= min_red:
                ty, tx = np.where(red)
                a[red, :3] = jersey_main  # clear the generated 7
                dy = int(round(ty.mean() - ry.mean()))
                dx = int(round(tx.mean() - rx.mean()))
                ok = _jersey_mask(a, feet) | red  # only on jersey (never on arms / skin)
                for (y, x), c in zip(zip(ry + dy, rx + dx), seven):
                    if 0 <= y < a.shape[0] and 0 <= x < a.shape[1] and ok[y, x]:
                        a[y, x, :3] = c
                pasted.append(i)
        out.append(Image.fromarray(a, "RGBA"))
    info = {"mapping": {"#%02X%02X%02X" % k: "#%02X%02X%02X" % v for k, v in mapping.items()},
            "seven_pasted_frames": pasted}
    return out, info


# ---------------------------------------------------------------- region match / largest blob (zombie)

def zombie_part(r: int, g: int, b: int) -> str:
    """Same rules as tools/art/make_zombie_variants.py classify()."""
    import colorsys
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


def match_region(img: Image.Image, ref: Image.Image, part: str) -> Image.Image:
    """Re-map the colours of one classify() region of `img` to the same region of `ref` by
    luminance quantile (keeps the shading order, uses the reference's colours and proportions)."""
    def lum(c):
        return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]

    def region(arr):
        cnt = {}
        for c in map(tuple, arr[arr[..., 3] > 0][:, :3]):
            if zombie_part(*c) == part:
                cnt[c] = cnt.get(c, 0) + 1
        cols = sorted(cnt, key=lum)
        tot = max(1, sum(cnt.values()))
        out, cum = [], 0
        for c in cols:
            out.append((c, cum / tot, (cum + cnt[c]) / tot))
            cum += cnt[c]
        return out

    a = np.array(img.convert("RGBA"))
    ref_r = region(np.array(ref.convert("RGBA")))
    tgt = region(a)
    if not ref_r or not tgt:
        return img
    mp = {}
    for c, lo, hi in tgt:
        mid = (lo + hi) / 2
        mp[c] = next((rc for rc, rlo, rhi in ref_r if rlo <= mid <= rhi), ref_r[-1][0])
    flat = a.reshape(-1, 4)
    for i in range(len(flat)):
        if flat[i, 3] and tuple(flat[i, :3]) in mp:
            flat[i, :3] = mp[tuple(flat[i, :3])]
    return Image.fromarray(flat.reshape(a.shape), "RGBA")


def keep_largest(img: Image.Image) -> Image.Image:
    """Drop opaque blobs (8-connected) other than the largest one (stray props, specks)."""
    from scipy import ndimage
    a = np.array(img.convert("RGBA"))
    lab, n = ndimage.label(a[..., 3] > 0, structure=np.ones((3, 3)))
    if n <= 1:
        return img
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    keep = 1 + int(np.argmax(sizes))
    a[(lab > 0) & (lab != keep), 3] = 0
    return Image.fromarray(a, "RGBA")


# ---------------------------------------------------------------- CLI

def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("downscale")
    d.add_argument("frames", nargs="+", type=Path)
    d.add_argument("--out", type=Path, required=True)
    d.add_argument("--scale", type=float, default=None, help="512-space scale for a 512 source")
    d.add_argument("--ref-height", type=float, default=None, help="source px height of idle frame 0")
    d.add_argument("--ref-size", type=int, default=None, help="source canvas size for --ref-height")
    d.add_argument("--align", choices=["frame", "action", "hybrid"], default="hybrid")
    d.add_argument("--height", type=int, default=64, help="output canvas height (64 or 72)")
    d.add_argument("--foot-row", type=int, default=61, help="sprite row of the feet (61, or 69 on 64x72)")
    d.add_argument("--fixed-foot", type=float, default=None,
                   help="source-pixel ground edge used for EVERY frame (keeps jumps/airborne frames off the ground)")
    d.add_argument("--fixed-center", type=float, default=None, help="source-pixel x used as centreline for every frame")
    d.add_argument("--drop-warm", action="store_true", help="remove saturated orange/brown pixels (stray props)")
    p = sub.add_parser("palette")
    p.add_argument("dirs", nargs="+", type=Path)
    p.add_argument("--k", type=int, default=16)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--dark-l", type=float, default=0.25, help="OKLab L below which pixels merge into one outline colour")
    p.add_argument("--reserve", nargs="*", default=[], help="hex colours always in the palette")
    p.add_argument("--base", type=Path, default=None,
                   help="use this sprite's exact colours instead of k-means (plus --extra new colours)")
    p.add_argument("--extra", type=int, default=0)
    q = sub.add_parser("apply")
    q.add_argument("dir", type=Path)
    q.add_argument("--palette", type=Path, required=True)
    q.add_argument("--out", type=Path, required=True)
    q.add_argument("--headlock", type=int, default=0, help="rows of head to lock to frame 0 (0=off)")
    q.add_argument("--stripes", default="", help="Y0:Y1 rows (from the figure's top) to pinstripe, e.g. 17:34")
    q.add_argument("--stripe-color", default="#7C8AA8")
    q.add_argument("--stripe-every", type=int, default=3)
    q.add_argument("--keep-outline", action="store_true", help="do not recolour edge pixels (art already has its outline)")
    q.add_argument("--lock-rows", type=int, default=0,
                   help="copy canvas rows [0, N) from frame 0 into every frame, no bob (head+hands+bat stay still)")
    rg = sub.add_parser("region", help="zombie: match classify() regions to a reference frame, drop stray blobs")
    rg.add_argument("dir", type=Path)
    rg.add_argument("--ref", type=Path, required=True, help="reference sprite frame (RGBA)")
    rg.add_argument("--parts", nargs="*", default=[], help="regions to re-map, e.g. pants")
    rg.add_argument("--only", nargs="*", default=None, help="frame names (e.g. 00 01 02) to re-map; default all")
    rg.add_argument("--keep-largest", action="store_true")
    rg.add_argument("--out", type=Path, required=True)
    h = sub.add_parser("harmonize", help="match jersey colours + number 7 to a reference action")
    h.add_argument("dir", type=Path)
    h.add_argument("--ref", type=Path, required=True, help="reference action dir (e.g. idle frames)")
    h.add_argument("--feet", type=int, default=61)
    h.add_argument("--ref-feet", type=int, default=61)
    h.add_argument("--no-seven", action="store_true")
    h.add_argument("--stripe-pattern", default="", help='refill stripes on plain jersey white, e.g. "10100"')
    h.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()

    if a.cmd == "region":
        ref = Image.open(a.ref).convert("RGBA")
        a.out.mkdir(parents=True, exist_ok=True)
        for f in load_frames([a.dir]):
            im = Image.open(f).convert("RGBA")
            if a.only is None or f.stem in a.only:
                for part in a.parts:
                    im = match_region(im, ref, part)
            if a.keep_largest:
                im = keep_largest(im)
            im.save(a.out / f.name)
        print(f"region -> {a.out}")
        return

    if a.cmd == "harmonize":
        files = load_frames([a.dir])
        imgs, info = harmonize([Image.open(f).convert("RGBA") for f in files],
                               [Image.open(f).convert("RGBA") for f in load_frames([a.ref])],
                               a.feet, a.ref_feet, not a.no_seven, stripe_pattern=a.stripe_pattern)
        a.out.mkdir(parents=True, exist_ok=True)
        for f, im in zip(files, imgs):
            im.save(a.out / f.name)
        (a.out / "harmonize.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
        print(json.dumps(info))
        return

    if a.cmd == "downscale":
        scale = a.scale
        if a.ref_height:
            size = a.ref_size or Image.open(a.frames[0]).width
            scale = M_HEIGHT8 / (a.ref_height * 512 / size)  # in 512 space for a 512 source
        info = downscale(a.frames, a.out, scale, a.align, a.height, a.foot_row,
                         a.fixed_foot, a.fixed_center, a.drop_warm)
        print(json.dumps({"frames": len(info), "scale512": info[0]["scale512"]}))
    elif a.cmd == "palette":
        if a.base:
            pal = palette_from_image(a.base, a.dirs, a.extra, a.out)
        else:
            pal = build_palette(a.dirs, a.k, a.out, a.dark_l, a.reserve)
        print(f"{len(pal)} colours -> {a.out}")
    else:
        pal = np.array(Image.open(a.palette).convert("RGB")).reshape(-1, 3)
        files = load_frames([a.dir])
        imgs = [cleanup(quantize(Image.open(f), pal), pal, outline=not a.keep_outline) for f in files]
        if a.stripes:
            y0, y1 = (int(v) for v in a.stripes.split(":"))
            sc = hex_rgb(a.stripe_color)
            if not (pal == sc).all(1).any():
                raise SystemExit(f"stripe colour {a.stripe_color} is not in the palette (add it with --reserve)")
            imgs = [draw_stripes(im, pal, (y0, y1), sc, a.stripe_every) for im in imgs]
        if a.headlock:
            imgs = headlock(imgs, a.headlock, imgs[0])
        if a.lock_rows:
            ref = np.array(imgs[0])
            locked = []
            for im in imgs:
                arr = np.array(im)
                arr[: a.lock_rows] = ref[: a.lock_rows]
                locked.append(Image.fromarray(arr, "RGBA"))
            imgs = locked
        a.out.mkdir(parents=True, exist_ok=True)
        for f, im in zip(files, imgs):
            im.save(a.out / f.name)
        cols = set()
        for im in imgs:
            arr = np.array(im).reshape(-1, 4)
            cols |= {tuple(c) for c in arr[arr[:, 3] > 0][:, :3]}
        print(f"{len(imgs)} frames, {len(cols)} colours used")


if __name__ == "__main__":
    main()
