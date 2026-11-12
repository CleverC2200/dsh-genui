export interface BlockInteractionState {

  answers?: Record<string, string>

  multiAnswers?: Record<string, string[]>

  locked?: boolean

  fields?: Record<string, string>
}

const STORE_KEY = 'dsh.genui.interaction'

const MAX_BLOCKS = 200

interface StoreShape {

  order: string[]
  blocks: Record<string, BlockInteractionState>
}

function emptyStore(): StoreShape {
  return { order: [], blocks: {} }
}

function readStore(): StoreShape {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw === null) return emptyStore()
    const parsed = JSON.parse(raw) as Partial<StoreShape>
    if (!Array.isArray(parsed.order) || typeof parsed.blocks !== 'object' || parsed.blocks === null) {
      return emptyStore()
    }
    return { order: parsed.order.filter(k => typeof k === 'string'), blocks: parsed.blocks as Record<string, BlockInteractionState> }
  } catch {
    return emptyStore()
  }
}

function writeStore(store: StoreShape): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {

  }
}

export function loadBlockState(stateKey: string): BlockInteractionState | null {
  if (stateKey === '') return null
  const store = readStore()
  return store.blocks[stateKey] ?? null
}

export function saveBlockState(stateKey: string, state: BlockInteractionState): void {
  if (stateKey === '') return
  const store = readStore()
  const order = store.order.filter(k => k !== stateKey)
  order.unshift(stateKey)
  const blocks = { ...store.blocks, [stateKey]: state }
  while (order.length > MAX_BLOCKS) {
    const evicted = order.pop()
    if (evicted !== undefined) delete blocks[evicted]
  }
  writeStore({ order, blocks })
}

export function clearBlockState(stateKey: string): void {
  if (stateKey === '') return
  const store = readStore()
  if (!(stateKey in store.blocks)) return
  const blocks = { ...store.blocks }
  delete blocks[stateKey]
  writeStore({ order: store.order.filter(k => k !== stateKey), blocks })
}

export function fingerprint(raw: string): string {
  let h = 5381
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}

export function fenceStateKey(sessionId: string, fenceKey: number | string, raw: string): string {
  return `f:${sessionId}:${String(fenceKey)}:${fingerprint(raw)}`
}

export function panelStateKey(sessionId: string, raw: string): string {
  return `p:${sessionId}:${fingerprint(raw)}`
}

export function toolStateKey(sessionId: string, callId: string): string {
  return `t:${sessionId}:${callId}`
}
