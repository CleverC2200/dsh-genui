export type SkeletonShape =
  | 'card'
  | 'table'
  | 'chart'
  | 'list'
  | 'keyvalue'
  | 'stat'
  | 'text'
  | 'diagram'
  | 'code'
  | 'media'
  | 'control'
  | 'rule'
  | 'generic'

const SHAPE_BY_TYPE: Readonly<Record<string, SkeletonShape>> = {
  card: 'card', accordion: 'card', tabs: 'card', col: 'card', row: 'card',
  table: 'table',
  chart: 'chart', echart: 'chart', plot: 'chart', sparkline: 'chart',
  list: 'list', steps: 'list', timeline: 'list', 'file-tree': 'list', keyvalue: 'list',
  stat: 'stat', progress: 'stat', badge: 'stat',
  text: 'text', callout: 'text', code: 'text',
  diagram: 'diagram', mermaid: 'diagram',
  diff: 'code', json: 'code',
  image: 'media', 'image-group': 'media', video: 'media', audio: 'media', scene3d: 'media',
  input: 'keyvalue', textarea: 'keyvalue', editor: 'keyvalue', select: 'keyvalue', slider: 'keyvalue',
  'date-picker': 'keyvalue', 'segmented-control': 'control',
  checkbox: 'keyvalue', radio: 'keyvalue', switch: 'keyvalue', submit: 'keyvalue',
  choices: 'list', quiz: 'list', compare: 'media',

  button: 'control', link: 'control', icon: 'control', avatar: 'control', popover: 'control',
  arrow: 'control', breadcrumb: 'control', copy: 'control',

  divider: 'rule', spacer: 'rule',
  hero: 'media', carousel: 'media', map: 'media', svg: 'media',
  blocks: 'card', grid: 'card', 'entity-card': 'card',
}

function firstType(raw: string): string | undefined {
  const match = /"type"\s*:\s*"([a-z0-9-]{1,24})"/.exec(raw)
  return match?.[1]
}

function firstTitle(raw: string): string | undefined {
  const match = /"title"\s*:\s*"([^"\\]{0,80})/.exec(raw)
  const title = match?.[1]?.trim()
  return title === undefined || title === '' ? undefined : title
}

export interface SkeletonDetail {

  columns?: number

  chartKind?: string

  lines?: number
}

function columnCount(raw: string): number | undefined {
  const start = raw.indexOf('"columns"')
  if (start < 0) return undefined
  const open = raw.indexOf('[', start)
  if (open < 0) return undefined
  let count = 0
  let inString = false
  let escaped = false
  for (let i = open + 1; i < raw.length; i++) {
    const ch = raw[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') { inString = false; count += 1 } else continue
      continue
    }
    if (ch === '"') inString = true
    else if (ch === ']') break
  }

  return count === 0 ? undefined : Math.min(count, 8)
}

function chartKind(raw: string): string | undefined {
  const match = /"(?:kind|chartType)"\s*:\s*"([a-z]{1,12})"/.exec(raw)
  return match?.[1]
}

function lineEstimate(raw: string): number | undefined {
  const match = /"content"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(raw)
  const text = match?.[1]
  if (text === undefined) return undefined
  const chars = text.replace(/\\n/g, '\n').length
  if (chars === 0) return undefined
  return Math.min(6, Math.max(1, Math.ceil(chars / 42)))
}

export function inferSkeleton(raw: string): {
  shape: SkeletonShape
  title?: string
  columns?: number
  chartKind?: string
  lines?: number
} {
  const type = firstType(raw)
  const shape = type === undefined ? 'generic' : (SHAPE_BY_TYPE[type] ?? 'generic')
  const detail: SkeletonDetail = {}
  if (shape === 'table') {
    const columns = columnCount(raw)
    if (columns !== undefined) detail.columns = columns
  }
  if (shape === 'chart') {
    const kind = chartKind(raw)
    if (kind !== undefined) detail.chartKind = kind
  }
  if (shape === 'text') {
    const lines = lineEstimate(raw)
    if (lines !== undefined) detail.lines = lines
  }

  const result: ReturnType<typeof inferSkeleton> = { shape, ...detail }
  const title = firstTitle(raw)
  if (title !== undefined) result.title = title
  return result
}
