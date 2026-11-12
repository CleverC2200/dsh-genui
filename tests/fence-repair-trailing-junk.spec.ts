import { describe, expect, it } from 'vitest'
import { completeFenceJson, repairFenceJson } from '../src/shared/fence-repair.ts'
import { resolveFence } from '../src/shared/fence-resolve.ts'

const QUOTES_AND_JUNK = "{\"gap\": 8, \"items\": [{\"pairs\": [{\"key\": \"① 采集→博文 这条链已接通（两处，都可一行回退）\", \"value\": \"① **采集侧**：新增 `--save-blogs`（**默认关** ✗）+ `--save-limit-per-topic`（默认 20 ✓）⇒ 在**已有**取博文的那一轮里顺手 `save_blogs`（**零新增请求** ✓）；\\n② **编排侧**：collect 阶段 argv **显式打开** `--save-blogs` ✓，并在阶段 doc 记 `save_blogs = {enabled, limit_per_topic, round_saved_total, note}` ✓ —— **可回退 = 去掉那一个参数** ✓。\\n验证 ✓：**78 passed** ✓；用例断言的是**真实 argv 列表**与**阶段 doc 字段**（不是源码串 ✓），并覆盖\"不带开关 ⇒ enabled 为 False\" ✓；变异只做一次（删参数 ⇒ 恰好一条用例红 ✓，`cmp` 还原 ✓）。\"}, {\"key\": \"② 我暂不开最后一张 MR（避免又撞冲突）\", \"value\": \"**原因**：新卡改的文件与还没合的 **`!80`** **重叠**（都是 `scripts/tb2_autotrain.py` + `tests/test_autotrain_e2e.py` ✓）⇒ 如果现在就基于 `release` 开新 MR，会**再演一次今天那个冲突** ✗ ⇒ ⇒ **正确顺序**：你先把 **`!80`** 合掉（现在无冲突、2 文件 ✓）⇒ 我立刻开最后一张 ✓（那时它就只含新改动 ✓、天然无冲突 ✓）。\"}], \"type\": \"keyvalue\"}], \"title\": \"两张落库卡完成；等你合 !80 我再开最后一张 MR\"}</p>"

describe('tier-2: trailing junk after a complete root value', () => {
  it('repairs the real sample instead of dropping every repair', () => {

    expect(repairFenceJson(QUOTES_AND_JUNK)).toBeNull()

    const completed = completeFenceJson(QUOTES_AND_JUNK)
    expect(completed).not.toBeNull()
    const value = JSON.parse(completed!.text) as { title?: string; items?: unknown[] }
    expect(value.title).toContain('两张落库卡完成')
    expect(value.items).toHaveLength(1)

    expect(completed!.text).not.toContain('</p>')
    expect(completed!.text).toContain('并覆盖\\"不带开关')
  })

  it('settled resolution renders it; streaming resolution does not', () => {

    expect(resolveFence(QUOTES_AND_JUNK, { settled: true }).spec).not.toBeNull()
    expect(resolveFence(QUOTES_AND_JUNK, { settled: false }).spec).toBeNull()
  })

  it('trims arbitrary trailing prose, not just an HTML tag', () => {
    const raw = '{"items":[{"type":"text","content":"好"}],"title":"尾随文字"}这是一句解释。'
    const completed = completeFenceJson(raw)
    expect(completed).not.toBeNull()
    expect(JSON.parse(completed!.text)).toEqual({ items: [{ type: 'text', content: '好' }], title: '尾随文字' })
  })

  it('still refuses when the root itself is invalid', () => {

    expect(completeFenceJson('这不是 JSON，只是一句话')).toBeNull()

    expect(completeFenceJson('{"items": [broken} </p>')).toBeNull()

    const truncated = completeFenceJson('{"items":[{"type":"text","content":"好"}]')
    expect(truncated).not.toBeNull()
    expect(JSON.parse(truncated!.text)).toEqual({ items: [{ type: 'text', content: '好' }] })
  })
})
