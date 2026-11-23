# 阿凱鋁棒三段連擊影格（第六輪）

遊戲裡鋁棒已經改成三段連擊，每一段的速度、範圍、判定都不一樣（數值在 `src/data/weapons.ts` 的 `bat.steps`）。第 1 招已經有影格（`akai_ai_melee.png`），第 2、3 招目前是借第 1 招的格子重新排順序暫代。這一輪要補上第 2、3 招的專屬影格。

| 招 | 名稱 | 動作 | 起手／出手／收招（秒） |
| --- | --- | --- | --- |
| 1 | 左揮 | 現有 `akai_ai_melee.png` | 0.14 / 0.10 / 0.30 |
| 2 | 右揮 | 球棒揮過頭之後，借反彈力道反手往回掃，身體跟著轉回來（最快、範圍最短） | 0.07 / 0.08 / 0.26 |
| 3 | 下揮 | 雙手把球棒高舉過頭、身體後仰蓄力，往前跨一步劈到前方地面（最慢、最遠） | 0.24 / 0.12 / 0.50 |

## 要交的東西

- `akai_ai_melee2.png`、`akai_ai_melee3.png`：各 **6 格、64×72**，規格和 `akai_ai_melee.png` 完全一樣（朝右、腳底第 69 列、舊版形象、同一套調色盤、手和球棒畫在影格裡）
- 每招的 6 格排法固定：0–1 起手、2 命中格（球棒打到正前方）、3 揮到底、4–5 收招回到備戰姿勢
- 簡易 GIF 就好（3 倍、12 fps），三招接起來播一次
- 遊戲裡揮棒不再轉動貼圖，身體的前傾、後仰、轉身都要畫在影格裡

推到 `ai-art/test-01` 的 `art/ai/out/akai_combo/`，雲端這邊放進 `public/assets/sprites/` 並載入；程式已經會依檔名自動改用專屬影格。

## 生成方式：H3 首尾幀把三招串起來

每一招的首幀就是上一招的最後動作，這樣接起來最順：

- 第 2 招：首幀＝`akai_ai_melee.png` 第 3 格（揮過頭），尾幀＝第 5 格（備戰）。提示詞方向：backhand return swing with a baseball bat, swinging back across the body, side view, fixed camera, plain magenta background, pixel art
- 第 3 招：首幀＝第 2 招第 3 格，尾幀＝備戰。提示詞方向：raises the bat high overhead with both hands, leans back, steps forward and smashes it down to the ground in front, side view, fixed camera, plain magenta background, pixel art

後處理和第四輪的揮擊影格相同。
