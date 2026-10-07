import type { CoreRawData } from '@asyra/utils'
import {
  STARTER_STORAGE_SLOT,
  createStarterDocumentWrapper,
  parseStarterDocumentWrapper,
  type ItemFieldExtension
} from '../domain/item-domain.js'

export interface StarterStorage {
  readonly unavailableReason?: string
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export interface SaveResult {
  readonly ok: boolean
  readonly message: string
  readonly savedAt?: string
}

export interface LoadResult {
  readonly ok: boolean
  readonly message: string
}

export const saveCoreDocument = (
  storage: StarterStorage,
  core: CoreRawData
): SaveResult => {
  try {
    const wrapper = createStarterDocumentWrapper(core)
    const serialized = JSON.stringify(wrapper)
    storage.setItem(STARTER_STORAGE_SLOT, serialized)
    return {
      ok: true,
      message: `Saved at ${wrapper.savedAt}`,
      savedAt: wrapper.savedAt
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

// 清掉重來（選項 B）：移除存檔 slot。無 removeItem 的 storage 則為 no-op。
export const clearSavedCoreDocument = (storage: StarterStorage): void => {
  storage.removeItem?.(STARTER_STORAGE_SLOT)
}

export const readSavedCoreDocument = (
  storage: StarterStorage,
  itemFields: readonly ItemFieldExtension[] = []
): { readonly core: CoreRawData; readonly savedAt: string } | LoadResult => {
  const serialized = storage.getItem(STARTER_STORAGE_SLOT)
  if (serialized === null) {
    return { ok: false, message: 'Nothing saved yet.' }
  }

  const wrapper = parseStarterDocumentWrapper(serialized, itemFields)
  return {
    core: wrapper.core,
    savedAt: wrapper.savedAt
  }
}
