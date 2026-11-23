# 測試規格：阿凱 ＋ 一般霧屍

## 1. 畫布與比例（所有角色共用，不可改）

| 項目 | 規格 |
| --- | --- |
| 遊戲內單格 | **64×64 px**，RGBA 透明背景 |
| 生成尺寸 | **512×512**（剛好 8 倍），洋紅 `#FF00FF` 平塗背景 |
| 視角 | 純側面，面向**右**，固定鏡頭、不縮放、不平移 |
| 腳底基準線 | **y = 61**（8 倍空間 = 488）。站立／走路時支撐腳的最低不透明像素落在這一行 |
| 身體中線 | **x = 32**（8 倍空間 = 256）。攻擊可往前伸，但軀幹中線維持 |
| 體型 M 站姿高度 | **56 px**（頭頂到腳底，含帽子不超過 58） |
| 頭高 | 約 14 px（約 4 頭身） |
| 外框 | 1 px 深色外框（selout：依相鄰色加深，不要全黑） |
| 光源 | 左上，暗面在右下 |
| 調色盤 | 每個角色 ≤ 16 色（不含透明），該角色所有動作共用 |

參考：`art/ai/refs/canvas_guide_x8.png`（綠線 = 腳底線、藍線 = 中線、白線 = M 頭頂、黃 S/橘 L/紅 XL）。

現況對照：目前主角約 60 px 高、霧屍約 57 px，新規格統一為 M = 56 px（比例問題就是從這裡解決）。

## 2. M 體型人台（第一個要做的東西）

目的：所有 M 體型角色都在同一個人台上換裝，頭身比由人台決定，不由 AI 決定。

1. 以 `art/ai/refs/akai_body_teen_x8.png` 為起點（現有 teen 底圖，60 px 高）。
2. 用 Qwen-Image-Edit 生成「無臉、灰色、無衣物細節的側面人台」，再縮放校正到 56 px 高、腳底 y=61、中線 x=32。可以手動用 Pillow 調整比例後再讓模型重畫乾淨。
3. 輸出：`art/ai/mannequins/M/stand.png`（512 與 64 各一）。
4. **姿勢模板**：用同一個人台做各動作的關鍵姿勢（見第 4 節表格的「模板」欄），存 `art/ai/mannequins/M/<action>_<n>.png`。做法任選：
   - 從 Wan 對人台生成的影片挑格；
   - 用 Qwen-Image-Edit「把人台改成 XX 姿勢」逐張生成；
   - 從現有 sprite（`player_reload.png`、`zombie_*.png`）放大 8 倍當姿勢參考。
5. 驗收：所有模板疊在一起，腳底線與頭頂線對齊（自動產生疊圖檢查）。

## 3. 兩個角色

詳細清單在 `art/ai/characters/akai.yaml`、`art/ai/characters/zombie_basic.yaml`。

### 阿凱（主角，M 體型）

- 高中棒球隊員，十幾歲男生，瘦。
- 白色球衣、**藍灰色細直條紋**，胸前**紅色背號 7**；深藍棒球帽；紅色護腕；深色長褲、運動鞋。
- 現有外觀在 `src/art/HeroArt.ts`（以 `teen` 底圖＋程式加條紋、背號、帽子）。新版要一眼認得出是同一個人。
- **持槍動作要做「無手臂版」**：遊戲的 WeaponRig（`src/entities/WeaponRig.ts`）會擦掉手臂、用程式畫手臂和槍。近戰、受擊、死亡才畫完整手臂。

### 一般霧屍（basic，M 體型）

- 一般市民變成的霧屍：灰綠膚色、破爛襯衫與長褲、駝背前傾、手往前伸、拖步。
- 參考 `art/ai/refs/zombie_basic_walk0_x8.png`（現有走路第 0 格）。
- 衣服盡量用**中性灰／米色大色塊**：遊戲的 `src/art/ZombieComposer.ts` 會在執行期換膚色、衣色、加制服花紋，色塊越乾淨越好換。

## 4. 動作清單

| 角色 | 動作 | 格數 | 循環 | 主要方法 | 模板 |
| --- | --- | --- | --- | --- | --- |
| 阿凱 | idle | 4 | ✓ | Wan（首尾同幀） | stand |
| 阿凱 | walk | 8 | ✓ | Wan | — |
| 阿凱 | run | 8 | ✓ | Wan | — |
| 阿凱 | aim（無手臂） | 2 | ✓ | Qwen Edit 換人 | aim_1–2 |
| 阿凱 | shoot（無手臂，後座） | 3 | — | Qwen Edit 換人 | shoot_1–3 |
| 阿凱 | melee（揮球棒） | 6 | — | Qwen Edit 換人（+ Wan 補格） | melee_1–6 |
| 阿凱 | hit | 3 | — | Qwen Edit 換人 | hit_1–3 |
| 阿凱 | death | 8 | — | Qwen Edit 關鍵格 + Wan 首尾幀補格 | death_1,4,8 |
| 霧屍 | walk（拖步） | 8 | ✓ | Wan | — |
| 霧屍 | attack（抓咬） | 6 | — | Qwen Edit 換人 | attack_1–6 |
| 霧屍 | hit | 3 | — | Qwen Edit 換人 | hit_1–3 |
| 霧屍 | death | 9 | — | 同阿凱 death | death_1,5,9 |

播放速度：循環 10 fps、攻擊 12 fps、死亡 10 fps。

**每個動作 A、B 兩條路線都跑**（設定稿與動作）：

| 步驟 | 路線 A | 路線 B |
| --- | --- | --- |
| 設定稿（人台換裝） | Qwen-Image-Edit-2511 ＋ Lightning；可先用 FLUX.2 klein + 像素 LoRA 出概念圖當參考 | H3 Image（Picture 1 = 角色參考、Picture 2 = 人台） |
| 循環動作 | Wan 2.2 I2V ＋ lightx2v ＋ 像素動畫 LoRA | H3 影片 I2V（首尾幀） |
| 短動作 | Qwen Edit（角色 + 姿勢模板） | H3 Image（角色 + 姿勢模板） |

後處理兩條路線完全一樣，才能公平比較。

## 5. 提示詞基準（英文，依模型微調）

共同部分：

```
pixel art game sprite, full body, strict side view facing right, flat colors, clean 1px dark outline,
simple shapes, readable silhouette, limited palette, solid magenta background (#FF00FF),
static camera, no shadow on ground, no text
```

設定稿（Edit 模型）：

```
Redraw the character from Picture 1 onto the exact body, pose, size and position of Picture 2.
Keep Picture 2's proportions, head size, foot position and outline exactly. Change only clothing, hair, face and colors.
```

循環動作（影片模型）：

```
the character walks in place, side view facing right, static camera, the character stays in the center,
full body visible, magenta background, smooth loop
```

短動作（Edit 模型）：

```
Redraw the character from Picture 1 in the exact pose of Picture 2. Keep Picture 1's clothes, colors and face.
Keep Picture 2's pose, size and foot position exactly.
```

## 6. 後處理（寫成 `tools/art/ai/` 的腳本，兩條路線共用）

1. **挑格** `pick_frames.py`：循環動作依步態（腳最高、雙腿最開）挑出規定格數，且首尾能接；短動作依模板相似度。
2. **去背** `pixelize.py`：洋紅色相鍵（hue 接近 300°、高飽和）→ 透明；邊緣殘留洋紅改成相鄰色。效果差才用 BiRefNet `toonout`。
3. **對齊**：在 512 空間把支撐腳底對到 y=488、軀幹中線對到 x=256。整個動作用同一個縮放比例（以 idle 第 0 格的身高 = 448 px 為準，不可每格各自縮放）。
4. **縮小**：÷8 k-centroid（每 8×8 區塊取主要顏色，不要平均）→ 64×64。
5. **調色盤**：收集該角色所有動作的像素，OKLab k-means 取 ≤16 色，全部格套同一組，避免閃色。
6. **清理**：去除孤立單點、外框修成 1 px、補外框斷點；走路時頭部若變形，用 idle 頭部覆蓋（headlock）。
7. **輸出** `build_sheet.py`：
   - `art/ai/out/<route>/<character>/<action>.png`：橫向 strip，每格 64×64
   - 同名 `.json`：`{frameWidth:64, frameHeight:64, frames:N, fps, loop}`
   - `contact_<action>.png`：放大 4 倍、疊腳底線與中線
   - `<action>.gif`：放大 4 倍預覽
   - `meta.json`：模型、LoRA、seed、步數、提示詞、耗時

## 7. 驗收標準

每項在 `REPORT.md` 打勾或寫明沒過的原因：

- [ ] 阿凱與霧屍並排（`compare_lineup.png`），頭頂線、腳底線一致（誤差 ≤ 1 px）
- [ ] 所有格的支撐腳都在 y=61，循環動作播放時不上下抖、不左右飄
- [ ] 每個角色 ≤ 16 色，播放不閃色
- [ ] 放大 4 倍看：外框連續、沒有孤立雜點、沒有殘留洋紅
- [ ] 阿凱認得出：條紋球衣、紅色 7 號、深藍帽
- [ ] 無手臂版的肩膀位置在各格一致（WeaponRig 才接得上）
- [ ] 每個動作的姿勢讀得懂（縮回 64 px、1 倍大小時仍看得出在做什麼）
- [ ] A、B 兩條路線各有一份完整結果與比較表（品質 1–5 分、每個動作耗時、重抽次數、VRAM 峰值）
- [ ] 估算：照此流程做完 18 個隊員＋3 主角＋7 種霧屍要多少時間
