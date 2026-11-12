import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { processGenuiSpec, isRenderableProcess } from '../src/client/guard.ts'
import { validateRenderableChartSemantics } from '../src/plugin/chart-contract.ts'

const skill = readFileSync(join(process.cwd(), 'SKILL.md'), 'utf8')
const blocksOf = (tag: string): string[] =>
  [...skill.matchAll(new RegExp('```json ' + tag + '\\n([\\s\\S]*?)\\n```', 'g'))].map(m => m[1]!)
const renders = (raw: string): boolean => {
  const spec = JSON.parse(raw)
  return validateRenderableChartSemantics(spec).length === 0 && isRenderableProcess(processGenuiSpec(spec))
}

describe('SKILL.md examples', () => {
  const good = blocksOf('dsh-ui')
  const bad = blocksOf('dsh-ui-bad')

  it('ships copy-pasteable examples and at least one anti-example', () => {
    expect(good.length).toBeGreaterThanOrEqual(5)
    expect(bad.length).toBeGreaterThanOrEqual(1)

    expect(skill).toContain('正确地不套组件')
  })

  it('keeps user-visible example values language-neutral', () => {
    expect(skill).toContain('never emit these placeholders literally')
    expect(skill).toContain('"title":"<user-language text>"')
    expect(skill).not.toContain('"title":"可选标题"')
    expect(skill).not.toContain('"label":"已合并"')
    expect(skill).not.toContain('"columns":["方案","代价","判断"]')
    expect(skill).not.toContain('"label":"本周"')
  })

  for (const [i, raw] of good.entries()) {
    it(`example ${i + 1} renders`, () => {
      expect(renders(raw)).toBe(true)
    })
  }

  for (const [i, raw] of bad.entries()) {
    it(`anti-example ${i + 1} is really rejected`, () => {

      expect(renders(raw)).toBe(false)
    })
  }
})
