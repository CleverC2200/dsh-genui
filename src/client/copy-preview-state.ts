import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import type { GenuiSpec } from './spec.ts'
import { walkGenuiNodes } from './walk-spec.ts'

interface CopyPreviewState {
  readonly expanded: ReadonlySet<string>
  readonly toggle: (path: string) => void
}

export const CopyPreviewContext = createContext<CopyPreviewState | undefined>(undefined)

export function useCopyPreviewState(spec: GenuiSpec): CopyPreviewState {
  const paths = useMemo(() => {
    const result = new Set<string>()
    walkGenuiNodes(spec, (node, path) => {
      if (node.type === 'copy' && node.expandable === true) result.add(path)
    })
    return result
  }, [spec])
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    setExpanded(previous => {
      const next = new Set([...previous].filter(path => paths.has(path)))
      return next.size === previous.size ? previous : next
    })
  }, [paths])
  const toggle = useCallback((path: string) => {
    setExpanded(previous => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])
  return useMemo(() => ({ expanded, toggle }), [expanded, toggle])
}
