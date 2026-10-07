# Flow Inspector Phase 2 收尾（review note）

**一句話**：edges 連線與剪貼簿複製的「核心」在前一段已實作並提交（typecheck 綠燈、16 測試全過）；本次只做兩個小收尾 —— 複製成功給明確提示、舊/壞存檔走「清掉重來」。

## 函式 / 檔案清單

| 檔案 / 函式 | 職責 | 本次 |
|---|---|---|
| `StarterApp.tsx` → `SelectedItemEditor` `copyFixPrompt()` + `copied` state | 複製成功 → 按鈕秒變「✓ 已複製!」1.8s，不再靠會變紅的狀態列 | [修改] |
| `StarterApp.tsx` → 修正 prompt 按鈕 | 文字/樣式依 `copied` 切換 | [修改] |
| `styles.css` → `.fix-prompt-button.copied` | 已複製時轉綠 | [新增] |
| `starter-runtime.ts` → `reload()` catch | 讀到不相容舊存檔(`StarterDomainError`) → 清掉 slot，回友善訊息（選項 B） | [修改] |
| `parseNextTargets()` / `drawFlowEdge()` / `flush()` | edges 連線渲染 | 現狀✓（不改，肉眼驗證） |

## 關鍵資料結構 / state
- 節點欄位：`title / status(ok|warn|broken) / offsetX,offsetY / ref / notes / next`。
- `next`："2,3" = 連到第 2、第 3 步（1-based，逗號/空白分隔）。
- 新增 UI state：`SelectedItemEditor` 內 `copied: boolean` + `copiedTimer` ref（卸載時清除）。

## 行為決策
- **#1 舊/壞存檔 = 清掉重來(B)**：啟動只載空白再 seed，不碰 localStorage → 啟動永遠不會崩。只有按「重新載入」才讀存檔；若格式不相容，直接覆寫成空白存檔並提示，畫面維持目前 seed 狀態。
- **#2 複製提示**：原本把成功訊息丟頂部狀態列，但該訊息不符合 ok 樣式判斷會被塗紅 → 改用按鈕本體就地回饋。
- **#3 edges**：已完成，本次不動程式，只在瀏覽器確認線與箭頭。

## 風險 / 待確認
- 清存檔只在 `reload()` 偵測到 `StarterDomainError` 時觸發，不影響正常存檔。
- clipboard 無權限時維持 `window.prompt` fallback。
