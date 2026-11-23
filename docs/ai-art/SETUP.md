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
| ComfyUI-PixelArt-Detector（dimtoneff） | 像素格點偵測、調色盤（備案；主力是自寫腳本） |
| comfyui_controlnet_aux | 必要時抽 OpenPose / 輪廓 |
| ComfyUI-WanVideoWrapper（kijai） | 備案；先用原生 Wan 節點 |

裝完重啟，確認啟動 log 沒有 import 失敗。

## 3. 模型下載清單

資料夾都在 `ComfyUI\models\` 底下。可用 `huggingface-cli download` 或 comfy-mcp 的 `download_model`。

### 路線 A：開放授權模型

| 模型 | 檔案（建議版本） | 放到 | 約大小 |
| --- | --- | --- | --- |
| Qwen-Image-Edit-2511 | `Comfy-Org` 的 fp8 版，或 `unsloth/Qwen-Image-Edit-2511-GGUF` Q6_K | `diffusion_models/`（GGUF 放 `unet/`） | 20 / 17 GB |
| Qwen2.5-VL-7B 文字編碼器 | `qwen_2.5_vl_7b_fp8_scaled.safetensors` | `text_encoders/` | 9 GB |
| Qwen Image VAE | `qwen_image_vae.safetensors` | `vae/` | 0.3 GB |
| Qwen Edit Lightning | `lightx2v/Qwen-Image-Edit-2511-Lightning`（4 步） | `loras/` | 1 GB |
| Wan 2.2 I2V A14B high noise | fp8_scaled 或 GGUF Q5_K_M / Q6_K | `diffusion_models/` 或 `unet/` | 10–15 GB |
| Wan 2.2 I2V A14B low noise | 同上 | 同上 | 10–15 GB |
| UMT5-XXL 文字編碼器 | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `text_encoders/` | 7 GB |
| Wan 2.1 VAE | `wan_2.1_vae.safetensors` | `vae/` | 0.3 GB |
| lightx2v Wan2.2 I2V 4 步 LoRA | high / low 各一 | `loras/` | 1.2 GB |
| Wan2.2 像素動畫 LoRA | `styly-agents/Wan2-2-pixel-animate` → `wan2.2_animate_adapter_model.safetensors` | `loras/` | 2.3 GB |
| FLUX.2 klein 4B | 官方/Comfy-Org 版 | `diffusion_models/`＋對應文字編碼器、VAE | 約 10 GB |
| 像素 sprite LoRA（FLUX.2 klein） | `limbicnation/pixel-art-lora` → `pytorch_lora_weights.safetensors`（改名 `pixel_sprite_klein.safetensors`） | `loras/` | <1 GB |

### 路線 B：MiniMax H3

| 模型 | 檔案 | 放到 | 約大小 |
| --- | --- | --- | --- |
| H3 Image DiT | `Comfy-Org/MiniMax-H3-Image` 的 **w4a8** | `diffusion_models/` | 12.5 GB |
| H3 Image 文字編碼器 | Qwen3-VL-32B **NVFP4**（5060 Ti 原生支援 FP4） | `text_encoders/` | 15.7 GB |
| H3 Image VAE | fp16 | `vae/` | 1.2 GB |
| H3 影片 | `Comfy-Org/MiniMax-H3` 的 **pruned_w6a8**＋4 步 turbo LoRA＋對應編碼器/VAE（照 ComfyUI 範本 `video_minimax_h3_i2v` 要求） | 依範本 | 16 GB＋ |

### 16GB VRAM 注意事項

- 一次只載一組模型；工作流之間呼叫 ComfyUI `/free`（comfy-mcp 的 `free_memory`）。
- H3 Image：DiT 與 32B 文字編碼器無法同時放進 16GB，靠 ComfyUI 自動 offload 到 RAM（64GB 夠）。慢是正常的。
- H3 影片 w6a8 會頂到上限：解析度先用 512×512、長度用最短（約 124 幀/5 秒，之後再挑格）。爆 VRAM 就記錄並略過，以 Wan 為主。
- Wan 2.2 14B：512×512、49–81 幀、4 步。若 OOM，換 GGUF Q4_K_M 或降到 41 幀。

## 4. 每個模型的試跑

各用 ComfyUI 內建範本（Workflow → Browse Templates）跑一次最小案例，記到 `art/ai/out/REPORT.md`：

| 模型 | 輸入 | 記錄 |
| --- | --- | --- |
| Qwen Edit | `art/ai/refs/akai_body_teen_x8.png` ＋「把衣服換成白色條紋棒球衣」 | 秒數、峰值 VRAM |
| FLUX.2 klein + LoRA | 文字：`pixel art sprite, high school baseball player, side view, game asset` | 同上 |
| Wan 2.2 I2V | 同一張參考圖，「walking in place, side view, static camera」 | 同上 |
| H3 Image | 同 Qwen Edit | 同上 |
| H3 影片 | 同 Wan | 同上 |

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
