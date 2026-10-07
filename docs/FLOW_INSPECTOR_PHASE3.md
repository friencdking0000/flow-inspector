# Flow Inspector Phase 3（review note）

**一句話**：讓 Flow Inspector 支援「多專案/多流程切換」，並讓節點 ref（file:line）能用本機編輯器一鍵開啟。

## 邏輯圖

```
【專案層（新增）】project-store.ts
  localStorage
    ├─ starter-app.projects.v1   → { activeId, projects:[{id,name,rootPath}] }
    └─ starter-app.doc.<id>.v1   → 每個專案各一份流程存檔（沿用既有 wrapper 格式）
  createProjectStorage(base)  [新增]
    └─ 把 runtime 固定用的 STARTER_STORAGE_SLOT 轉址到 doc.<activeId>
       其餘 key 原樣透傳；切換專案 = setActive(id)

【切換流程】StarterApp
  switchProject(id)  [新增]
    runtime.save()            → 存目前專案（adapter active=舊）
    projectStorage.setActive(id)
    runtime.reload()          → 讀目標專案
      └─ 讀不到(新專案) → runtime.newDocument()  [新增於 runtime] 空白畫布
  createProject / renameProject / deleteProject / setProjectRoot  [新增]
  init effect（取代舊 seed effect）[修改]
    無專案 → 建預設「CrystalCraft（NANOMATERIALS）」+ seed + save
    有專案 → setActive + reload

【開啟本地檔案（Feature 3）】SelectedItemEditor
  parseFileRef(ref)   [新增]  "index.html:402" → {file, line}
  buildEditorUri(root,ref) [新增] → vscode://file/<abs>:<line>
  ref 下方出現：〔在編輯器開啟〕(a href=vscode://) +〔複製路徑〕 [新增]
  需要該專案的 rootPath；未設定 → 顯示提示

【影響面】
  starter-runtime.ts：+newDocument()（core.load(空白)）
  StarterApp.tsx：useStarterRuntime 改注入 projectStorage.storage；
                  header 下方新增 .project-bar；編輯器加開檔 UI
  styles.css：.project-bar / .open-file-* 樣式
```

## 關鍵資料結構
- `FlowProject { id, name, rootPath }`、`ProjectsState { activeId, projects }`。
- 每專案存檔分槽 `starter-app.doc.<id>.v1`，透過 storage adapter 轉址，runtime 其餘程式不用改。

## 風險 / 待確認
- **瀏覽器無法直接開本機檔**：改用 `vscode://file/...` 深層連結（需本機裝 VS Code 並註冊協定）。非 file:line 的 ref（如 `rebuild()`）不顯示開啟鈕。另附「複製絕對路徑」通用後路。
- **儲存被拒（測試情境）**：init effect 於 `unavailableReason` 時整段跳過，畫面照常顯示錯誤、不白屏。
- rootPath 用正斜線組出絕對路徑；Windows 走 `vscode://file/C:/...`。
- 切換/新增專案會自動先 `save()` 目前專案，避免未存變動遺失。
