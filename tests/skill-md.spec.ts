import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

function frontmatterYaml(raw: string): string {
  const lines = raw.slice(4).split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (line.trim() === '---') break
    out.push(line)
  }
  return out.join('\n')
}

describe('SKILL.md frontmatter (host yaml parser)', () => {
  const raw = readFileSync(join(process.cwd(), 'SKILL.md'), 'utf8')

  it('starts with the frontmatter fence', () => {
    expect(raw.startsWith('---\n')).toBe(true)
  })

  it('parses with the harness yaml parser', () => {
    expect(() => parse(frontmatterYaml(raw))).not.toThrow()
  })

  it('declares name and a non-empty description', () => {
    const data = parse(frontmatterYaml(raw)) as Record<string, unknown>
    expect(data.name).toBe('genui')
    expect(typeof data.description).toBe('string')
    expect((data.description as string).length).toBeGreaterThan(20)
    expect(data.description).toContain('Preserve conversation language')
    expect(data.description).not.toMatch(/[\u3400-\u9fff]/u)
  })
})

describe('SKILL.md command-delivery contract', () => {
  const raw = readFileSync(join(process.cwd(), 'SKILL.md'), 'utf8')

  it('requires a copy-paste-runnable heredoc for multi-line python', () => {

    expect(raw).toContain("python - <<'PY'")
    expect(raw).toMatch(/不要用 `python -c/)
    expect(raw).toContain('一次粘进终端就能跑')
  })
})
