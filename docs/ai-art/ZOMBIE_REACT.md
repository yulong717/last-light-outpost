# 第五輪：一般霧屍受擊、擊飛、爬起影格

給本地 Claude Code 照著做。遊戲裡的打擊手感已經用程式做好（見 `docs/HIT_FEEL.md`），這一輪只換掉霧屍「被打」的表現：現在受擊只會傾斜、倒地是整張圖轉 90°，要換成真正的動作影格。

## 1. 要交的東西

一張 `art/ai/out/zombie_basic/react.png`：**11 格橫排，每格 64×64**，透明底。

| 格 | 動作 | 內容 |
| --- | --- | --- |
| 0–2 | 受擊 hit | 頭往後甩 → 上身往後凹 → 回到快站直（第 2 格接回走路不突兀） |
| 3–4 | 擊飛 air | 被打離地：上身大幅後仰、雙腳離地往前踢，第 4 格身體接近水平 |
| 5–6 | 落地 land | 背部著地（第 5 格身體還有點彈起、第 6 格平躺），姿勢接近現有第 14 格 |
| 7–10 | 爬起 getup | 平躺 → 撐起上身坐起 → 單膝跪 → 站起（第 10 格接近走路第 0 格） |

另外交：
- `contact_react.png`：4 倍放大對照表（洋紅底），每格下面標格號
- `react.gif`：**簡易 GIF 就好**（3 倍放大、12 fps、只播一次再停 0.5 秒），不要 mp4
- `meta.json`：seed、提示詞、首尾幀、從影片挑的格號

推到 `ai-art/test-01`（同一個 PR），在 `art/ai/out/REPORT.md` 加「第五輪」一節。

## 2. 規格（一定要對，不然遊戲會換不了色）

遊戲的 `ZombieComposer` 會拿這張圖在執行期換膚色、上衣、褲子，做出幾十種霧屍。它是**看顏色分區**的，所以：

1. **朝右**，和 `public/assets/sprites/zombie_basic.png` 同方向。被打是從右邊（正面）打過來，所以往**左後方**倒，躺下時**頭在左、腳在右**（跟現有第 12–14 格一樣）。
2. **腳底線 y = 62**（站姿、跪姿的腳底；躺姿的背部貼在 y = 60–62）。
3. **大小和現有霧屍一樣**：站姿約 57 px 高。這一輪不套 3.5 頭身，沿用現有霧屍的比例。
4. **只用 `art/ai/refs/zombie_basic_palette.png` 裡的 70 色**（現有霧屍的全部顏色），後處理最後一步硬性對色。
5. 分區顏色要保住：
   - 上衣 = 淺灰白、幾乎沒彩度（HSV：s < 0.07、v > 0.58）
   - 褲子 = 藍灰（色相 165–230°、s > 0.15）
   - 皮膚 = 灰綠（色相 70–165°、s ≥ 0.07）
   - 外框 = 近黑（v < 0.11）
   
   交之前用 `tools/art/make_zombie_variants.py` 的 `classify()` 跑一次，輸出一張分區色塊圖（上衣白、褲子藍、皮膚綠、其他灰）一起交，確認沒有把皮膚分成上衣之類的錯。
6. 頭上不要畫帽子或頭髮以外的東西（頭飾是遊戲另外疊上去的）。

## 3. 生成方式：H3 影片首尾幀，分兩段

參考圖都在 `art/ai/refs/`：
- `zombie_basic_stand0_x8.png`：站姿（現有第 0 格）
- `zombie_basic_down13_x8.png`：倒地（現有第 13 格）
- `zombie_basic_all15_x4.png`：現有全部 15 格

**A 段：被打飛倒地**（得到第 0–6 格）
- 首幀＝站姿，尾幀＝倒地
- 提示詞方向：zombie is struck hard in the chest by a baseball bat from the right, head snaps back, knocked off its feet flying backward to the left, lands flat on its back, small bounce; side view, fixed camera, plain magenta background, pixel art
- 從 39–56 格裡挑：受擊 3 格（剛被打到那一段）、離地 2 格、落地 2 格

**B 段：爬起來**（得到第 7–10 格）
- 首幀＝倒地，尾幀＝站姿
- 提示詞方向：zombie lying on its back slowly pushes itself up, sits up, gets to one knee, stands up hunched; side view, fixed camera, plain magenta background, pixel art
- 挑 4 格

每段先跑 4 個 seed 出對照表，挑最好的再做後處理。後處理沿用阿凱的流程（洋紅去背、對腳底線、÷8 縮小、對色），只是調色盤換成霧屍的。

## 4. 驗收

- [ ] 11 格都朝右、腳底線對齊、站姿高度和現有第 0 格差 ≤ 2 px
- [ ] 分區色塊圖正確（上衣、褲子、皮膚三區完整，沒有雜點）
- [ ] 第 2 格、第 10 格和走路第 0 格放在一起看不會跳
- [ ] 第 6 格和現有第 14 格的躺姿方向一致（頭在左）
- [ ] GIF 看起來是「被打飛、彈一下、躺著、爬起來」一氣呵成

接進遊戲（替換程式化的傾斜與轉 90°、對上 `Zombie.launch` 的時間軸）由雲端這邊做。
