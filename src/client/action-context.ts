import { createContext, useContext } from 'react'
import type { Context } from 'react'

export type GenuiActionHandler = (action: string, payload: Record<string, unknown>) => void

const localContext = createContext<GenuiActionHandler | undefined>(undefined)

export const GenuiActionContext: Context<GenuiActionHandler | undefined> = localContext

export function useGenuiAction(): GenuiActionHandler | undefined {
  return useContext(GenuiActionContext)
}
