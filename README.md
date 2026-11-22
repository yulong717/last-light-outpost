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
| 移動（上下左右） | WASD 或方向鍵 | 左下角虛擬搖桿 |
| 瞄準射擊 | 滑鼠瞄準、左鍵射擊 | 點住畫面瞄準射擊 |
| 換彈 | R | 右下「換彈」 |
| 換槍 | 1／2 或 Q | 右下「換槍」 |
| 靜音 | M | 右上喇叭 |

## 目前進度（M0 骨架 + 防守雛形）

- 640×360 像素解析度（720p 2 倍、1080p 3 倍），FIT 等比縮放，手機直向時提示轉橫向
- 像素角色（PixelLab）＋程式化動畫與特效，流程與免費工具見 [docs/ART_PIPELINE.md](docs/ART_PIPELINE.md)
- 2.5D 帶狀戰場：主角與霧屍都能前後左右移動，依腳底 y 排序前後；戰場寬 1280，鏡頭跟著主角捲動
- 霧屍會沿著路障散開；主角翻出路障外、靠太近時會被追擊（主角有獨立血量）
- 夜晚防守：手槍、霰彈槍、爆頭判定、穿透、擊退；3 種霧屍；路障與據點耐久；3 波
- 音效與音樂全部程式生成（無授權問題）：每把槍不同槍聲、換彈、彈殼、腳步、霧屍、路障、心跳、動態配樂、夜風蟲鳴；左右聲道、音量設定、M 靜音，見 [docs/AUDIO.md](docs/AUDIO.md)
- 輸入抽象層（`src/input/InputManager.ts`），鍵鼠與觸控共用遊戲邏輯
- 數值全部在 `src/data/`
- 手感：開槍鏡頭後頓與 trauma 震動、連射／移動散射（準星會張開）、命中 ✕ 確認、槍口閃光照亮；
  移動有加減速、倒退走較慢、腳步揚塵；受擊閃白轉紅、擊退、無敵閃爍、紅邊與低血量心跳、手機／手把震動。
  數值在 `src/feel/FeelConfig.ts`（全域）與 `src/data/weapons.ts`（每把槍）
- 遊戲事件匯流排 `src/systems/GameEvents.ts`：`player:shoot`、`enemy:hit`、`player:hurt`、`player:step` 等，
  音效、NPC 等系統用 `GameEvents.of(scene).on(...)` 訂閱，不必改玩法程式

### 據點布置（白天）

一天的流程：白天布置 → 按「開始夜晚」（或 Enter）→ 夜晚防守 → 撐過就進入下一天，建築、路障耐久、廢料都保留。

- 戰場上有 10 個固定槽位：路障後方 2 座高台（砲塔／照明燈），前方三排地面點（沙包牆／尖刺陷阱／照明燈）
- 點槽位跳出面板：空槽位選建築；已蓋的可升級（最高 Lv3）、修理、拆除（退一半）
- 點主路障可強化（300 → 420 → 560）與修理；點左側外牆可修理據點耐久
- 沙包牆擋住同一排的霧屍，牠們會停下來拆；陷阱刺傷＋減速；照明燈讓光圈內的霧屍變慢；砲塔自動射擊前方
- 廢料：開局 80，擊殺掉落（2／3／8），撐過一夜 +20，每天白天固定 +25（白天探索做好前的暫代收入）
- 槽位、數值都在 `src/data/buildings.ts`；邏輯在 `src/build/`（Outpost、BuildMode）與 `src/scenes/BuildUIScene.ts`

## 資料夾

```
src/
  scenes/    Boot, Menu, Defense, UI(HUD), BuildUI（白天布置面板）, GameOver
  build/     Outpost（建築與修理）, BuildMode（槽位點選）
  entities/  Zombie, Barricade, Building
  systems/   WeaponSystem（hitscan 射擊）, WaveSpawner, GameEvents（事件匯流排）
  feel/      手感：CameraFeel, Crosshair, ScreenFeedback, Haptics, FeelConfig
  input/     InputManager
  audio/     AudioManager（程式生成音效與音樂）、AudioBridge（事件→聲音）
  state/     GameState（含 localStorage 存檔）
  data/      weapons, enemies, waves, buildings
public/assets/  之後放像素圖、地圖、音效
```

## 部署

推到 `main` 後，GitHub Actions 會自動部署到 GitHub Pages。
第一次需要到 repo 的 Settings → Pages，把 Source 設為「GitHub Actions」。
