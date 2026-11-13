import { partialRepairGenuiSpec, processGenuiSpec, type GenuiProcessResult } from '../client/guard.ts'
import { parsePartialGenuiSpec } from '../client/parse-partial.ts'
import type { GenuiSpec } from '../client/spec.ts'
import { completeFenceJson, repairFenceJson } from './fence-repair.ts'

export interface FenceResolveOptions {

  readonly settled: boolean
}

export interface FenceResolution {

  readonly value: unknown | null

  readonly processed: GenuiProcessResult | null

  readonly spec: GenuiSpec | null
}

function resolveParsedFence(value: unknown): FenceResolution {
  const processed = processGenuiSpec(value, { deferPanelReferences: true })
  return { value, processed, spec: partialRepairGenuiSpec(processed) }
}

function unresolvedFence(): FenceResolution {
  return { value: null, processed: null, spec: null }
}

export function resolveFence(raw: string, options: FenceResolveOptions): FenceResolution {
  const parsed = parsePartialGenuiSpec(raw)
  let resolution = parsed === null ? unresolvedFence() : resolveParsedFence(parsed)
  if (resolution.spec !== null) return resolution

  const repaired = repairFenceJson(raw)
  if (repaired !== null) {
    const reparsed = parsePartialGenuiSpec(repaired.text)
    resolution = reparsed === null ? unresolvedFence() : resolveParsedFence(reparsed)
  }
  if (resolution.spec !== null || !options.settled) return resolution

  const completed = completeFenceJson(raw)
  if (completed === null) return resolution
  const reparsed = parsePartialGenuiSpec(completed.text)
  return reparsed === null ? unresolvedFence() : resolveParsedFence(reparsed)
}

export function resolveFenceSpec(raw: string, options: FenceResolveOptions): GenuiSpec | null {
  return resolveFence(raw, options).spec
}
