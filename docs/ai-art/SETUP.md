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

## 3. 模型（2026-11-23 定案：MiniMax H3 單一主線）

> 使用者決定：選 H3 就是因為品質與速度都最好，**品質落差大的模型不做比對**。舊路線（Qwen-Image-Edit-2511、FLUX.2 klein、Z-Image、Wan 2.2、LTX）全部移除，不用下載。授權先擱置。

### 主線模型（都已裝好，見 REPORT.md）

| 用途 | 模型 |
| --- | --- |
| 設定稿、換裝到人台、姿勢關鍵格 | **MiniMax H3 Image**（DiT int8＋Qwen3-VL-32B＋VAE），1024² 生成 |
| 動作（循環與一次性） | **MiniMax H3 影片** fl2va int8＋turbo LoRA，首尾幀控制 |

### 要加裝的（都是 H3 的配套，不是另一個模型）

| 項目 | 用途 | 放到 |
| --- | --- | --- |
| **`JOYUNGI/pixelart8x-h3-lora`（v3）** | H3 影片的像素動畫 LoRA：每格一色、固定 8px 格點、有限色盤、逐格式動作，正好對應我們 ÷8 縮小。提示詞開頭 `pixel art animation, crisp 8x pixel grid, limited palette.`，結尾 `Sound: none.` | `loras/` |
| **bunnyUFO-lab/pixel-studio-comfyui-workflows** 的 `sprite-from-prompt-h3` 工作流（2026-11-17） | sprite＋動作描述 → 39 幀取 13 幀；循環動作首尾同幀、一次性動作解開尾幀；8 倍放大比 4 倍腿部乾淨；8 步 turbo、res_multistep、無 CFG；提示詞只放動作描述 | 匯入 ComfyUI，存一份 API JSON 到 `art/ai/workflows/` |
| **japaneserunic/blubs-pixel-nodepack**（PixelForge-H3，MIT） | H3 輸出轉 sprite：Chroma Key、Pixel Grid Recover、Quantize、**Temporal Stabilize**（防閃色）、**Auto-Crop & Anchor**（對齊腳底）、Loop Trim、Frame Dedup、Sprite Sheet Pack、Save GIF | `custom_nodes/` |

先用這兩套跑通；它們做不到的（例如固定腳底 y=61、≤16 色共用調色盤、headlock）才補 `tools/art/ai/` 自寫腳本。

### 可選：H3 加速版

- **HyperFlow H3 Flash**（2026-11-06）：H3 剪枝到 13.7B，Q4_K_M GGUF 9.1GB，4–8 步。只在 H3 影片太慢或爆 VRAM 時試，品質要和原版並排確認沒掉。

### 查證過但不測的

| 模型 | 不測的原因 |
| --- | --- |
| MOSS-Image（2026-10-16，5B，Apache-2.0） | 只有文生圖＋版面控制，沒有原生多參考圖編輯（換裝只能靠社群 LoRA），參數量約 H3 Image 的 1/7，鎖角色一致性做不到同等級。之後若要訓練自家像素風 LoRA 再評估 |
| Qwen-Image 2.1（2026-09-20，7B） | 有編輯與透明背景，但規模和品質與 H3 有落差，且為非商用研究授權 |
| P-H3-Image（Pruna 蒸餾版） | 需約 21GB VRAM |
| Wan 2.2 / LTX-2.x | 舊或品質低於 H3；Wan 2.2 之後沒有開放權重 |

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
| H3 影片（已完成） | 設定稿 → 原地走路 | 同上 |
| H3 影片 ＋ pixelart8x LoRA | 同上，和不加 LoRA 並排比較 | 同上 |
| sprite-from-prompt-h3 ＋ PixelForge-H3 | 同上，直接出 sprite sheet | 同上 |

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
