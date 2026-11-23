# 本地 AI 像素角色生成流程（ComfyUI + Claude Code）規劃

> 狀態：第一階段（資料搜集與規劃）完成，硬體已確認（RTX 5060 Ti 16 GB、64 GB RAM、Windows 11），待確認授權方向後進入第二階段「兩個角色全流程測試」。
> 資料查證日期：2026-11-23。模型更新很快，第二階段開工前要再確認一次版本。

> **要在本機開始測試？** 照 [`docs/ai-art/README.md`](ai-art/README.md) 的交接包做（給本地 Claude Code 讀）。

## 1. 要解決的問題

| 現況問題 | 原因 | 這套流程怎麼解 |
| --- | --- | --- |
| 動作不完整（缺跑、近戰、受擊、死亡…） | PixelLab 免費額度有限，只做了射擊 3 格、換彈 9 格、霧屍走路＋死亡 | 本地生成不限次數，可以反覆抽 seed |
| 比例不一致 | 每次生成都是獨立的，AI 自己決定頭身比；體型再靠程式拉伸 | 先定「體型模板（人台）」，所有角色都在模板上「換裝」，動作也從模板出發 |
| 效果普通、雜點多 | AI 圖直接縮小 → 糊、顏色多、外框不乾淨 | 固定的後處理：8 倍生成 → 格點縮小 → 共用調色盤 → 清雜點與外框 |

## 2. 名詞查證：「MiniMax image / H3」指的是什麼

查證結果：你說的應該是 **MiniMax H3** 系列，有兩個模型，都已開放權重、ComfyUI 原生支援。

| 模型 | 發布 | 能做什麼 | 檔案大小（最小版） | ComfyUI |
| --- | --- | --- | --- | --- |
| **MiniMax H3**（影片） | 2026-08-03 | 文字/圖片/參考圖轉影片、首尾幀控制、Pose/Depth ControlNet、動作轉移 | DiT `w6a8` 16 GB（另有 int8/fp8 21 GB、bf16 40 GB）、4 步 turbo LoRA | 0.30+，ControlNet 要 0.35+ |
| **MiniMax H3 Image**（圖片） | 2026-11-10 | 文生圖＋編輯同一個模型，最多 16 張參考圖（"Picture 1"…），用來鎖角色身分 | DiT `w4a8` 12.5 GB ＋ 文字編碼器 Qwen3-VL-32B NVFP4 15.7 GB | v0.45.0+ |

另一個可能的「H3」是騰訊 **HunyuanImage 3.x**：3.0 本地版是 83B 參數（社群 NF4 量化也非常吃資源），3.5 只有 API（雲端付費）。**不建議**用在這個專案。

### ⚠️ H3 授權是最大風險（必讀）

- H3 影片：在本地生成的圖要商用，若**你在美國/歐盟/英國/韓國以外、年營收 < 2000 萬美元**，可用免費社群授權，但要標「Powered by MiniMax H3」，而且**產出物被使用的地區也受同樣限制**。在上述四地使用要買授權（專業版每月 5,000 美元起）。
- 社群上已有作者因為這條限制，不公開 H3 產出（comfy-sprite-lab）。
- H3 Image 的授權全文本次未取得，條款可能類似，要再確認。
- **結論**：遊戲若要上 Steam 給全球玩家（含美國、歐盟），H3 的產出直接放進遊戲有風險。建議 **主力用 Apache-2.0 的模型（Qwen、Wan 2.2、FLUX.2 klein、Z-Image）**，H3 只當「找靈感、出設定稿」的輔助，或等授權確認後再升級。

## 3. 推薦的模型組合（全部可本地、可商用）

| 用途 | 主力 | 備案 / 低 VRAM | 授權 |
| --- | --- | --- | --- |
| 角色設計、換裝到人台 | **Qwen-Image-Edit-2511**（多參考圖、角色一致性強）＋ Lightning 4 步 LoRA | GGUF Q4/Q5（12 GB 可跑）；H3 Image（授權待確認） | Apache-2.0 |
| 像素風格出圖 | **FLUX.2 klein 4B ＋ pixel-art sprite LoRA**（4 步、直接透明背景） | Z-Image Turbo ＋ elusarca pixel LoRA | Apache-2.0 |
| 循環動作（走、跑、待機） | **Wan 2.2 I2V 14B（GGUF）＋ lightx2v 4 步 LoRA**，可加 `styly-agents/Wan2-2-pixel-animate` 像素動畫 LoRA | Wan 2.2 5B；H3 影片（授權風險） | Apache-2.0（LoRA 依 Wan 授權） |
| 短動作關鍵格（近戰、受擊、死亡） | **姿勢模板換人**：Qwen-Image-Edit 以「角色圖＋同比例的姿勢模板圖」重畫 | Wan 2.2 首尾幀補中間格 | Apache-2.0 |
| 去背 | 洋紅色底＋色相去背（最乾淨） | BiRefNet `toonout`（ComfyUI-RMBG） | MIT 等 |
| 像素化 | 自寫 Python：÷8 k-centroid、OKLab 調色盤 | ComfyUI-PixelArt-Detector | — |

不用的：AnyPose LoRA（官方寫明對像素/扁平風格失敗）、AI 放大器（會亂補細節）、Nano Banana 類雲端模板（付費，也沒有真正的像素格點）。

## 4. 統一角色規格（解決比例問題）

以目前遊戲為準：畫面 640×360、`pixelArt: true`、每格 64×64，現有主角約 60 px 高、霧屍 57–58 px 高。

### 4.1 畫布與錨點

| 項目 | 規格 |
| --- | --- |
| 單格尺寸 | **64×64**（不改，現有載入程式與 WeaponRig 都能沿用） |
| 生成尺寸 | 512×512（8 倍），角色在中央，洋紅 `#FF00FF` 平塗底 |
| 視角 | 純側面、面向右（左向用翻轉） |
| 腳底基準線 | y = 61（下方留 3 px 給影子與落地），所有動作的支撐腳都對齊這條線 |
| 水平錨點 | 身體中線 x = 32（攻擊動作可往前超出，但中線不動） |
| 外框 | 1 px 深色外框；可用 selout（外框依旁邊顏色變深，不是全黑） |
| 光源 | 左上；暗面固定往右下 |

### 4.2 體型等級（取代現在的程式拉伸）

| 等級 | 站姿高度 | 頭高 | 用在 |
| --- | --- | --- | --- |
| S 小 | 48 px | 14 px | 小孩、矮老人（tinyold） |
| M 標準 | **56 px** | 16 px（3.5 頭身） | 大部分主角、隊員、一般霧屍 |
| L 高大 | 60 px | 17 px | tall、soldier、bruiser |
| XL 巨漢 | 62 px，寬 1.4 倍 | 18 px | brute 霧屍、fatman |

做法：先做 **4 個無臉人台**（S/M/L/XL，各一張側面站姿＋各動作的姿勢模板），所有角色都「穿」在對應的人台上。AI 只決定衣服、髮型、臉，不決定頭身比。這就是 comfy-sprite-lab 用來鎖比例的方法。

### 4.3 調色盤

- 全遊戲一張主調色盤（建議 48 色內，可從 Lospec 選 CC0 的再微調成灰綠末日感）。
- 每個角色從主調色盤挑 ≤16 色；同一角色的所有動作共用同一組，避免閃爍。
- 霧屍膚色、血色固定幾個色號，方便 `ZombieComposer` 繼續做執行期換色。

## 5. 動作清單

格數以 Dead Ahead 那種「少格、重姿勢」的節奏為準，8–12 fps。

### 5.1 主角 / 隊員（人類）

| 動作 | 格數 | 循環 | 生成方式 | 備註 |
| --- | --- | --- | --- | --- |
| idle 待機 | 4 | ✓ | Wan 首尾同幀 | 呼吸起伏 |
| walk 走 | 8 | ✓ | Wan | 步態挑格 |
| run 疾跑 | 8 | ✓ | Wan | 身體前傾 |
| aim 持槍待機 | 2 | ✓ | 模板換人 | **無手臂版**，交給 WeaponRig 畫手臂與槍 |
| shoot 射擊後座 | 3 | — | 模板換人 | 無手臂版（身體後仰） |
| reload 換彈 | 沿用 WeaponRig | — | 程式 | 只需身體無手臂版 |
| melee 揮擊 | 6 | — | 模板換人 | 預備 2、出手 1、收招 3 |
| hit 受擊 | 3 | — | 模板換人 | 後仰＋閃白由程式加 |
| death 死亡 | 8 | — | 模板換人＋Wan 補格 | 現在是程式轉 90°，改成真的倒地 |
| downed 倒地求救（選做） | 4 | ✓ | 模板換人 | 配合救援事件 |

> 關鍵決策：目前槍械與手臂是 **WeaponRig 程式畫的**（`stripArms` 擦掉手臂再畫）。建議**保留**這套（換武器不用重畫角色），AI 只產「身體動作」；需要手的動作（近戰、受擊、死亡）才產完整手臂。

### 5.2 霧屍

| 動作 | 格數 | 備註 |
| --- | --- | --- |
| walk 走 | 8 | 現在只有 4 格 |
| run（runner 型） | 8 | |
| attack 抓咬 | 6 | 現在是程式位移 2 格 |
| hit 受擊 | 3 | |
| death 倒地 | 9 | 已有，用新規格重做 |
| headshot death | 6 | 斷頭格仍由程式切 |
| crawl 爬行（選做） | 6 | 斷腿 / 特殊種類 |

一個角色約 **50 格**。換算：主角 3 位＋隊員底圖 18 位＋霧屍 3 種，全部重做約 1,200 格，所以流程必須能批次跑、自動挑格、自動檢查。

## 6. 流程步驟

```
人台 (S/M/L/XL)
   │
① 角色設定稿 ── Qwen-Image-Edit「把 Picture 2 的人台換成 Picture 1 的角色」→ 512px 側面站姿（洋紅底）
   │                （可選：FLUX.2 klein + pixel LoRA 先出概念圖當 Picture 1）
   ▼
② 動作生成
   ├─ 循環動作：Wan 2.2 I2V，首幀＝設定稿（循環時尾幀也＝設定稿），45–81 幀
   └─ 短動作：Qwen-Image-Edit「角色 + 同體型姿勢模板」逐格重畫，必要時 Wan 補中間格
   ▼
③ 挑格 ── 依步態（腳抬最高、雙腿最開）或依模板相似度，自動挑出規定格數
   ▼
④ 去背對齊 ── 洋紅色相去背 → 依腳底基準線與中線對齊（全部 8 倍空間做）
   ▼
⑤ 像素化 ── ÷8 k-centroid 縮到 64×64 → 套角色 16 色調色盤（OKLab k-means，跨格穩定）
   ▼
⑥ 清理 ── 去孤立雜點、外框修成 1px、頭部鎖定（走路時頭不變形）、selout
   ▼
⑦ 輸出 ── 橫向 strip PNG（每格 64×64）＋ Phaser JSON，部位遮罩沿用 make_player_regions 的做法
   ▼
⑧ 檢查 ── 自動產生對照表（放大 4 倍＋疊上基準線）與 GIF，Claude 看圖判斷，不合格就換 seed 重跑
```

### 預計的 repo 結構

```
art/ai/
  mannequins/          人台與姿勢模板（S/M/L/XL）
  characters/<id>.yaml 角色清單：體型、描述、參考圖、要做的動作、seed
  palette/master.gpl   主調色盤
  workflows/           ComfyUI API 格式 JSON（design、wan_loop、pose_swap）
  raw/                 ComfyUI 原始輸出（不進 git）
tools/art/ai/
  run_comfy.py         送工作流到 ComfyUI /prompt、輪詢 /history、下載結果
  pick_frames.py       挑格
  pixelize.py          去背、對齊、縮小、調色盤、清理
  build_sheet.py       組 sheet、寫 JSON、產對照表與 GIF
```

## 7. Claude Code 怎麼驅動 ComfyUI

1. 你的電腦啟動 ComfyUI（本機 `127.0.0.1:8188`）。
2. 我用 Remote Control 在你電腦上開 Claude Code，連到這個 repo。
3. 連接方式二選一（建議 A）：
   - **A. 官方 `comfy-mcp`（Comfy-Org）**：`pip install comfy-mcp "comfy-cli>=1.14.0"`，`claude mcp add comfy-mcp …`。有 run_workflow、fetch_outputs、free_memory、download_model、install_node 等工具，可以幫你裝模型與節點。授權 AGPL-3.0（只是工具，不影響遊戲）。
   - **B. `artokun/comfyui-mcp`**：Claude Code 外掛，38 個工具＋42 個 skill（含 Wan、Qwen、Z-Image），有 VRAM 監控。MIT。
4. 不論用哪個，正式流程都用 **repo 裡的 Python 腳本＋API JSON 工作流**（可重現、可批次）；MCP 主要用來安裝、除錯、單張試圖。
5. Claude 看得懂圖片，所以第 ⑧ 步的對照表可以讓我自動判斷「比例有沒有跑掉、腳有沒有對齊、臉有沒有糊」，不合格自己換 seed。

## 8. 硬體需求

### 8.0 你的電腦：RTX 5060 Ti 16 GB ＋ 64 GB RAM ＋ Windows 11

- 落在下表「16 GB」那一級，**整套主力流程都能本地跑**；64 GB 記憶體讓大模型可以把一部分權重放到 RAM（offload），不會爆。
- 5060 Ti 是 Blackwell 架構（RTX 50 系）：要裝 **支援 CUDA 12.8 的 ComfyUI**（官方 Windows 可攜版或 ComfyUI Desktop 最新版即可），舊版 PyTorch 不支援 50 系。好處是原生支援 **NVFP4**，H3 Image 的 NVFP4 文字編碼器、各種 FP4/FP8 量化版會比較快。
- 建議設定：Qwen-Image-Edit-2511 用 fp8 或 GGUF Q6 ＋ Lightning 4 步；Wan 2.2 14B 用 fp8/GGUF Q5–Q6 ＋ lightx2v 4 步，解析度 512×512、49–81 幀；ComfyUI 啟動加 `--reserve-vram 1`。
- H3 Image（w4a8 DiT 12.5 GB ＋ NVFP4 文字編碼器 15.7 GB）需要讓兩者輪流載入，可以跑但較慢；H3 影片 w6a8（16 GB）會頂到上限，要靠 offload。
- 硬碟：準備一顆 SSD 留 150 GB。

### 8.1 各級顯卡參考

| 顯卡 VRAM | 能跑什麼 | 每個角色預估 |
| --- | --- | --- |
| 8 GB | FLUX.2 klein / Z-Image ＋ LoRA；Qwen Edit Q4（慢）；Wan 2.2 5B | 很慢，動作品質較差 |
| **12 GB**（如 3060 12G、4070） | Qwen Edit GGUF Q4–Q5 ＋ Lightning；Wan 2.2 14B GGUF Q4 ＋ 4 步 LoRA（社群實測約 3 分鐘/段） | 約 1–2 小時（含重抽） |
| 16 GB（4080、4060Ti 16G） | 上面全部更快；H3 影片 w6a8 勉強 | 約 1 小時 |
| 24 GB+（3090、4090、5090） | 全部舒適；H3 Image int8 | 30–45 分鐘 |

其他：系統記憶體 **32 GB 起跳**（64 GB 較穩）、硬碟預留 **150 GB**（模型約 80–100 GB）、NVIDIA 顯卡最好（AMD/Mac 很多節點不支援或很慢）、作業系統 Windows 或 Linux 都可以。

## 9. 第二階段：兩個角色全流程測試

| 測試角色 | 為什麼選它 |
| --- | --- |
| **阿凱**（主角，M 體型） | 有既定外觀（白條紋棒球衣、背號 7、深藍帽），可以測「換裝到人台後還認得出來」，也要接 WeaponRig |
| **一般霧屍**（M 體型） | 動作需求不同（拖步、抓咬、倒地），也測 ZombieComposer 換色是否還能用 |

步驟與預估時間：

1. 安裝 ComfyUI、節點、模型（半天，大多是下載時間）
2. 做 M 體型人台與姿勢模板（半天）
3. 兩個角色各跑完 idle / walk / run / melee(attack) / hit / death（1–2 天）
4. 接進遊戲替換現有圖，錄 GIF 前後對比（半天）

驗收標準：

- 兩個角色站在一起，頭身比、腳底線完全一致
- 每個動作播放不閃色、不抖動（同角色所有格 ≤16 色）
- 放大 4 倍看：外框連續、沒有孤立雜點
- 在遊戲裡實際播放，打擊感不比現在差
- 記錄每個步驟的時間與重抽次數，估算全部角色要花多久

## 10. 風險與替代方案

| 風險 | 可能性 | 對策 |
| --- | --- | --- |
| H3 授權限制商用地區 | 確定存在 | 主力用 Apache-2.0 模型；H3 只做參考 |
| 64 px 太小，臉糊成一團 | 高 | 設計時就用「大色塊、粗外框、簡化五官」提示詞；臉部 2–3 格交給清理腳本鎖定或手修 |
| 影片模型轉成 3/4 視角或鏡頭移動 | 中 | 提示詞鎖側面＋固定鏡頭；用像素動畫 LoRA；不合格直接換 seed |
| 跨格閃色 | 中 | 整個角色共用一組調色盤，加時間平滑 |
| 短動作（死亡、近戰）影片模型做不好 | 中 | 改用姿勢模板逐格重畫；最後手段用 Aseprite/Pixelorama 手修關鍵格 |
| 顯卡不夠 | 視規格 | 用 GGUF 量化與 4 步 LoRA；最差情況下把動作生成租雲端 GPU（按小時計費，比 PixelLab 月費便宜且無次數限制） |
| 新模型版本變動、節點壞掉 | 中 | 工作流 JSON 與模型版本寫進 repo，固定版本 |
| 上架 Steam 要揭露 AI 使用 | 確定 | 在商店頁照實填寫 |

## 11. 參考資料

- MiniMax H3 影片：<https://blog.comfy.org/p/minimax-h3-day-0-support-in-comfyui>、<https://docs.comfy.org/tutorials/video/minimax/minimax-h3>
- MiniMax H3 Image：<https://comfyui-wiki.com/models/minimax/minimax-h3-image>
- HunyuanImage 3：<https://huggingface.co/tencent/HunyuanImage-3.0>、<https://docs.comfy.org/tutorials/partner-nodes/tencent/hy-image-3-5>
- comfy-sprite-lab（人台＋Wan 走路＋÷8 像素化，最接近本規劃）：<https://github.com/themessie/comfy-sprite-lab>
- comfyui-2d-character-pipeline（設計給 Claude Code 驅動）：<https://github.com/mor-o/comfyui-2d-character-pipeline>
- SpriteForge（以模板 sprite sheet 換人）：<https://tantk.github.io/spriteforge-pipeline/blog>
- Qwen-Image-Edit-2511：<https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511>、GGUF：<https://huggingface.co/unsloth/Qwen-Image-Edit-2511-GGUF>、Lightning：<https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning>
- Wan 2.2：<https://docs.comfy.org/tutorials/video/wan/wan2_2>、像素動畫 LoRA：<https://huggingface.co/styly-agents/Wan2-2-pixel-animate>
- 像素 LoRA：<https://huggingface.co/limbicnation/pixel-art-lora>（FLUX.2 klein）、<https://huggingface.co/reverentelusarca/elusarca-pixel-art-style-lora-zimage-turbo>（Z-Image）
- 像素化：<https://aigaming.nuilab.org/workflows/pixel-perfect-output/>、ComfyUI-PixelArt-Detector
- 去背：<https://github.com/1038lab/ComfyUI-RMBG>
- Claude Code ↔ ComfyUI：<https://github.com/Comfy-Org/comfy-mcp>、<https://github.com/artokun/comfyui-mcp>
- AnyPose（不適用像素風的說明）：<https://huggingface.co/lilylilith/AnyPose>
