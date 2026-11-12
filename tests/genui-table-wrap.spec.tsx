import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import type { GenuiSpec } from '../src/client/spec.ts'
import { processGenuiSpec } from '../src/client/guard.ts'

afterEach(cleanup)

const LONG_CELL = '复制 bili-duty 那份清单成 ~/.dsh/profiles/bili-duty-xj/，追加 llm-pi-ai 条目，重启后 headless 会话才会用这份配置。'

function proseSpec(wrap?: boolean): GenuiSpec {
  const table = {
    type: 'table' as const,
    columns: ['方案', '具体改动'],
    rows: [
      ['另建一个 profile（推荐）', LONG_CELL],
      ['真能修的路', '把清单直接加到 desktop profile 的 cordis.patch.yml 里'],
    ],
    ...(wrap === undefined ? {} : { wrap }),
  }
  return { items: [table] }
}

function wrapperOf(container: HTMLElement): HTMLElement {
  const table = container.querySelector('table')
  expect(table).not.toBeNull()
  return table!.parentElement as HTMLElement
}

describe('table.wrap opt-in prose layout', () => {
  it('validates the public boolean field and preserves its opt-in meaning', () => {
    for (const wrap of [true, false]) {
      const result = processGenuiSpec(proseSpec(wrap))
      expect(result.errors).toEqual([])
      expect(result.spec?.items[0]).toMatchObject(wrap ? { wrap: true } : { type: 'table' })
      if (!wrap) expect(result.spec?.items[0]).not.toHaveProperty('wrap')
    }
    const value = proseSpec(true)
    expect(processGenuiSpec({ items: [{ ...value.items[0], wrap: 'true' }] }).errors.join(' ')).toContain('wrap')
  })
  it('marks the scroll wrapper when wrap is true', () => {
    const { container } = render(<GenuiBlock spec={proseSpec(true)} />)
    expect(wrapperOf(container).className).toContain('tableWrapProse')
  })

  it('leaves the data-table DOM untouched when wrap is omitted', () => {
    for (const spec of [proseSpec(), proseSpec(false)]) {
      const { container } = render(<GenuiBlock spec={spec} />)
      expect(wrapperOf(container).className).not.toContain('tableWrapProse')
    }
  })

  it('renders the same cells in both modes (wrap is layout only)', () => {
    const wrapped = render(<GenuiBlock spec={proseSpec(true)} />).container
    const plain = render(<GenuiBlock spec={proseSpec()} />).container
    expect(wrapped.textContent).toBe(plain.textContent)
    expect(wrapped.querySelectorAll('td')).toHaveLength(plain.querySelectorAll('td').length)

    expect(wrapped.querySelectorAll('td[class*="tdMultiline"]')).toHaveLength(0)
    expect(wrapped.querySelectorAll('td[class*="tdCode"]')).toHaveLength(0)
  })

  it('keeps multi-line cells on their own whitespace rules under wrap', () => {
    const { container } = render(<GenuiBlock spec={{
      items: [{ type: 'table', columns: ['A', 'B'], rows: [['x', '第一行\n第二行']], wrap: true }],
    }} />)
    const td = container.querySelectorAll('td')[1]!
    expect(td.className).toContain('tdMultiline')
  })

  it('pins the prose stylesheet contract and the #326 guards', () => {

    const css = readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')

    expect(css).toMatch(/\.tableWrapProse > \.table\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*table-layout:\s*auto/)

    expect(css).toMatch(/\.tableWrapProse > \.table[^{}]*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere[^}]*min-width:\s*6em/)

    expect(css).toMatch(/\.table\s*\{[^}]*width:\s*max-content[^}]*min-width:\s*100%/)
    expect(css).toMatch(/\.table th\s*\{[^}]*white-space:\s*nowrap/)
    expect(css).toMatch(/\.table td\s*\{[^}]*white-space:\s*nowrap/)
  })
})
