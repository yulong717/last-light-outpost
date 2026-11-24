# 第六輪：主調色盤＋風格樣板圖（統一美術的第一步）

給本地 Claude Code 照著做。規格來源：[`docs/ART_STYLE_SPEC.md`](../ART_STYLE_SPEC.md)。這一輪只做「之後所有生成都要對齊的基準」，不換遊戲裡的圖。

## 1. 主調色盤 `art/ai/palette/master.gpl`

- 48 色＋8 色保留（血紅 2、火光 2、霧白 1、提示黃 1、UI 2），共 56 色。
- 起點：把現有 `akai_ai_idle.png`、`zombie_basic.png`、`art/ai/refs/zombie_basic_palette.png` 的顏色合併，用 OKLab k-means 收斂到 48 色，灰綠末日色調；最暗 L*≥8、最亮 L*≤90（高光點除外）。
- 輸出 `palette_swatch.png`（每色 16×16、標色號）。

## 2. 風格樣板圖 `art/ai/style/anchor.png`

一張 H3 Image 生成的同框圖，之後每次生成都當參考圖（Picture 1）。

| 內容 | 目標尺寸（px，64×64 格內，32 px = 1 m） |
| --- | --- |
| 阿凱（M 人台，3.5 頭身，頭 16） | 約 28×56 |
| 一般霧屍（M） | 56 高 |
| 木箱 | 21×19 |
| 油桶 | 19×28 |
| 路燈（只畫下半段到 64 高） | 寬約 14 |

規則：純側面、左上 45° 光、每個體積 3–4 階、1 px selout 外框（右下較深）、不畫落地影子、全部只用 master.gpl。

做法：H3 Image 512×512 洋紅底，參考圖放 `akai_ai_idle` 第 0 格（16 倍）、`zombie_basic` 第 0 格（16 倍）；物件用提示詞描述。生成 4 個 seed → 每張走既有後處理（÷8 縮小、對 master.gpl、清雜點、外框）→ 排成對照表。

## 3. 交付（推 `ai-art/test-01`，`REPORT.md` 加「第六輪」）

- `art/ai/palette/master.gpl`、`palette_swatch.png`
- `art/ai/style/anchor.png`（選定的 1 張，原尺寸）、`anchor_x4.png`、`anchor_seeds_x4.png`（4 個 seed 並排）
- `meta.json`：seed、提示詞、參考圖

## 4. 驗收

- [ ] 阿凱、霧屍腳底都在同一線，高度 56±1
- [ ] 每個物件都有外框，亮面都在左上
- [ ] 全部顏色都在 master.gpl 內（腳本檢查）
- [ ] 放進遊戲同框（雲端這邊做）看起來是同一個畫師
