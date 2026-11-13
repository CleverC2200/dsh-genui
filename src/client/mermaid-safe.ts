const SVG_INJECTION = /<script|[\s"']on[a-z]+\s*=|javascript:/i

export function assertSafeSvg(svg: string): void {
  if (SVG_INJECTION.test(svg)) {
    throw new Error('mermaid output failed the sanitization check; refusing to render')
  }
}

export function repairMermaidSource(code: string): string {
  const kind = /^([A-Za-z]+)/.exec(code.trim())?.[1] ?? ''
  if (kind !== 'graph' && kind !== 'flowchart') return code
  const cleaned = code.replace(/`/g, '').replace(/<br\s*\/?>/gi, ' ')

  const EDGE = /(--|==|-\.)(?!>)[ \t]*([^-\n]|-(?!--))*?[ \t]*(-->|==>|\.->)/g
  const spans: string[] = []
  const masked = cleaned.replace(EDGE, (span) => {

    if (/^[-=.<>]+$/.test(span)) return span
    spans.push(span)
    return `\uE000${spans.length - 1}\uE001`
  })

  const PIPE_LINK = /(?:<|[ox])?(?:-{2,}[>ox]?|={2,}[>ox]?|-\.+-[>ox]?)[ \t]*\|/y
  const pipeSpans: string[] = []
  const closers: string[] = []
  let inQuote = false
  let copied = 0
  let maskedPipes = ''
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i]!
    if (inQuote) {
      if (ch === '\\') i++
      else if (ch === '"') inQuote = false
      continue
    }
    if (ch === '"') { inQuote = true; continue }
    if (ch === '%' && masked[i + 1] === '%') {
      const end = masked.indexOf('\n', i)
      if (end === -1) break
      i = end
      continue
    }
    if ('[({'.includes(ch)) { closers.push(ch === '[' ? ']' : ch === '(' ? ')' : '}'); continue }
    if (ch === closers[closers.length - 1]) { closers.pop(); continue }
    if (closers.length > 0 || !'<ox-='.includes(ch)) continue

    if (i > 0 && '-=.'.includes(masked[i - 1]!)) continue
    PIPE_LINK.lastIndex = i
    const link = PIPE_LINK.exec(masked)
    if (link === null) continue
    const start = PIPE_LINK.lastIndex
    let end = start
    let labelQuote = false
    for (; end < masked.length && masked[end] !== '\n'; end++) {
      if (masked[end] === '\\' && labelQuote) { end++; continue }
      if (masked[end] === '"') labelQuote = !labelQuote
      if (masked[end] === '|' && !labelQuote) break
    }
    if (masked[end] !== '|') continue
    const text = masked.slice(start, end)
    const trimmed = text.trim()
    const label = /[@\[\]]/.test(trimmed) && !trimmed.includes('"') ? `"${trimmed}"` : text
    pipeSpans.push(`${link[0]}${label}|`)
    maskedPipes += masked.slice(copied, i) + `\uE002${pipeSpans.length - 1}\uE003`
    copied = end + 1
    i = end
  }
  maskedPipes += masked.slice(copied)
  const quoted = maskedPipes.replace(
    /([\[\(])([^\[\]\(\)\{\}"'\n]*)([\]\)])/g,
    (whole, open: string, label: string, close: string) => {
      const trimmed = label.trim()
      if (trimmed === '') return whole
      if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(trimmed) || /\s/.test(trimmed)) {
        return `${open}"${trimmed}"${close}`
      }
      return whole
    },
  )

  return quoted
    .replace(/\uE002(\d+)\uE003/g, (whole, i: string) => pipeSpans[Number(i)] ?? whole)
    .replace(/\uE000(\d+)\uE001/g, (whole, i: string) => spans[Number(i)] ?? whole)
}

const FLOWCHART_EDGE = /-->(?!>)|==>|-\.->/

export function ensureFlowchartKind(code: string): string {
  const trimmed = code.trim()
  const kind = /^([A-Za-z]+)/.exec(trimmed)?.[1] ?? ''
  if (kind === 'graph' || kind === 'flowchart') return code
  if (!FLOWCHART_EDGE.test(trimmed)) return code
  return `graph TD\n${trimmed}`
}
