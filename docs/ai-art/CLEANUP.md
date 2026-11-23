# 清理模型：只留 MiniMax H3 主線

給本地 Claude Code 執行。目的：刪掉 H3 主線用不到的模型，釋放硬碟空間。

> 刪除後無法復原（要重新下載）。**先列清單給使用者看，使用者說「刪」再刪**；刪除用移到資源回收筒或直接刪除，依使用者指示。

## 位置

- ComfyUI 模型：`%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Shared\models\`（見 REPORT.md）
- 也要檢查這些常見的佔空間處：
  - Hugging Face 快取：`%USERPROFILE%\.cache\huggingface\hub\`
  - ComfyUI 輸出與暫存：`...\ComfyUI\output\`、`...\ComfyUI\temp\`
  - 曾經解壓或另裝的 ComfyUI（例如 `ComfyUI_windows_portable`）裡的 `models\`
  - 下載資料夾裡殘留的 `.safetensors`、`.gguf`、`.ckpt`

## 一定要保留（H3 主線）

| 資料夾 | 檔案 |
| --- | --- |
| `diffusion_models/` | `minimax_h3_image_pruned_int8_convrot.safetensors`（H3 Image） |
| `diffusion_models/` | `minimax_h3_fl2va_pruned_int8_convrot.safetensors`（H3 影片） |
| `text_encoders/` | `qwen3vl_32b_minimax_h3_int8_convrot.safetensors`（H3 Image 用） |
| `text_encoders/` | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`（H3 影片用） |
| `vae/` | `minimax_h3_image_vae_fp16.safetensors`、`minimax_h3_video_vae_int8_convrot.safetensors`（以及 H3 範本要求的音訊 VAE，若有） |
| `loras/` | `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors`、之後加的 `pixelart8x-h3-lora` |
| `background_removal/`、`RMBG/` 等 | ComfyUI-RMBG 用的 BiRefNet（約 1GB 內，備用去背，可留） |

保留規則：檔名含 `minimax_h3` / `h3` 的、目前工作流 `art/ai/workflows/*.json` 有引用的，一律保留。執行前先用腳本掃 workflows JSON 裡所有檔名，加進保留清單。

## 可以刪（H3 主線用不到）

依檔名辨識，實際大小以掃描結果為準：

| 類型 | 常見檔名關鍵字 | 常見位置 | 每個約 |
| --- | --- | --- | --- |
| Qwen-Image / Qwen-Image-Edit（2509、2511、2.1）與其 Lightning LoRA | `qwen_image`、`qwen-image`、`Qwen-Image-Edit`、`qwen_2.5_vl_7b`、`qwen3vl_8b` | `diffusion_models/`、`unet/`、`text_encoders/`、`vae/`、`loras/` | 7–20 GB（文字編碼器 9–17 GB） |
| Wan 2.1 / 2.2（含 VACE、Animate、5B、14B high/low noise）、lightx2v、CausVid | `wan2.1`、`wan2.2`、`Wan2_2`、`umt5_xxl`、`lightx2v`、`causvid`、`vace` | `diffusion_models/`、`unet/`、`text_encoders/`、`vae/`、`loras/` | 10–28 GB（14B 一組兩個檔） |
| FLUX / FLUX.2 / FLUX.2 klein 及像素 LoRA | `flux`、`flux2`、`klein`、`ae.safetensors`、`t5xxl`、`clip_l` | 同上、`clip/` | 4–24 GB |
| Z-Image | `z_image`、`zimage` | 同上 | 6–12 GB |
| LTX-Video / LTX-2 | `ltx`、`ltxv` | 同上 | 10–25 GB |
| HunyuanVideo / HunyuanImage | `hunyuan` | 同上 | 10–40 GB |
| SD1.5 / SDXL 大模型與其 LoRA、ControlNet | `sd_xl`、`sdxl`、`v1-5`、`controlnet` | `checkpoints/`、`controlnet/`、`loras/` | 2–7 GB |
| 放大模型 | `RealESRGAN`、`4x-` | `upscale_models/` | <0.1 GB（可留，影響小） |
| 舊的生成輸出 | — | `ComfyUI\output\`、`temp\` | 視情況 |
| Hugging Face 快取中上述模型的副本 | `models--Qwen--*`、`models--Wan-AI--*`、`models--black-forest-labs--*` 等 | `.cache\huggingface\hub\` | 可能很大 |

**不確定的檔案不要刪**：列在「待確認」欄給使用者決定。

## 執行步驟

1. 掃描：列出上述所有位置中 > 100MB 的檔案（路徑、大小、修改日期），依大小排序。
2. 分類：比對「保留規則」與「可以刪」關鍵字，分成 **保留／可刪／待確認** 三欄，寫進 `art/ai/out/CLEANUP_LIST.md`（這個檔不用提交）。
3. 給使用者看：總共可釋放多少 GB，列出可刪清單與待確認清單。
4. 使用者確認後才刪除；刪完再算一次剩餘空間。
5. 重新啟動 ComfyUI，跑一次 `h3_image_edit.json` 與 `h3_video_i2v.json` 確認 H3 仍正常。
6. 把釋放的空間與刪除清單摘要記進 `REPORT.md` 的「問題與處理」。

PowerShell 掃描範例：

```powershell
$roots = @("$env:LOCALAPPDATA\Comfy-Desktop\ComfyUI-Shared\models", "$env:USERPROFILE\.cache\huggingface\hub")
Get-ChildItem $roots -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object Length -gt 100MB |
  Sort-Object Length -Descending |
  Select-Object @{n='GB';e={[math]::Round($_.Length/1GB,2)}}, FullName, LastWriteTime |
  Format-Table -AutoSize
```
