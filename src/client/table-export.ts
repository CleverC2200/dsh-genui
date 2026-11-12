import { GENUI_COMPUTED_CELL } from './spec.ts'
import type { GenuiComputedCell, GenuiTable } from './spec.ts'

type TableCell = GenuiTable['rows'][number][number]

export function tableCellText(value: unknown): string {
  if (value !== null && typeof value === 'object' && Object.hasOwn(value, GENUI_COMPUTED_CELL)) {
    return (value as GenuiComputedCell).formatted
  }
  return String(value ?? '')
}

export function tableToMarkdown(columns: string[], rows: Array<Array<TableCell>>): string {
  const escape = (v: unknown): string => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const head = `| ${columns.map(escape).join(' | ')} |`
  const rule = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map(row => `| ${columns.map((_c, i) => escape(tableCellText(row[i]))).join(' | ')} |`)
  return [head, rule, ...body].join('\n')
}

export function tableToCsv(rows: Array<Array<TableCell>>): string {
  const cell = (v: unknown): string => {
    const s = tableCellText(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map(row => row.map(cell).join(',')).join('\n')
}
