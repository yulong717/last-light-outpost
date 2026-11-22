# 美術與動畫流程

目標：在不花錢的前提下，讓 64×64 像素角色「看起來很生動」。
做法是 **少量手繪/AI 影格 + 大量程式化動態**：影格負責姿勢，程式負責重量感與打擊感。

## 目前在遊戲裡的東西

| 效果 | 做法 | 程式位置 |
| --- | --- | --- |
| 三種霧屍各自的配色與體型 | Python 調色盤替換＋加寬（不靠遊戲內 tint） | `tools/art/make_zombie_variants.py` |
| 霧屍職業制服、隨機膚色衣色、頭飾、背包、血跡 | 執行期換色＋程式畫圖樣，頭飾疊圖（見 docs/ZOMBIES.md） | `src/art/ZombieComposer.ts` |
| 霧屍攻擊動作（蓄力、前撲） | 從走路影格逐列位移上半身，產生 2 格 | 同上 |
| 受擊閃白＋擠壓伸展＋後仰 | `setTintFill` + scale 補間 + 逐漸回正的角度 | `src/entities/Zombie.ts`、`src/fx/Fx.ts` `squash()` |
| 卡肉（hit-stop） | 擊殺時整個戰場停 25–55ms | `Fx.freeze()`，`DefenseScene` 的 dt 乘上 `fx.timeScale` |
| 噴血、落地成血跡 | 自寫小物理，每顆血滴有自己的地面 y，落地蓋章到 RenderTexture | `Fx.blood()`、`Fx.stain()` |
| 爆頭斷頭 | 從精靈圖切出 `head_N` 影格飛出去，屍體用 `setCrop` 切掉頭 | `registerHeadFrames()`、`Fx.fall()` |
| 程式化倒地 | 複製當下影格成屍體，以腳底為軸轉 90° + Bounce 緩動，落地揚塵、變暗、7 秒後淡出 | `Fx.fall()` |
| 拋殼、槍口煙 | 彈殼彈跳後停在地上；抖色煙往上散 | `Fx.ejectShell()`、`Fx.muzzleSmoke()` |
| 路障損壞階段＋木屑 | 程式逐像素畫 3 格（完好/破損/快垮） | `src/art/ProceduralArt.ts` |
| 腳下影子 | 跟著角色的橢圓，為之後上下多路線（2.5D）做準備 | `Fx.attachShadow()` |
| 夜晚氣氛 | 灰燼粒子、兩層視差貼地霧、閃爍據點燈、抖色暗角 | `src/fx/Atmosphere.ts` |

| 霧屍中槍倒地（9 格） | PixelLab PixMiniMax（免費帳號可用），以走路第 0 格為起始影格；非爆頭擊殺播放 | `art/source/zombie_death.png` → 腳本合併進三種霧屍 |
| 每把槍／近戰武器的手持圖、圖示、掉落彈匣、彈殼、槍口火光 | 字串像素圖（只畫填色，外框自動），部件化（滑套、彈匣、槍管、上蓋） | `src/art/weaponMaps.ts`、`src/art/WeaponArt.ts` |
| 主角與隊員手持武器、換彈與揮擊動作 | 角色圖擦掉手臂（`stripArms`），程式畫手臂並以握把為軸旋轉武器；5 種換彈動作 | `src/entities/WeaponRig.ts`（說明見 docs/WEAPONS.md） |

所有特效貼圖都在 `src/fx/FxTextures.ts` 用程式畫，沒有額外美術檔。
碎片和血跡都以「被打中那隻的腳底 y」當地面，所以改成上下移動的多路線後不用改。

## 隊員底圖（18 個不同的人）

- 來源：`art/source/crew_bases/<id>.png`，PixelLab「Image to image」以主角射擊第 0 格為參考（AI freedom 100～400、Init Image Strength 200、透明背景）。
  這個工具會鎖住參考圖輪廓：臉、髮型、服裝會變，**胖瘦高矮不會變**，所以體型改由 `crewPaint.ts` 的加寬、啤酒肚、駝背與縮放來做。
- `python3 tools/art/make_crew_bases.py [--preview]` 排成 `public/assets/sprites/crew_bases.png` 並自動標部位遮罩；順序要和 `src/data/crewBases.ts` 一致。
- 免費額度有限：要加新底圖時，先把清單（id、描述、設定）寫好再一次生成，不要邊試邊改。

## 重新產生霧屍變體

```bash
pip install pillow
python3 tools/art/make_zombie_variants.py
```

來源圖在 `art/source/zombie_walk.png`（PixelLab 產生的 4 格走路）。
換掉來源圖或調整腳本裡的 `SCHEMES`（色相、飽和度倍率、明度倍率、加寬比例）就能做出新的霧屍種類。

## 免費工具與素材（2026-11 查證）

### 繪製與動畫工具

- **Aseprite**：原始碼公開，FAQ 允許**自行編譯、個人使用**，做出的圖可以商用；不能散布編譯好的程式。Phaser 內建 `this.load.aseprite()` + `anims.createFromAseprite()`，tag 直接變動畫，最順。<https://aseprite.org/faq>
- **Pixelorama**：MIT，Windows/Mac/Linux/網頁版，可匯出 spritesheet。
- **LibreSprite**：GPLv2，Aseprite 舊版分支。
- **Piskel**：Apache 2.0，網頁版即可用，匯出 PNG sheet 後用 `load.spritesheet` 按格切。
- 只有 PNG 時可用 Free Texture Packer 產生 Phaser 的 JSON atlas。

### AI 生成（有免費額度）

- **PixelLab**：試用約 40 次快速生成，之後每天少量慢速生成（第三方評測數字，未經官方確認）。有文字生成動畫、骨架動畫、4/8 方向。產出可商用；上 Steam 要填 AI 使用揭露。<https://www.pixellab.ai/docs/faq>
- **Retro Diffusion**：新帳號送少量點數；單圖生成 4–16 格動畫 sheet（Walk/Idle/Attack…），每次約 0.10–0.25 美元。產出可商用。<https://www.retrodiffusion.ai/>
- 其他有試用額度：Ludo、Sprite-AI、Sprixen、Scenario、Leonardo（免費版多半有浮水印或匯出限制）。

### 可商用的免費素材

- **Kenney**：CC0，不需標註。<https://kenney.nl/support>
- **CraftPix 免費區**：可商用、不需標註；不能轉賣原始檔、不能拿去訓練 AI。<https://craftpix.net/file-licenses/>
- **OpenGameArt / itch.io**：每個素材授權不同，用 CC0 篩選。可參考：
  - The Zombie Free Sprites（CC0）<https://opengameart.org/content/the-zombie-free-sprites>
  - Zombie Sprite（CC0）<https://opengameart.org/content/zombie-sprite>
  - Free 3 Zombies Pixelated Pack（頁面未寫明授權，使用前要確認）<https://free-game-assets.itch.io/free-zombie-sprite-sheet-pack-pixel-art>
  - ⚠️ `tutudalao.itch.io/zombie` 明寫禁止商用，不要用。
- **Lospec 調色盤**：可用 cc0 標籤篩選。<https://lospec.com/palette-list/tag/cc0>

### 骨骼動畫

- Spine 要付費；DragonBones 已改名 LoongBones，是否仍免費未確認。
- 建議維持 Phaser 原生：Tween + 粒子 + tint + 少量手繪影格，也就是本專案目前的做法。

## PixelLab 免費帳號的做法（實測 2026-11）

- 「Animate with text → V3」只限付費；**PixMiniMax（Beta）** 免費帳號可用，每次扣 1 次生成，4–40 格。
- 上傳 64×64 的角色單格當 First frame，描述動作，產出是 3×3（或更多）格的 PNG。
- 取回時要保持像素精確：在頁面上用 `image-rendering: pixelated` 放大成整數倍、洋紅色背景，截圖後每格取中心像素還原（本次 0 個不一致像素）。

## 下一步建議

1. 再用 PixMiniMax 補「受擊」「疾跑」影格，或用 Aseprite/Pixelorama 自己修。
2. 背景改成像素分層視差圖（遠景城市剪影、中景圍牆、近景地面），可用程式產生或 CC0 素材。
