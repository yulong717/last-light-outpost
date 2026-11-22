"""
把 PixelLab 產生的隊員底圖（art/source/crew_bases/<id>.png，每張 64×64、和主角同姿勢）
排成一條精靈圖，並自動標出部位遮罩（編碼同 make_player_regions.py：R = 部位 × 16）。

遊戲執行時（src/art/crewPaint.ts）依遮罩換膚色、髮色、衣褲顏色，再疊配件。
底圖的順序與設定在 src/data/crewBases.ts 的 CREW_BASES，兩邊要一致。

用法：python3 tools/art/make_crew_bases.py [--preview]
輸出：public/assets/sprites/crew_bases.png、crew_bases_regions.png
"""
import sys
from collections import Counter
from PIL import Image

SRC = 'art/source/crew_bases/{}.png'
OUT = 'public/assets/sprites/crew_bases.png'
OUT_MASK = 'public/assets/sprites/crew_bases_regions.png'

NONE, OUTLINE, HAIR, SKIN, BAND, JACKET, PANTS, BOOTS, KNEE, GUN, FLASH, DETAIL, GEAR = range(13)

# 順序要和 src/data/crewBases.ts 一致；第二欄：頭上本來就戴著帽子（不換髮色、不再疊帽子）
BASES = [
    ('trench', False), ('hoodie', False), ('bruiser', False), ('teen', False),
    ('doctor', False), ('police', True), ('worker', True), ('granny', False),
    ('punk', False), ('soldier', True), ('office', False), ('track', False),
    ('overalls', False), ('oldcoat', False),
    ('fatman', False), ('tinyold', False), ('tall', False), ('muscle', False),
]


def lum(p):
    return (p[0] + p[1] + p[2]) / 3


def neutral(p):
    return abs(p[0] - p[2]) < 16 and abs(p[0] - p[1]) < 16


def warm_skin(p):
    """膚色：偏紅黃的色相、中等飽和度、不太暗"""
    r, g, b = p[:3]
    mx, mn = max(r, g, b), min(r, g, b)
    if mx < 70 or mx == mn or r != mx:
        return False
    sat = (mx - mn) / mx
    hue = 60 * ((g - b) / (mx - mn))  # 紅色為 0，往黃色增加
    return 0 <= hue <= 42 and 0.18 <= sat <= 0.8


def frequent(pixels, share=0.85):
    """依出現次數排序，取累積佔比 share 的顏色"""
    cnt = Counter(pixels)
    total = sum(cnt.values()) or 1
    out, acc = set(), 0
    for col, n in cnt.most_common():
        if acc / total >= share:
            break
        out.add(col)
        acc += n
    return out


def classify(im, hat):
    W, H = im.size
    px = im.load()
    part = [[NONE] * W for _ in range(H)]
    rgb = lambda x, y: px[x, y][:3]
    solid = lambda x, y: px[x, y][3] > 0

    for y in range(H):
        for x in range(W):
            if not solid(x, y):
                continue
            p = px[x, y]
            if lum(p) < 18:
                part[y][x] = OUTLINE
            elif x >= 40 and 12 <= y <= 31 and neutral(p):
                part[y][x] = GUN

    # 膚色：臉與手的暖色當種子，同色的像素都算皮膚（短褲露出的腿也會跟著換）
    seeds = set()
    for y in range(4, 28):
        for x in range(16, 41):
            if solid(x, y) and part[y][x] == NONE and warm_skin(px[x, y]):
                seeds.add(rgb(x, y))
    for y in range(15, 38):
        for x in range(38, W):
            if solid(x, y) and part[y][x] == NONE and warm_skin(px[x, y]):
                seeds.add(rgb(x, y))
    for y in range(H):
        for x in range(W):
            if solid(x, y) and part[y][x] == NONE and rgb(x, y) in seeds:
                if y <= 27 or x >= 37 or y >= 44:
                    part[y][x] = SKIN

    # 頭髮（或帽子）：頭頂幾列的顏色
    top_cols = [rgb(x, y) for y in range(0, 12) for x in range(10, 42) if solid(x, y) and part[y][x] == NONE]
    hair_cols = frequent(top_cols, 0.95)
    head_bottom = 27
    for y in range(0, head_bottom + 1):
        for x in range(0, 41):
            if not solid(x, y) or part[y][x] != NONE:
                continue
            if rgb(x, y) in hair_cols:
                # 眼睛那幾列、左右都夾著皮膚的深色點是眼睛，不是頭髮
                if 12 <= y <= 22 and any(part[y][x - k] == SKIN for k in (1, 2)) and any(part[y][x + k] == SKIN for k in (1, 2)):
                    part[y][x] = DETAIL
                else:
                    part[y][x] = GEAR if hat else HAIR
            elif y <= 24:
                part[y][x] = DETAIL

    # 衣褲：胸口區塊的常見色 = 上衣，大腿區塊的常見色 = 褲子
    # 每個顏色看它在哪一區比較常見（依區塊大小正規化）
    top = Counter(rgb(x, y) for y in range(28, 42) for x in range(18, 37) if solid(x, y) and part[y][x] == NONE)
    bottom = Counter(rgb(x, y) for y in range(47, 57) for x in range(12, 42) if solid(x, y) and part[y][x] == NONE)
    tt, tb = sum(top.values()) or 1, sum(bottom.values()) or 1
    for y in range(0, H):
        for x in range(0, W):
            if not solid(x, y) or part[y][x] != NONE:
                continue
            c = rgb(x, y)
            ft, fb = top[c] / tt, bottom[c] / tb
            if y >= 58:
                part[y][x] = BOOTS
            elif ft == 0 and fb == 0:
                part[y][x] = DETAIL
            elif y >= 46 and fb > 0:
                part[y][x] = PANTS  # 腿部：只要在大腿區出現過就算褲子
            elif y < 44 and ft > 0:
                part[y][x] = JACKET
            elif ft >= fb:
                part[y][x] = JACKET
            else:
                part[y][x] = PANTS
    return part


def main():
    preview = '--preview' in sys.argv
    n = len(BASES)
    sheet = Image.new('RGBA', (64 * n, 64), (0, 0, 0, 0))
    mask = Image.new('RGBA', (64 * n, 64), (0, 0, 0, 0))
    pal = [(0, 0, 0), (40, 40, 40), (255, 0, 255), (255, 200, 150), (0, 255, 255), (255, 120, 0),
           (0, 80, 255), (120, 60, 0), (180, 180, 180), (0, 255, 0), (255, 255, 0), (255, 0, 0), (140, 255, 140)]
    prev = Image.new('RGBA', (64 * n, 128), (60, 64, 72, 255))
    for i, (bid, hat) in enumerate(BASES):
        im = Image.open(SRC.format(bid)).convert('RGBA')
        assert im.size == (64, 64), (bid, im.size)
        part = classify(im, hat)
        sheet.paste(im, (i * 64, 0))
        for y in range(64):
            for x in range(64):
                if im.getpixel((x, y))[3]:
                    k = part[y][x]
                    mask.putpixel((i * 64 + x, y), (k * 16, 0, 0, 255))
                    if preview:
                        prev.putpixel((i * 64 + x, 64 + y), pal[k] + (255,))
        if preview:
            prev.alpha_composite(im, (i * 64, 0))
    sheet.save(OUT)
    mask.save(OUT_MASK)
    if preview:
        prev.resize((prev.width * 3, prev.height * 3), Image.NEAREST).save('crew_bases_preview.png')
    print('bases:', n)


if __name__ == '__main__':
    main()
