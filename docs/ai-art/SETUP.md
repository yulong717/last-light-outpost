# 安裝：Windows 11 + RTX 5060 Ti 16GB + 64GB RAM

> 模型版本與檔名 2026-11-23 查證。下載前到 Hugging Face 頁面確認最新檔名；檔名不同就用頁面上最接近的版本，並記進 `REPORT.md`。

## 0. 前置

- NVIDIA 驅動：最新 Game Ready / Studio 驅動（需支援 CUDA 12.8+）。`nvidia-smi` 確認。
- git、Python 3.12（只給工具腳本用；ComfyUI portable 自帶 Python）、Node.js 22 LTS（給 MCP 用）。
- 磁碟：SSD 留 **200GB**（模型約 120GB＋輸出）。
- Windows 開啟長路徑：`git config --global core.longpaths true`。

## 1. ComfyUI

選一個：

- **ComfyUI Windows Portable（建議）**：GitHub Releases 下載 **cu128** 版（RTX 50 系必須），解壓到例如 `D:\AI\ComfyUI_windows_portable`。
- ComfyUI Desktop 最新版也可以，但自訂節點與路徑較難由腳本控制。

啟動參數（改 `run_nvidia_gpu.bat`）：

```
.\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --reserve-vram 1 --listen 127.0.0.1 --port 8188
```

版本需求：Qwen-Image-Edit-2511、Wan 2.2 原生支援；**MiniMax H3 Image 需要 ComfyUI v0.45.0+**；H3 影片 ControlNet 需要 0.35+。先更新到最新。

## 2. 自訂節點

先裝 ComfyUI-Manager，再用 Manager 或 `git clone` 到 `ComfyUI\custom_nodes\`：

| 節點 | 用途 |
| --- | --- |
| ComfyUI-Manager | 安裝管理 |
| ComfyUI-GGUF（city96） | 載入 GGUF 量化模型 |
| ComfyUI-KJNodes | 影像處理、Resize、各種工具 |
| ComfyUI-VideoHelperSuite | 影片載入、拆幀、輸出 GIF |
| ComfyUI-RMBG（1038lab） | BiRefNet 去背（備案；主力是洋紅色鍵） |
| ComfyUI-PixelArt-Detector（dimtoneff） | 像素格點偵測、調色盤（備案） |
| **blubs-pixel-nodepack（PixelForge-H3）** | H3 輸出轉像素 sprite：去背、格點還原、量化、防閃、對齊、打包（主力，見第 3 節） |
| comfyui_controlnet_aux | 必要時抽 OpenPose / 輪廓 |
| ComfyUI-WanVideoWrapper（kijai） | 備案；先用原生 Wan 節點 |

裝完重啟，確認啟動 log 沒有 import 失敗。

## 3. 模型下載清單（2026-11-23 更新為最新模型）

> 舊版清單（Qwen-Image-Edit-2511、FLUX.2 klein、Z-Image、Wan 2.2 為主）已淘汰：使用者要求改用最新模型。Wan 官方開放權重仍停在 2.2（2.5 以後只有 API），所以 Wan 2.2 只當備案。
> 授權先擱置，只比效果；但每個模型的授權仍記在表裡，之後要用。

比對分兩個階段，每階段同時跑多個模型：

### 階段 1：角色設定稿／姿勢關鍵格（圖片模型三選一比較）

| 模型 | 發布 | 為什麼選 | 檔案（16GB 用） | 放到 | 授權 |
| --- | --- | --- | --- | --- | --- |
| **MiniMax H3 Image**（已裝） | 2026-11-10 | 33B，最多 16 張參考圖，試跑時換裝最準 | DiT int8 21GB 或 w4a8 12.5GB＋Qwen3-VL-32B NVFP4 15.7GB＋VAE | 已就緒 | MiniMax 社群授權（限地區） |
| **Qwen-Image 2.1** | 2026-09-20 | 7B，生圖＋編輯同一模型，最多 10 張參考圖，**原生透明背景（RGBA）**，對 sprite 很有用；16GB 跑起來最輕鬆 | `Comfy-Org` 的 `qwen_image_2.1_int8_convrot`（7.3GB）＋`qwen3vl_8b_int8_convrot`（9.4GB）或 w4a8（6.3GB）＋ 64ch RGBA VAE；加速用 LightX2V **Lightning v2** 4 步 | `diffusion_models/`、`text_encoders/`、`vae/`、`loras/` | Qwen Research License（非商用） |
| **MOSS-Image**（OpenMOSS） | 2026-10-16 | 5B，**JSON 版面控制（bbox）**可以直接指定角色位置與大小（對齊腳底線）；社群有 pose / lineart 控制 LoRA、4 步 LoRA；**Base 版適合之後訓練我們自己的像素風 LoRA** | `Comfy-Org/MOSS-Image`：SFT int8_convrot 5.4GB＋ Qwen3.5-9B w4a8 7.3GB ＋ flux2-vae；建議用 `MOSS-Image-heal`（修 fp16 溢位）；4 步 LoRA（lvladikov）；pose 控制 LoRA（thedeoxen，約 290MB） | 同上 | **Apache-2.0** |

不列入：P-H3-Image（需約 21GB VRAM）、HunyuanImage 3.x（太大或只有 API）。

### 階段 2：動作（影片模型比較）

| 模型 | 發布 | 為什麼選 | 檔案（16GB 用） | 授權 |
| --- | --- | --- | --- | --- |
| **MiniMax H3 影片**（已裝）＋ **pixelart8x-h3-lora** | H3 2026-08；LoRA v3 | LoRA 專門做「每格一色、固定 8px 格點、有限色盤、逐格動作」的真像素動畫，正好對應我們 ÷8 的縮小 | 已裝的 fl2va int8 ＋ turbo LoRA；`JOYUNGI/pixelart8x-h3-lora`（用 v3）→ `loras/` | MiniMax 社群授權 |
| **HyperFlow H3 Flash** | 2026-11-06 | H3 剪枝到 13.7B，Q4_K_M GGUF 9.1GB，4–8 步，16GB 更從容；功能同 H3（首尾幀、參考圖） | GGUF → `unet/` | MiniMax 社群授權 |
| **LTX-2.3**（或 2.5）＋ **ume-pixelart LoRA** | 2026-03 / 08 | 非 H3 的對照組；官方稱 12GB 起可跑（蒸餾/FP8），有現成像素風 LoRA | Lightricks 官方 FP8／蒸餾版＋ `OmerHagage/ltx2-ume-pixelart-lora`（觸發詞 `ume-pixelart`） | LTX 授權（年營收 1000 萬美元以下免費）；LoRA MIT |
| Wan 2.2 I2V（備案） | 2025-07 | 最新可下載的 Wan，社群資源多；前兩者都失敗時才用 | 見舊版說明 | Apache-2.0 |

### 現成的 H3 像素 sprite 工具（先試，能省掉大部分自寫後處理）

| 工具 | 內容 |
| --- | --- |
| **bunnyUFO-lab/pixel-studio-comfyui-workflows** 的 `sprite-from-prompt-h3`（2026-11-17 合併） | sprite＋動作描述 → 39 幀取 13 幀的 sprite sheet；走路/待機首尾同幀做循環，一次性動作解開尾幀。作者實測 8 倍放大比 4 倍腿部乾淨。8 步 turbo、res_multistep、無 CFG。提示詞只放動作描述（加角色描述反而讓走路停住） |
| **japaneserunic/blubs-pixel-nodepack**（PixelForge-H3，MIT） | 節點：Sprite Chroma Key、Pixel Grid Recover、Pixel Art Quantize（k-means／PICO-8 等色盤）、**Temporal Stabilize**（防閃色）、**Auto-Crop & Anchor**（對齊腳底）、Loop Trim、Frame Dedup、Sprite Sheet Pack（Aseprite JSON）、Save GIF |
| multimodalart/sprite-forge（HF Space 原始碼） | 參考它的挑格法：輪廓變化的局部極小值＋最遠點取樣，第 0 格固定保留；YCbCr 去背 |

### 16GB VRAM 注意事項

- 一次只載一組模型；工作流之間呼叫 ComfyUI `/free`（comfy-mcp 的 `free_memory`）。
- H3 Image：DiT 與 32B 文字編碼器無法同時放進 16GB，靠 ComfyUI 自動 offload 到 RAM（64GB 夠）。慢是正常的。
- H3 影片 w6a8 會頂到上限：解析度先用 512×512、長度用最短（約 124 幀/5 秒，之後再挑格）。爆 VRAM 就記錄並略過，以 Wan 為主。
- Wan 2.2 14B：512×512、49–81 幀、4 步。若 OOM，換 GGUF Q4_K_M 或降到 41 幀。

## 4. 每個模型的試跑

各用 ComfyUI 內建範本（Workflow → Browse Templates）跑一次最小案例，記到 `art/ai/out/REPORT.md`：

| 模型 | 輸入 | 記錄 |
| --- | --- | --- |
| H3 Image（已完成） | 人台＋阿凱參考圖換裝 | 秒數、峰值 VRAM |
| Qwen-Image 2.1 | 同上，另試 RGBA 透明輸出 | 同上 |
| MOSS-Image | 同上描述，用 JSON bbox 指定角色框（腳底 y≈976/1024） | 同上 |
| H3 影片 ＋ pixelart8x LoRA | 設定稿 → 原地走路 | 同上 |
| HyperFlow H3 Flash | 同上 | 同上 |
| LTX-2.x ＋ ume-pixelart | 同上 | 同上 |

## 5. Claude Code 連 ComfyUI

**主要：官方 comfy-mcp（Comfy-Org）**

```powershell
pip install comfy-mcp "comfy-cli>=1.14.0"
claude mcp add comfy-mcp -e COMFYUI_URL=http://127.0.0.1:8188 -- comfy-mcp
```

（若 comfy-cli 要求 `COMFY_BIN` 或 workspace，照 README 設定成 portable 的路徑。）常用工具：`run_workflow`、`job`、`fetch_outputs`、`free_memory`、`system_stats`、`download_model`、`install_node`、`validate_workflow`。

**備案：artokun/comfyui-mcp**（Claude Code plugin，含 Wan / Qwen 等 skill 與 VRAM 監控）

```
/plugin marketplace add artokun/comfyui-mcp
/plugin install comfy
```

**正式批次一律走腳本**：`tools/art/ai/run_comfy.py` 直接 POST `http://127.0.0.1:8188/prompt`、輪詢 `/history/<id>`、從 `/view` 下載輸出。工作流從 ComfyUI 介面「Export (API)」存成 `art/ai/workflows/*.json`，腳本只替換輸入圖、提示詞、seed、幀數等欄位。

## 6. 工具腳本的 Python 環境

```powershell
cd <repo>
python -m venv .venv-art
.\.venv-art\Scripts\pip install pillow numpy scikit-learn requests pyyaml imageio
```

`.venv-art/` 要加進 `.gitignore`。
