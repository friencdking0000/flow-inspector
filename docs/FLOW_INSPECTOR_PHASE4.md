# Flow Inspector Phase 4（review note）

**一句話**：加「匯入 JSON」——貼上一段步驟陣列，一次把整張流程灌進目前專案（取代現有內容），省去逐步手動輸入。

## 邏輯圖

```
project-bar〔匯入〕 → setImportOpen(true)
  ImportModal（textarea + 匯入/取消）
    importFlow(text)  [新增]
      JSON.parse → 必須是陣列
      每個元素：title 必填；status 預設 ok；ref/notes/next 預設 ''
      驗證失敗 → setImportError（不關窗）
      成功：
        runtime.newDocument()           清空目前專案畫布
        for step: runtime.feature.addItem(...)
        runtime.save()
      → 關窗、提示「已匯入 N 個步驟」
```

## 匯入格式
```json
[
  { "title": "步驟名", "status": "ok|warn|broken",
    "ref": "src/x.ts:10", "notes": "說明", "next": "2,3" }
]
```
- `title` 必填；其餘可省。`status` 非 ok/warn/broken 一律當 ok。
- `next` 接受字串 `"2,3"`、數字 `2`、或陣列 `[2,3]` → 一律轉成逗號字串。

## 關鍵決策
- **匯入＝取代**目前專案的整張流程（先 `newDocument()` 清空），這樣步驟的 1-based `next` 編號才會對齊匯入批次；避免「附加」造成連線編號錯位。
- 建議用法：先〔＋新增〕空白專案 → 設根目錄 → 〔匯入〕貼 JSON。

## 檔案 / 函式
| 檔案 | 改動 | 標記 |
|---|---|---|
| `StarterApp.tsx` → `importFlow()` + import state + ImportModal | 匯入邏輯與 UI | [新增] |
| `StarterApp.tsx` → project-bar〔匯入〕鈕 | 觸發 | [修改] |
| `styles.css` → `.import-overlay/.import-dialog` | 彈窗樣式 | [新增] |
| `docs/flows/whealth.flow.json` | WHealth 12 步流程，供匯入 | [新增] |

## 風險 / 待確認
- 取代式匯入會清掉目前專案內容 → modal 內明標警語。
- 儲存不可用時（測試情境）不受影響：匯入是使用者主動操作，失敗以 importError 呈現。
