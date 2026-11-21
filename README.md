# 殘光據點 Last Light Outpost

像素風橫向生存射擊網頁遊戲：白天探索搜刮、夜晚守住據點、主動進攻霧巢。
技術：Phaser 3 + TypeScript + Vite。電腦優先，同時支援手機觸控與橫向畫面。

## 開始

```bash
npm install
npm run dev      # 開發伺服器 http://localhost:5173（同網路的手機可用電腦 IP 連線測試）
npm run build    # 型別檢查 + 打包到 dist/
```

## 操作

| | 電腦 | 手機 |
| --- | --- | --- |
| 瞄準射擊 | 滑鼠瞄準、左鍵射擊 | 點住畫面瞄準射擊 |
| 換彈 | R | 右下「換彈」 |
| 換槍 | 1／2 或 Q | 右下「換槍」 |

## 目前進度（M0 骨架 + 防守雛形）

- 480×270 像素解析度，FIT 等比縮放，手機直向時提示轉橫向
- 色塊佔位圖（`BootScene` 產生），之後放入同名像素圖即可替換
- 夜晚防守：手槍、霰彈槍、爆頭判定、穿透、擊退；3 種霧屍；路障與據點耐久；3 波
- 輸入抽象層（`src/input/InputManager.ts`），鍵鼠與觸控共用遊戲邏輯
- 數值全部在 `src/data/`

## 資料夾

```
src/
  scenes/    Boot, Menu, Defense, UI(HUD), GameOver
  entities/  Zombie, Barricade
  systems/   WeaponSystem（hitscan 射擊）, WaveSpawner
  input/     InputManager
  state/     GameState（含 localStorage 存檔）
  data/      weapons, enemies, waves
public/assets/  之後放像素圖、地圖、音效
```

## 部署

推到 `main` 後，GitHub Actions 會自動部署到 GitHub Pages。
第一次需要到 repo 的 Settings → Pages，把 Source 設為「GitHub Actions」。
