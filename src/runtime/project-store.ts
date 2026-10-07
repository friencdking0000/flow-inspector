// Phase 3：多專案/多流程支援。
// 每個專案的流程存成獨立分槽，再用一個「轉址 storage」讓既有 runtime 無感切換。
import { STARTER_STORAGE_SLOT } from '../domain/item-domain.js'
import type { StarterStorage } from './storage.js'

export interface FlowProject {
  readonly id: string
  readonly name: string
  readonly rootPath: string
}

export interface ProjectsState {
  readonly activeId: string
  readonly projects: readonly FlowProject[]
}

const PROJECTS_SLOT = 'starter-app.projects.v1'
const docSlot = (id: string): string => `starter-app.doc.${id}.v1`

export const genProjectId = (): string => {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID()
  }
  return (
    'p-' +
    Date.now().toString(36) +
    '-' +
    Math.floor(Math.random() * 1e6).toString(36)
  )
}

const storageFailureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const unavailableStorage = (reason: string): StarterStorage => ({
  unavailableReason: reason,
  getItem() {
    throw new Error(reason)
  },
  setItem() {
    throw new Error(reason)
  }
})

// 取得底層 storage（真正的 localStorage，或在被拒時回傳會丟錯的替身）。
export const getBaseStorage = (): StarterStorage => {
  try {
    return window.localStorage
  } catch (error) {
    return unavailableStorage(storageFailureMessage(error))
  }
}

export interface ProjectStorage {
  readonly storage: StarterStorage
  getActive(): string
  setActive(id: string): void
}

// 把 runtime 固定使用的 STARTER_STORAGE_SLOT 轉址到「目前專案」的分槽，
// 其他 key（專案索引）原樣透傳。
export const createProjectStorage = (base: StarterStorage): ProjectStorage => {
  let activeId = ''
  const mapKey = (key: string): string =>
    key === STARTER_STORAGE_SLOT ? docSlot(activeId) : key
  const storage: StarterStorage = {
    unavailableReason: base.unavailableReason,
    getItem: (key) => base.getItem(mapKey(key)),
    setItem: (key, value) => base.setItem(mapKey(key), value),
    removeItem: (key) => base.removeItem?.(mapKey(key))
  }
  return {
    storage,
    getActive: () => activeId,
    setActive: (id) => {
      activeId = id
    }
  }
}

const isFlowProject = (value: unknown): value is FlowProject =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as FlowProject).id === 'string' &&
  typeof (value as FlowProject).name === 'string'

const isProjectsState = (value: unknown): value is ProjectsState => {
  if (!value || typeof value !== 'object') return false
  const state = value as { activeId?: unknown; projects?: unknown }
  return (
    typeof state.activeId === 'string' &&
    Array.isArray(state.projects) &&
    state.projects.every(isFlowProject)
  )
}

export const loadProjectsState = (
  base: StarterStorage
): ProjectsState | null => {
  let raw: string | null
  try {
    raw = base.getItem(PROJECTS_SLOT)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isProjectsState(parsed)) {
      return {
        activeId: parsed.activeId,
        projects: parsed.projects.map((project) => ({
          id: project.id,
          name: project.name,
          rootPath: typeof project.rootPath === 'string' ? project.rootPath : ''
        }))
      }
    }
  } catch {
    /* 壞掉就當作沒有，從頭來 */
  }
  return null
}

export const saveProjectsState = (
  base: StarterStorage,
  state: ProjectsState
): void => {
  try {
    base.setItem(PROJECTS_SLOT, JSON.stringify(state))
  } catch {
    /* 存不進去就算了，至少當下 session 仍可用 */
  }
}

export const removeProjectDoc = (base: StarterStorage, id: string): void => {
  try {
    base.removeItem?.(docSlot(id))
  } catch {
    /* ignore */
  }
}

// 一次性搬移：把 Phase 1/2 的單槽存檔（STARTER_STORAGE_SLOT）
// 複製成新專案的分槽，讓既有流程不會因改用多專案而消失。回傳是否有搬到東西。
export const migrateLegacyDocToProject = (
  base: StarterStorage,
  newId: string
): boolean => {
  try {
    const legacy = base.getItem(STARTER_STORAGE_SLOT)
    if (!legacy) return false
    base.setItem(docSlot(newId), legacy)
    return true
  } catch {
    return false
  }
}
