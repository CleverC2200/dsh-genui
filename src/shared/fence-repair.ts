export function isCompleteJson(raw: string): boolean {
  try {
    JSON.parse(raw)
    return true
  } catch {
    return false
  }
}

export function describeJsonFailure(raw: string): string | null {
  try {
    JSON.parse(raw)
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const pos = msg.match(/position (\d+)/i)
    const where = pos !== null ? `（字符 ${pos[1]} 附近）` : ''
    return `${where}${msg.slice(0, 140)}`
  }
}

export function repairFenceJson(raw: string): { text: string; repairs: number } | null {
  try {
    JSON.parse(raw)
    return null
  } catch {

  }
  return scanFenceJson(raw, false)
}

const MAX_QUOTE_ATTEMPTS = 32
const MAX_QUOTE_LOOKAHEAD = 4096

type JsonScope = {
  closer: '}' | ']'
  expecting: 'key' | 'colon' | 'value' | 'comma'
}

type Token = {
  kind: '{' | '}' | '[' | ']' | ',' | ':' | 'string'
  start: number
  end: number
}
type RepairScan = {
  text: string
  repairs: number
  rootEnd: number
  rawRootEnd: number
  choices: number[]
  unfinishedString: boolean
  invalidValue: boolean
}

function isJsonSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
}

function jsonStructureAt(raw: string, index: number): string {
  const ch = raw[index] ?? '\0'
  if (ch === '：') return ':'
  if (ch === '，' || ch === '、' || ch === '；') return ','
  return ch
}

function skipValuelessKeys(raw: string, start: number, limit = raw.length): { start: number; repairs: number } | null {
  let cursor = start
  let repairs = 0
  while (cursor < limit && raw[cursor] === '"') {
    const keyStart = cursor++
    while (cursor < limit && raw[cursor] !== '"') {
      if (raw[cursor] === '\\') cursor += 2
      else cursor++
    }
    if (cursor >= limit) return null
    cursor++
    try { JSON.parse(raw.slice(keyStart, cursor)) } catch { return null }
    while (cursor < limit && isJsonSpace(raw[cursor])) cursor++
    if (jsonStructureAt(raw, cursor) === ':') return repairs > 0 ? { start: keyStart, repairs } : null
    if (jsonStructureAt(raw, cursor) !== ',') return null
    repairs++
    cursor++
    while (cursor < limit && isJsonSpace(raw[cursor])) cursor++
  }
  return null
}

function quoteCanClose(raw: string, index: number, key: boolean, scopes: JsonScope[], complete: boolean): boolean {
  const limit = Math.min(raw.length, index + MAX_QUOTE_LOOKAHEAD)
  let cursor = index + 1
  const skipSpace = (): void => { while (cursor < limit && isJsonSpace(raw[cursor])) cursor++ }
  skipSpace()
  if (cursor >= limit) return true
  if (key) return jsonStructureAt(raw, cursor) === ':'
  let scopeIndex = scopes.length - 1
  if (jsonStructureAt(raw, cursor) === ':') return false
  while (raw[cursor] === '}' || raw[cursor] === ']') {
    const scope = scopes[scopeIndex]
    if (scope === undefined) return false
    if (raw[cursor] === scope.closer) scopeIndex--
    else if (!complete) return false
    cursor++
    skipSpace()
    if (cursor >= limit) return true

    if (scopeIndex < 0) return complete
  }
  if (jsonStructureAt(raw, cursor) !== ',') return false
  const scope = scopes[scopeIndex]
  if (scope === undefined) return false
  cursor++
  skipSpace()
  if (cursor >= limit) return true
  if (raw[cursor] === scope.closer) return true
  if (scope.closer === ']') return /["[{tfn\-0-9]/.test(raw[cursor]!)
  if (raw[cursor] !== '"') return false

  const valueless = skipValuelessKeys(raw, cursor, limit)
  if (valueless !== null) cursor = valueless.start

  cursor++
  while (cursor < limit) {
    if (raw[cursor] === '\\') { cursor += 2; continue }
    if (raw[cursor] === '"') {
      cursor++
      skipSpace()
      return cursor >= limit || jsonStructureAt(raw, cursor) === ':'
    }
    if (raw[cursor]!.charCodeAt(0) < 0x20) return false
    cursor++
  }
  return true
}

function scanFenceCandidate(raw: string, complete: boolean, contentQuotes: ReadonlySet<number>): RepairScan {
  let out = ''
  const scopes: JsonScope[] = []
  let inString = false
  let key = false
  let interiorQuote = false
  let escaped = false
  let repairs = 0
  let rootEnd = 0
  let rawRootEnd = 0
  let invalidValue = false
  const choices: number[] = []
  const finishValue = (): void => {
    const scope = scopes[scopes.length - 1]
    if (scope !== undefined) scope.expecting = 'comma'
  }
  for (let i = 0; i < raw.length; i++) {
    let ch = raw[i]!
    if (escaped) {
      if (inString && ch === '"') interiorQuote = true
      out += ch
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') { out += ch; escaped = true; continue }
      if (ch !== '"') { out += ch; continue }
      let next = i + 1
      while (next < raw.length && isJsonSpace(raw[next])) next++

      const ordinaryEnd = !key && ((!interiorQuote && ',}]:'.includes(raw[next] ?? '\0'))
        || (scopes[scopes.length - 1]?.closer === ']' && raw[next] === ','))
      if (!contentQuotes.has(i) && (ordinaryEnd || quoteCanClose(raw, i, key, scopes, complete))) {
        inString = false
        out += ch
        const scope = scopes[scopes.length - 1]
        if (key) {
          if (scope !== undefined) scope.expecting = 'colon'
        } else {
          finishValue()

          if (scope !== undefined && interiorQuote) {
            if (choices.length === MAX_QUOTE_ATTEMPTS) choices.shift()
            choices.push(i)
          }
        }
      } else {
        out += '\\"'
        interiorQuote = true
        repairs++
      }
      continue
    }
    const structural = jsonStructureAt(raw, i)
    if (structural !== ch) { ch = structural; repairs++ }
    if (ch === '"') {
      key = scopes[scopes.length - 1]?.expecting === 'key'
      if (key) {
        const valueless = skipValuelessKeys(raw, i)
        if (valueless !== null) {
          repairs += valueless.repairs
          i = valueless.start - 1
          continue
        }
      }
      interiorQuote = false
      inString = true
      out += ch
      continue
    }
    if (ch === '{' || ch === '[') {
      finishValue()
      scopes.push({ closer: ch === '{' ? '}' : ']', expecting: ch === '{' ? 'key' : 'value' })
      out += ch
      continue
    }
    if (ch === '}' || ch === ']') {
      if (scopes[scopes.length - 1]?.closer === ch) {
        scopes.pop()
        out += ch
        if (scopes.length === 0 && rootEnd === 0) {
          rootEnd = out.length
          rawRootEnd = i + 1
        }
      } else if (complete) repairs++
      else out += ch
      continue
    }
    if (ch === ',') {
      let j = i + 1
      while (j < raw.length && isJsonSpace(raw[j])) j++
      if (j === raw.length || raw[j] === '}' || raw[j] === ']') {
        repairs++
        continue
      }
      const scope = scopes[scopes.length - 1]
      if (scope !== undefined) scope.expecting = scope.closer === '}' ? 'key' : 'value'
    } else if (ch === ':') {
      const scope = scopes[scopes.length - 1]
      if (scope !== undefined) scope.expecting = 'value'
    } else if (!isJsonSpace(ch) && scopes[scopes.length - 1]?.expecting === 'value') {

      let j = i + 1
      while (j < raw.length && !isJsonSpace(raw[j]) && !'{}[],:"'.includes(jsonStructureAt(raw, j))) j++
      const token = raw.slice(i, j)
      if (!/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(token)) invalidValue = true
      finishValue()
      out += token
      i = j - 1
      continue
    }
    out += ch
  }
  const unfinishedString = inString
  if (complete) {
    if (inString) { out += '"'; repairs++ }
    while (scopes.length > 0) { out += scopes.pop()!.closer; repairs++ }
  }
  return { text: out, repairs, rootEnd, rawRootEnd, choices, unfinishedString, invalidValue }
}

function originalJsonPrefix(raw: string): string | null {
  const scopes: string[] = []
  let inString = false
  let escaped = false
  let started = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (escaped) { escaped = false; continue }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (!started) {
      if (isJsonSpace(ch)) continue
      if (ch !== '{' && ch !== '[') return null
      started = true
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{' || ch === '[') scopes.push(ch === '{' ? '}' : ']')
    else if (ch === '}' || ch === ']') {
      if (scopes.pop() !== ch) return null
      if (scopes.length === 0) {
        const text = raw.slice(0, i + 1).trimEnd()
        try { JSON.parse(text); return text } catch { return null }
      }
    }
  }
  return null
}

function scanFenceJson(raw: string, complete: boolean): { text: string; repairs: number } | null {

  const original = originalJsonPrefix(raw)
  if (original !== null) return complete ? { text: original, repairs: 1 } : null
  const pending: number[][] = [[]]
  let prefix: { text: string; repairs: number; rawEnd: number } | null = null
  for (let attempt = 0; attempt < MAX_QUOTE_ATTEMPTS && pending.length > 0; attempt++) {
    const forced = pending.pop()!
    const scanned = scanFenceCandidate(raw, complete, new Set(forced))

    if (scanned.repairs > 0 && !(forced.length > 0 && scanned.unfinishedString)) {
      try {
        JSON.parse(scanned.text)
        return { text: scanned.text, repairs: scanned.repairs }
      } catch {                                                    }
    }

    if (complete && scanned.rootEnd > 0 && (prefix === null || scanned.rawRootEnd > prefix.rawEnd)) {
      const text = scanned.text.slice(0, scanned.rootEnd).trimEnd()
      try {
        JSON.parse(text)
        prefix = { text, repairs: scanned.repairs + 1, rawEnd: scanned.rawRootEnd }
      } catch {                                                       }
    }
    if (scanned.invalidValue) continue
    const last = forced[forced.length - 1] ?? -1
    for (const quote of scanned.choices) {
      if (quote > last) pending.push([...forced, quote])
    }

    if (pending.length > MAX_QUOTE_ATTEMPTS) pending.splice(0, pending.length - MAX_QUOTE_ATTEMPTS)
  }

  if (prefix !== null) return { text: prefix.text, repairs: prefix.repairs }
  return null
}

export function trimToBalancedRoot(text: string): string | null {
  const stack: Array<'}' | ']'> = []
  let inString = false
  let escaped = false
  let started = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      started = true
      continue
    }
    if (ch === '{') {
      stack.push('}')
      started = true
      continue
    }
    if (ch === '[') {
      stack.push(']')
      started = true
      continue
    }
    if (ch === '}' || ch === ']') {

      if (stack[stack.length - 1] !== ch) return null
      stack.pop()
      if (stack.length === 0 && started) {
        if (i + 1 >= text.length) return null
        return text.slice(0, i + 1).trim()
      }
    }
  }
  return null
}

function repairWrappedMemberKey(raw: string): { text: string; repairs: number } | null {

  if (!/\[\s*"/.test(raw)) return null
  const tokens: Token[] = []
  let inString = false
  let escaped = false
  let stringStart = -1
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (inString) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') {
        inString = false
        tokens.push({ kind: 'string', start: stringStart, end: i + 1 })
      }
      continue
    }
    if (ch === '"') { inString = true; stringStart = i; continue }
    if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ',' || ch === ':') {
      tokens.push({ kind: ch, start: i, end: i + 1 })
    }
  }

  const enclosingOf: Array<'{' | '[' | null> = []
  const openStack: Array<'{' | '['> = []
  for (const token of tokens) {
    if (token.kind === '}' || token.kind === ']') {
      enclosingOf.push(openStack.pop() ?? null)
      continue
    }
    enclosingOf.push(openStack[openStack.length - 1] ?? null)
    if (token.kind === '{' || token.kind === '[') openStack.push(token.kind)
  }
  const unwraps: Array<{ from: number; to: number; key: string }> = []
  for (let k = 0; k + 2 < tokens.length; k++) {
    const open = tokens[k]!
    const key = tokens[k + 1]!
    const close = tokens[k + 2]!
    if (open.kind !== '[' || key.kind !== 'string' || close.kind !== ']') continue

    if (raw.slice(open.end, key.start).trim() !== '') continue
    if (raw.slice(key.end, close.start).trim() !== '') continue
    const prev = tokens[k - 1]
    if (prev === undefined) continue

    if (prev.kind !== '{' && prev.kind !== ',') continue
    if (enclosingOf[k] !== '{') continue

    const next = tokens[k + 3]
    if (next === undefined || next.kind !== ':') continue
    unwraps.push({ from: open.start, to: close.end, key: raw.slice(key.start, key.end) })
    k += 2
  }
  if (unwraps.length === 0) return null
  let text = ''
  let cursor = 0
  for (const edit of unwraps) {
    text += raw.slice(cursor, edit.from) + edit.key
    cursor = edit.to
  }
  text += raw.slice(cursor)
  return { text, repairs: unwraps.length }
}

function rewriteFenceShapes(raw: string): { text: string; repairs: number } | null {
  let text = raw
  let repairs = 0
  const wrapped = repairWrappedMemberKey(text)
  if (wrapped !== null) { text = wrapped.text; repairs += wrapped.repairs }
  const tetris = rewriteTetrisTableColumns(text)
  if (tetris !== null) { text = tetris.text; repairs += tetris.repairs }
  return repairs === 0 ? null : { text, repairs }
}

function rewriteTetrisTableColumns(raw: string): { text: string; repairs: number } | null {
  if (!/"columns"\s*:\s*\[/.test(raw)) return null
  let text = ''
  let rest = raw
  let edits = 0
  while (true) {
    const match = /"columns"\s*:\s*\[/.exec(rest)
    if (match === null) { text += rest; break }
    const start = match.index + match[0]!.length

    let depth = 1
    let inString = false
    let escaped = false
    let end = -1
    for (let i = start; i < rest.length; i++) {
      const ch = rest[i]!
      if (escaped) { escaped = false; continue }
      if (inString) {
        if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') { inString = true; continue }
      if (ch === '[') depth++
      else if (ch === ']') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end < 0) return null
    const after = rest.slice(end + 1)

    const keyed = /^\s*,\s*\[\s*"rows"\s*:\s*\[/.exec(after)
    if (keyed !== null) {
      const through = end + 1 + keyed[0]!.length
      text += `${rest.slice(0, end + 1)},"rows":[`
      rest = rest.slice(through)
      edits += 1
      continue
    }
    const nextArray = /^\s*,\s*\[/.exec(after)
    if (nextArray === null) {
      text += rest.slice(0, end + 1)
      rest = after
      continue
    }
    const throughBracket = end + 1 + nextArray[0]!.length
    text += rest.slice(0, throughBracket).replace(/,\s*\[$/, ', "rows": [')
    rest = rest.slice(throughBracket)
    edits += 1
  }
  if (edits === 0) return null

  const stack: string[] = []
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (escaped) { out += ch; escaped = false; continue }
    if (inString) {
      out += ch
      if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; out += ch; continue }
    if (ch === '{' || ch === '[') { stack.push(ch); out += ch; continue }
    if (ch === '}' || ch === ']') {
      const open = stack[stack.length - 1]
      if ((ch === '}' && open === '{') || (ch === ']' && open === '[')) {
        stack.pop()
        out += ch
      } else edits += 1
      continue
    }
    out += ch
  }
  return { text: out, repairs: edits }
}

export function completeFenceJson(raw: string): { text: string; repairs: number } | null {
  try {
    JSON.parse(raw)
    return null
  } catch {

  }

  const shaped = rewriteFenceShapes(raw)
  if (shaped !== null) {
    try {
      JSON.parse(shaped.text)
      return shaped
    } catch {

    }
    const scanned = completeFenceJson(shaped.text)
    if (scanned === null) return null
    return { text: scanned.text, repairs: scanned.repairs + shaped.repairs }
  }
  return scanFenceJson(raw, true)
}
