# 音效與音樂

全部音效、環境音與背景音樂都是**程式即時生成**（Web Audio + 自寫 DSP），
沒有任何外部音檔，因此**沒有授權問題、不用下載、也不增加載入時間**（程式碼約 30 KB）。
授權與本專案程式碼相同。

## 架構

```
src/systems/GameEvents.ts   每個場景一條的型別化事件匯流排（玩法只負責 emit「發生了什麼」）
src/audio/dsp.ts            濾波器、包絡、殘響、無縫循環等小工具
src/audio/SfxBank.ts        每種音效的配方（槍聲、換彈、彈殼、霧屍、路障、主角、介面）
src/audio/MusicBank.ts      背景音樂兩層 + 夜風 + 蟲鳴
src/audio/AudioManager.ts   單例：音量匯流排、靜音、變體/音高、左右聲道、發聲數限制、手機解鎖
src/audio/AudioBridge.ts    attachAudio(scene)：把 GameEvents 對應到聲音，依鏡頭算左右聲道
```

事件匯流排是「射擊／移動／受擊手感」那邊建立的 `GameEvents.of(scene)`；
其他系統（NPC 隊友、據點建造）只要 emit 事件就會有聲音，不需要 import 音效程式。目前對應：

| 事件 | 聲音 |
| --- | --- |
| `player:shoot` | 各武器槍聲（`shot_<武器id>`，沒有就用對照表）＋彈殼落地；霰彈槍會接泵動聲 |
| `player:dryfire` | 空膛喀噠 |
| `player:reload-start` / `-end` | 彈匣退出／插入＋拉滑套；霰彈槍是一顆顆塞子彈＋泵動 |
| `player:weapon-switch` | 換槍 |
| `player:step` | 碎石腳步（左右腳音高略不同） |
| `player:hurt` / `player:heartbeat` / `player:death` | 悶哼、低血量心跳、倒下 |
| `enemy:spawn` / `enemy:death` | 計算場上數量 → 配樂緊張度；倒地聲（大隻音高較低） |
| `enemy:groan` / `enemy:attack` / `enemy:hit` | 低吼、撲咬、打肉、爆頭 |
| `barricade:hit` / `barricade:break`、`base:hit` | 木頭敲擊、路障崩塌、撞牆 |
| `wave:start`、`game:over` | 警報號角、勝利／失敗短樂句 |

介面音效直接呼叫 `AudioManager.ui('tap' | 'confirm' | 'back')`。

## 動態配樂

兩層 16 秒循環（A 小調，120 BPM）同時播放、拍子對齊：
- `music_calm`：陰暗合成器長音 + 零星鐘聲
- `music_tension`：心跳鼓 + 八分音符低音 + 遠處金屬敲擊

場上霧屍越多，第二層越大聲（8 隻以上全開）。夜晚另有夜風與蟲鳴（戰鬥越激烈蟲越安靜）。

## 設定

- 主選單右下：音樂／音效音量（0–10），存在 `localStorage` 的 `llo-audio`
- 戰鬥 HUD 右上喇叭：靜音；電腦可按 **M**
- 手機瀏覽器要求使用者互動後才能出聲：第一次點擊／按鍵時自動解鎖
- 切到背景分頁時自動暫停

## 想換成真實錄音？

在 `AudioManager.ts` 的 `SAMPLE_OVERRIDES` 填上檔案路徑（放在 `public/assets/audio/`），
同名音效就會改用音檔，載入失敗會自動退回程式生成版本。建議只用 **CC0** 素材，免標註：

- Kenney（https://kenney.nl/assets ，CC0）：Impact Sounds、Interface Sounds、Sci-fi Sounds
- OpenGameArt（https://opengameart.org ，篩選 CC0）
- Freesound（https://freesound.org ，篩選 Creative Commons 0）

加入音檔時請在本文件下方記錄「檔名 / 來源網址 / 作者 / 授權」。

| 檔名 | 來源 | 作者 | 授權 |
| --- | --- | --- | --- |
| （目前沒有外部音檔） | | | |

## 調整聲音

每個配方都有 `volume`（音量）、`pitch`（隨機 ±半音）、`maxVoices`（同時發聲數）、`minGapMs`（最短間隔）。
想試聽可以在瀏覽器 console 執行（需先點過畫面解鎖）：

```js
// 開發模式下
import('/src/audio/AudioManager.ts').then(m => m.AudioManager.play('shot_shotgun'))
```
