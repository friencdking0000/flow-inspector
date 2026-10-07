# Flow Inspector 改造計畫（review note）

**一句話**：把 asyra starter 的通用 `Item` 改造成「流程步驟節點」，每個節點記錄 `title / status / ref(函式或檔案) / notes`，用顏色即時顯示 ✅正常 / ⚠️待驗證 / ❌壞掉，並讓壞掉的節點一鍵產生「請 Claude 修正」的 prompt。

## 函式 / 檔案清單

| 檔案 / 函式 | 職責 | 本次 |
|---|---|---|
| `item-domain.ts` → `ITEM_STATUSES` | 狀態列舉 todo/doing/done → `ok/warn/broken` | [修改] |
| `item-domain.ts` → `createItemPropertySchema` | schema 加 `ref`、`notes` 兩個字串欄 | [修改] |
| `item-domain.ts` → `isItemStatus` / `STARTER_DOCUMENT_VERSION` | 驗證更新、版本 +1 | [修改] |
| `starter-runtime.ts` → addItem/editItem 指令 | 帶入 `ref`、`notes` 欄位 | [修改] |
| `projection-store.ts` | 投影列輸出 `ref`、`notes` | [修改] |
| `StarterApp.tsx` → 狀態下拉 / 卡片 | 顯示 ✅⚠️❌、依狀態上色 | [修改] |
| `StarterApp.tsx` → inspector | 新增 `ref` / `notes` 輸入 | [新增] |
| `StarterApp.tsx` → `onClickBroken()` | ❌節點 →「複製修正 prompt」 | [新增] |
| `styles.css` | 三狀態顏色 | [修改] |

## 資料結構
```ts
Step {
  title: string
  status: 'ok' | 'warn' | 'broken'   // ✅ / ⚠️ / ❌
  ref: string                        // function 名或 file:line
  notes: string
  offsetX, offsetY: number           // 畫布座標（既有）
}
```

## 影響面 (blast radius)
- 改 `ITEM_STATUSES` 會影響：schema 驗證、UI 下拉、既有存檔相容性（故版本號 +1，舊存檔以預設值 migrate）。
- 新增欄位走 starter 既有的 `itemField` 擴充機制 + 自訂，確保 Save/Reload/Undo 一致。

## 風險 / 待確認
- [ ] 狀態改名後，舊 localStorage 存檔要能 migrate（todo→ok 等）或直接清掉重來？
- [ ] Phase 2 的節點連線 (edges) 是否要這次就做？（較大）
- [ ] 「複製修正 prompt」是純剪貼簿複製，還是要寫到某個檔案給 Claude 讀？

## Phase 2（之後）
- 節點之間的連線 edges，表達流程順序與相依。
