# AI 像素角色測試 01

> 2026-11-23 定案：**MiniMax H3 單一主線**（見 REVIEW-01、SETUP 第 3 節）。本輪曾短暫下載並試跑路線 A（Qwen Edit / FLUX.2 klein / Wan 2.2），結果僅留在「附錄：路線 A 試跑」供參考，不再繼續。

## 環境

- OS：Windows 11 Pro（10.0.26300）、RAM 64GB
- GPU：RTX 5060 Ti 16GB，驅動 616.92
- ComfyUI：**Comfy Desktop**（非 SETUP 建議的 Portable），ComfyUI 0.46.2、前端 1.59.6，port **8000**
  - 啟動參數：`--use-sage-attention --disable-pinned-memory --enable-manager`
  - 機器上已有可用的 Desktop 安裝，版本符合 H3 Image（≥ 0.45）需求，不重裝。腳本預設連 `http://127.0.0.1:8000`。
- PyTorch 2.13.0+cu130、Python 3.13（ComfyUI 內）；工具腳本用 Python 3.12 `.venv-art`
- 模型資料夾：`%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Shared\models`（與使用者其他 ComfyUI 專案共用）

### H3 模型

| 用途 | 檔案 | 備註 |
| --- | --- | --- |
| H3 Image DiT | `minimax_h3_image_pruned_int8_convrot.safetensors` | SETUP 建議 w4a8；機器上已有 int8，照官方範本使用 |
| H3 Image 文字編碼器 | `qwen3vl_32b_minimax_h3_int8_convrot.safetensors` | 官方範本預設 |
| H3 Image VAE | `minimax_h3_image_vae_fp16.safetensors` | |
| H3 影片 DiT | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | 19.5GB |
| H3 影片 turbo LoRA | `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` | lightx2v，8 步 |
| H3 影片文字編碼器 | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | FP4 |
| H3 影片 VAE | `minimax_h3_video_vae_int8_convrot.safetensors` | |

### H3 配套（REVIEW-01 第 6 點）— **未完成，見「問題」**

| 項目 | 狀態 |
| --- | --- |
| `JOYUNGI/pixelart8x-h3-lora`（v3） | **找不到**：Hugging Face（`JOYUNGI` 作者、`pixelart8x` 關鍵字）與 Civitai 都查無此模型。HF 上有的 H3 像素類 LoRA：`KennethFal/16bit-pixel-lora-minimax-h3`、`Leon1000/16bit-pixel-lora-minimax-h3`、`ij/PixelTune-MiniMax-H3-LoRA`、`pocis/MiniMax-H3-Video-PixelHead`（未驗證） |
| bunnyUFO `sprite-from-prompt-h3` 工作流 | 已下載檢視：用的就是我們的 H3 影片 DiT（他們用 w6a8）＋ nvfp4 編碼器＋8 步 turbo LoRA，768²／39 幀，**峰值 VRAM 約 21.7GB**（16GB 要降解析度）。「x8-v3」指的是其清理節點的參數版本，不是 LoRA。需要該 repo 的自訂節點 `comfyui_workflows_utils`（PrepareSpriteForVideo、CleanVideoFrames、PickEvenFrames、SaveSpriteSheet…） |
| PixelForge-H3（`japaneserunic/blubs-pixel-nodepack`，MIT） | 未安裝 |

兩套自訂節點都要把第三方程式碼裝進 ComfyUI，本機的 Claude Code 權限設定擋下了這一步，等使用者確認後再裝。

## 試跑紀錄（H3）

| 模型 | 解析度/幀數 | 耗時 | VRAM 峰值 | 備註 |
| --- | --- | --- | --- | --- |
| H3 Image edit（冷） | 1024² | 40.4 s | 15.1 GB | 含載入；6 步 euler cfg 1 |
| H3 Image edit（熱，1 張參考圖） | 1024² | 9.1 s | 15.1 GB | |
| H3 Image edit（熱，2 張參考圖） | 1024² | 15–30 s | 15.1 GB | 角色＋人台 |
| H3 Image edit（熱） | 512² | 19.2 s | 15.5 GB | 較糊，不用 |
| H3 影片 I2V（冷） | 512² / 56 幀 | 40.8 s | 15.5 GB | 首尾同幀；8 步 turbo、res_multistep |
| H3 影片 I2V（熱） | 512² / 56 幀 | 29–30 s | 15.4 GB | |

VRAM 峰值為 `nvidia-smi` 整卡用量（含桌面）。全程沒有 OOM。

## M 人台與姿勢模板

- **3.5 頭身**：從 H3 生成的側面人台切頸部，頭／身分別縮放到 16 px／40 px（身體橫向 ×1.15 加厚），依畫布規格貼到 1024² 畫布（腳底 y=976、中線 x=512）後讓 H3 重畫。4 個 seed 實測全部 **56 px 高、頭 16 px、3.5 頭身**。
- **H3 會沿用參考圖位置**：參考圖照規格擺好，輸出的頂端 y=96、腳底 y=991，縮放比剛好 0.5，不用再估比例。
- 有手臂（`stand`）與無手臂（`stand_noarm`）兩版。
- 姿勢模板 20 個（`art/ai/mannequins/M/`，定義在 `poses.yaml`）：walk_contact_a/b、run_a、aim_1–2、shoot_1–3、melee_1–6（球棒）、hit_1–3、death_1/4/8。每個 2 seed 挑一張。腳底全部 y=61；站姿頭頂都在 y=6（melee_1/5 高出的是球棒、shoot_1 是後仰、death 低於是正常）。
- 疊圖：`templates_contact.png`、`overlay_check.png`。
- 失敗：`walk_pass_a`（過渡姿勢）兩個 seed 都畫成大步，沒有收腿；之後改提示詞重做。灰色人台的近腳／遠腳不易區分，contact_a / contact_b 看起來差不多。

## 第三輪（REVIEW-03）：舊版阿凱形象＋idle／walk／melee

輸出：`art/ai/out/akai_v3/`（`idle`、`walk`、`melee` 的 strip／json／gif／contact，`palette.png`，`meta.json`，對照圖 `compare_oldlook.png`）。

**參考圖**：資料夾裡只有 `akai_oldlook_x4_preview.png`（256²、透明底）。確認它是 64×64 原圖的精確 4 倍放大（每個 4×4 區塊同色）後，無損還原出 `akai_oldlook_64.png`，再做 `_x8`、`_x16`（洋紅底）。都放在 `art/ai/refs/`。原圖：高 60 px（y=4–63）、62 色。

| 動作 | 格數 | 做法 | seed | 結果 |
| --- | --- | --- | --- | --- |
| idle | 4 | H3 Image「移除雙臂與手槍，其他不變」（4/4 可用）→ H3 影片首尾同幀 56 幀 | 3 | 頭＋軀幹鎖定（頂端 42 列，到紅腰帶上方） |
| walk | 8 | 無手臂圖 → H3 Image 大步關鍵格（4/4 可用）→ H3 影片首尾同幀 56 幀，週期 26 幀 | 1 | 同上鎖定；步幅大、雙腿交替清楚 |
| melee | 6 | 原圖 → H3 Image「雙手握球棒、預備姿勢」（3/4 可用；1 張胸前出現兩個 7）→ H3 影片不接尾幀 39 幀 | 4 | 手動挑格：預備 9、13，出手 17，收招 20、24、28。不鎖 |

後處理：
- 調色盤：直接用 `akai_oldlook_64.png` 的 62 色，另加 3 色（k-means，只取和原色差很多的像素＝球棒木色）共 65 色。新增 `pixelize.py palette --base <圖> --extra N`。
- 外框：原圖已有黑色粗外框，`apply --keep-outline` 不重新上色。
- 條紋：縮小後還在，不另畫。
- 腳底：每格 y=61（原圖在 63，往上移 2 px）。

注意事項：
- **頭頂空間只有 2 px**：原圖 60 px 高，腳底移到 y=61 後頭頂在 y=2。走路的過渡姿勢身體會升高 2–3 px，帽子會碰到畫布頂端；鎖定上半身時頭部取自完整的第 0 格，所以帽子不會被切掉，起伏最多 2 px。
- **melee 球棒舉高時（第 0、4、5 格）球棒尖端超出畫布頂 1–2 px，被切掉**。如果要完整，需要比 64 高的畫格（例如 64×72），或讓 melee 的腳底留在 y=63；請雲端那邊決定。
- **melee 看起來比 idle 大**：用 512 原始畫格量帽寬，中位數三個動作都是約 12 px，比例相同；看起來大是因為蹲低、站得開、頭轉得比較正面。
- **球衣比原圖白**：H3 把球衣畫亮了，量化後對應到原調色盤裡較亮的白色。melee 預備格的條紋較不清楚、7 號較方塊。
- 調色盤用了原圖的 62 色＋3 色，所以每個動作實際用到 56–64 色（第一、二輪的 ≤16 色規則這輪不適用，REVIEW-03 指定沿用原圖配色）。

## 第二輪修正（REVIEW-02）

| 意見 | 處理 | 結果 |
| --- | --- | --- |
| 1. 臉前緣是暗紅外框（`#7B1111`） | `pixelize.py` 外框改為「只從同色系挑較暗色」：彩色像素只找色相差 30° 以內的較暗色，白／灰只找中性較暗色，找不到才用外框黑。調色盤保留深膚色 `#8A4A2A` | 頭部（頂端 17 列）紅色像素：12 格全部 0。臉前緣是深膚色 |
| 2. 純側面太扁 | 人台改 **3/4 側面**（`three-quarter view facing right, chest slightly turned toward camera`），再橫向加寬（身體 ×1.3、頭 ×1.1）後讓 H3 重畫。比例 56 px／3.5 頭身／腳底 y=61 不變 | 站姿寬 28 px（現有主角約 28 px）；無手臂 23 px。舊的純側面模板移到 `art/ai/mannequins/M/profile/` 保留 |
| 3. 調色盤有 4 個近黑色 | `pixelize.py palette` 把 OKLab L<0.25 的像素合併成 **1 個外框黑**，另保留深膚色、條紋色，其餘 13 色做 k-means | 16 色：`#030505`（唯一近黑）、深藍 ×4（帽、褲明暗）、`#8A4A2A`、`#D40B0B`、灰 `#70777A`、條紋 `#7C8AA8`、膚 ×2、白衣 4 階（`#ACB7C1`→`#FAFCFC`） |
| 4. 條紋 | `pixelize.py apply --stripes 17:35`：球衣區（頭頂往下 17–34 列、中性淺色、非外框）每 3 px 畫一條 `#7C8AA8` 直線，以中線 x=32 為基準，各格不會漂 | 條紋清楚，7 號與外框不受影響 |

3/4 版重做流程：3/4 人台 → 無手臂 → 走路大步關鍵格 → 阿凱設定稿（4/4 可用，挑 seed 133）→ 阿凱走路關鍵格（4/4 可用，挑 seed 143）→ idle／walk 影片各 4 seed（idle 挑 seed 2、walk 挑 seed 3）。

### PixelForge-H3 試用（REVIEW-01 第 4 點）

節點已安裝（`blubs-pixel-nodepack`，28 個節點；另裝 bunnyUFO `comfyui_workflows_utils`，28 個節點，需 `pixeloe`、`potracer`）。用 `art/ai/workflows/pf_post.json`（Chroma Key flood → Temporal Stabilize despike → Quantize 64 px／16 色／共用調色盤）處理同一批 walk 畫格，和自寫腳本並排：

| | 自寫 `pixelize.py` | PixelForge（預設參數） |
| --- | --- | --- |
| 速度 | 約 5 s（CPU） | 1 s |
| 腳底 y=61 | ✓ | ✓（沒用 Auto-Crop，畫格已按規格擺好） |
| 去背 | ✓ | ✗ 兩腿之間殘留洋紅（flood 只去掉連到邊緣的背景） |
| 色彩 | ✓ | ✗ 第 0、7 格臉變灰綠（映射到錯的色） |
| 7 號、臉閃動 | ✓（上半身鎖定） | ✗ 每格不同 |
| 條紋、外框規則 | ✓ | 無 |

結論：後處理**繼續用自寫腳本**。PixelForge 的 `key` 方法、`temporal_lock` 等參數還沒調，之後如果要給其他角色用可再試。bunnyUFO 的 `sprite-from-prompt-h3` 在 768² 需約 21.7GB VRAM，這輪沒跑。

## 結果

| 角色 | 動作 | 品質 1–5 | 重抽次數 | 耗時 | 問題 |
| --- | --- | --- | --- | --- | --- |
| 阿凱 | idle（4 格，3/4） | 4 | 0（4 seed 挑 1） | 設定稿 4×15–30 s ＋ 影片 4×30 s | 呼吸動作小（遊戲有程式化呼吸，OK） |
| 阿凱 | walk（8 格，3/4） | 4 | 0（4 seed 挑 1） | 關鍵格 4×15–30 s ＋ 影片 4×30 s | 7 號在 64 px 筆畫較粗糙 |

輸出：`art/ai/out/akai/`（`idle.png/json/gif`、`walk.png/json/gif`、`contact_*.png`、`palette.png`、`meta.json`）。

第一輪（純側面）的流程如下，第二輪只換成 3/4 人台與上面的後處理修正：
1. 設定稿：H3 Image，Picture 1 = 試跑時的阿凱換裝圖、Picture 2 = 無手臂人台 → 無手臂阿凱（4/4 都可用，挑 seed 71）。
2. 走路關鍵格：H3 Image，Picture 1 = 無手臂阿凱、Picture 2 = `walk_contact_a` 人台（4/4 可用）。
3. 影片：H3 影片，首尾同幀（idle 用設定稿、walk 用大步關鍵格），56 幀。提示詞加 `long strides, legs clearly alternating, knees lifting, heel strike and toe push-off`（無手臂版不加 `arms swinging`）。**步幅問題解決**：腿明顯交替、跨步大。
4. `pick_frames.py loop`：自動找最能接回的週期（walk 週期 27 幀＝兩步），平均取 8 格／4 格。
5. `pixelize.py`：洋紅去背 → 對齊（同一動作共用水平中線、每格腳底對 y=61）→ ÷8 k-centroid → idle＋walk 共用 16 色 OKLab 調色盤 → 清孤立點、補外框 → **上半身鎖定**（見下）。
6. `build_sheet.py`：strip／json／contact（4×，含基準線）／GIF。

## 驗收清單

- [ ] 阿凱與霧屍並排（`compare_lineup.png`）— 霧屍下一輪
- [x] 所有格的支撐腳都在 y=61，循環動作不上下抖、不左右飄（`meta.json` 的 `foot_rows` 全為 61；水平中線整個動作共用）
- [x] 每個角色 ≤ 16 色，播放不閃色（idle＋walk 共用一組 16 色）
- [x] 放大 4 倍看：外框連續、沒有孤立雜點、沒有殘留洋紅（目視 contact）
- [x] 阿凱認得出：深藍帽、紅色 7 號、白色條紋球衣（條紋由腳本畫）
- [ ] 無手臂版的肩膀位置在各格一致 — 上半身鎖定後一致，待 WeaponRig 實測
- [x] 每個動作的姿勢讀得懂（walk 1 倍大小看得出在走；idle 幾乎靜止）
- [ ] H3 設定比較表（pixelart8x LoRA 有／無、倍率、循環方式）— LoRA 找不到、節點未裝，下一輪
- [ ] 全部角色時間估算 — 見「建議」初估

## 問題與處理

- **紅 7 與臉每格閃動**：影片每格重畫細節，量化後 7 的筆畫、眼睛每格不同。無手臂版的上半身在側面走路時是剛體，所以 `pixelize.py apply --headlock 34` 把第 0 格的頭＋軀幹（頂端往下 34 列）貼到每一格，跟著每格的上下起伏移動；腿保留影片原本的動作。閃動消失。**限制**：有手臂的動作（melee／hit／death）不能這樣鎖，之後要另想辦法（只鎖頭，或鎖 7 號的區塊）。
- **條紋消失**：原圖條紋約 4 px 寬（512 空間），縮 8 倍後不到 1 px。建議比照 `HeroArt.ts` 由程式在 64 px 上畫條紋，或 H3 提示詞要求「粗條紋、間距 2 px」再試。
- **headlock 被雜點帶偏**：一開始用每格最上面一個不透明像素對位，帽子上方一個雜點會讓頭錯位；改為「第一列有 ≥3 個像素」。
- **輸出路徑**：依新規格改為 `art/ai/out/<角色>/`。
- **H3 Image 官方範本**的提示詞擴寫步驟已移除；`h3_image_edit.json` 加了可選的第二張參考圖（`load2`，不用時 `--set cond.images.image_2=null`）。
- **pixelart8x LoRA、PixelForge-H3、bunnyUFO 節點**：見上方「H3 配套」。
- **模型清理**：本機模型資料夾與使用者其他 ComfyUI 專案共用，只刪本輪為路線 A 下載的 15 個檔案（依檔案大小合計約 81.9 GB；刪除前後 C 槽剩餘空間只差 46 GB，可能同時有其他寫入）。H3 主線模型與其他專案的檔案都沒動。
- **pixelart8x LoRA**：使用者決定這輪不用 LoRA（H3 原始輸出縮到 64 px 已夠乾淨），等 idle／walk 確認後再評估。

## 建議

- H3 已可產出可用的 idle／walk：設定稿與關鍵格 4/4 可用，影片 4 seed 都可用、只是挑最穩的。
- 時間初估（熱機、每動作 4 seed）：設定稿約 2 分鐘＋每個循環動作約 2–3 分鐘＋每個短動作（6 格關鍵格）約 4–6 分鐘＋後處理與挑選約 5 分鐘。一個角色全套（12 個動作）約 1–1.5 小時機器時間；18 隊員＋3 主角＋7 霧屍約 30–40 小時機器時間，人工審圖另計。
- 下一輪：裝好 PixelForge-H3／bunnyUFO 節點比較後處理；找到 pixelart8x LoRA（或改試上列替代品）做有／無比較；做霧屍與短動作。

## 附錄：路線 A 試跑（已停止，僅供參考）

| 模型 | 解析度 | 耗時（熱） | VRAM 峰值 | 結果 |
| --- | --- | --- | --- | --- |
| Qwen-Image-Edit-2511 int8 ＋ Lightning 4 步 | 1024² | 11 s（單圖）／17 s（雙圖） | 15.4 GB | 換裝品質好；但**放到人台上 4 張只有 1 張可用**（臉朝左、7 號畫到背後、長出手臂）；人台放在 Picture 1 時完全不換人，要角色在前、姿勢在後才行 |
| FLUX.2 klein 4B ＋ 像素 LoRA | 1024² | 5 s | 15.0 GB | 寫實比例（約 7 頭身）、背景不是純洋紅，只能當概念圖 |
| Wan 2.2 I2V 14B ＋ lightx2v | 512² / 49 幀 | 44.5 s（冷） | 15.1 GB | 跑通，未完成比較即停止 |

結論與 REVIEW-01 一致：H3 的指令遵循與一致性明顯較好。
