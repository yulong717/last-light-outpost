# 協作方式：本地生成 ↔ 雲端審圖與接進遊戲

兩邊分工：

| 誰 | 做什麼 |
| --- | --- |
| **本地 Claude Code**（使用者電腦） | 安裝、跑 ComfyUI、寫與調整 `tools/art/ai/` 腳本與 `art/ai/workflows/`、產出 sprite、寫 `REPORT.md` |
| **專案 thread 的 Claude**（雲端） | 審對照表與 GIF、提出修改意見、把通過的 sprite 接進遊戲（BootScene、動畫定義、WeaponRig 對位）、錄前後對比 |
| **使用者** | 決定 H3 設定與哪些結果可以用；在兩邊之間說一句話轉達即可 |

## 1. 分支與資料夾

- 本地工作分支：**`ai-art/test-01`**，從 `main` 開（這份交接文件在 PR #28；若 PR #28 還沒合併，就從 `claude/project-thread-2oxpov` 開）。之後每輪測試開新分支 `ai-art/test-02`…
- 不要直接推 `main`。
- 要提交的：

```
art/ai/
  mannequins/M/...           人台與姿勢模板（512 與 64）
  characters/*.yaml          角色清單（可修改）
  workflows/*.json           ComfyUI API 工作流
  out/
    REPORT.md                本輪報告（見第 3 節）
    compare_lineup.png       兩角色並排
    compare_settings.png     H3 設定比較（LoRA 有無、倍率、循環方式）
    akai/<action>.png|.json|.gif, contact_<action>.png, meta.json
    zombie_basic/...
tools/art/ai/*.py            腳本
```

- **不提交**（加進 `.gitignore`）：`art/ai/raw/`（ComfyUI 原始輸出、影片）、`.venv-art/`、模型檔。
- 單一 PNG 盡量 < 2MB；GIF 若太大，降到 3 倍放大或縮短。

## 2. 回傳流程

1. 每完成一個階段（人台 → 阿凱 → 霧屍 → 比較）就 commit＋push 到 `ai-art/test-01`。
2. 第一次 push 後開 **Draft PR**（標題：`AI 像素角色測試 01`），之後持續推到同一個 PR。
3. 使用者到專案 thread 說一句「test-01 推上去了」（或貼 PR 連結）。
4. 雲端 Claude 拉分支、看 `REPORT.md` 與圖，在 PR 或 thread 回覆意見。
5. 使用者把意見貼回本地 Claude Code（或叫它讀 PR 留言），進下一輪。

> 若不方便開 PR：也可以把 `art/ai/out/` 整個資料夾壓縮後上傳到專案的檔案區，雲端這邊一樣能審。

## 3. REPORT.md 範本

```markdown
# AI 像素角色測試 01

## 環境
- ComfyUI 版本 / PyTorch / CUDA / 驅動
- 已安裝節點、模型（檔名）

## 試跑紀錄
| 模型 | 解析度/幀數 | 耗時 | VRAM 峰值 | 備註 |

## 結果
| 角色 | 動作 | 設定 | 品質 1–5 | 重抽次數 | 耗時 | 問題 |

## 驗收清單
（貼 TEST_SPEC 第 7 節，逐項打勾）

## 問題與處理
- 問題、錯誤訊息、怎麼繞過

## 建議
- 哪組 H3 設定、哪些步驟要改、全部角色的時間估算
```

## 4. 雲端這邊會怎麼審

- 看 `contact_*.png`：腳底線、中線、比例、外框、雜點。
- 看 GIF：節奏、是否閃色、姿勢讀不讀得懂。
- 用腳本複驗：顏色數、每格腳底 y、不透明像素邊界。
- 放進遊戲實測：在一個測試分支替換 `player` / `zombie_basic` 的貼圖與動畫，錄 GIF 前後對比，確認 WeaponRig 手臂與槍是否對得上、擊中特效位置是否正確。

## 5. 接進遊戲（雲端負責，本地不用做）

- 新 sheet 放 `public/assets/sprites/`，BootScene 以 `frameWidth: 64` 載入。
- 動畫定義依 `.json` 的格數與 fps 建立。
- 主角持槍動作需要部位遮罩（`tools/art/make_player_regions.py` 的做法）與肩膀錨點，雲端會依無手臂版調整 WeaponRig。
- 霧屍需確認 `ZombieComposer` 換色仍正確、`registerHeadFrames()` 的斷頭切割位置。

## 6. 何時回到雲端討論

- H3 設定比較結果出來時（決定 LoRA、倍率、循環方式）。
- 某個動作反覆失敗（例如 5 次以上都不合格），需要調整規格或改用手修。
- 要開始量產其他角色之前。
