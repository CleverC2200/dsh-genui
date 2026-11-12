import { createContext, useContext, useSyncExternalStore } from 'react'

export type GenuiMapStyle = {
  version: 8
  sources: Record<string, unknown>
  layers: readonly unknown[]
  [name: string]: unknown
}

export interface GenuiMapConfig {

  style: GenuiMapStyle
}

export const GenuiMapContext = createContext<GenuiMapConfig | undefined>(undefined)

let hostConfig: GenuiMapConfig | undefined
const listeners = new Set<() => void>()

export function setGenuiMapConfig(config: GenuiMapConfig | undefined): void {
  hostConfig = config
  for (const listener of listeners) listener()
}
export function useGenuiMapConfig(): GenuiMapConfig | undefined {
  const context = useContext(GenuiMapContext)
  const fallback = useSyncExternalStore(
    listener => { listeners.add(listener); return () => listeners.delete(listener) },
    () => hostConfig,
    () => undefined,
  )
  return context ?? fallback
}
