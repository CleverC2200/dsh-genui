import { EN } from './en.ts'
import { ZH } from './zh.ts'

export type LocaleId = 'en' | 'zh'

export const FALLBACK_LOCALE: LocaleId = 'en'

export const LOCALE_IDS: readonly LocaleId[] = ['en', 'zh']

export type LocaleDict = Record<string, string>

export type GenuiTextKey = keyof typeof EN

const DICTS: Record<LocaleId, LocaleDict> = { en: EN, zh: ZH }

export function normalizeLocale(tag: string | undefined | null): LocaleId | undefined {
  if (typeof tag !== 'string' || tag === '') return undefined

  const primary = tag.toLowerCase().split(/[-_]/)[0]
  return LOCALE_IDS.find(id => id === primary)
}

export function detectLocale(): LocaleId {
  if (typeof navigator === 'undefined') return FALLBACK_LOCALE
  const nav = navigator as Navigator & { languages?: readonly string[] }
  const tags: readonly string[] = Array.isArray(nav.languages) && nav.languages.length > 0
    ? nav.languages
    : [nav.language]
  for (const tag of tags) {
    const hit = normalizeLocale(tag)
    if (hit !== undefined) return hit
  }
  return FALLBACK_LOCALE
}

let active: LocaleId = detectLocale()

let revision = 0
const listeners = new Set<() => void>()

export function getLocale(): LocaleId {
  return active
}

export function getLocaleRevision(): number {
  return revision
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function setLocale(tag: string | LocaleId): void {
  const next = normalizeLocale(tag)
  if (next === undefined || next === active) return
  active = next
  revision += 1
  for (const fn of [...listeners]) fn()
}

function interpolate(template: string, params?: Record<string, unknown>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name]
    return value === undefined ? whole : String(value)
  })
}

export function t(key: GenuiTextKey | string, params?: Record<string, unknown>): string {
  const template = DICTS[active][key] ?? DICTS[FALLBACK_LOCALE][key] ?? key
  return interpolate(template, params)
}

export function dictOf(id: LocaleId): LocaleDict {
  return DICTS[id]
}
