import { GENUI_LIMITS } from './genui-runtime/index.ts'
import { GENUI_COMPUTED_CELL } from './spec.ts'
import type { GenuiComputedCell, GenuiComputedRef } from './spec.ts'

export interface TableDetailSource {
  columns?: unknown
  rows?: unknown
  data?: unknown
  types?: unknown
}

export interface PreparedTableRows {
  columns: string[]
  rows: Array<Array<string | number | GenuiComputedRef | GenuiComputedCell>>
}

export function prepareTableRows(table: TableDetailSource, onRowsTruncated?: (count: number) => void): PreparedTableRows | null {
  const declaredColumns = table.columns
  const columnsSpecified = Array.isArray(declaredColumns) && declaredColumns.length > 0
  const rawColumns = columnsSpecified && Array.isArray(declaredColumns)
    && typeof declaredColumns[0] === 'object' && declaredColumns[0] !== null
    ? declaredColumns.map(columnHeaderText)
    : declaredColumns
  let columns = repairColumnValues(rawColumns)
  let rawRows = table.rows !== undefined ? table.rows : table.data

  if (Array.isArray(rawRows) && rawRows.length > 0
    && typeof rawRows[0] === 'object' && rawRows[0] !== null && !Array.isArray(rawRows[0])) {
    const keys = Array.isArray(table.columns) && table.columns.length > 0
      && typeof table.columns[0] === 'object' && table.columns[0] !== null
      ? table.columns.map(columnKeyOf).filter((key): key is string => key !== undefined)
      : Object.keys(rawRows[0] as Record<string, unknown>)
    rawRows = rawRows.map(row => row !== null && typeof row === 'object' && !Array.isArray(row)
      ? keys.map(key => cellText((row as Record<string, unknown>)[key]))
      : row)
  }

  let derived: PreparedTableRows | null = null
  let truncatedRows = 0
  if (!columnsSpecified && Array.isArray(rawRows) && rawRows.length > 0 && Array.isArray(rawRows[0])) {
    const grid = repairRows(rawRows)
    const candidate = grid.rows.length === 0 ? null : deriveTableColumns(grid.rows)
    if (candidate !== null && repairRows(candidate.rows).rows.length === candidate.rows.length) {
      derived = candidate
      truncatedRows = grid.truncatedRows
      columns = candidate.columns.map(column => column.slice(0, 128))
    }
  }

  if (columns.length === 0 && !Array.isArray(table.columns)) return null
  const repairedRows = repairRows(derived === null ? rawRows : derived.rows)
  if (derived === null) truncatedRows = repairedRows.truncatedRows
  if (truncatedRows > 0) onRowsTruncated?.(truncatedRows)
  if (!Array.isArray(rawRows)) return null
  return { columns: columns.slice(0, GENUI_LIMITS.maxTableCols), rows: repairedRows.rows }
}

export function tableRowsForDetails<Row = unknown>(table: TableDetailSource): Row[] {
  return (prepareTableRows(table)?.rows ?? []) as Row[]
}

export function isTableGroupHeaderRow(row: unknown, types: unknown): boolean {
  if (!Array.isArray(row) || !Array.isArray(types) || types[0] !== 'group') return false
  return String(row[0] ?? '').trim() !== ''
    && row.slice(1).every(cell => String(cell ?? '').trim() === '')
}

export function isTableDetailReachable(table: TableDetailSource, rowIndex: number): boolean {
  const rows = tableRowsForDetails(table)
  return rowIndex >= 0
    && rowIndex < rows.length
    && !isTableGroupHeaderRow(rows[rowIndex], table.types)
}

function repairColumnValues(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const columns: string[] = []
  for (const item of value) {
    if (columns.length >= GENUI_LIMITS.maxTableCols) break
    if (typeof item === 'string') columns.push(item.slice(0, 128))
    else if (item !== null && typeof item === 'object') {
      const column = item as Record<string, unknown>
      const label = typeof column.label === 'string' ? column.label
        : typeof column.value === 'string' ? column.value
          : typeof column.title === 'string' ? column.title
            : typeof column.name === 'string' && column.name !== '' ? column.name
              : JSON.stringify(item)
      columns.push(label.slice(0, 128))
    }
  }
  return columns
}

function repairRows(value: unknown): {
  rows: Array<Array<string | number | GenuiComputedRef | GenuiComputedCell>>
  truncatedRows: number
} {
  if (!Array.isArray(value)) return { rows: [], truncatedRows: 0 }
  const rows: Array<Array<string | number | GenuiComputedRef | GenuiComputedCell>> = []
  let truncatedRows = 0
  for (const row of value) {
    if (!Array.isArray(row)) continue
    const cells: Array<string | number | GenuiComputedRef | GenuiComputedCell> = []
    for (const cell of row) {
      if (cells.length >= GENUI_LIMITS.maxTableCols) break
      if (isComputedCell(cell)) cells.push(cell)
      else if (typeof cell === 'string') cells.push(cell.slice(0, 256))
      else if (typeof cell === 'number' && Number.isFinite(cell)) cells.push(cell)
      else if (cell !== null && typeof cell === 'object' && !Array.isArray(cell)
        && Object.keys(cell).length === 1 && typeof (cell as Record<string, unknown>).$computed === 'string'
        && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test((cell as Record<string, unknown>).$computed as string)) {
        cells.push({ $computed: (cell as Record<string, unknown>).$computed as string })
      }
    }
    if (cells.length === 0) continue
    if (rows.length < GENUI_LIMITS.maxTableRows) rows.push(cells)
    else truncatedRows += 1
  }
  return { rows, truncatedRows }
}

function deriveTableColumns(rows: Array<Array<string | number | GenuiComputedRef | GenuiComputedCell>>): PreparedTableRows | null {
  const header = rows[0]
  if (header === undefined || header.length === 0) return null
  const body = rows.slice(1)
  if (body.length === 0) {
    const columns = header.map(cell => String(cell).trim())
    return columns.every(column => column !== '') ? { columns, rows: [] } : null
  }
  if (body.every(row => row.length === header.length)) {
    return { columns: header.map(cell => String(cell).trim()), rows: body }
  }
  return { columns: Array.from({ length: header.length }, (_unused, index) => `列${index + 1}`), rows }
}

function columnKeyOf(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const column = value as Record<string, unknown>
  for (const key of ['key', 'dataIndex', 'title', 'label', 'name'] as const) {
    if (typeof column[key] === 'string' && column[key] !== '') return column[key]
  }
  return undefined
}

function cellText(value: unknown): string | number | GenuiComputedRef | GenuiComputedCell {
  if (isComputedCell(value)) return value
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1 && typeof (value as Record<string, unknown>).$computed === 'string'
    && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test((value as Record<string, unknown>).$computed as string)) {
    return { $computed: (value as Record<string, unknown>).$computed as string }
  }
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

function isComputedCell(value: unknown): value is GenuiComputedCell {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, GENUI_COMPUTED_CELL)) {
    return false
  }
  const cell = value as GenuiComputedCell
  return cell[GENUI_COMPUTED_CELL] === true && Number.isFinite(cell.value) && typeof cell.formatted === 'string'
}

function columnHeaderText(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return String(value)
  const column = value as Record<string, unknown>
  for (const key of ['title', 'label', 'key', 'dataIndex', 'name'] as const) {
    if (typeof column[key] === 'string' && column[key] !== '') return column[key]
  }
  return JSON.stringify(value)
}
