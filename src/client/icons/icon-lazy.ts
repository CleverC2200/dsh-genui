import { loadGenuiAsset } from '../asset-loader.ts'
import { ICONS, type BundledIcon } from './icon-data.ts'
import { ICON_NAMES_FULL } from './icon-names-full.ts'

const known = new Set(ICON_NAMES_FULL)

let full: Readonly<Record<string, BundledIcon>> | undefined
let load: Promise<void> | undefined
const listeners = new Set<() => void>()

function hasIcon(source: Record<string, unknown> | undefined, name: string): boolean {
  return source !== undefined && Object.hasOwn(source, name)
}

export function isKnownIcon(name: string): boolean {
  return hasIcon(ICONS as unknown as Record<string, unknown>, name) || known.has(name)
}

export function resolveIcon(name: string): BundledIcon | undefined {
  const inline = hasIcon(ICONS as unknown as Record<string, unknown>, name) ? ICONS[name] : undefined
  if (inline !== undefined && Array.isArray(inline.shapes)) return inline
  const lazy = hasIcon(full as unknown as Record<string, unknown> | undefined, name) ? full?.[name] : undefined
  return lazy !== undefined && Array.isArray(lazy.shapes) ? lazy : undefined
}

export function onIconsLoaded(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function ensureIcons(): Promise<void> {
  if (full !== undefined) return Promise.resolve()
  if (load !== undefined) return load
  load = loadGenuiAsset<Readonly<Record<string, BundledIcon>>>('icons')
    .then((catalogue) => {
      full = catalogue
      for (const listener of [...listeners]) listener()
    })
    .catch((error: unknown) => {
      if (typeof console !== 'undefined') console.warn('[genui] icon catalogue unavailable', error)
    })
  return load
}
