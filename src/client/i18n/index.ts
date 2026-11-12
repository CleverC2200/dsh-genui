import { useSyncExternalStore } from 'react'
import {
  dictOf,
  getLocale,
  getLocaleRevision,
  LOCALE_IDS,
  setLocale,
  subscribeLocale,
  t,
  type LocaleId,
} from './runtime.ts'

export {
  detectLocale,
  dictOf,
  FALLBACK_LOCALE,
  getLocale,
  getLocaleRevision,
  LOCALE_IDS,
  normalizeLocale,
  setLocale,
  subscribeLocale,
  t,
  type GenuiTextKey,
  type LocaleDict,
  type LocaleId,
} from './runtime.ts'

export function useT(): typeof t {
  useSyncExternalStore(subscribeLocale, getLocaleRevision, getLocaleRevision)
  return t
}

export function useLocaleRevision(): number {
  return useSyncExternalStore(subscribeLocale, getLocaleRevision, getLocaleRevision)
}

interface HostLocaleRuntime {
  getLocale?: () => { active?: string }
  subscribe?: (fn: () => void) => () => void
  register?: (ns: string, locale: string, dict: Record<string, string>) => () => void
}

export const GENUI_LOCALE_NS = 'genui'

export function bridgeHostLocale(ctx: { get?: (name: string) => unknown }): () => void {
  const locale = typeof ctx.get === 'function'
    ? (ctx.get('locale') as HostLocaleRuntime | undefined)
    : undefined
  if (locale === undefined) return () => {}

  const disposers: Array<() => void> = []

  if (typeof locale.register === 'function') {
    for (const id of LOCALE_IDS) {
      try {
        disposers.push(locale.register(GENUI_LOCALE_NS, id, { ...dictOf(id) }))
      } catch {

      }
    }
  }

  const sync = (): void => {
    const active = locale.getLocale?.().active
    if (typeof active === 'string') setLocale(active)
  }
  sync()
  if (typeof locale.subscribe === 'function') disposers.push(locale.subscribe(sync))

  return () => {
    for (const dispose of disposers) dispose()
  }
}

export function currentLocale(): LocaleId {
  return getLocale()
}
