# ComfyUI 工作流（API 格式）

這裡的 JSON 都是 **API 格式**（`{"節點id": {"class_type", "inputs"}}`），由 `tools/art/ai/run_comfy.py` 送到本機 ComfyUI（`http://127.0.0.1:8000`）。不能直接拖進 ComfyUI 畫布。

- 每個檔案開頭的 `_meta_doc` 寫了輸入欄位。
- 執行時只用 `--set 節點id.欄位=值` 換提示詞、seed、尺寸、幀數、圖檔，其他節點和參數照檔案原樣。

## 比對官方更新

- 官方範本：GitHub `Comfy-Org/workflow_templates` 的 `templates/` 資料夾（PyPI 套件 `comfyui-workflow-templates-json`）。
- 查最近更新：`https://api.github.com/repos/Comfy-Org/workflow_templates/commits?path=templates/<範本名>.json`
- 本機 Comfy Desktop 內建的範本包可能比較舊。2026-11-24 時本機是 `comfyui_workflow_templates_json` 0.1.57（9 月），PyPI 已到 0.1.143。這只影響介面裡看到的範本，不影響這裡的 JSON。

## 工作流

### `h3_image_edit.json`、`h3_image_edit_3ref.json`：H3 Image 編輯（靜態圖）

| 項目 | 內容 |
| --- | --- |
| 來源範本 | `image_minimax_h3_image_edit` |
| 建立日期 | 2026-11-23（第一輪）；`_3ref` 在 2026-11-24 第六輪加入 |
| 已比對的官方版本 | 2026-11-21 commit「Update default size to 16 megapixels for MiniMax H3 Image workflows (#1430)」 |
| 模型 | `minimax_h3_image_pruned_int8_convrot.safetensors`（diffusion_models） |
| 文字編碼器 | `qwen3vl_32b_minimax_h3_int8_convrot.safetensors` |
| VAE | `minimax_h3_image_vae_fp16.safetensors` |
| 取樣 | KSampler：6 步、cfg 1、euler／simple（和官方相同） |

改了什麼：
- **拿掉 LLM 提示詞擴寫**（官方用 `qwen3.5_9b_w4a8_gptq` 先改寫提示詞）。我們的提示詞寫死了姿勢、配色、畫風，擴寫會把它們改掉。
- **尺寸 1024²**（官方預設 3104²，約 1600 萬像素）。像素圖最後要縮 16 倍，1024² 已經夠，而且快很多。
- `_3ref`：多加 `load3`／`scale3` 接到 `cond.images.image_3`（第三張參考圖，通常是 anchor 畫風樣板）。

### `h3_video_i2v.json`：H3 影片首尾幀（FL2V）

| 項目 | 內容 |
| --- | --- |
| 來源範本 | `video_minimax_h3_i2v` |
| 建立日期 | 2026-11-23（第一輪） |
| 已比對的官方版本 | 2026-11-22 commit「normalise MarkdownNote model links…(#1427)」 |
| 模型 | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` |
| LoRA | `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors`，強度 1.0（lightx2v） |
| 文字編碼器 | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` |
| VAE | `minimax_h3_video_vae_int8_convrot.safetensors`（官方 11 月也改成 int8） |
| 取樣 | SamplerCustomAdvanced＋res_multistep、BasicScheduler simple **8 步**、BasicGuider |
| 尺寸 | 512²、56 幀（24 fps，長度要是 17k+5：22／39／56／73…） |

改了什麼：
- **拿掉音訊分支**（audio VAE、音訊 latent）。我們只要畫面。
- **LoRA 固定開**：官方用開關切換，關＝20 步、開＝6 步。這裡固定開 8 步 turbo LoRA，用 8 步，照該 LoRA 的設計步數。
- 圖片縮放改成固定尺寸 nearest-exact（官方是 ImageScaleToTotalPixels），像素圖不會被重新取樣糊掉。

變體（不另存檔，用 `--set` 換）：
- **官方 4 步 LoRA**（第十一輪 D）：`--set lora.lora_name=minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors --set sched.steps=4`
  - 檔案來源：Hugging Face `Comfy-Org/MiniMax-H3`，`loras/` 資料夾，1.96GB
  - 官方範本的說明裡有列這個檔

### `pf_post.json`：PixelForge-H3 後處理（只做比較）

| 項目 | 內容 |
| --- | --- |
| 來源 | 自己組的，不是官方範本 |
| 需要的節點 | `blubs-pixel-nodepack`（PixelForge）、`comfyui-videohelpersuite`（VHS_LoadImagesPath） |
| 內容 | 洋紅 flood 去背 → 時間去尖峰 → 縮到 64 px／16 色共用調色盤 |

正式流程的後處理是 repo 裡的 Python（`tools/art/ai/pixelize.py`、`build_zombie9/10.py`），不是這個。

## 尚未納入

- **pi-H3**（`Lakonik/pi-H3`，2 步／4 步 DWD adapter）：需要自訂節點 ComfyUI-piFlow（`comfyui-piflow` 1.4.2）。目前還沒安裝，見 REPORT 第十一輪。
  - 官方工作流：`Lakonik/ComfyUI-piFlow` 的 `workflows/pi-H3-DWD.json`（ComfyUI 內建稀疏注意力，不用另外裝）
  - adapter：`pi_h3_{2,4}step_dwd_adapter_int8_convrot.safetensors` → `models/loras/`
- **pixelart8x_h3_v3**（`JOYUNGI/pixelart8x-h3-lora`）：Hugging Face 上查無此模型。
