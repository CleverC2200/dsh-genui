export function isIsoDate(value: unknown): value is string {

  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function isDatePickerValueValid(
  value: string,
  mode: 'single' | 'range',
  min?: string,
  max?: string,
): boolean {
  const dates = value.split('/')
  if (dates.length !== (mode === 'range' ? 2 : 1) || !dates.every(isIsoDate)) return false
  const [start, end] = dates as [string, string?]
  if (end !== undefined && start > end) return false
  if (min !== undefined && (!isIsoDate(min) || dates.some(date => date < min))) return false
  if (max !== undefined && (!isIsoDate(max) || dates.some(date => date > max))) return false
  return true
}
