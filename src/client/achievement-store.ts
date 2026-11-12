import type { GenuiSpec } from './spec.ts'
import { ACHIEVEMENTS, checkAchievements, countSpecKinds, emptyState, type AchieveState, type AchievementDef } from './achievements.ts'

const STORE_KEY = 'dsh.genui.achievements'
const SEEN_KEY = 'dsh.genui.achievements.seen'
const SEEN_MAX = 200

interface AchieveStore {
  state: AchieveState
  unlocked: Record<string, number>
}

let store: AchieveStore = loadStore()
const listeners = new Set<() => void>()

let toastQueue: AchievementDef[] = []

function loadStore(): AchieveStore {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw === null) return { state: emptyState(), unlocked: {} }
    const parsed = JSON.parse(raw) as Partial<AchieveStore>
    const state = { ...emptyState(), ...(parsed.state ?? {}) }
    return { state, unlocked: typeof parsed.unlocked === 'object' && parsed.unlocked !== null ? parsed.unlocked as Record<string, number> : {} }
  } catch {
    return { state: emptyState(), unlocked: {} }
  }
}

function saveStore(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {

  }
}

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function writeSeen(list: string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(0, SEEN_MAX)))
  } catch {

  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

function applyDelta(patch: Partial<AchieveState>): void {
  store.state = { ...store.state, ...patch }
  const fresh = checkAchievements(store.state, store.unlocked)
  for (const ach of fresh) store.unlocked[ach.id] = Date.now()
  if (fresh.length > 0) toastQueue.push(...fresh)
  saveStore()
  emit()
}

function fingerprintOf(spec: GenuiSpec): string {
  const s = JSON.stringify(spec)
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  return `${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}`
}

export function recordFence(spec: GenuiSpec): void {
  const fingerprint = fingerprintOf(spec)
  const seen = readSeen()
  if (seen.includes(fingerprint)) return
  writeSeen([fingerprint, ...seen])
  const kinds = countSpecKinds(spec)
  applyDelta({
    fences: store.state.fences + 1,
    charts: store.state.charts + (kinds.charts > 0 ? 1 : 0),
    advanced: store.state.advanced + (kinds.advanced > 0 ? 1 : 0),
  })
}

export function recordPanel(): void {
  applyDelta({ panels: store.state.panels + 1 })
}

export function recordInteraction(): void {
  applyDelta({ interactions: store.state.interactions + 1 })
}

export function recordTemplateUse(): void {
  applyDelta({ templates: store.state.templates + 1 })
}

export function getAchievementSnapshot(): { state: AchieveState, unlocked: Record<string, number> } {
  return store
}

export function consumeUnlocks(): AchievementDef[] {
  const queue = toastQueue
  toastQueue = []
  return queue
}

export function subscribeAchievements(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function achievementCount(): { total: number, unlocked: number } {
  return {
    total: ACHIEVEMENTS.length,
    unlocked: ACHIEVEMENTS.filter(a => store.unlocked[a.id] !== undefined).length,
  }
}
