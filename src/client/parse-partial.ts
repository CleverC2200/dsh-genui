import { isGenuiSpec, type GenuiSpec } from './spec.ts'
import { wrapSingleComponentRoot } from './spec.ts'

export const MAX_PARTIAL_REPAIR_ATTEMPTS = 32

let repairAttemptsLimit = MAX_PARTIAL_REPAIR_ATTEMPTS

export function setMaxPartialRepairAttempts(n: number): void {
  repairAttemptsLimit = n
}

export interface PartialCandidate {
  end: number
  closingSuffix: string
}

export function collectPartialCandidates(raw: string): { candidates: PartialCandidate[]; scannedChars: number } {
  const stack: string[] = []
  const candidates: PartialCandidate[] = []
  const push = (c: PartialCandidate): void => {
    if (candidates.length >= repairAttemptsLimit) candidates.shift()
    candidates.push(c)
  }
  let inString = false
  let escaped = false
  let scanned = 0
  for (; scanned < raw.length; scanned++) {
    const ch = raw[scanned]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch)
      continue
    }
    if (ch === '}' || ch === ']') {
      const open = stack.pop()
      const expects = ch === '}' ? '{' : '['
      if (open !== expects) {

        break
      }

      if (stack.length > 0 && stack[stack.length - 1] === '[') {
        let closing = ''
        for (let i = stack.length - 1; i >= 0; i--) closing += stack[i] === '[' ? ']' : '}'
        push({ end: scanned + 1, closingSuffix: closing })
      }
      if (stack.length === 0) {

        push({ end: scanned + 1, closingSuffix: '' })
      }
      continue
    }
  }
  candidates.sort((a, b) => b.end - a.end)
  const deduped: PartialCandidate[] = []
  for (const c of candidates) {
    if (deduped.length === 0 || deduped[deduped.length - 1]!.end !== c.end) deduped.push(c)
  }
  return { candidates: deduped.slice(0, repairAttemptsLimit), scannedChars: scanned }
}

function trySpec(candidate: string, allowSingleComponentRoot: boolean): GenuiSpec | null {
  try {
    let value: unknown = JSON.parse(candidate)

    if (typeof value === 'string') {
      try {
        value = JSON.parse(value)
      } catch {
        return null
      }
    }
    if (isGenuiSpec(value)) return value

    if (Array.isArray(value) && value.length > 0) return { items: value }

    return allowSingleComponentRoot ? wrapSingleComponentRoot(value) : null
  } catch {
    return null
  }
}

export function parsePartialGenuiSpec(raw: string): GenuiSpec | null {
  const text = raw.trim()
  if (text === '') return null

  const full = trySpec(text, true)
  if (full !== null) return full

  const { candidates } = collectPartialCandidates(text)
  for (const candidate of candidates) {
    const spec = trySpec(text.slice(0, candidate.end) + candidate.closingSuffix, false)
    if (spec !== null) return spec
  }

  return null
}
