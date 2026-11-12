function inEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

export function str(value: unknown, cap: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, cap) : undefined
}

const SAFE_COLOR_RE = /^(?:#[\da-fA-F]{3,8}|rgba?\([^)]{0,64}\)|hsla?\([^)]{0,64}\)|var\(--dsw-[\w-]+(?:,\s*#[0-9a-fA-F]{3,8})?\))$/

export function color(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length <= 64 && SAFE_COLOR_RE.test(normalized) ? normalized : undefined
}

export function safeHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (normalized.length > 2048) return undefined
  return /^https?:\/\//i.test(normalized) || /^mailto:[^@\s]+@[^@\s]+$/i.test(normalized) ? normalized : undefined
}

export function safeMediaSrc(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined
  const normalized = value.trim()
  if (normalized === '' || normalized.length > 2048) return undefined
  if (/^https?:\/\//i.test(normalized)) return normalized
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized) || /^[/\\]{2}/.test(normalized)) return undefined
  return normalized
}

export function num(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined
}

export function int(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : undefined
}

export function enu<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return inEnum(value, values) ? value : undefined
}

export function obj(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function opt<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : { [key]: value } as Partial<Record<K, V>>
}
