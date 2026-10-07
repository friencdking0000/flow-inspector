// Flow Inspector：每個步驟節點附帶一個「ref」欄位，
// 用來連結實作的 function 名稱或 file:line，方便哪步壞掉就知道去哪找。
export const isValidItemRef = (value: unknown): value is string =>
  typeof value === 'string'

export const refItemField = {
  key: 'ref',
  defaultValue: '',
  validate: isValidItemRef,
  invalidMessage: 'ref 必須是字串（function 名稱或 file:line）。'
} as const
