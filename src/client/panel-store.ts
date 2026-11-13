import type { GenuiSpec } from './spec.ts'
import { countGenuiNodes, isRenderableProcess, processGenuiSpec } from './guard.ts'
import { obj } from './genui-runtime/value-utils.ts'
import { GENUI_LIMITS } from './genui-runtime/index.ts'
import { fingerprint } from './interaction-store.ts'
import { mergePanelSpecs } from '../shared/panel-merge.ts'
export { mergePanelSpecs } from '../shared/panel-merge.ts'

export const PANEL_LIMITS = {

  maxNodes: 200,

  maxAppends: 200,
} as const

type PanelLimits = { maxNodes: number; maxAppends: number }

let limits: PanelLimits = { ...PANEL_LIMITS }

export function setPanelLimits(next: Partial<PanelLimits>): void {
  limits = { ...limits, ...next }
}

export type PanelOrder = readonly [number, number, number]

export interface PanelOperation {

  sourceId: string
  order: PanelOrder
  mode: 'replace' | 'append'
  spec: GenuiSpec
}

interface FoldResult {
  snapshot: GenuiSpec | null
  stateIdentity: string | null

  kept: PanelOperation[]
  invalid: Map<string, string>

  overflow: PanelOperation | null

  maxSeenSeq: number
}

interface SessionPanelState {
  baseIdentity: string | null
  stateIdentity: string | null
  ops: Map<string, PanelOperation>
  invalid: Map<string, string>

  seen: Map<string, PanelOrder>
  overflow: PanelOperation | null

  local: GenuiSpec | null

  localBarrier: number

  replayBarrier: number
  maxSeenSeq: number
  snapshot: GenuiSpec | null
}

const sessions = new Map<string, SessionPanelState>()
const listeners = new Set<() => void>()

function emptyState(): SessionPanelState {
  return { baseIdentity: null, stateIdentity: null, ops: new Map(), invalid: new Map(), seen: new Map(), overflow: null, local: null, localBarrier: -1, replayBarrier: -1, maxSeenSeq: -1, snapshot: null }
}

const STORAGE_KEY = 'dsh.genui.panel'

const MAX_PERSISTED_SESSIONS = 50

interface PersistedPanel {
  stateIdentity?: string | null
  snapshot: GenuiSpec | null
  local: GenuiSpec | null
  localBarrier: number
  maxSeenSeq: number

  pending?: { ops: PanelOperation[]; overflow: PanelOperation | null; replayBarrier: number; baseIdentity: string | null }
}

interface PanelStorageShape {
  order: string[]
  sessions: Record<string, PersistedPanel>
}

function readPanelStorage(): PanelStorageShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { order: [], sessions: {} }
    const parsed = JSON.parse(raw) as Partial<PanelStorageShape>
    if (!Array.isArray(parsed.order) || typeof parsed.sessions !== 'object' || parsed.sessions === null) {
      return { order: [], sessions: {} }
    }
    return {
      order: parsed.order.filter(k => typeof k === 'string'),
      sessions: parsed.sessions as Record<string, PersistedPanel>,
    }
  } catch {
    return { order: [], sessions: {} }
  }
}

function writePanelStorage(sessionId: string, entry: PersistedPanel): void {
  try {
    const store = readPanelStorage()
    const order = store.order.filter(k => k !== sessionId)
    order.unshift(sessionId)
    const sessions = { ...store.sessions, [sessionId]: entry }
    while (order.length > MAX_PERSISTED_SESSIONS) {
      const evicted = order.pop()
      if (evicted !== undefined) delete sessions[evicted]
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ order, sessions }))
  } catch {

  }
}

function stateOf(sessionId: string): SessionPanelState {
  const existing = sessions.get(sessionId)
  if (existing !== undefined) return existing
  let state = emptyState()
  try {
    const stored = readPanelStorage().sessions[sessionId]
    if (stored !== undefined && obj(stored) !== undefined) {
      const snapshot = stored.snapshot === null ? null : checkedPanelSpec(stored.snapshot)
      const local = stored.local == null ? null : checkedPanelSpec(stored.local)

      if (snapshot === null && stored.snapshot !== null) {
        console.warn('[genui] Invalid saved panel ignored; valid history can rebuild this session.')
        if (local !== null) {
          state.local = state.snapshot = local
          state.baseIdentity = state.stateIdentity = fingerprint(JSON.stringify(local))
          state.localBarrier = state.replayBarrier = state.maxSeenSeq = storedSeq(stored.localBarrier)
        }
        sessions.set(sessionId, state)
        return state
      }
      const stateIdentity = snapshot === null ? null : typeof stored.stateIdentity === 'string'
        ? stored.stateIdentity : fingerprint(JSON.stringify(snapshot))
      const maxSeenSeq = storedSeq(stored.maxSeenSeq)
      const restoredState: SessionPanelState = {
        baseIdentity: stateIdentity,
        stateIdentity,
        ops: new Map(),
        invalid: new Map(),
        seen: new Map(),
        overflow: null,
        local: snapshot,
        localBarrier: storedSeq(stored.localBarrier),
        replayBarrier: maxSeenSeq,
        maxSeenSeq,
        snapshot,
      }
      const pending = stored.pending
      if (obj(pending) !== undefined && Array.isArray(pending?.ops)
        && pending.ops.every(isStoredOperation)
        && (pending.overflow === null || isStoredOperation(pending.overflow))
        && Number.isSafeInteger(pending.replayBarrier) && pending.replayBarrier >= -1
        && (pending.baseIdentity === null || typeof pending.baseIdentity === 'string')
        && (stored.local == null || local !== null)) {
        const pendingState: SessionPanelState = {
          ...restoredState, local, baseIdentity: pending.baseIdentity,
          ops: new Map(pending.ops.map(op => [op.sourceId, op])),
          seen: new Map(pending.ops.map(op => [op.sourceId, op.order])),
          replayBarrier: pending.replayBarrier, overflow: pending.overflow,
        }
        const restored = fold(pendingState, null)!

        if (samePanelSpec(restored.snapshot, snapshot)) {
          Object.assign(restoredState, pendingState, {
            snapshot: restored.snapshot, stateIdentity: restored.stateIdentity,
            invalid: restored.invalid, ops: new Map(restored.kept.map(op => [op.sourceId, op])),
            overflow: restored.overflow,
          })
          if (restoredState.overflow !== null) restoredState.seen.set(restoredState.overflow.sourceId, restoredState.overflow.order)
        }
      }

      state = restoredState
    }
  } catch {

  }
  sessions.set(sessionId, state)
  return state
}

function storedSeq(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= -1 ? value : -1
}

function canonicalPanelSpec(original: unknown, canonical: GenuiSpec): GenuiSpec {
  return samePanelSpec(original, canonical) ? original as GenuiSpec : canonical
}

function samePanelSpec(a: unknown, b: unknown): boolean {
  const sortedKeys = (_key: string, value: unknown) => obj(value) === undefined ? value
    : Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
  return JSON.stringify(a, sortedKeys) === JSON.stringify(b, sortedKeys)
}

function checkedPanelSpec(value: unknown): GenuiSpec | null {
  const processed = processGenuiSpec(value)
  return processed.errors.length === 0 && processed.spec !== null && !exceedsPanelBudget(processed.spec)
    ? canonicalPanelSpec(value, processed.spec) : null
}

function isStoredOperation(value: unknown): value is PanelOperation {
  const op = obj(value)
  if (op === undefined || typeof op.sourceId !== 'string' || op.sourceId === ''
    || !Array.isArray(op.order) || op.order.length !== 3
    || !op.order.every(n => typeof n === 'number' && Number.isSafeInteger(n))
    || (op.mode !== 'replace' && op.mode !== 'append')) return false
  return isRenderableProcess(processGenuiSpec(op.spec, { panelOperation: op.mode }))
}

function compareOrder(a: PanelOrder, b: PanelOrder): number {
  for (let i = 0; i < 3; i++) {
    const d = a[i]! - b[i]!
    if (d !== 0) return d
  }
  return 0
}

function fold(state: SessionPanelState, extra: PanelOperation | null): FoldResult | null {
  if (extra !== null) {
    if (extra.order[0] <= state.localBarrier || extra.order[0] <= state.replayBarrier) return null
    if (state.seen.has(extra.sourceId)) return null
    if (state.overflow !== null && state.overflow.sourceId === extra.sourceId) return null
    if (extra.mode === 'append' && state.overflow !== null && compareOrder(extra.order, state.overflow.order) > 0) {

      return null
    }
  }

  const ops = [...state.ops.values()].filter(op => op.order[0] > state.localBarrier && op.order[0] > state.replayBarrier)
  if (state.overflow !== null && state.overflow.order[0] > state.localBarrier && state.overflow.order[0] > state.replayBarrier) ops.push(state.overflow)
  if (extra !== null) ops.push(extra)
  ops.sort((a, b) => compareOrder(a.order, b.order))
  const checked = new Map(ops.map(op => [op, processGenuiSpec(op.spec, { panelOperation: op.mode })]))

  let start = 0
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!
    if (op.mode === 'replace' && checked.get(op)!.errors.length === 0 && !exceedsPanelBudget(op.spec)) start = i
  }
  let snapshot: GenuiSpec | null = state.local
  let stateIdentity = state.baseIdentity
  let overflow: PanelOperation | null = null
  let appendCount = 0
  const kept: PanelOperation[] = []
  const invalid = new Map<string, string>()
  let maxSeenSeq = state.maxSeenSeq
  for (let i = start; i < ops.length; i++) {
    const op = ops[i]!
    if (op.order[0] > maxSeenSeq) maxSeenSeq = op.order[0]
    const validation = checked.get(op)!
    if (!isRenderableProcess(validation)) {
      invalid.set(op.sourceId, validation.errors.join('；') || 'invalid panel spec')
      continue
    }
    const canonical = canonicalPanelSpec(op.spec, validation.spec!)
    if (op.mode === 'replace') {
      if (exceedsPanelBudget(op.spec)) {

        if (overflow === null || compareOrder(op.order, overflow.order) < 0) overflow = op
        continue
      }
      overflow = null
      snapshot = canonical
      stateIdentity = fingerprint(JSON.stringify(canonical))
      kept.length = 0
      appendCount = 0
      kept.push(op)
      continue
    }

    const merged = mergePanelSpecs(snapshot, canonical)
    if (appendCount >= limits.maxAppends
      || exceedsPanelBudget(op.spec)
      || exceedsPanelBudget(merged)) {
      if (overflow === null || compareOrder(op.order, overflow.order) < 0) overflow = op
      continue
    }
    appendCount += 1
    kept.push(op)

    const mergedValidation = processGenuiSpec(merged)
    if (mergedValidation.errors.length > 0 || mergedValidation.spec === null) {
      invalid.set(op.sourceId, mergedValidation.errors.join('；') || 'invalid panel spec')
      continue
    }
    if (snapshot === null) stateIdentity = fingerprint(JSON.stringify(op.spec))
    snapshot = canonicalPanelSpec(merged, mergedValidation.spec)
  }
  if (extra !== null) {
    const sameSet = kept.length === state.ops.size
      && kept.every(op => state.ops.get(op.sourceId)?.mode === op.mode)
      && ((overflow === null && state.overflow === null)
        || (overflow !== null && state.overflow !== null && overflow.sourceId === state.overflow.sourceId))
    if (sameSet && invalid.size === state.invalid.size
      && [...invalid].every(([id, error]) => state.invalid.get(id) === error)) return null
  }
  return { snapshot, stateIdentity, kept, invalid, overflow, maxSeenSeq }
}

function commit(state: SessionPanelState, result: FoldResult, sessionId: string): void {
  state.snapshot = result.snapshot
  state.stateIdentity = result.stateIdentity
  state.invalid = result.invalid
  state.overflow = result.overflow
  state.maxSeenSeq = result.maxSeenSeq
  state.ops = new Map(result.kept.map(op => [op.sourceId, op]))

  for (const op of result.kept) state.seen.set(op.sourceId, op.order)
  if (result.overflow !== null) state.seen.set(result.overflow.sourceId, result.overflow.order)
  writePanelStorage(sessionId, {
    stateIdentity: state.stateIdentity,
    snapshot: state.snapshot,
    local: state.local,
    localBarrier: state.localBarrier,
    maxSeenSeq: state.maxSeenSeq,
    ...(state.invalid.size === 0 ? {} : { pending: {
      ops: [...state.ops.values()], overflow: state.overflow, replayBarrier: state.replayBarrier, baseIdentity: state.baseIdentity,
    } }),
  })
}

export type PanelOperationStatus = 'accepted' | 'idempotent' | 'blocked' | 'overflow' | 'invalid'

export function applyPanelOperation(sessionId: string, op: PanelOperation): PanelOperationStatus {
  const state = stateOf(sessionId)
  const result = fold(state, op)
  if (result === null) {
    if (state.seen.has(op.sourceId) || state.overflow?.sourceId === op.sourceId) return 'idempotent'

    const laterThanOverflow = state.overflow !== null
      && op.mode === 'append'
      && compareOrder(op.order, state.overflow.order) > 0
    if (!laterThanOverflow) diagnosePanelBlocked(sessionId, op, state)
    return 'blocked'
  }
  const status: PanelOperationStatus = result.overflow !== null && result.overflow.sourceId === op.sourceId
    ? 'overflow'
    : result.invalid.has(op.sourceId) ? 'invalid' : 'accepted'
  const changed = state.snapshot !== result.snapshot || state.invalid.size !== result.invalid.size
    || [...result.invalid].some(([sourceId, error]) => state.invalid.get(sourceId) !== error)
  commit(state, result, sessionId)
  state.seen.set(op.sourceId, op.order)
  if (changed) for (const fn of listeners) fn()
  return status
}

const diagnosedBlocked = new Set<string>()

function diagnosePanelBlocked(sessionId: string, op: PanelOperation, state: SessionPanelState): void {
  const key = `${sessionId}\u0000${op.sourceId}`
  if (diagnosedBlocked.has(key)) return
  diagnosedBlocked.add(key)
  console.warn(
    `[genui] 面板操作被重放屏障拒绝（source ${op.sourceId}，order[0]=${op.order[0]} ≤ replayBarrier ${state.replayBarrier} / localBarrier ${state.localBarrier}）。历史消息重放被拒是预期行为；若是刚发送的新消息，说明消息序号推导异常，请报告。`,
  )
}

export function setLocalPanel(sessionId: string, spec: GenuiSpec | null): void {
  if (spec !== null) {
    const checked = checkedPanelSpec(spec)
    if (checked === null) return
    spec = checked
  }
  const state = stateOf(sessionId)
  const barrier = state.maxSeenSeq

  if (state.local === spec && state.localBarrier === barrier) return
  state.local = spec
  state.baseIdentity = spec === null ? null : fingerprint(JSON.stringify(spec))
  state.localBarrier = barrier

  const result = fold(state, null)!
  commit(state, result, sessionId)
  for (const fn of listeners) fn()
}

const diagnosedOverflow = new Set<string>()

export function diagnosePanelBudget(sessionId: string, sourceId: string): void {
  const key = `${sessionId}\u0000${sourceId}`
  if (diagnosedOverflow.has(key)) return
  diagnosedOverflow.add(key)
  console.warn(
    `[genui] 面板已到内容/操作上限（${limits.maxNodes} 节点、${GENUI_LIMITS.maxComputedFields} 个计算字段、${limits.maxAppends} 条追加），本次 append 被拒绝；请让模型发送 replace 更新面板。`,
  )
}

export function clearSessionPanel(sessionId: string): void {
  const had = sessions.delete(sessionId)
  const hadToken = expandTokens.delete(sessionId)
  const prefix = `${sessionId}\u0000`
  for (const key of diagnosedOverflow) {
    if (key.startsWith(prefix)) diagnosedOverflow.delete(key)
  }
  for (const key of diagnosedBlocked) {
    if (key.startsWith(prefix)) diagnosedBlocked.delete(key)
  }
  if (!had && !hadToken) return
  for (const fn of listeners) fn()
  for (const fn of expandListeners) fn()
}

export function getPanelSpec(sessionId: string): GenuiSpec | null {
  return stateOf(sessionId).snapshot
}

export function getPanelStateKey(sessionId: string): string | undefined {
  const identity = stateOf(sessionId).stateIdentity
  return identity === null ? undefined : `p:${sessionId}:${identity}`
}

export function getPanelOperationError(sessionId: string, sourceId: string): string | null {
  return stateOf(sessionId).invalid.get(sourceId) ?? null
}

export function subscribePanel(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function exceedsPanelBudget(spec: GenuiSpec): boolean {
  return countGenuiNodes(spec, limits.maxNodes + 1) > limits.maxNodes
    || (spec.computed?.length ?? 0) > GENUI_LIMITS.maxComputedFields
}

const expandTokens = new Map<string, number>()

const expandListeners = new Set<() => void>()

export function requestPanelExpand(sessionId: string): void {
  expandTokens.set(sessionId, (expandTokens.get(sessionId) ?? 0) + 1)
  for (const fn of expandListeners) fn()
}

export function getPanelExpandToken(sessionId: string): number {
  return expandTokens.get(sessionId) ?? 0
}

export function subscribePanelExpand(listener: () => void): () => void {
  expandListeners.add(listener)
  return () => {
    expandListeners.delete(listener)
  }
}
