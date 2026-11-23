# AI 像素角色測試 01

> 本輪先走**路線 B（MiniMax H3）**；路線 A（Qwen Edit / Wan 2.2 / FLUX.2 klein）的模型尚未下載，之後補跑。

## 環境

- OS：Windows 11 Pro（10.0.26300）、RAM 64GB
- GPU：RTX 5060 Ti 16GB，驅動 616.92
- ComfyUI：**Comfy Desktop**（非 SETUP 建議的 Portable），ComfyUI 0.46.2、前端 1.59.6，port **8000**
  - 啟動參數：`--use-sage-attention --disable-pinned-memory --enable-manager`
  - 原因：機器上已有可用的 Desktop 安裝，版本符合 H3 Image（≥ 0.45）需求，不重裝。腳本預設連 `http://127.0.0.1:8000`。
- PyTorch 2.13.0+cu130、Python 3.13（ComfyUI 內）；工具腳本用 Python 3.12 `.venv-art`
- 模型資料夾：`%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Shared\models`

### 節點

已有：ComfyUI-Manager（Desktop 內建）、ComfyUI-GGUF、KJNodes、VideoHelperSuite、ComfyUI-RMBG、Easy-Use、Impact Pack、LayerStyle、rgthree 等。
未裝：PixelArt-Detector、comfyui_controlnet_aux、WanVideoWrapper（皆為備案，路線 B 不需要）。

### 路線 B 模型

| 用途 | 檔案 | 備註 |
| --- | --- | --- |
| H3 Image DiT | `minimax_h3_image_pruned_int8_convrot.safetensors` | SETUP 建議 w4a8；機器上已有 int8，照官方範本使用 |
| H3 Image 文字編碼器 | `qwen3vl_32b_minimax_h3_int8_convrot.safetensors` | 官方範本預設 |
| H3 Image VAE | `minimax_h3_image_vae_fp16.safetensors` | |
| H3 影片 DiT | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | 本輪新下載（19.5GB） |
| H3 影片 turbo LoRA | `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` | 本輪新下載（1.8GB，lightx2v） |
| H3 影片文字編碼器 | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | FP4 |
| H3 影片 VAE | `minimax_h3_video_vae_int8_convrot.safetensors` | |

## 試跑紀錄

| 模型 | 解析度/幀數 | 耗時 | VRAM 峰值 | 備註 |
| --- | --- | --- | --- | --- |
| H3 Image edit（冷啟動） | 1024² | 40.4 s | 15.1 GB | 含載入模型；6 步 euler cfg 1 |
| H3 Image edit（熱） | 1024² | 9.1 s | 15.1 GB | **品質最好**：條紋、紅 7、深藍帽都正確，姿勢與比例保留 |
| H3 Image edit（熱） | 512² | 19.2 s | 15.5 GB | 較糊、細節少；不用 512，改為 1024 生成再縮 |
| H3 影片 I2V（冷啟動） | 512² / 56 幀 | 40.8 s | 15.5 GB | 首尾幀同一張；8 步 turbo LoRA、res_multistep |
| H3 影片 I2V（熱） | 512² / 56 幀 | 29.4 s | 15.4 GB | 原地走路成立、鏡頭不動、洋紅背景保持、腳在基準線上 |

VRAM 峰值為 `nvidia-smi` 整卡用量（含桌面），模型 offload 時會貼近上限屬正常。沒有 OOM。

預覽（試跑用舊 teen 底圖，非正式結果）：`smoke/h3_image_edit_akai.png`、`smoke/h3_video_walk_contact.png`、`smoke/h3_video_walk.gif`。

觀察：H3 影片在 512² 仍保有像素風，但邊緣略軟化（後處理 k-centroid 縮小可以吸收）；步幅偏小，正式跑走路時提示詞需強調步伐。

## 結果

| 角色 | 動作 | 路線 | 品質 1–5 | 重抽次數 | 耗時 | 問題 |
| --- | --- | --- | --- | --- | --- | --- |

## 驗收清單

- [ ] 阿凱與霧屍並排（`compare_lineup.png`），頭頂線、腳底線一致（誤差 ≤ 1 px）
- [ ] 所有格的支撐腳都在 y=61，循環動作播放時不上下抖、不左右飄
- [ ] 每個角色 ≤ 16 色，播放不閃色
- [ ] 放大 4 倍看：外框連續、沒有孤立雜點、沒有殘留洋紅
- [ ] 阿凱認得出：條紋球衣、紅色 7 號、深藍帽
- [ ] 無手臂版的肩膀位置在各格一致（WeaponRig 才接得上）
- [ ] 每個動作的姿勢讀得懂（縮回 64 px、1 倍大小時仍看得出在做什麼）
- [ ] A、B 兩條路線各有一份完整結果與比較表
- [ ] 估算：18 隊員＋3 主角＋7 種霧屍所需時間

## 問題與處理

- H3 Image 官方範本內含一個 Qwen3.5-9B 的提示詞擴寫步驟；為了可重現、提示詞可控，API 工作流 `h3_image_edit.json` 拿掉這步，直接餵 TEST_SPEC 的提示詞。
- 512² 生成品質明顯比 1024² 差（H3 Image 針對約 4MP 調校）；統一用 1024² 生成（16 倍），後處理縮到 64。
- comfy-mcp 尚未安裝：正式生成走 `tools/art/ai/run_comfy.py`，目前不需要 MCP。

## 建議

（比較完成後填寫）
