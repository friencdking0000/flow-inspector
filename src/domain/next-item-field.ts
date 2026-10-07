// Flow Inspector：第三個自訂欄位「next」，
// 以逗號/空白分隔的「目標步驟號」(1-based)，用來畫出步驟之間的連線 edges。
// 例如 "2,3" 代表這一步連到第 2、第 3 步。
export const isValidItemNext = (value: unknown): value is string =>
  typeof value === 'string'

export const nextItemField = {
  key: 'next',
  defaultValue: '',
  validate: isValidItemNext,
  invalidMessage: 'next 必須是字串（以逗號分隔的步驟號）。'
} as const
