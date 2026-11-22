"""
把主角射擊圖（player_shoot.png，3 格 64×64）的每個像素標上「部位」，輸出部位遮罩圖。
遊戲執行時（src/art/CrewArt.ts）依遮罩替 NPC 換膚色、髮色、衣褲顏色，再疊上帽子、眼鏡等配件。

遮罩編碼：R 通道 = 部位編號 × 16，其餘通道 0；透明像素 alpha = 0。
用法：python3 tools/art/make_player_regions.py  （輸出 public/assets/sprites/player_shoot_regions.png）
"""
import sys
from PIL import Image

SRC = 'public/assets/sprites/player_shoot.png'
OUT = 'public/assets/sprites/player_shoot_regions.png'

NONE, OUTLINE, HAIR, SKIN, BAND, JACKET, PANTS, BOOTS, KNEE, GUN, FLASH, DETAIL = range(12)


def classify(p, x, y, f):
    r, g, b, a = p
    if a == 0:
        return NONE
    lum = (r + g + b) / 3
    if lum < 15:
        return OUTLINE
    if lum > 215 and x < 40:
        return DETAIL  # 眼白反光
    neutral = abs(r - b) < 14 and abs(r - g) < 14
    warm = r - b > 60
    # 開火火光（第 1 格槍口右側的亮黃色）
    if r > 200 and g > 120 and b < 120 and x >= 50:
        return FLASH
    if r > 230 and g > 200 and b > 180 and x >= 50:
        return FLASH
    if neutral:
        if y >= 57:
            return BOOTS
        if y >= 46:
            return KNEE
        if x <= 39 and y <= 23:
            return HAIR
        return GUN
    # 第 2 格往後飛的彈殼
    if f == 2 and x < 17 and 20 <= y <= 30:
        return DETAIL
    # 臉、手：亮的膚色
    if y < 26 and x >= 19 and warm and lum > 95:
        return SKIN
    if x >= 38 and 22 <= y <= 36 and lum > 85:
        return SKIN  # 前手 / 後手
    if y <= 24:
        if 16 <= y and x >= 20 and lum < 60:
            return DETAIL  # 眉毛、眼睛
        if 19 <= x and 16 <= y and lum >= 60:
            return SKIN  # 臉部陰影
        return BAND
    if y >= 57:
        return BOOTS
    if y >= 45:
        return PANTS
    return JACKET


def main():
    src = Image.open(SRC).convert('RGBA')
    out = Image.new('RGBA', src.size, (0, 0, 0, 0))
    frames = src.width // 64
    for f in range(frames):
        for y in range(64):
            for x in range(64):
                p = src.getpixel((f * 64 + x, y))
                k = classify(p, x, y, f)
                if p[3]:
                    out.putpixel((f * 64 + x, y), (k * 16, 0, 0, 255))
    out.save(OUT)
    if len(sys.argv) > 1:
        pal = [(0, 0, 0), (40, 40, 40), (255, 0, 255), (255, 200, 150), (0, 255, 255), (255, 120, 0),
               (0, 80, 255), (120, 60, 0), (180, 180, 180), (0, 255, 0), (255, 255, 0), (255, 0, 0)]
        prev = Image.new('RGBA', src.size, (255, 255, 255, 255))
        for y in range(src.height):
            for x in range(src.width):
                m = out.getpixel((x, y))
                if m[3]:
                    prev.putpixel((x, y), pal[m[0] // 16] + (255,))
        both = Image.new('RGBA', (src.width, src.height * 2), (255, 255, 255, 255))
        both.paste(src, (0, 0), src)
        both.paste(prev, (0, src.height))
        both.resize((both.width * 5, both.height * 5), Image.NEAREST).save(sys.argv[1])


if __name__ == '__main__':
    main()
