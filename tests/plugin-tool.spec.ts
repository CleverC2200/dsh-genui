// The render_ui tool definition: schema shape, execute behavior (guard-backed
// repair + caps), and the presentation projections (call/result cards + meta
// spec for the browser toolview).
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createRenderUiTool, createValidateDshUiTool } from '../src/plugin/tool.ts'
import { GENUI_LIMITS } from '../src/client/genui-runtime/index.ts'
import { processGenuiSpec } from '../src/client/guard.ts'

const tool = createRenderUiTool()

const text = (content: string) => ({ type: 'text', content })

describe('render_ui tool definition', () => {
  it('limits presentation content to the requested data scope', () => {
    for (const definition of [tool, createValidateDshUiTool()]) {
      expect(definition.description).toMatch(/字段和指标.*用户所问/)
      expect(definition.description).toMatch(/数值和单位.*来源一致/)
      expect(definition.description).toMatch(/短答.*只给所问结果/)
      expect(definition.description).toContain('比较任务可补直接回答所需差额')
      expect(definition.description).toContain('用户限定名次、原值或单个对象时，仅给限定字段，不加衍生指标')
      expect(definition.description).toContain('只问谁/哪个时只答名称')
      expect(definition.description).toContain('只问数值时只答数值及原单位')
      expect(definition.description).toContain('不附其他字段或解释')
    }
  })

  it('requires successful calculation receipts across presentation formats when business rules require tools', () => {
    const skill = readFileSync('SKILL.md', 'utf8')
    for (const guidance of [tool.description, createValidateDshUiTool().description, skill]) {
      expect(guidance).toContain('短答约束仅限最终可见文本')
      expect(guidance).toContain('原输入值可直接呈现')
      expect(guidance).toContain('当前业务规则要求工具验证的计算，无论短答、纯文字建议或组件')
      expect(guidance).toContain('须先取得所需计算工具真实成功回执才呈现派生值')
      expect(guidance).toContain('无成功回执则保留未完成，不把拟算值写成已核实')
      expect(guidance.match(/当前业务规则要求工具验证的计算/gu)).toHaveLength(1)
      expect(guidance).not.toContain('派生数值交付前按当前业务规则验证')
    }
  })

  it('separates UI validation and publication from calculation while preserving comparison inputs', () => {
    const skill = readFileSync('SKILL.md', 'utf8')
    for (const guidance of [tool.description, createValidateDshUiTool().description, skill]) {
      expect(guidance).toContain('validate_dsh_ui 仅校验结构/字段，不验算业务数值')
      expect(guidance).toContain('校验或渲染成功不代表计算完成；渲染仅发布组件')
      expect(guidance).toContain('引用原值保留指标含义和单位')
      expect(guidance).toContain('比较建议保留支撑取舍的关键原值，不用未验证差值替换')
    }
    expect(createValidateDshUiTool().description).toContain('validation_scope=ui_structure_only')
    expect(createValidateDshUiTool().description).toContain('numerical_calculation=not_performed')
  })

  it('presents each fact once across nodes and keeps source notes to provenance', () => {
    const skill = readFileSync('SKILL.md', 'utf8')
    for (const guidance of [tool.description, createValidateDshUiTool().description, skill]) {
      expect(guidance).toContain('整个答复内同一信息只呈现一次')
      expect(guidance).toContain('包括正文、Markdown、内联围栏、工具卡及同卡多个节点')
      expect(guidance).toContain('来源说明只标注来源/口径，不复列已呈现数值、名次或状态')
    }
  })

  it('keeps facts and source states consistent across reply and UI channels', () => {
    const skill = readFileSync('SKILL.md', 'utf8')
    for (const guidance of [tool.description, createValidateDshUiTool().description, skill]) {
      expect(guidance).toContain('所需结论、来源和限制放进组件，组件本身就是回答')
      expect(guidance).toContain('工具卡与内联围栏择一交付')
      expect(guidance).toContain('工具卡交付成功且无组件外的所问新信息时，结束本轮，不再输出正文或围栏')
      expect(guidance).toContain('内联围栏已承载全答时，闭合后结束')
      expect(guidance).toContain('正文只补所问新信息')
      expect(guidance).toContain('unknown 保持未知，不改未完成')
      expect(guidance).toContain('未完成不等于未开始')
      expect(guidance).toContain('下一页条数和结果未知时保留未知，不作承诺')
      expect(guidance).toContain('完整工具卡答复用 final:true')
      expect(guidance).toContain('先完成必要工具和校验')
      expect(guidance).toContain('缺省或 false 继续本轮')
    }
    expect(skill).not.toContain('文字照常穿插在前后')
    expect(skill).not.toContain('不要用工具')
  })

  it('keeps presentation guidance visible without a global prompt section', () => {
    for (const definition of [tool, createValidateDshUiTool()]) {
      expect(definition.description).toMatch(/状态总览.*库存对比.*排行.*用组件/)
      expect(definition.description).toContain('单个状态含义、差额或第一名直接短答')
      expect(definition.description).toContain('渲染器负责字号和间距')
      expect(definition.description).toMatch(/操作入口.*action.*真实.*链接/)
      expect(definition.description).toContain('文字路径不能充当入口')
    }
    expect(JSON.stringify(tool.parameters)).not.toContain('USE THIS whenever')
    expect(tool.description).toContain('组件字段先读当前原生 genui Skill')
    expect(tool.description).not.toContain('see the system prompt')
  })

  it('registers under the render_ui name with an open spec argument', () => {
    expect(tool.name).toBe('render_ui')
    expect(typeof tool.description).toBe('string')
    expect(tool.description.length).toBeGreaterThan(50)
    const parameters = tool.parameters as { required?: string[]; properties?: Record<string, unknown> }
    expect(parameters.required).toContain('spec')
    expect(parameters.required).not.toContain('final')
    expect(parameters.properties?.final).toEqual(expect.objectContaining({ type: 'boolean' }))
    const spec = parameters.properties?.spec as { type?: string } | undefined
    expect(spec).toBeDefined()
    // spec must be schema-typed as an object: a serialized JSON string (the
    // model's observed failure mode) fails argument validation early instead
    // of reaching the guard, which could not repair it anyway.
    expect(spec!.type).toBe('object')
    // The spec object carries structural hints for the tool-call bridge so it
    // can serialize the tree directly instead of falling back to an
    // OpenAI-style { arguments: "<JSON>" } wrapper (observed in the live
    // harness bridge for bare-object parameters).
    const specProps = (spec as { properties?: Record<string, unknown> }).properties
    expect(specProps).toBeDefined()
    for (const key of ['title', 'gap', 'panel', 'items']) {
      expect(specProps![key]).toBeDefined()
    }
  })

  it('declares a string output schema and a render projection', () => {
    const schema = tool.output.schema as { type?: string }
    expect(schema.type).toBe('string')
    const blocks = tool.output.render({ spec: {} }, 'ok')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('text')
  })
})

describe('render_ui execute', () => {
  it('delivers a complete card at the node budget when it explicitly opts in', async () => {
    const concludeTurn = vi.fn()
    const args = { final: true, spec: { items: Array.from({ length: 200 }, (_, i) => text(`n${i}`)) } }
    const value = await tool.execute(args, { concludeTurn } as never)
    expect(String(value)).toContain('status=rendered')
    expect(String(value)).toContain('rendered=200')
    expect(tool.output.presentationMeta!(args, value)).toEqual(expect.objectContaining(args.spec))
    expect(concludeTurn).toHaveBeenCalledTimes(1)
    expect(String(value)).toContain('turn=concluded')
    expect(String(value)).toContain('next=turn_completed')
  })

  it.each([undefined, false])('keeps the existing continuation when final is %s', async (final) => {
    const concludeTurn = vi.fn()
    const spec = { items: [text('继续')] }
    const args = final === undefined ? { spec } : { spec, final }
    const value = await tool.execute(args, { concludeTurn } as never)
    expect(concludeTurn).not.toHaveBeenCalled()
    expect(String(value)).toContain('next=reply_only_missing_information')
    expect(String(value)).not.toContain('turn=')
  })

  it('keeps older hosts usable when they do not support concluding a turn', async () => {
    const args = { final: true, spec: { items: [text('兼容')] } }
    for (const exec of [undefined, {}, { concludeTurn: true }]) {
      const value = await tool.execute(args, exec as never)
      expect(String(value)).toContain('status=rendered')
      expect(String(value)).toContain('turn=continued reason=host_unsupported')
      expect(String(value)).toContain('next=reply_only_missing_information')
    }
  })

  it('does not conclude invalid cards or failed executions', async () => {
    const concludeTurn = vi.fn()
    const exec = { concludeTurn } as never
    const invalid = await tool.execute({ final: true, spec: {} }, exec)
    expect(String(invalid)).toContain('status=invalid')
    await expect(tool.execute({ final: true, spec: { items: [{ type: 'table', rows: 42 }] } }, exec)).rejects.toThrow()
    expect(concludeTurn).not.toHaveBeenCalled()
  })

  it.each([
    [{ type: 'text', content: '信息', unsupported: true }, 'warning=unknown_field'],
    [{ type: 'text', content: '| A | B |\n|---|---|\n| x | y |' }, 'warning=block_markdown'],
  ])('keeps diagnostics actionable before final delivery for %j', async (node, warning) => {
    const concludeTurn = vi.fn()
    const value = await tool.execute({ final: true, spec: { items: [node] } }, { concludeTurn } as never)
    expect(concludeTurn).not.toHaveBeenCalled()
    expect(String(value)).toContain(warning)
    expect(String(value)).toContain('turn=continued reason=pending_diagnostics')
    expect(String(value)).toContain('next=fix_and_retry')
  })

  it('withholds a final card with diagnostics and publishes only the corrected delivery', async () => {
    const concludeTurn = vi.fn()
    const exec = { concludeTurn } as never
    const table = { type: 'table', columns: ['仓库', '库存（件）'], rows: [['甲仓', 120]] }
    const invalid = { final: true, spec: { items: [{ ...table, caption: '库存' }] } }
    const fixed = { final: true, spec: { items: [table] } }
    const rejected = await tool.execute(invalid, exec)
    expect(String(rejected)).toContain('status=needs_repair')
    expect(String(rejected)).toContain('warning=unknown_field')
    expect(String(rejected)).toContain('next=fix_and_retry')
    expect(String(rejected)).not.toContain('status=rendered')
    expect(String(rejected)).not.toContain('组件已作为回答交付')
    expect(tool.output.presentationMeta!(invalid, rejected)).toBeNull()
    expect(tool.output.presentationMeta!(fixed, rejected)).toBeNull()
    expect(concludeTurn).not.toHaveBeenCalled()

    const delivered = await tool.execute(fixed, exec)
    expect(String(delivered)).toContain('status=rendered')
    expect(String(delivered)).toContain('turn=concluded')
    expect(tool.output.presentationMeta!(fixed, delivered)).toEqual(expect.objectContaining({ items: [table] }))
    expect(concludeTurn).toHaveBeenCalledTimes(1)

    const continuing = { ...invalid, final: false }
    const continued = await tool.execute(continuing, exec)
    expect(String(continued)).toContain('status=rendered')
    expect(tool.output.presentationMeta!(continuing, continued)).not.toBeNull()
    expect(concludeTurn).toHaveBeenCalledTimes(1)
  })

  it('withholds a final card when the node budget truncates otherwise valid content', async () => {
    const concludeTurn = vi.fn()
    const args = { final: true, spec: { items: Array.from({ length: 201 }, (_, i) => text(`n${i}`)) } }
    const value = await tool.execute(args, { concludeTurn } as never)
    expect(String(value)).toContain('status=needs_repair')
    expect(String(value)).toContain('diagnostic="spec exceeds 200 nodes; tail elided"')
    expect(String(value)).toContain('diagnostic="repair dropped 1 declared native node(s): declared 201, rendered 200"')
    expect(String(value)).toContain('turn=continued reason=pending_diagnostics')
    expect(String(value)).toContain('next=fix_and_retry')
    expect(String(value)).not.toContain('status=rendered')
    expect(tool.output.presentationMeta!(args, value)).toBeNull()
    expect(concludeTurn).not.toHaveBeenCalled()
  })

  it('rejects oversized SVG with its path and lengths before reporting a valid delivery', async () => {
    const code = `<svg>${' '.repeat(GENUI_LIMITS.maxCode)}</svg>`
    const spec = { items: [{ type: 'svg', code }] }
    const result = String(await createValidateDshUiTool().execute({ spec }))
    expect(result).toContain('status=invalid')
    expect(result).toContain(`items[0].code length ${code.length} exceeds SVG limit ${GENUI_LIMITS.maxCode}`)
    expect(result).toContain('next=fix_and_revalidate')
    await expect(tool.execute({ spec })).rejects.toThrow('exceeds SVG limit')
  })

  it('returns a render summary for a valid spec', async () => {
    const value = await tool.execute({ spec: { title: '监控面板', items: [text('a'), { type: 'stat', label: 'CPU', value: '42%' }] } })
    expect(String(value)).toContain('监控面板')
    expect(String(value)).toContain('rendered=2')
    expect(String(value)).toContain('reply_language=conversation')
  })

  it('guides the model to finish without repeating a delivered card, while invalid specs still require retry', async () => {
    const args = { spec: { items: [{ type: 'table', columns: ['项目', '数量（件）'], rows: [['样品', 7]] }] } }
    const value = await tool.execute(args)
    const blocks = tool.output.render(args, value)
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('next=reply_only_missing_information') }])
    expect(String(value)).toContain('reply=组件已作为回答交付')
    expect(String(value)).toContain('若无组件外的所问新信息或待处理诊断，立即结束本轮，不再输出正文或 dsh-ui 围栏')
    expect(String(value)).toContain('需要补充时只补所问新信息或处理诊断')
    expect(String(value)).toContain('不得以结论、摘要或来源说明重列组件已有数值、排序')

    const invalid = String(await tool.execute({ spec: {} }))
    expect(invalid).toContain('status=invalid')
    expect(invalid).toContain('next=fix_and_retry')
    expect(invalid).not.toContain('next=reply_only_missing_information')
    expect(invalid).not.toContain('组件已作为回答交付')
  })

  it.each([undefined, false])('keeps repaired oversized cards visible when final is %s', async (final) => {
    const concludeTurn = vi.fn()
    const spec = { items: Array.from({ length: 500 }, (_, i) => text(`n${i}`)) }
    const args = final === undefined ? { spec } : { spec, final }
    const value = await tool.execute(args, { concludeTurn } as never)
    expect(String(value)).toContain('status=rendered')
    expect(String(value)).toContain(`rendered=${GENUI_LIMITS.maxNodes}`)
    expect(tool.output.presentationMeta!(args, value)).toEqual(expect.objectContaining({ items: spec.items.slice(0, GENUI_LIMITS.maxNodes) }))
    expect(concludeTurn).not.toHaveBeenCalled()
  })

  it('returns a corrective message for an unusable spec', async () => {
    const value = await tool.execute({ spec: 'not a tree' })
    expect(String(value)).toContain('error=invalid_spec')
  })

  it('unwraps bridge-wrapped spec shapes (transport compatibility)', async () => {
    const spec = { title: '桥接兼容', items: [text('a')] }
    // Observed live: the bridge nests the authored `spec` object inside a
    // wrapper — the serialized text carried by { arguments: "..." } is itself
    // `{ spec: { title, gap, items } }` — so test both with and without the
    // inner `spec` key at every wrapper level.
    const nested = { spec }
    const expectOk = async (args: unknown) => {
      const value = await tool.execute(args as never)
      expect(String(value)).toContain('桥接兼容')
    }
    // Authored shape
    await expectOk({ spec })
    // Spec serialized to text
    await expectOk({ spec: JSON.stringify(spec) })
    await expectOk({ spec: JSON.stringify(nested) })
    // {arguments} wrapper with a serialized or object spec
    await expectOk({ arguments: JSON.stringify(spec) })
    await expectOk({ arguments: JSON.stringify(nested) })
    await expectOk({ arguments: spec })
    await expectOk({ arguments: nested })
    // Bare double-encoded strings
    await expectOk(JSON.stringify(spec))
    await expectOk(JSON.stringify(nested))
  })

  it('reports broken wrapped JSON as unusable instead of misparsing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // Corrupted mid-stream JSON (observed with large specs): the bridge
      // passed the raw broken text through; it must not crash and must not
      // pretend the spec is valid.
      const value = await tool.execute({ arguments: '{"spec": {"items": [' } as never)
      expect(String(value)).toContain('error=invalid_spec')
      expect(spy).toHaveBeenCalledOnce()
      expect(String(spy.mock.calls[0]![0])).toContain('[genui-tool] spec wrapped as arguments-string')
    } finally {
      spy.mockRestore()
    }
  })

  it('rejects chart aliases and invalid data instead of silently rendering bars', async () => {
    await expect(tool.execute({
      spec: {
        items: [{
          type: 'chart',
          variant: 'line',
          data: [{ label: 1, value: '128' }],
        }],
      },
    })).rejects.toThrow(
      'items[0].variant is unsupported; use kind; items[0].data[0].label must be a string; items[0].data[0].value must be a finite number',
    )
  })

  it('accepts multi-series line charts (v3) and rejects donut series', async () => {
    const rendered = String(await tool.execute({
      spec: {
        items: [{
          type: 'chart',
          kind: 'line',
          series: [
            { label: '本月', data: [{ label: '周一', value: 128 }] },
            { label: '上月', data: [{ label: '周一', value: 96 }] },
          ],
        }],
      },
    }))
    expect(rendered).toContain('status=rendered')
    await expect(tool.execute({
      spec: {
        items: [{ type: 'chart', kind: 'donut', series: [{ label: 'A', data: [{ label: 'X', value: 1 }] }] }],
      },
    })).rejects.toThrow('items[0].series is only supported for bars and line')
  })

  it('does not green-light a dropped native image beside an opaque custom node', async () => {
    const spec = { items: [{ type: 'image' }, { type: 'custom-widget', payload: { owner: 'plugin' } }] }
    await expect(tool.execute({ spec })).rejects.toThrow('repair dropped')

    const value = String(await createValidateDshUiTool().execute({ spec }))
    expect(value).toContain('status=invalid')
    expect(value).not.toContain('status=valid')
  })

  it('includes native-field warnings in a successful render summary', async () => {
    const value = String(await tool.execute({ spec: { items: [{ type: 'text', content: '好', extension: true }] } }))
    expect(value).toContain('status=rendered')
    expect(value).toContain('items[0].extension')
    expect(value).toContain('unknown field')
  })

  it('distinguishes an ignored canonical alias in model-facing warnings', async () => {
    const value = String(await tool.execute({
      spec: { items: [{ type: 'text', text: 'legacy', content: 'canonical' }] },
    }))
    expect(value).toContain('warning=alias_ignored')
    expect(value).toContain('canonical=items[0].content')
  })
})

describe('render_ui projections', () => {
  it('projects the repaired spec into result meta for the toolview', () => {
    const meta = tool.output.presentationMeta!({ spec: { items: [text('x'), { type: 'progress', value: 80 }] } })
    const spec = meta as { items: Array<{ type: string }> }
    expect(spec.items).toHaveLength(2)
    expect((spec.items[1] as { value: number }).value).toBe(80)
  })

  it('does not project an invalid repaired spec into result meta', () => {
    expect(tool.output.presentationMeta!({ spec: { items: [{ type: 'progress', value: 150 }] } })).toBeNull()
  })

  it('presents pending and completed cards with the spec title', () => {
    const args = { spec: { title: '订单', items: [text('a')] } }
    const call = tool.presentCall!(args)
    expect(call).not.toBeUndefined()
    expect(call!.card).toBe('generic')
    expect((call as { title: string }).title).toContain('订单')
    const result = tool.presentResult!(args, { isError: false } as never)
    expect(result).not.toBeUndefined()
    expect((result as { title: string }).title).toContain('订单')
  })

  it('falls back to generic presentation for invalid args (replay safety)', () => {
    expect(tool.presentCall!({ spec: 42 })).toBeUndefined()
    expect(tool.presentResult!({ spec: null }, { isError: false } as never)).toBeUndefined()
  })
})


describe('validate_dsh_ui tool', () => {
  const vtool = createValidateDshUiTool()

  it('registers under the validate_dsh_ui name with a spec argument', () => {
    expect(vtool.name).toBe('validate_dsh_ui')
    expect(vtool.description).toContain('dsh-ui fence')
    const parameters = vtool.parameters as { required?: string[] }
    expect(parameters.required).toContain('spec')
  })

  it.each([
    { args: { spec: { items: [text('正文')] } }, status: 'valid', next: 'emit_fence' },
    { args: { spec: '{"items":[{"type":"text","content":"正文",}],}' }, status: 'invalid', next: 'emit_repaired_fence' },
    { args: { spec: { items: [{ type: 'callout', title: '只有标题' }] } }, status: 'invalid', next: 'fix_and_revalidate' },
    { args: { spec: { items: [{ type: 'chart', kind: 'area', data: [] }] } }, status: 'invalid', next: 'fix_and_revalidate' },
    { args: {}, status: 'invalid', next: 'provide_spec' },
  ])('limits the $status / $next receipt to UI structure validation', async ({ args, status, next }) => {
    const value = String(await vtool.execute(args))
    expect(value).toContain('[genui-validation]')
    expect(value).toContain('validation_scope=ui_structure_only')
    expect(value).toContain('numerical_calculation=not_performed')
    expect(value).toContain(`status=${status}`)
    expect(value).toContain(`next=${next}`)
    expect(value).toContain('reply_language=conversation')
  })

  it('approves a valid fence body (string or object)', async () => {
    const good = '{"title":"x","items":[{"type":"text","content":"好"}]}'
    expect(String(await vtool.execute({ spec: good }))).toContain('status=valid')
    expect(String(await vtool.execute({ spec: JSON.parse(good) }))).toContain('status=valid')
    expect(String(await vtool.execute(good))).toContain('status=valid')
  })

  it.each([
    { type: 'list', title: '标题', items: [{ title: '条目', desc: '正文' }] },
    { type: 'chart', kind: 'bars', title: '标题', data: [{ label: 'A', value: 1 }] },
  ])('requires correction of an unsupported %s field before emitting', async node => {
    const value = String(await vtool.execute({ spec: { items: [node] } }))
    expect(value).toContain('warning=unknown_field path="items[0].title"')
    expect(value).toContain('next=fix_and_revalidate')
    expect(value).not.toContain('next=emit_fence')
  })

  it('does not green-light an unknown field after repairing JSON', async () => {
    const value = String(await vtool.execute({ spec: '{"items":[{"type":"text","content":"正文","extra":true,}],}' }))
    expect(value).toContain('repair=applied')
    expect(value).toContain('warning=unknown_field path="items[0].extra"')
    expect(value).toContain('next=fix_and_revalidate')
    expect(value).not.toContain('next=emit_repaired_fence')
  })

  it('accepts correctly escaped quotes in supported components', async () => {
    const value = String(await vtool.execute({ spec: { items: [
      { type: 'text', content: '含有 "引号" 的正文' },
    ] } }))
    expect(value).toContain('status=valid')
    expect(value).toContain('next=emit_fence')
    expect(value).not.toContain('warning=unknown_field')
  })

  it('reports fenced code and Markdown table in canonical inline content', async () => {
    const value = String(await vtool.execute({ spec: JSON.stringify({ items: [
      { type: 'callout', tone: 'error', title: '围栏', content: '因为：```score = 1 - 0.05 × level ```于是照建不误' },
      { type: 'callout', tone: 'info', title: '表格', content: '| 配置 | 级数 |\n|---|---|\n| 破例版 | 887 |' },
    ] }) }))
    expect(value).toContain('status=valid')
    expect(value).toContain('rendered=2')
    expect(value).toContain('warning=block_markdown path=items[0].content kind=fenced_code replacement=code')
    expect(value).toContain('warning=block_markdown path=items[1].content kind=markdown_table replacement=table')
    expect(value).toContain('next=fix_and_revalidate')

    const corrected = String(await vtool.execute({ spec: { items: [
      { type: 'code', code: 'score = 1 - 0.05 × level' },
      { type: 'table', columns: ['配置', '级数'], rows: [['破例版', '887']] },
    ] } }))
    expect(corrected).toContain('status=valid')
    expect(corrected).toContain('next=emit_fence')
    expect(corrected).not.toContain('warning=block_markdown')
  })

  it('reports canonical aliases and nested component paths', async () => {
    const value = String(await vtool.execute({ spec: { items: [
      { type: 'callout', desc: '```alias```' },
      { type: 'tabs', tabs: [{ label: '页', items: [{ type: 'text', content: '~~~nested~~~' }] }] },
      { type: 'table', columns: ['列'], rows: [['值']], details: [[{ type: 'keyvalue', pairs: [{ key: '键', value: 'a | b\n---|---' }] }]] },
    ] } }))
    expect(value).toContain('warning=block_markdown path=items[0].content kind=fenced_code replacement=code')
    expect(value).toContain('warning=block_markdown path=items[1].tabs[0].items[0].content kind=fenced_code replacement=code')
    expect(value).toContain('warning=block_markdown path=items[2].details[0][0].pairs[0].value kind=markdown_table replacement=table')
    expect(value).toContain('next=fix_and_revalidate')
  })

  it('checks visible labels and table cells without scanning input values', async () => {
    const value = String(await vtool.execute({ spec: { title: '```标题```', items: [
      { type: 'button', label: '~~~操作~~~', action: '```raw```' },
      { type: 'table', columns: ['列'], rows: [['a | b\n---|---']] },
      { type: 'input', label: '输入', value: '```raw```', placeholder: '```raw```' },
    ] } }))
    expect(value).toContain('warning=block_markdown path=title kind=fenced_code replacement=code')
    expect(value).toContain('warning=block_markdown path=items[0].label kind=fenced_code replacement=code')
    expect(value).toContain('warning=block_markdown path=items[1].rows[0][0] kind=markdown_table replacement=table')
    expect(value.match(/warning=block_markdown/g)).toHaveLength(3)
  })

  it('ignores index cell content unless a detail toggle displays it', async () => {
    const ignored = String(await vtool.execute({ spec: { items: [{
      type: 'table', columns: ['序号'], types: ['index'], rows: [['```ignored```']],
    }] } }))
    expect(ignored).toContain('status=valid')
    expect(ignored).toContain('next=emit_fence')
    expect(ignored).not.toContain('warning=block_markdown')

    const visible = String(await vtool.execute({ spec: { items: [{
      type: 'table', columns: ['序号'], types: ['index'], rows: [['```visible```']],
      details: [[{ type: 'text', content: '说明' }]],
    }] } }))
    expect(visible).toContain('warning=block_markdown path=items[0].rows[0][0] kind=fenced_code replacement=code')
    expect(visible).toContain('next=fix_and_revalidate')
  })

  it('keeps raw-content data and ordinary pipes free of block Markdown warnings', async () => {
    const value = String(await vtool.execute({ spec: { items: [
      { type: 'code', code: '```js\nfoo()\n```' },
      { type: 'mermaid', code: 'graph TD\nA --> B' },
      { type: 'copy', text: '```foo```' },
      { type: 'diff', diffs: [{ path: 'a.ts', oldText: '```old```', newText: '```new```' }] },
      { type: 'json', value: { type: 'text', content: '```data```' } },
      { type: 'echart', option: { type: 'text', content: '```data```' } },
      { type: 'text', content: 'foo | bar' },
      { type: 'text', content: 'A | B\n普通第二行' },
    ] } }))
    expect(value).toContain('status=valid')
    expect(value).toContain('next=emit_fence')
    expect(value).not.toContain('warning=block_markdown')
  })

  it('keeps chart category labels free of block Markdown warnings', async () => {
    const value = String(await vtool.execute({ spec: { items: [
      { type: 'chart', data: [
        { label: '版本 ```alpha```', value: 1 },
        { label: 'A | B\n---|---', value: 2 },
      ] },
      { type: 'chart', kind: 'line', series: [{ label: '版本', data: [
        { label: '~~~alpha~~~', value: 1 },
        { label: 'A | B\n---|---', value: 2 },
      ] }] },
    ] } }))
    expect(value).toContain('status=valid')
    expect(value).toContain('next=emit_fence')
    expect(value).not.toContain('warning=block_markdown')

    const seriesLabel = String(await vtool.execute({ spec: { items: [
      { type: 'chart', series: [{ label: '```series```', data: [{ label: '```category```', value: 1 }] }] },
    ] } }))
    expect(seriesLabel).toContain('warning=block_markdown path=items[0].series[0].label kind=fenced_code replacement=code')
    expect(seriesLabel.match(/warning=block_markdown/g)).toHaveLength(1)
  })

  it('requires content changes after repairing JSON with block Markdown', async () => {
    const value = String(await vtool.execute({
      spec: '{"items":[{"type":"callout","content":"| A | B |\\n|---|---|\\n| x | y |"},],}',
    }))
    expect(value).toContain('repair=applied')
    expect(value).toContain('warning=block_markdown path=items[0].content kind=markdown_table replacement=table')
    expect(value).toContain('next=fix_and_revalidate')
    expect(value).not.toContain('next=emit_repaired_fence')
    expect(value).toContain('repaired_json:')
  })

  it('warns when declared components were silently dropped (issue #42)', async () => {
    // The table has no recognizable rows/columns at all: repair drops it and
    // the tool must not green-light a half-empty tree.
    const dropping = '{"items":[{"type":"table","columns":{},"rows":42},{"type":"text","content":"好"}]}'
    const value = String(await vtool.execute({ spec: dropping }))
    expect(value).toContain('status=invalid')
    expect(value).toContain('declared=2')
    expect(value).toContain('rendered=1')
    // #163 follow-up: the dropped node is named with its position and type
    // instead of only the aggregate count.
    expect(value).toContain('node=items[0]')
    expect(value).toContain('type=table')
  })

  it.each([
    // Real-session samples (2 sessions, 62 fences): the model names the field
    // by intent and the alias registry adopts it. Asserting the whole
    // validate verdict — not just the warning — pins the load-bearing claim:
    // these bodies now RENDER, so the fence cannot degrade to raw JSON.
    [{ type: 'keyvalue', items: [{ key: 'a', value: 'b' }] }, { type: 'keyvalue', pairs: [{ key: 'a', value: 'b' }] }],
    [{ type: 'callout', text: 'hello' }, { type: 'callout', content: 'hello' }],
    [{ type: 'callout', body: 'hello' }, { type: 'callout', content: 'hello' }],
    [{ type: 'code', content: 'x = 1' }, { type: 'code', code: 'x = 1' }],
    [{ type: 'copy', content: 'x = 1' }, { type: 'copy', text: 'x = 1' }],
    [{ type: 'image', url: 'https://example.com/a.png' }, { type: 'image', src: 'https://example.com/a.png' }],
  ])('adopts the model field name for %j instead of dropping the node', async (node, canonical) => {
    const value = String(await vtool.execute({ spec: { items: [node] } }))
    expect(value).toContain('status=valid')
    expect(value).toContain('warning=alias_normalized')
    expect(value).toContain('next=emit_fence')
    expect(processGenuiSpec({ items: [node] }).repaired?.items).toEqual([canonical])
  })

  it('adopts quiz title/choices and still grades against string options', async () => {
    const node = { type: 'quiz', title: '问题', choices: ['甲', '乙'] }
    const value = String(await vtool.execute({ spec: { items: [node] } }))
    expect(value).toContain('status=valid')
    // quiz repair canonicalizes options into `{label}` records (correctness
    // lives per option), so the claim under test is the adopted field names.
    expect(processGenuiSpec({ items: [node] }).repaired?.items).toEqual([
      { type: 'quiz', question: '问题', options: [{ label: '甲' }, { label: '乙' }] },
    ])
  })

  it('drops malformed tables but explains the columns/rows contract', async () => {
    // Filtering still matters: a non-2D body is not a table we can rescue.
    const value = String(await vtool.execute({ spec: '{"items":[{"type":"table","rows":42}]}' }))
    expect(value).toContain('status=invalid')
    expect(value).toContain("items[0]: type 'table' requires rows (array)")
  })

  it.each([
    [{ type: 'keyvalue', pairs: 'k=v' }, 'items[0]: type \'keyvalue\' requires pairs (array)'],
    [{ type: 'diff', items: [{ text: 'x' }] }, 'items[0].diffs[0]: requires path (a string)'],
    [{ type: 'table', columns: {}, rows: 42 }, "items[0]: type 'table' requires columns (array)"],
  ])('keeps field errors when invalid components are dropped: %j', async (node, field) => {
    const value = String(await vtool.execute({ spec: { items: [node] } }))
    expect(value).toContain('status=invalid')
    expect(value).toContain(field)
  })

  it('reports native drop counts without counting opaque custom nodes', async () => {
    const value = String(await vtool.execute({ spec: {
      items: [{ type: 'image', src: 'javascript:blocked' }, { type: 'custom-widget' }],
    } }))
    expect(value).toContain('declared=1')
    expect(value).toContain('rendered=0')
    expect(value).toContain('dropped=1')
  })

  it('names each dropped node, its type, what it wrote, and what is missing', async () => {
    // A healthy sibling must NOT be reported as dropped, and the dropped node
    // must be named with the field it actually wrote — the aggregate count
    // alone left the model guessing which component was broken.
    const value = String(await vtool.execute({ spec: {
      items: [{ type: 'callout', title: '只有标题' }, { type: 'text', content: '好' }],
    } }))
    expect(value).toContain('[genui-validation]')
    expect(value).toContain('next=fix_and_revalidate')
    expect(value).toContain('node=items[0]')
    expect(value).toContain('type=callout')
    expect(value).toContain('error=missing_required_field')
    expect(value).toContain('field=content')
    expect(value).toContain('written=title')
    expect(value).toContain('reply_language=conversation')
    expect(value).not.toContain('验证未通过')
    expect(value).not.toContain('请修正')
    expect(value).not.toContain('node=items[1]')

    // A node nested in a container keeps its full path.
    const nested = String(await vtool.execute({ spec: {
      items: [{ type: 'grid', cols: 2, items: [{ type: 'table', rows: 42 }] }],
    } }))
    expect(nested).toContain('node=items[0].items[0]')
    expect(nested).toContain('type=table')
    expect(nested).toContain('field=columns')
  })

  it('reports the chart kind contract and field-level data errors', async () => {
    const value = String(await vtool.execute({
      spec: {
        items: [{
          type: 'chart',
          variant: 'line',
          kind: 'area',
          data: [{ label: 1, value: Number.NaN }],
        }],
      },
    }))
    expect(value).toContain('error=invalid_chart_fields')
    expect(value).toContain('items[0].variant is unsupported; use kind')
    expect(value).toContain('items[0].kind must be bars, line, or donut')
    expect(value).toContain('items[0].data[0].label must be a string')
    expect(value).toContain('items[0].data[0].value must be a finite number')
  })

  it('rejects line/donut series and empty chart collections before rendering', async () => {
    // v3: line charts accept series; donut does not.
    const line = String(await vtool.execute({
      spec: {
        items: [{
          type: 'chart',
          kind: 'line',
          series: [{ label: 'A', data: [{ label: '周一', value: 128 }] }],
        }],
      },
    }))
    expect(line).toContain('status=valid')
    const donut = String(await vtool.execute({
      spec: {
        items: [{ type: 'chart', kind: 'donut', series: [{ label: 'A', data: [{ label: 'X', value: 1 }] }] }],
      },
    }))
    expect(donut).toContain('items[0].series is only supported for bars and line')

    const empty = String(await vtool.execute({
      spec: {
        items: [{
          type: 'chart',
          data: [],
          series: [{ label: 'A', data: [] }],
        }],
      },
    }))
    // `data: []` is legal for grouped bars (points live in series), so only
    // the truly empty series is reported — the chart is still rejected.
    expect(empty).toContain('items[0].series[0].data must not be empty')
    expect(empty).not.toContain('items[0].data must not be empty')

    const emptyPlain = String(await vtool.execute({
      spec: { items: [{ type: 'chart', data: [] }] },
    }))
    expect(emptyPlain).toContain('items[0].data must not be empty')

    const emptySeries = String(await vtool.execute({
      spec: { items: [{ type: 'chart', series: [] }] },
    }))
    expect(emptySeries).toContain('items[0].series must not be empty')
  })

  it('keeps chart field validation after repairing fence JSON syntax', async () => {
    const value = String(await vtool.execute({
      spec: '{"items":[{"type":"chart","variant":"line","data":[{"label":"周一","value":128}],}],}',
    }))
    expect(value).toContain('error=invalid_chart_fields')
    expect(value).toContain('items[0].variant is unsupported; use kind')
    expect(value).not.toContain('next=emit_repaired_fence')
  })

  it('allows unknown chart extension fields but native repair ignores them', async () => {
    const raw = {
      items: [{
        type: 'chart',
        kind: 'line',
        data: [{ label: '周一', value: 128, extension: true }],
        extension: { owner: 'another-plugin' },
      }],
    }
    const value = String(await vtool.execute({ spec: raw }))
    expect(value).toContain('status=valid')
    const meta = tool.output.presentationMeta!({ spec: raw }) as {
      items: Array<Record<string, unknown> & { data?: Array<Record<string, unknown>> }>
    }
    expect(meta.items[0]).not.toHaveProperty('extension')
    expect(meta.items[0]!.data?.[0]).not.toHaveProperty('extension')
  })

  it('stays green when object-shaped tables heal instead of dropping', async () => {
    const healed = '{"items":[{"type":"table","columns":[{"title":"a","key":"k"}],"data":[{"k":"v"}]}]}'
    const value = String(await vtool.execute({ spec: healed }))
    expect(value).toContain('status=valid')
  })

  it('does not mistake file-tree children for dropped components', async () => {
    const tree = '{"items":[{"type":"file-tree","items":[{"name":"src","type":"dir","children":[{"name":"a.ts","type":"file"}]}]}]}'
    const value = String(await vtool.execute({ spec: tree }))
    expect(value).toContain('status=valid')
  })

  it('reports parse failures with position and bracket counts', async () => {
    // The real-world failure: rows-array `]` emitted as `}` (stray closer).
    const bad = '{"title":"x","items":[{"type":"table","columns":["a"],"rows":[["1"]}]}]}]}'
    const value = String(await vtool.execute({ spec: bad }))
    expect(value).toContain('status=invalid')
    expect(value).toContain('error=invalid_json')
    // Bracket-count diagnostic points at the stray `}`.
    expect(value).toContain('brackets_open=')
    expect(value).toContain('braces_close=')
    // Repairable: the reply hands the model the fixed JSON instead of
    // asking it to re-author the fix by hand.
    expect(value).toContain('repair=applied')
    const match = /```\n([\s\S]*)\n```/.exec(value)
    expect(match).not.toBeNull()
    expect(() => JSON.parse(match![1]!)).not.toThrow()
  })

  it('rejects JSON that parses but is not a GenUI spec', async () => {
    const value = String(await vtool.execute({ spec: '{"a":1}' }))
    expect(value).toContain('status=invalid')
    expect(value).toContain('items')
  })

  it('rejects a missing spec argument', async () => {
    const value = String(await vtool.execute({}))
    expect(value).toContain('status=invalid')
    expect(value).toContain('error=missing_spec')
  })

  it('reports MISSING closers in the right direction (缺 not 多)', async () => {
    const value = String(await vtool.execute({ spec: '{"items": [{"type": "text"' }))
    expect(value).toContain('brace_delta=2')
    expect(value).toContain('brace_action=add:2')
  })

  it('reports EXTRA closers in the right direction (多 not 缺)', async () => {
    const value = String(await vtool.execute({ spec: '{"items": []}}' }))
    expect(value).toContain('brace_delta=-1')
    expect(value).toContain('brace_action=remove:1')
  })

  it('counts nodes inside tabs like the panel fold does', async () => {
    const spec = {
      items: [{ type: 'tabs', tabs: [
        { label: 'A', items: [text('a1'), text('a2')] },
        { label: 'B', items: [text('b1')] },
      ] }],
    }
    // 1 tabs node + 3 inner nodes = 4 (the old local counter said 1).
    const value = String(await tool.execute({ spec }))
    expect(value).toContain('rendered=4')
    const vv = String(await vtool.execute({ spec: JSON.stringify(spec) }))
    expect(vv).toContain('rendered=4')
  })

  it('returns the AUTO-REPAIRED JSON when the body is repairable', async () => {
    // trailing comma + missing closing brackets — tier-1/tier-2 heal it.
    const bad = '{"items":[{"type":"text","content":"你好"},],'
    const value = String(await vtool.execute({ spec: bad }))
    expect(value).toContain('repair=applied')
    expect(value).toContain('next=emit_repaired_fence')
    // the repaired body appears verbatim and parses
    const match = /```\n([\s\S]*)\n```/.exec(value)
    expect(match).not.toBeNull()
    const repaired = match![1]!
    expect(() => JSON.parse(repaired)).not.toThrow()
    expect(repaired).toContain('"content":"你好"')
    expect(repaired).not.toMatch(/,\]/)
  })

  it('keeps process warnings when repaired JSON becomes valid', async () => {
    const value = String(await vtool.execute({
      spec: '{"items":[{"type":"text","text":"legacy","content":"canonical","extension":true},],}',
    }))
    expect(value).toContain('repair=applied')
    expect(value).toContain('items[0].text')
    expect(value).toContain('warning=alias_ignored')
    expect(value).toContain('items[0].extension')
  })

  it('keeps the diagnostics-only reply when the body cannot be repaired', async () => {
    const value = String(await vtool.execute({ spec: '{"items": [{"type": "tex' }))
    // repairable in theory, but the result is not a valid spec (missing content) — wait:
    // this one IS completable but the spec has no valid nodes; assert the no-auto-repair path:
    const bad = '{"title": "x", garbage'
    const v2 = String(await vtool.execute({ spec: bad }))
    expect(v2).toContain('repair=failed')
  })
})
