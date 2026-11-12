import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readRule = (name: string): string => {
  const css = readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')
  const match = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css)
  expect(match, `${name} rule must exist`).not.toBeNull()
  return match![1]!
}

describe('grading result layout contract', () => {
  it('gradeItem keeps the answer column shrinkable', () => {
    const rule = readRule('gradeItem')

    expect(rule).not.toContain('auto auto 1fr')
    expect(rule).toContain('minmax(0, 1fr)')
    expect(rule).toContain('display: grid')
  })

  it('question spans its own full row above tag|answer', () => {
    const rule = readRule('gradeQ')
    expect(rule).toContain('grid-column: 1 / -1')
    expect(rule).toContain('overflow-wrap: anywhere')
  })

  it('long text fields wrap instead of overflowing', () => {
    for (const name of ['gradeAns', 'gradeExp']) {
      expect(readRule(name)).toContain('overflow-wrap: anywhere')
    }

    expect(readRule('gradeExp')).toContain('grid-column: 1 / -1')
  })
})
