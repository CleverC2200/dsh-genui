import { describe, expect, it } from 'vitest'
import { completeFenceJson, repairFenceJson } from '../src/shared/fence-repair.ts'
import { processGenuiSpec, partialRepairGenuiSpec } from '../src/client/guard.ts'
import { parsePartialGenuiSpec } from '../src/client/parse-partial.ts'

const WRAPPED_KEY = '{"items":[{"type":"table",["columns"]:["a","b"],"rows":[["1","2"],["3","4"]]}]}'

const SESSION_BODY =
  '{"gap":10,"items":[{"columns":["阶段","拒绝数","说明"],["rows"]],[["17:22","19","—"],[["**17:35","41","+22"]],"type":"table"}],"title":"拒绝"}'

describe('wrapped member key (tier-3)', () => {
  it('is bracket-balanced and quote-clean — the reason the other tiers fail', () => {
    const count = (ch: string): number => WRAPPED_KEY.split(ch).length - 1
    expect(count('{')).toBe(count('}'))
    expect(count('[')).toBe(count(']'))
    expect(() => JSON.parse(WRAPPED_KEY)).toThrow()
    expect(repairFenceJson(WRAPPED_KEY)).toBeNull()
  })

  it('unwraps the key and yields the intended member', () => {
    const completed = completeFenceJson(WRAPPED_KEY)
    expect(completed).not.toBeNull()
    expect(JSON.parse(completed!.text)).toEqual({
      items: [{ type: 'table', columns: ['a', 'b'], rows: [['1', '2'], ['3', '4']] }],
    })
    expect(completed!.repairs).toBe(1)
  })

  it('renders through the shared pipeline instead of degrading to a code block', () => {
    const completed = completeFenceJson(WRAPPED_KEY)!
    const spec = partialRepairGenuiSpec(processGenuiSpec(parsePartialGenuiSpec(completed.text)!))
    expect(spec).not.toBeNull()
  })

  it('unwraps several wrapped keys in one body', () => {
    const raw = '{"items":[{"type":"table",["columns"]:["a"],["rows"]:[["1"]]}]}'
    const completed = completeFenceJson(raw)
    expect(completed).not.toBeNull()
    expect(JSON.parse(completed!.text)).toEqual({
      items: [{ type: 'table', columns: ['a'], rows: [['1']] }],
    })
    expect(completed!.repairs).toBe(2)
  })

  it('does not unwrap an array value while tier-2 completes the body', () => {

    const raw = '{"items":[["a"],["b"]],"t":"x"'
    const completed = completeFenceJson(raw)
    expect(completed).not.toBeNull()
    expect(JSON.parse(completed!.text)).toEqual({ items: [['a'], ['b']], t: 'x' })
  })

  it('does not touch a wrapped string that is an ARRAY element', () => {

    expect(completeFenceJson('{"a":[1,["b"]:2}')).toBeNull()
  })

  it('does not guess when the wrapped key has no colon (a second defect)', () => {
    const completed = completeFenceJson(SESSION_BODY)
    expect(completed).toBeNull()
  })

  it('unwraps the key BEFORE the Tetris rewrite (the order is load-bearing)', () => {

    const raw = '{"columns":["a"],["rows"]:[["1"]]}'
    const completed = completeFenceJson(raw)
    expect(completed).not.toBeNull()
    expect(JSON.parse(completed!.text)).toEqual({ columns: ['a'], rows: [['1']] })
    expect(completed!.repairs).toBe(1)
  })

  it('does not guess when the ONLY defect is the missing colon', () => {

    expect(completeFenceJson('{"a":1,["b"]{"c":2}')).toBeNull()
    expect(completeFenceJson('{"a":1,["b"]}')).toBeNull()
  })

  it('unwraps inside a root array and three levels deep', () => {
    expect(JSON.parse(completeFenceJson('[{"a":1,["b"]:2}]')!.text)).toEqual([{ a: 1, b: 2 }])
    expect(JSON.parse(completeFenceJson('{"a":{"b":{"c":1,["d"]:2}}}')!.text)).toEqual({ a: { b: { c: 1, d: 2 } } })
  })

  it('counts every edit when shapes mix', () => {

    expect(completeFenceJson('{["a"]:1,}')!.repairs).toBe(2)
  })

  it('heals a wrapped key AND a missing closer in one pass', () => {
    const raw = '{"items":[{"type":"table",["columns"]:["a"],"rows":[["1"]}'
    const completed = completeFenceJson(raw)
    expect(completed).not.toBeNull()
    expect(JSON.parse(completed!.text)).toEqual({
      items: [{ type: 'table', columns: ['a'], rows: [['1']] }],
    })
  })
})
