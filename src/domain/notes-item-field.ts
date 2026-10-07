// Flow Inspector：每個步驟節點的第二個自訂欄位「notes」，
// 記錄這一步的備註 / 觀察 / 待確認事項。
export const isValidItemNotes = (value: unknown): value is string =>
  typeof value === 'string'

export const notesItemField = {
  key: 'notes',
  defaultValue: '',
  validate: isValidItemNotes,
  invalidMessage: 'notes 必須是字串。'
} as const
