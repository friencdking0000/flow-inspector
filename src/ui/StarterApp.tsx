import { useEffect, useMemo, useRef, useState } from 'react'
import type { ItemProjection, ItemStatus } from '../domain/item-domain.js'
import { ITEM_STATUSES } from '../domain/item-domain.js'
import { refItemField } from '../domain/ref-item-field.js'
import { notesItemField } from '../domain/notes-item-field.js'
import { nextItemField } from '../domain/next-item-field.js'
import {
  createStarterRuntime,
  getStarterItemRenderBounds,
  getStarterRenderHeight,
  type StarterRuntime
} from '../runtime/starter-runtime.js'
import {
  createProjectStorage,
  genProjectId,
  getBaseStorage,
  loadProjectsState,
  migrateLegacyDocToProject,
  removeProjectDoc,
  saveProjectsState,
  type FlowProject,
  type ProjectsState
} from '../runtime/project-store.js'
import './styles.css'

// 預設專案（第一次開啟）對應的本機根目錄，供「開啟檔案」組出絕對路徑。
const DEFAULT_PROJECT_ROOT =
  'C:/Users/GIGABYTE/Documents/Obsidian Vault/GitHub/stustclass/NANOMATERIALS'

interface FileRef {
  readonly file: string
  readonly line?: number
}

// 從 ref 文字抓出「檔名(.副檔名)[:行號]」，抓不到(例如 rebuild())回傳 null。
const parseFileRef = (ref: string): FileRef | null => {
  const match = ref
    .trim()
    .match(/([A-Za-z0-9_\-./\\]+\.[A-Za-z0-9]+)(?::(\d+))?/)
  if (!match) return null
  return { file: match[1], line: match[2] ? parseInt(match[2], 10) : undefined }
}

const toAbsPath = (root: string, file: string): string => {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const rel = file.replace(/\\/g, '/').replace(/^\/+/, '')
  return base + '/' + rel
}

// 組出 VS Code 深層連結：vscode://file/<絕對路徑>:<行號>
const buildEditorUri = (root: string, ref: FileRef): string =>
  'vscode://file/' +
  toAbsPath(root, ref.file) +
  (ref.line ? ':' + ref.line : '')

// 本 app 啟用的三個自訂欄位：ref（連結位置）+ notes（備註）+ next（連線目標步驟號）
const ITEM_FIELDS = [refItemField, notesItemField, nextItemField]

const statusLabels: Record<ItemStatus, string> = {
  ok: '✅ 正常',
  warn: '⚠️ 待驗證',
  broken: '❌ 壞掉'
}

// 讀取某步驟的 ref（function 名稱 / file:line）
const itemRef = (item: ItemProjection): string =>
  typeof item.fields?.ref === 'string' ? item.fields.ref : ''

// 讀取某步驟的 notes（備註）
const itemNotes = (item: ItemProjection): string =>
  typeof item.fields?.notes === 'string' ? item.fields.notes : ''

// 讀取某步驟的 next（連線目標步驟號，1-based，逗號分隔）
const itemNext = (item: ItemProjection): string =>
  typeof item.fields?.next === 'string' ? item.fields.next : ''

// 首次開啟時自動塞入的 CrystalCraft（NANOMATERIALS）真實流程
const SEED_STEPS: readonly {
  title: string
  status: ItemStatus
  ref: string
  notes: string
  next: string
}[] = [
  {
    title: '載入 Three.js（CDN→內嵌）',
    status: 'ok',
    ref: 'lib/three.min.js（已內嵌）',
    notes: '改成單一離線檔，不依賴 CDN。',
    next: '2'
  },
  {
    title: 'initThree() 建立場景',
    status: 'ok',
    ref: 'initThree()',
    notes: '相機、燈光、OrbitControls。',
    next: '3'
  },
  {
    title: 'rebuild() 依 state 重建 3D',
    status: 'ok',
    ref: 'rebuild()',
    notes: '每次參數變動都重建場景。',
    next: '4'
  },
  {
    title: '修正語法錯誤：多餘的 )',
    status: 'ok',
    ref: 'rebuild() 的 forEach 那行',
    notes: '多一個 ) 讓整支 JS 無法編譯。',
    next: '5'
  },
  {
    title: 'editMotif() 即時編輯 x/y/z',
    status: 'ok',
    ref: 'editMotif() / oninput',
    notes: '改成不重建表格，避免焦點被摧毀。',
    next: '6'
  },
  {
    title: '輸入框字體顏色 + 欄寬',
    status: 'ok',
    ref: 'renderMotif() / CSS table-layout',
    notes: 'table-layout:fixed 讓數值放得下。',
    next: '7'
  },
  {
    title: '元素週期表（新增/參考）',
    status: 'ok',
    ref: 'buildPeriodicTable() / ptAdd()',
    notes: '118 元素，點擊即新增原子。',
    next: '8'
  },
  {
    title: 'Flow Inspector：notes 第二欄位',
    status: 'ok',
    ref: 'itemFields[] 一般化（ref + notes）',
    notes: '已修：單一 itemField → 陣列。',
    next: '9'
  },
  {
    title: 'Flow Inspector：節點連線 edges',
    status: 'ok',
    ref: 'FlowEdges（SVG 疊層）',
    notes: 'next 欄位 → SVG 連線＋箭頭＋流動動畫。',
    next: ''
  }
]

// ❌ 節點 → 產生交給 Claude 的修正 prompt
const buildFixPrompt = (item: ItemProjection): string =>
  `請修正 Flow Inspector 流程中的這一步：\n` +
  `步驟：「${item.title}」\n` +
  `相關位置 (ref)：${itemRef(item) || '（未填）'}\n` +
  `備註 (notes)：${itemNotes(item) || '（未填）'}\n` +
  `目前狀態：❌ 壞掉\n` +
  `請找出原因並修正，修好後把此節點狀態改回 ✅。`

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const useStarterRuntime = () => {
  const base = useMemo(() => getBaseStorage(), [])
  const projectStorage = useMemo(() => createProjectStorage(base), [base])
  const runtime = useMemo(
    () =>
      createStarterRuntime({
        itemFields: ITEM_FIELDS,
        storage: projectStorage.storage
      }),
    [projectStorage]
  )
  const [items, setItems] = useState<readonly ItemProjection[]>([])
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('Starting runtime...')
  const [canvasWidth, setCanvasWidth] = useState(800)

  useEffect(() => {
    const host = document.getElementById('starter-render-host')
    if (!host) {
      setMessage('Render host is missing.')
      return
    }

    let active = true
    const unsubscribe = runtime.projection.subscribe(setItems)
    const resize = (): void => {
      if (!active) return
      const width = Math.max(1, host.clientWidth || 800)
      const height = Math.max(390, host.clientHeight || 390)
      setCanvasWidth(width)
      runtime.resize(width, height)
    }
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)

    runtime
      .start(host, {
        width: Math.max(1, host.clientWidth || 800),
        height: Math.max(390, host.clientHeight || 390)
      })
      .then(() => {
        if (!active) return
        setReady(true)
        setMessage(runtime.storageStatus ?? 'Ready')
        observer?.observe(host)
        resize()
      })
      .catch((error: unknown) => {
        if (active) setMessage(errorMessage(error))
      })

    return () => {
      active = false
      observer?.disconnect()
      unsubscribe()
      void runtime.dispose()
    }
  }, [runtime])

  return {
    items,
    message,
    ready,
    runtime,
    setMessage,
    canvasWidth,
    base,
    projectStorage
  }
}

const SelectedItemEditor = ({
  item,
  runtime,
  onEdit,
  projectRoot
}: {
  readonly item: ItemProjection
  readonly runtime: StarterRuntime
  readonly onEdit: (message: string) => void
  readonly projectRoot: string
}) => {
  const [title, setTitle] = useState(item.title)
  const [refValue, setRefValue] = useState(itemRef(item))
  const [notesValue, setNotesValue] = useState(itemNotes(item))
  const [nextValue, setNextValue] = useState(itemNext(item))
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    []
  )

  useEffect(() => {
    setTitle(item.title)
  }, [item.id, item.title])

  useEffect(() => {
    setRefValue(itemRef(item))
    setNotesValue(itemNotes(item))
    setNextValue(itemNext(item))
  }, [item.id, item])

  const commitTitle = (): void => {
    if (title === item.title) return
    try {
      runtime.feature.editItem(item.id, { title })
      onEdit('已更新標題 - 尚未儲存')
    } catch (error) {
      setTitle(item.title)
      onEdit(errorMessage(error))
    }
  }

  const commitRef = (): void => {
    if (refValue === itemRef(item)) return
    try {
      runtime.feature.editItem(item.id, { fields: { ref: refValue } })
      onEdit('已更新 ref - 尚未儲存')
    } catch (error) {
      setRefValue(itemRef(item))
      onEdit(errorMessage(error))
    }
  }

  const commitNotes = (): void => {
    if (notesValue === itemNotes(item)) return
    try {
      runtime.feature.editItem(item.id, { fields: { notes: notesValue } })
      onEdit('已更新 notes - 尚未儲存')
    } catch (error) {
      setNotesValue(itemNotes(item))
      onEdit(errorMessage(error))
    }
  }

  const commitNext = (): void => {
    if (nextValue === itemNext(item)) return
    try {
      runtime.feature.editItem(item.id, { fields: { next: nextValue } })
      onEdit('已更新連線 - 尚未儲存')
    } catch (error) {
      setNextValue(itemNext(item))
      onEdit(errorMessage(error))
    }
  }

  const flashCopied = (): void => {
    setCopied(true)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 1800)
  }

  const copyFixPrompt = (): void => {
    const prompt = buildFixPrompt(item)
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(prompt)
        .then(flashCopied)
        .catch(() => {
          window.prompt('複製下面的修正 prompt：', prompt)
        })
    } else {
      window.prompt('複製下面的修正 prompt：', prompt)
    }
  }

  return (
    <div className="item-editor">
      <div className="editor-heading">
        <strong>編輯步驟</strong>
        <span>已選取</span>
      </div>
      <label className="field-label" htmlFor="selected-item-title">
        步驟名稱
      </label>
      <input
        id="selected-item-title"
        aria-label="步驟名稱"
        value={title}
        onBlur={commitTitle}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <p className="field-help">按 Enter 套用名稱</p>
      <label className="field-label" htmlFor="selected-item-ref">
        ref（function 名稱 / file:line）
      </label>
      <input
        id="selected-item-ref"
        aria-label="ref"
        placeholder="例如 editMotif() 或 index.html:402"
        value={refValue}
        onBlur={commitRef}
        onChange={(event) => setRefValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <p className="field-help">哪步壞掉就靠這個 ref 找實作位置</p>
      {(() => {
        const fileRef = parseFileRef(refValue)
        if (!fileRef) return null
        if (!projectRoot) {
          return (
            <p className="field-help open-file-hint">
              設定上方專案「根目錄」後，可一鍵開啟 {fileRef.file}
            </p>
          )
        }
        const abs = toAbsPath(projectRoot, fileRef.file)
        return (
          <div className="open-file-row">
            <a
              className="open-file-btn"
              href={buildEditorUri(projectRoot, fileRef)}
            >
              ↗ 在 VS Code 開啟
              {fileRef.line ? '（第 ' + fileRef.line + ' 行）' : ''}
            </a>
            <button
              type="button"
              className="open-file-btn ghost"
              onClick={() => {
                if (navigator.clipboard?.writeText) {
                  navigator.clipboard
                    .writeText(abs)
                    .then(() => onEdit('已複製絕對路徑'))
                    .catch(() => window.prompt('複製絕對路徑：', abs))
                } else {
                  window.prompt('複製絕對路徑：', abs)
                }
              }}
            >
              複製路徑
            </button>
          </div>
        )
      })()}
      <label className="field-label" htmlFor="selected-item-notes">
        notes（備註）
      </label>
      <textarea
        id="selected-item-notes"
        aria-label="notes"
        className="notes-input"
        rows={3}
        placeholder="這一步的備註、觀察、待確認事項…"
        value={notesValue}
        onBlur={commitNotes}
        onChange={(event) => setNotesValue(event.target.value)}
      />
      <p className="field-help">失焦時自動套用</p>
      <label className="field-label" htmlFor="selected-item-next">
        連到步驟（1-based，逗號分隔）
      </label>
      <input
        id="selected-item-next"
        aria-label="連到步驟"
        placeholder="例如 2,3 代表連到第 2、第 3 步"
        value={nextValue}
        onBlur={commitNext}
        onChange={(event) => setNextValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <p className="field-help">畫布上會畫出指向目標步驟的箭頭連線</p>
      <div className="field-label">狀態</div>
      <div className="status-control" role="group" aria-label="狀態">
        {ITEM_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={status === item.status}
            className={
              (status === item.status ? 'active ' : '') + 'status-' + status
            }
            onClick={() => {
              if (status === item.status) return
              try {
                runtime.feature.editItem(item.id, { status })
                onEdit('已更新狀態 - 尚未儲存')
              } catch (error) {
                onEdit(errorMessage(error))
              }
            }}
          >
            {statusLabels[status]}
          </button>
        ))}
      </div>
      {item.status === 'broken' && (
        <button
          type="button"
          className={'fix-prompt-button' + (copied ? ' copied' : '')}
          onClick={copyFixPrompt}
        >
          {copied ? '✓ 已複製!' : '🛠 複製修正 prompt（交給 Claude）'}
        </button>
      )}
    </div>
  )
}

interface DragSession {
  readonly pointerId: number
  readonly startX: number
  readonly startY: number
  readonly startBounds: ReturnType<typeof getStarterItemRenderBounds>
  moved: boolean
  offset?: { x: number; y: number }
}

const CanvasItem = ({
  item,
  index,
  width,
  height,
  selected,
  runtime,
  onSelect,
  onMove
}: {
  readonly item: ItemProjection
  readonly index: number
  readonly width: number
  readonly height: number
  readonly selected: boolean
  readonly runtime: StarterRuntime
  readonly onSelect: () => void
  readonly onMove: (message: string) => void
}) => {
  const drag = useRef<DragSession | null>(null)
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null)
  const bounds = getStarterItemRenderBounds(
    index,
    width,
    preview ?? item.offset,
    height
  )

  useEffect(() => {
    if (
      preview &&
      !drag.current &&
      preview.x === (item.offset?.x ?? 0) &&
      preview.y === (item.offset?.y ?? 0)
    ) {
      setPreview(null)
      runtime.previewItemPosition(null)
    }
  }, [item.offset, preview, runtime])

  useEffect(() => () => runtime.previewItemPosition(null), [runtime])

  const cancelDrag = (): void => {
    drag.current = null
    setPreview(null)
    runtime.previewItemPosition(null)
  }

  return (
    <button
      type="button"
      className={'canvas-item' + (selected ? ' selected' : '')}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startBounds: getStarterItemRenderBounds(
            index,
            width,
            item.offset,
            height
          ),
          moved: false
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const session = drag.current
        if (!session || session.pointerId !== event.pointerId) return
        const deltaX = event.clientX - session.startX
        const deltaY = event.clientY - session.startY
        if (!session.moved && Math.hypot(deltaX, deltaY) < 3) return
        session.moved = true
        const fallback = getStarterItemRenderBounds(index, width)
        const x = Math.max(
          0,
          Math.min(width - bounds.width, session.startBounds.x + deltaX)
        )
        const y = Math.max(
          0,
          Math.min(height - bounds.height, session.startBounds.y + deltaY)
        )
        const offset = {
          x: Math.round(x - fallback.x),
          y: Math.round(y - fallback.y)
        }
        session.offset = offset
        setPreview(offset)
        runtime.previewItemPosition(item.id, offset)
      }}
      onPointerUp={(event) => {
        const session = drag.current
        if (!session || session.pointerId !== event.pointerId) return
        drag.current = null
        if (
          !session.moved ||
          !session.offset ||
          (session.offset.x === (item.offset?.x ?? 0) &&
            session.offset.y === (item.offset?.y ?? 0))
        ) {
          cancelDrag()
          onSelect()
          return
        }
        try {
          runtime.feature.moveItem(item.id, session.offset)
          onMove('Moved item - unsaved changes')
          onSelect()
        } catch (error) {
          cancelDrag()
          onMove(errorMessage(error))
        }
      }}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={() => {
        if (drag.current) cancelDrag()
      }}
      onClick={onSelect}
      aria-label={item.title}
      aria-pressed={selected}
    >
      <span className="canvas-item-top">
        <span>{String(index + 1).padStart(2, '0')} / 步驟</span>
        <span className={'item-status ' + item.status}>
          {statusLabels[item.status]}
        </span>
      </span>
      <strong>{item.title}</strong>
      <small>{itemRef(item) || '拖曳移動 · 點擊編輯'}</small>
    </button>
  )
}

// 畫布上的連線層：用 SVG 疊在卡片下方，箭頭用 <marker>，流動感用 dash 動畫。
const FlowEdges = ({
  items,
  width,
  height
}: {
  readonly items: readonly ItemProjection[]
  readonly width: number
  readonly height: number
}) => {
  const center = (index: number) => {
    const b = getStarterItemRenderBounds(
      index,
      width,
      items[index]?.offset,
      height
    )
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, h: b.height }
  }

  const edges: {
    key: string
    x1: number
    y1: number
    x2: number
    y2: number
    status: ItemStatus
  }[] = []

  items.forEach((item, from) => {
    itemNext(item)
      .split(/[\s,]+/)
      .map((token) => parseInt(token, 10))
      .filter((n) => Number.isFinite(n))
      .map((n) => n - 1)
      .forEach((to) => {
        if (to < 0 || to >= items.length || to === from) return
        const a = center(from)
        const b = center(to)
        const dx = b.x - a.x
        const dy = b.y - a.y
        const len = Math.hypot(dx, dy) || 1
        const ux = dx / len
        const uy = dy / len
        const endPad = Math.min(len * 0.42, b.h / 2 + 11) // 終點往回縮，箭頭落在卡片邊緣
        const startPad = Math.min(len * 0.3, a.h / 2 + 6)
        edges.push({
          key: from + '->' + to,
          x1: a.x + ux * startPad,
          y1: a.y + uy * startPad,
          x2: b.x - ux * endPad,
          y2: b.y - uy * endPad,
          status: items[to].status
        })
      })
  })

  if (edges.length === 0) return null

  return (
    <svg
      className="flow-edges"
      width={width}
      height={height}
      aria-hidden="true"
    >
      <defs>
        {(['ok', 'warn', 'broken'] as const).map((status) => (
          <marker
            key={status}
            id={'fi-arrow-' + status}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path
              d="M0,0 L10,5 L0,10 z"
              className={'edge-head edge-head-' + status}
            />
          </marker>
        ))}
      </defs>
      {edges.map((edge) => (
        <g key={edge.key}>
          <line
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            className={'edge-base edge-' + edge.status}
            markerEnd={'url(#fi-arrow-' + edge.status + ')'}
          />
          <line
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            className={'edge-flow edge-' + edge.status}
          />
        </g>
      ))}
    </svg>
  )
}

export const StarterApp = () => {
  const {
    items,
    message,
    ready,
    runtime,
    setMessage,
    canvasWidth,
    base,
    projectStorage
  } = useStarterRuntime()
  const [projects, setProjects] = useState<readonly FlowProject[]>([])
  const [activeProjectId, setActiveProjectId] = useState('')
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [requestedSelectionId, setRequestedSelectionId] = useState<
    string | null
  >(null)
  const [pending, setPending] = useState(false)
  const [redoDepth, setRedoDepth] = useState(0)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const selectedItem = items.find((item) => item.id === selectedId)
  const stageHeight = getStarterRenderHeight(items.length, canvasWidth)
  const canUndo = ready && !pending && runtime.core.getUndoHistoryDepth() > 0
  const canRedo = ready && !pending && redoDepth > 0

  useEffect(() => {
    if (requestedSelectionId) {
      if (items.some((item) => item.id === requestedSelectionId)) {
        setSelectedId(requestedSelectionId)
        setRequestedSelectionId(null)
      }
      return
    }
    if (selectedId && !items.some((item) => item.id === selectedId)) {
      setSelectedId(null)
    }
  }, [items, requestedSelectionId, selectedId])

  const afterEdit = (nextMessage: string): void => {
    setMessage(nextMessage)
    if (nextMessage.includes('unsaved changes')) setRedoDepth(0)
  }

  const addItem = (): void => {
    try {
      const id = runtime.feature.addItem({
        title: '步驟 ' + (items.length + 1),
        status: 'ok'
      })
      setRequestedSelectionId(id)
      setRedoDepth(0)
      setMessage('已新增步驟 - 尚未儲存')
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }

  // 專案索引持久化 + state 同步
  const persistProjects = (next: ProjectsState): void => {
    saveProjectsState(base, next)
    setProjects(next.projects)
    setActiveProjectId(next.activeId)
  }

  // 首次/返回開啟：初始化專案清單（取代舊的單一 seed）
  const initedRef = useRef(false)
  useEffect(() => {
    if (!ready || initedRef.current) return
    initedRef.current = true
    if (projectStorage.storage.unavailableReason) return // 儲存不可用 → 略過專案功能
    void (async () => {
      try {
        let state = loadProjectsState(base)
        if (!state || state.projects.length === 0) {
          const def: FlowProject = {
            id: genProjectId(),
            name: 'CrystalCraft（NANOMATERIALS）',
            rootPath: DEFAULT_PROJECT_ROOT
          }
          projectStorage.setActive(def.id)
          // 先嘗試搬移舊的單槽存檔；搬得到且載得起來就保留既有流程，否則重新 seed。
          let restored = false
          if (migrateLegacyDocToProject(base, def.id)) {
            const migratedResult = await runtime.reload()
            restored = migratedResult.ok
          }
          if (!restored) {
            SEED_STEPS.forEach((step) =>
              runtime.feature.addItem({
                title: step.title,
                status: step.status,
                fields: { ref: step.ref, notes: step.notes, next: step.next }
              })
            )
            await runtime.save()
          }
          state = { activeId: def.id, projects: [def] }
          saveProjectsState(base, state)
        } else {
          projectStorage.setActive(state.activeId)
          const result = await runtime.reload()
          if (!result.ok) await runtime.newDocument()
        }
        setProjects(state.projects)
        setActiveProjectId(state.activeId)
      } catch (error) {
        setMessage(errorMessage(error))
      }
    })()
  }, [ready, base, projectStorage, runtime, setMessage])

  const switchProject = (targetId: string): void => {
    if (!targetId || targetId === activeProjectId) return
    setPending(true)
    void (async () => {
      try {
        await runtime.save()
        projectStorage.setActive(targetId)
        const result = await runtime.reload()
        if (!result.ok) await runtime.newDocument()
        persistProjects({ activeId: targetId, projects })
        setSelectedId(null)
        setRedoDepth(0)
        setMessage('已切換專案')
      } catch (error) {
        setMessage(errorMessage(error))
      } finally {
        setPending(false)
      }
    })()
  }

  const createProject = (): void => {
    const name = window.prompt('新專案名稱：', '新流程')
    if (!name || !name.trim()) return
    setPending(true)
    void (async () => {
      try {
        await runtime.save()
        const project: FlowProject = {
          id: genProjectId(),
          name: name.trim(),
          rootPath: ''
        }
        projectStorage.setActive(project.id)
        await runtime.newDocument()
        persistProjects({
          activeId: project.id,
          projects: [...projects, project]
        })
        setSelectedId(null)
        setRedoDepth(0)
        setMessage('已建立專案「' + project.name + '」')
      } catch (error) {
        setMessage(errorMessage(error))
      } finally {
        setPending(false)
      }
    })()
  }

  const renameProject = (): void => {
    if (!activeProject) return
    const name = window.prompt('重新命名專案：', activeProject.name)
    if (!name || !name.trim()) return
    persistProjects({
      activeId: activeProjectId,
      projects: projects.map((p) =>
        p.id === activeProjectId ? { ...p, name: name.trim() } : p
      )
    })
  }

  const deleteProject = (): void => {
    if (!activeProject || projects.length <= 1) return
    const removed = activeProject
    if (
      !window.confirm(
        '刪除專案「' + removed.name + '」？此專案的流程會一併移除。'
      )
    )
      return
    const remaining = projects.filter((p) => p.id !== removed.id)
    const nextActive = remaining[0].id
    setPending(true)
    void (async () => {
      try {
        removeProjectDoc(base, removed.id)
        projectStorage.setActive(nextActive)
        const result = await runtime.reload()
        if (!result.ok) await runtime.newDocument()
        persistProjects({ activeId: nextActive, projects: remaining })
        setSelectedId(null)
        setRedoDepth(0)
        setMessage('已刪除專案「' + removed.name + '」')
      } catch (error) {
        setMessage(errorMessage(error))
      } finally {
        setPending(false)
      }
    })()
  }

  const setProjectRoot = (rootPath: string): void => {
    if (!activeProject || rootPath === activeProject.rootPath) return
    persistProjects({
      activeId: activeProjectId,
      projects: projects.map((p) =>
        p.id === activeProjectId ? { ...p, rootPath } : p
      )
    })
  }

  // 匯入 JSON：解析步驟陣列 → 取代目前專案的整張流程。
  const importFlow = (): void => {
    let parsed: unknown
    try {
      parsed = JSON.parse(importText)
    } catch (error) {
      setImportError('JSON 格式錯誤：' + errorMessage(error))
      return
    }
    if (!Array.isArray(parsed)) {
      setImportError('最外層必須是陣列 [ … ]')
      return
    }
    const toStr = (value: unknown): string => {
      if (Array.isArray(value)) return value.join(',')
      if (value === null || value === undefined) return ''
      return String(value)
    }
    const steps: {
      title: string
      status: ItemStatus
      ref: string
      notes: string
      next: string
    }[] = []
    for (const raw of parsed) {
      if (
        !raw ||
        typeof raw !== 'object' ||
        typeof (raw as { title?: unknown }).title !== 'string' ||
        !(raw as { title: string }).title.trim()
      ) {
        setImportError('每個步驟都要有非空的 title')
        return
      }
      const record = raw as Record<string, unknown>
      const status =
        record.status === 'warn' || record.status === 'broken'
          ? (record.status as ItemStatus)
          : 'ok'
      steps.push({
        title: (record.title as string).trim(),
        status,
        ref: toStr(record.ref),
        notes: toStr(record.notes),
        next: toStr(record.next)
      })
    }
    if (steps.length === 0) {
      setImportError('沒有任何步驟')
      return
    }
    setPending(true)
    void (async () => {
      try {
        await runtime.newDocument()
        steps.forEach((step) =>
          runtime.feature.addItem({
            title: step.title,
            status: step.status,
            fields: { ref: step.ref, notes: step.notes, next: step.next }
          })
        )
        await runtime.save()
        setImportOpen(false)
        setImportText('')
        setImportError('')
        setSelectedId(null)
        setRedoDepth(0)
        setMessage('已匯入 ' + steps.length + ' 個步驟')
      } catch (error) {
        setImportError(errorMessage(error))
      } finally {
        setPending(false)
      }
    })()
  }

  const runHistory = (
    command: () => Promise<void>,
    label: string,
    onSuccess: () => void
  ): void => {
    setPending(true)
    command()
      .then(() => {
        onSuccess()
        setMessage(label + ' - unsaved changes')
      })
      .catch((error: unknown) => setMessage(errorMessage(error)))
      .finally(() => setPending(false))
  }

  const runStorage = (
    command: StarterRuntime['save'] | StarterRuntime['reload'],
    reload: boolean
  ): void => {
    setPending(true)
    command()
      .then((result) => {
        setMessage(result.message)
        if (result.ok && reload) setRedoDepth(0)
      })
      .catch((error: unknown) => setMessage(errorMessage(error)))
      .finally(() => setPending(false))
  }

  let statusTone = 'ok'
  if (message === 'Starting runtime...') {
    statusTone = 'loading'
  } else if (message.includes('unsaved changes')) {
    statusTone = 'unsaved'
  } else if (
    !ready ||
    (message !== 'Ready' &&
      !message.startsWith('Saved at ') &&
      !message.startsWith('Reloaded '))
  ) {
    statusTone = 'error'
  }

  return (
    <main className="starter-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            🔎
          </span>
          <span className="brand-name">FLOW INSPECTOR</span>
        </div>
        <div className="workspace-name">
          <span>{activeProject?.name ?? 'Flow Inspector'}</span>
          <strong>流程檢視</strong>
        </div>
        <p className={'save-state ' + statusTone} role="status" title={message}>
          <i aria-hidden="true" />
          <span>{message}</span>
        </p>
      </header>

      {projects.length > 0 && (
        <div className="project-bar">
          <span className="pb-label">專案</span>
          <select
            className="pb-select"
            aria-label="切換專案"
            value={activeProjectId}
            onChange={(event) => switchProject(event.target.value)}
            disabled={!ready || pending}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={createProject}
            disabled={!ready || pending}
          >
            ＋ 新增
          </button>
          <button
            type="button"
            onClick={renameProject}
            disabled={!ready || pending || !activeProject}
          >
            改名
          </button>
          <button
            type="button"
            onClick={deleteProject}
            disabled={!ready || pending || projects.length <= 1}
          >
            刪除
          </button>
          <button
            type="button"
            onClick={() => {
              setImportError('')
              setImportOpen(true)
            }}
            disabled={!ready || pending || !activeProject}
          >
            匯入
          </button>
          <span className="pb-sep" />
          <label className="pb-label" htmlFor="pb-root">
            根目錄
          </label>
          <input
            id="pb-root"
            className="pb-root"
            key={activeProjectId}
            placeholder="例如 C:/…/NANOMATERIALS（給『開啟檔案』用）"
            defaultValue={activeProject?.rootPath ?? ''}
            onBlur={(event) => setProjectRoot(event.target.value.trim())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </div>
      )}

      <div className="workspace">
        <section className="canvas-area" aria-label="Starter workspace">
          <div className="canvas-toolbar">
            <div className="canvas-heading">
              <strong>流程畫布</strong>
              <span>{items.length} 個步驟 - 2D</span>
            </div>
            <div className="toolbar-actions">
              <button
                type="button"
                className="primary"
                onClick={addItem}
                disabled={!ready || pending}
              >
                <span aria-hidden="true">＋</span> 新增步驟
              </button>
              <button
                type="button"
                onClick={() =>
                  runHistory(runtime.undo, 'Undid action', () =>
                    setRedoDepth((depth) => depth + 1)
                  )
                }
                disabled={!canUndo}
              >
                復原
              </button>
              <button
                type="button"
                onClick={() =>
                  runHistory(runtime.redo, 'Redid action', () =>
                    setRedoDepth((depth) => Math.max(0, depth - 1))
                  )
                }
                disabled={!canRedo}
              >
                重做
              </button>
              <button
                type="button"
                onClick={() => runStorage(runtime.save, false)}
                disabled={!ready || pending}
              >
                儲存
              </button>
              <button
                type="button"
                onClick={() => runStorage(runtime.reload, true)}
                disabled={!ready || pending}
              >
                重新載入
              </button>
            </div>
          </div>
          <div className="canvas-surface">
            <span className="canvas-ruler">WORKSPACE / 01</span>
            <div className="render-stage" style={{ height: stageHeight }}>
              <div id="starter-render-host" className="render-host" />
              <FlowEdges
                items={items}
                width={canvasWidth}
                height={stageHeight}
              />
              <div className="stage-heading">
                <strong>流程板</strong>
                <span>可編輯步驟</span>
              </div>
              {items.map((item, index) => {
                return (
                  <CanvasItem
                    key={item.id}
                    item={item}
                    index={index}
                    width={canvasWidth}
                    height={stageHeight}
                    selected={item.id === selectedId}
                    runtime={runtime}
                    onSelect={() => setSelectedId(item.id)}
                    onMove={afterEdit}
                  />
                )
              })}
              {items.length === 0 && ready && (
                <p className="empty-canvas">畫布是空的，點「新增步驟」開始。</p>
              )}
            </div>
          </div>
          <div className="canvas-footer">
            <span>卡片顏色即時反映步驟狀態</span>
            <span>{items.length} 個步驟</span>
          </div>
        </section>

        <aside className="items-panel" aria-label="Items">
          <div className="panel-heading">
            <span className="eyebrow">文件</span>
            <h1>步驟</h1>
            <p>{items.length} 個可編輯步驟</p>
          </div>
          <div className="item-list">
            <div className="list-heading">
              <span>步驟清單</span>
              <span>狀態</span>
            </div>
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={
                  'item-line' + (selectedId === item.id ? ' selected' : '')
                }
                onClick={() => setSelectedId(item.id)}
                aria-label={'Select ' + item.title}
                aria-pressed={selectedId === item.id}
              >
                <span className="list-index">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="list-title">{item.title}</span>
                <span className={'pill ' + item.status}>
                  {statusLabels[item.status]}
                </span>
              </button>
            ))}
          </div>
          {selectedItem ? (
            <SelectedItemEditor
              key={selectedItem.id}
              item={selectedItem}
              runtime={runtime}
              onEdit={afterEdit}
              projectRoot={activeProject?.rootPath ?? ''}
            />
          ) : (
            <p className="empty-editor">選一個步驟來編輯</p>
          )}
          <div className="inspector-foot">
            復原 / 重做 · 需手動 儲存 / 重新載入
          </div>
        </aside>
      </div>

      {importOpen && (
        <div
          className="import-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="匯入流程 JSON"
          onClick={() => setImportOpen(false)}
        >
          <div
            className="import-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="import-head">
              <strong>匯入流程（JSON）</strong>
              <span>
                貼上步驟陣列，會<b>取代目前專案</b>「{activeProject?.name}
                」的整張流程
              </span>
            </div>
            <textarea
              className="import-text"
              aria-label="流程 JSON"
              rows={12}
              placeholder={
                '[\n  { "title": "步驟", "status": "ok", "ref": "src/x.ts:10", "notes": "說明", "next": "2" }\n]'
              }
              value={importText}
              onChange={(event) => {
                setImportText(event.target.value)
                if (importError) setImportError('')
              }}
            />
            {importError && <p className="import-error">{importError}</p>}
            <div className="import-actions">
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                disabled={pending}
              >
                取消
              </button>
              <button
                type="button"
                className="primary"
                onClick={importFlow}
                disabled={pending || !importText.trim()}
              >
                匯入並取代
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
