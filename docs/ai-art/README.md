# AI 像素角色生成：本地 Claude Code 交接包

這個資料夾是給**使用者電腦上的 Claude Code** 讀的。目標：在本機用 ComfyUI 生成兩個測試角色（阿凱、一般霧屍）的完整動作 sprite，並驗證整套流程。

> 背景與研究結論在 [`../AI_ART_PIPELINE.md`](../AI_ART_PIPELINE.md)。本資料夾是「照著做」的版本。
> 這階段只看效果和流程。模型定案為 **MiniMax H3**。

## 檔案

| 檔案 | 內容 |
| --- | --- |
| [`SETUP.md`](SETUP.md) | Windows 11 + RTX 5060 Ti 16GB 的安裝步驟、節點、模型下載清單、Claude Code 連 ComfyUI |
| [`TEST_SPEC.md`](TEST_SPEC.md) | 角色規格（64×64、腳底線）、兩個角色的描述與動作清單、生成流程、後處理、驗收標準 |
| [`CLEANUP.md`](CLEANUP.md) | 清掉 H3 主線用不到的模型、釋放硬碟空間（先列清單、使用者確認才刪） |
| [`COLLAB.md`](COLLAB.md) | 產出放哪、怎麼回傳（分支 / PR）、雲端這邊怎麼審圖與接進遊戲 |
| `../../art/ai/refs/` | 參考圖（8 倍放大、洋紅底）：阿凱身體底圖、霧屍走路第 0 格、主角射擊第 0 格、畫布基準線 |
| `../../art/ai/characters/*.yaml` | 兩個角色的設定清單（描述、體型、動作、格數） |

## 使用者電腦

- GPU：NVIDIA RTX 5060 Ti 16GB（Blackwell / RTX 50 系，需 CUDA 12.8+ 的 PyTorch）
- RAM：64GB
- OS：Windows 11

## 給本地 Claude Code 的開場指令（使用者複製貼上）

```
請讀 docs/ai-art/README.md、SETUP.md、TEST_SPEC.md、COLLAB.md，
照順序執行：
1. 檢查環境並回報（GPU 驅動、Python、git、磁碟空間、是否已有 ComfyUI）
2. 依 SETUP.md 安裝 ComfyUI、節點、模型，每個模型用最小工作流試跑並記錄速度與 VRAM
3. 依 TEST_SPEC.md 先做 M 體型人台，再用 H3 跑阿凱、一般霧屍
4. 依 COLLAB.md 把結果推到分支 ai-art/test-01 並更新 art/ai/out/REPORT.md
每完成一個階段停下來給我看對照表，再繼續。
```

## 工作原則（給 Claude Code）

1. **可重現**：所有正式生成都用 repo 裡的 API 格式工作流 JSON（`art/ai/workflows/`）＋ Python 腳本（`tools/art/ai/`）跑，seed、模型檔名、參數寫進輸出旁邊的 `meta.json`。MCP 只用來安裝、除錯、單張試圖。
2. **先少後多**：每個動作先跑 4 個 seed 出對照表，挑最好的再做後處理，不要一口氣跑完全部。
3. **自己看圖**：每一步都輸出放大 4 倍的對照表（PNG），用 Read 看圖，依 TEST_SPEC 的驗收標準判斷，不合格就換 seed 或改提示詞，記下原因。
4. **大檔不進 git**：ComfyUI 原始輸出、影片放 `art/ai/raw/`（已 gitignore）；只提交最終 64×64 sheet、對照表、GIF、報告。
5. **卡住就記錄**：節點裝不起來、模型爆 VRAM、效果很差，都寫進 `REPORT.md` 的「問題」區，附錯誤訊息，然後換備案繼續。
