import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownText } from './markdown-labels.tsx'
import { parsePartialGenuiSpec, collectPartialCandidates, setMaxPartialRepairAttempts } from '../src/client/parse-partial.ts'

afterEach(cleanup)

describe('parsePartialGenuiSpec', () => {
  it('parses a complete spec', () => {
    const spec = parsePartialGenuiSpec('{"items":[{"type":"text","content":"A"}]}')
    expect(spec?.items).toHaveLength(1)
  })

  it('wraps a single-component root into a col (documented fence vocabulary)', () => {

    const spec = parsePartialGenuiSpec('{"type":"callout","tone":"info","title":"T","content":"c"}')
    expect(spec).not.toBeNull()
    expect(spec!.items).toHaveLength(1)
    expect((spec!.items[0] as { type: string }).type).toBe('callout')
  })

  it('hoists panel/append from a single-component root onto the wrapper', () => {
    const spec = parsePartialGenuiSpec('{"type":"text","content":"x","panel":true,"append":true}')
    expect(spec?.panel).toBe(true)
    expect(spec?.append).toBe(true)
  })

  it('still rejects non-component roots without an items array', () => {
    expect(parsePartialGenuiSpec('{"title":"x"}')).toBeNull()
    expect(parsePartialGenuiSpec('{"foo":1}')).toBeNull()
  })

  it('extracts finished components while the array is still growing', () => {

    const spec = parsePartialGenuiSpec('{"items":[{"type":"text","content":"A"},{"type":"stat","labe')
    expect(spec?.items).toHaveLength(1)
    expect((spec!.items[0] as { type: string }).type).toBe('text')
  })

  it('does not expose a partial nested EChart option as a finished component', () => {
    const first = '{"type":"text","content":"A"}'
    const partialEchart = '{"type":"echart","option":{"tooltip":{"trigger":"axis"},"grid":{"left":48},"xAxis":{"type":"category","data":["质量指标记录"]}'
    const spec = parsePartialGenuiSpec(`{"items":[${first},${partialEchart}`)

    expect(spec?.items).toHaveLength(1)
    expect((spec!.items[0] as { type: string }).type).toBe('text')
  })

  it('does not render a single partial EChart before its component closes', () => {
    const partial = '{"items":[{"type":"echart","option":{"tooltip":{"trigger":"axis"},"grid":{"left":48},"xAxis":{"type":"category","data":["质量指标记录"]}'
    expect(parsePartialGenuiSpec(partial)).toBeNull()
  })

  it('waits for a bare component root instead of treating its data item as complete', () => {
    const partial = '{"type":"chart","data":[{"label":"A","value":1}'
    expect(parsePartialGenuiSpec(partial)).toBeNull()
  })

  it('extracts two finished components before the third', () => {
    const spec = parsePartialGenuiSpec('{"items":[{"type":"text","content":"A"},{"type":"stat","label":"B","value":"1"},{"type":"but')
    expect(spec?.items).toHaveLength(2)
    expect((spec!.items[0] as { type: string }).type).toBe('text')
    expect((spec!.items[1] as { type: string }).type).toBe('stat')
  })

  it('handles a trailing comma after the last finished element', () => {
    const spec = parsePartialGenuiSpec('{"items":[{"type":"text","content":"A"},')
    expect(spec?.items).toHaveLength(1)
  })

  it('returns null when no element is complete yet', () => {
    expect(parsePartialGenuiSpec('{"items":[{"type":"tex')).toBeNull()
    expect(parsePartialGenuiSpec('{"title":')).toBeNull()
  })

  it('does not choke on brackets inside strings', () => {
    const spec = parsePartialGenuiSpec('{"items":[{"type":"text","content":"a {b} [c] }"},{"type":"but')
    expect(spec?.items).toHaveLength(1)
    expect((spec!.items[0] as { content: string }).content).toBe('a {b} [c] }')
  })

  it('keeps escaping inside strings', () => {
    const spec = parsePartialGenuiSpec('{"items":[{"type":"code","code":"a \\"quote\\" b"},{"type":"di')
    expect(spec?.items).toHaveLength(1)
  })
})

describe('partial render while streaming', () => {
  it('renders finished components from an incomplete fence while streaming', () => {

    const partial = '```dsh-ui\n{"items":[{"type":"text","content":"你好"},{"type":"stat","label":"进度","value":"50%"},{"type":"but'
    const { container } = render(<MarkdownText text={partial} streaming />)

    expect(container.textContent).toContain('你好')
    expect(container.textContent).toContain('进度')

    expect(container.textContent).not.toContain('button')
  })

  it('grows the render as more components complete', () => {
    const head = '```dsh-ui\n{"items":[{"type":"text","content":"A"},'
    const r1 = render(<MarkdownText text={head + '{"type":"text","content":"B"}'} streaming />)

    expect(r1.container.textContent).toContain('A')
    expect(r1.container.textContent).toContain('B')
    r1.unmount()

    const r2 = render(<MarkdownText text={head} streaming />)
    expect(r2.container.textContent).toContain('A')
    expect(r2.container.textContent).not.toContain('B')
  })
})

describe('bounded repair (single scan, capped attempts)', () => {
  afterEach(() => {
    setMaxPartialRepairAttempts(32)
  })

  it('scans the pathological 24 KB / 8000-object input once, ≤32 candidates', () => {
    const items = Array.from({ length: 8000 }, (_, i) => `{"type":"text","content":"c${i}"}`).join(',')
    const raw = `{"items":[${items}`
    const { candidates, scannedChars } = collectPartialCandidates(raw)
    expect(scannedChars).toBe(raw.length)
    expect(candidates.length).toBeLessThanOrEqual(32)
  })

  it('keeps total JSON.parse calls within 1 full + the repair budget', () => {
    const raw = '{"items":[' + Array.from({ length: 8000 }, (_, i) => `{"type":"text","content":"c${i}"}`).join(',') + ',"type":"bu'
    const parseSpy = vi.spyOn(JSON, 'parse')
    const result = parsePartialGenuiSpec(raw)
    expect(result).not.toBeNull()

    expect(parseSpy.mock.calls.length).toBeLessThanOrEqual(33)
    parseSpy.mockRestore()
  })

  it('respects an injected smaller repair budget', () => {
    setMaxPartialRepairAttempts(4)
    const raw = '{"items":[' + Array.from({ length: 8000 }, (_, i) => `{"type":"text","content":"c${i}"}`).join(',') + ',"type":"bu'
    const parseSpy = vi.spyOn(JSON, 'parse')
    parsePartialGenuiSpec(raw)
    expect(parseSpy.mock.calls.length).toBeLessThanOrEqual(5)
    parseSpy.mockRestore()
  })

  it('still recovers the ordinary streaming prefixes (no regression)', () => {
    expect(parsePartialGenuiSpec('{"items":[{"type":"text","content":"A"},{"type":"stat","labe')?.items).toHaveLength(1)
    expect(parsePartialGenuiSpec('{"items":[{"type":"text","content":"A"},')?.items).toHaveLength(1)
    expect(parsePartialGenuiSpec('{"items":[{"type":"text","content":"a {b} [c] }"},{"type":"but')?.items).toHaveLength(1)
  })
})

describe('progressive inside a container', () => {
  it('shows a finished child before its container closes', () => {

    const raw = '{"items":[{"type":"col","items":[{"type":"text","content":"第一行"},{"type":"te'
    const spec = parsePartialGenuiSpec(raw)
    expect(spec).not.toBeNull()
    const col = spec!.items[0] as { type: string; items: Array<{ type: string; content?: string }> }
    expect(col.type).toBe('col')
    expect(col.items).toHaveLength(1)
    expect(col.items[0]!.content).toBe('第一行')
  })

  it('grows a card child by child instead of waiting for the closing brace', () => {
    const one = '{"items":[{"type":"card","title":"指标","items":[{"type":"stat","label":"A","value":"1"}]'
    expect((parsePartialGenuiSpec(one)!.items[0] as { items: unknown[] }).items).toHaveLength(1)

    const two = '{"items":[{"type":"card","title":"指标","items":[{"type":"stat","label":"A","value":"1"},{"type":"stat","label":"B","value":"2"}]'
    expect((parsePartialGenuiSpec(two)!.items[0] as { items: unknown[] }).items).toHaveLength(2)
  })

  it('shows finished table rows before the table closes', () => {
    const raw = '{"items":[{"type":"table","columns":["a","b"],"rows":[["1","2"]'
    const table = parsePartialGenuiSpec(raw)!.items[0] as { type: string; rows: unknown[] }
    expect(table.type).toBe('table')
    expect(table.rows).toHaveLength(1)
  })

  it('does not invent a child from a half-written object', () => {

    const raw = '{"items":[{"type":"col","items":[{"type":"text","content":"完整"},{"type":"text","content":"半'
    expect((parsePartialGenuiSpec(raw)!.items[0] as { items: unknown[] }).items).toHaveLength(1)
  })
})
