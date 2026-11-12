import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage, markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  createFeedbackMessage,
  extractDshUiFences,
  fenceCorrectionText,
  fenceFailures,
  fenceFingerprint,
  installFenceFeedback,
  missingBodyCorrectionText,
  planFenceFeedback,
  FEEDBACK_PLUGIN_NAME,
  FEEDBACK_SOURCE_KIND,
  MAX_CORRECTIONS_PER_TURN,
} from '../src/plugin/fence-feedback.ts'

const STAT_GROUP = JSON.stringify({ items: [{
  type: 'stat',
  items: [{ label: '质量门进度', value: '1/5' }, { label: '阻塞项', value: '0' }],
}] })

const BARE_STEPS = JSON.stringify({ type: 'steps', items: [{ title: '第一层' }] })

const BROKEN = JSON.stringify({ items: [{ type: 'stat' }] })
const REPAIRABLE = '{"title":"x","items":[{"type":"text","content":"好",},]}'
const REPAIRED_SCHEMA_FAILURE = '{"items":[{"type":"stat","value":"好",},]}'
const ISSUE_200 = '{"type":"keyvalue","items":[{"label":"a","value":"b"}]}'
const CUT = '{"items":[{"type":"text","content":"补全"}'
const TIER2_ONLY = '{"title":"x","items":[{"type":"text","content":"半截'

function reply(...bodies: string[]): string {
  return bodies.map(body => `说明文字\n\`\`\`dsh-ui\n${body}\n\`\`\`\n`).join('\n')
}

interface Harness {
  ctx: Context
  emitSession: (event: unknown) => void
  disposeSession: () => void
  boundary: (payload: unknown) => void
  steer: ReturnType<typeof vi.fn>
  listeners: Map<string, (payload: unknown, ...rest: unknown[]) => unknown>
}

interface StreamHarness {
  emitSession: (event: SessionEvent) => void
  stream: (options: GenerateOptions, chunks: readonly StreamChunk[]) => AsyncIterable<StreamChunk>
}

async function* streamChunks(chunks: readonly StreamChunk[]): AsyncGenerator<StreamChunk> {
  yield* chunks
}

async function collectChunks(source: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of source) chunks.push(chunk)
  return chunks
}

function agentRequest(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return markAgentLoopRequest({
    provider: 'test-provider',
    model: 'test-model',
    messages: [],
    sessionId: 'sess-1' as NonNullable<GenerateOptions['sessionId']>,
    ...overrides,
  })
}

function streamHarness(options: { parentSession?: string; enabled?: boolean } = {}): StreamHarness {
  const ctx = new Context()
  const session = {
    id: 'sess-1',
    snapshotEvents: () => [],
    header: options.parentSession === undefined
      ? { id: 'sess-1' }
      : { id: 'sess-1', parentSession: options.parentSession },
  }
  installFenceFeedback(ctx, options.enabled ?? true)
  return {
    emitSession: event => ctx.emit('session/event', session as never, event),
    stream: (request, chunks) => ctx.waterfall('llm/stream', request, () => streamChunks(chunks)),
  }
}

function harness(options: { parentSession?: string; enabled?: boolean } = {}): Harness {
  const listeners = new Map<string, (payload: unknown, ...rest: unknown[]) => unknown>()
  const ctx = {
    logger: { warn: vi.fn() },
    reflect: { get: vi.fn() },
    inject: vi.fn(),
    on: (name: string, handler: (payload: unknown, ...rest: unknown[]) => unknown) => {
      listeners.set(name, handler)
      return () => listeners.delete(name)
    },
  } as unknown as Context
  installFenceFeedback(ctx, options.enabled ?? true)
  const session = {
    id: 'sess-1',
    snapshotEvents: () => [],
    header: options.parentSession === undefined ? { id: 'sess-1' } : { id: 'sess-1', parentSession: options.parentSession },
  }
  const steer = vi.fn()
  const agent = { session, steer }
  return {
    ctx,
    steer,
    listeners,
    emitSession: (event: unknown) => {
      listeners.get('session/event')?.(session, event)
    },
    disposeSession: () => {
      listeners.get('session/disposed')?.(session)
    },
    boundary: (payload: unknown) => {
      listeners.get('agent/turn-stopping')?.(payload)
    },
  }
}

const assistantEvent = (text: string): unknown => ({ type: 'assistant/message', seq: 3, time: 1, data: { message: { content: [{ type: 'text', text }] } } }) as unknown as SessionEvent
const userEvent = (): unknown => ({ type: 'user/message', seq: 2, time: 1, data: { content: [{ type: 'text', text: '问题' }], source: { kind: 'user' } } }) as unknown as SessionEvent

async function persistedFeedbackHarness() {
  const ctx = new Context()
  const sessionPlugin = await ctx.plugin(SessionStore)
  const session = ctx.sessions.create('persisted-feedback')
  const applyFeedback = (feedbackCtx: Context) => installFenceFeedback(feedbackCtx, true)
  let feedback = await ctx.plugin(applyFeedback)
  let turn = 7
  const steer = vi.fn((message: ReturnType<typeof createFeedbackMessage>) => {
    session.append('user/message', message, { surfaceOp: 'append' })
  })
  const agent = { session, steer }
  return {
    ctx,
    session,
    steer,
    startTurn: (nextTurn = 7) => {
      turn = nextTurn
      session.append('turn/start', { turn })
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: '请展示界面' }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
    },
    assistant: (body: string) => {
      session.append('assistant/message', {
        turn, step: 1, stream: [],
        message: createAssistantMessage({
          content: [{ type: 'text', text: reply(body) }], source: { provider: 'test', model: 'test' },
        }),
      }, { surfaceOp: 'append' })
    },
    validate: () => {
      session.append('tool/call', {
        turn, step: 1, callId: `validate-${session.seq}` as never, name: 'validate_dsh_ui', arguments: '{}',
      })
    },
    boundary: () => ctx.emit('agent/turn-stopping', { agent: agent as never, turn, signal: new AbortController().signal }),
    reload: async (duringReload?: () => void | Promise<void>) => {
      await feedback.dispose()
      const reloading = ctx.plugin(applyFeedback)
      await Promise.resolve()
      const pendingEvent = duringReload?.()
      feedback = await reloading
      await pendingEvent
    },
    dispose: async () => {
      await feedback.dispose()
      await sessionPlugin.dispose()
    },
  }
}

describe('exact fence matching', () => {
  it.each(['dsh-ui>', 'DSH-UI', 'DSH-UI>'])('uses the renderer language rule for %s feedback', label => {
    const text = `\`\`\`${label}\n${BROKEN}\n\`\`\``
    expect(extractDshUiFences(text)).toEqual([{ raw: BROKEN, closed: true, index: 1 }])
    expect(fenceFailures(text)).toHaveLength(1)
    expect(fenceFailures(`\`\`\`${label}\n${STAT_GROUP}\n\`\`\``)).toEqual([])
  })

  it('extracts only a fence whose info string is exactly dsh-ui', () => {
    const text = [
      '```dsh-ui',
      BROKEN,
      '```',
      '```dsh-ui-dark',
      '{"items":[]}',
      '```',
      '```json',
      '{"items":[]}',
      '```',
      '正文里提到 dsh-ui 但不在围栏里',
    ].join('\n')
    const fences = extractDshUiFences(text)
    expect(fences).toHaveLength(1)
    expect(fences[0]!.raw).toBe(BROKEN)
    expect(fences[0]!.closed).toBe(true)
  })

  it('accepts trailing spaces and up to three spaces of indentation', () => {
    expect(extractDshUiFences('   ```dsh-ui   \n{}\n```')).toHaveLength(1)
    expect(extractDshUiFences('    ```dsh-ui\n{}\n```')).toHaveLength(0)
  })

  it('marks an unterminated fence instead of swallowing it silently', () => {
    const fences = extractDshUiFences('```dsh-ui\n{"items":[{"type":"text","content":"半截')
    expect(fences).toHaveLength(1)
    expect(fences[0]!.closed).toBe(false)
  })

  it('keeps multiple fences in document order with 1-based indices', () => {
    const fences = extractDshUiFences(reply(BROKEN, STAT_GROUP))
    expect(fences.map(fence => fence.index)).toEqual([1, 2])
  })

  it('fingerprints the body, not the surrounding whitespace', () => {
    expect(fenceFingerprint(` ${BROKEN} `)).toBe(fenceFingerprint(BROKEN))
    expect(fenceFingerprint(BROKEN)).not.toBe(fenceFingerprint(STAT_GROUP))
  })
})

describe('fenceFailures: only fences that would stay a code block', () => {
  it('passes the #172 bodies the guard now renders', () => {
    expect(fenceFailures(reply(STAT_GROUP))).toEqual([])
    expect(fenceFailures(reply(BARE_STEPS))).toEqual([])
  })

  it('reports the actionable field diagnosis of a dropped node', () => {
    const failures = fenceFailures(reply(BROKEN))
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain("type 'stat' requires label")
    expect(failures[0]!.detail).not.toContain('[genui-validation]')
    expect(failures[0]!.detail).not.toContain('next=fix_and_revalidate')
    expect(failures[0]!.detail).not.toContain('reply_language=conversation')
    expect(failures[0]!.fingerprint).toBe(fenceFingerprint(BROKEN))
  })

  it('reports unparseable and unrenderable unterminated bodies distinctly', () => {
    expect(fenceFailures('```dsh-ui\n{ not json\n```')[0]!.detail).toContain('error=invalid_json')
    expect(fenceFailures(`\`\`\`dsh-ui\n${BROKEN}`)[0]!.detail).toContain('error=unterminated_fence')
  })

  it('accepts bodies repaired by the settled renderer pipeline', () => {
    expect(fenceFailures(reply(REPAIRABLE))).toEqual([])
  })

  it('reports schema errors after tier-1 JSON repair', () => {
    const failures = fenceFailures(reply(REPAIRED_SCHEMA_FAILURE))
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain("type 'stat' requires label")
    expect(failures[0]!.detail).not.toContain('不是合法 JSON')
  })

  it('accepts a settled body repaired by tier-2 completion', () => {
    expect(fenceFailures(reply(CUT))).toEqual([])
    expect(fenceFailures(reply(TIER2_ONLY))).toEqual([])
  })

  it.each([
    ['complete JSON', STAT_GROUP],
    ['trailing tool syntax', `${STAT_GROUP}\n<|tool_calls_begin|>\n{"name":"render_ui",`],
    ['tier-1 repair', REPAIRABLE],
    ['settled tier-2 completion', TIER2_ONLY],
  ])('does not reject a renderable unclosed fence: %s (#288)', (_name, body) => {
    expect(fenceFailures(`\`\`\`dsh-ui\n${body}`)).toEqual([])
  })

  it('accepts the issue #200 keyvalue alias shape', () => {
    expect(fenceFailures(reply(ISSUE_200))).toEqual([])
  })

  it('ignores JSON fences and prose', () => {
    expect(fenceFailures('```json\n{"items":[{"type":"stat"}]}\n```\n正文 dsh-ui')).toEqual([])
  })
})

describe('planFenceFeedback: the bounds that prevent a retry storm', () => {
  const base = { text: reply(BROKEN), turn: 1, correctedSpec: new Set<string>(), aborted: false }

  it('plans one correction for a rejected fence', () => {
    const plan = planFenceFeedback(base)
    expect(plan).not.toBeNull()
    expect(plan!.turn).toBe(1)
    expect(plan!.kind).toBe('render')
    expect(plan!.fingerprints).toEqual([fenceFingerprint(BROKEN)])
    expect(plan!.text).toContain('next=resend_corrected_fence_only')
  })

  it('only resends the broken fence when another unclosed fence renders (#288)', () => {
    const plan = planFenceFeedback({ ...base, text: `${reply(BROKEN)}\n\`\`\`dsh-ui\n${STAT_GROUP}` })
    expect(plan!.fingerprints).toEqual([fenceFingerprint(BROKEN)])
    expect(plan!.text).toContain('fences=1')
    expect(plan!.text).not.toContain('fence=2')
  })

  it('checks the final reply body even when an earlier validated body was valid', () => {
    expect(fenceFailures(reply(STAT_GROUP))).toEqual([])
    const finalReply = planFenceFeedback({ ...base, text: reply(BROKEN) })
    expect(finalReply).not.toBeNull()
    expect(finalReply!.text).toContain("type 'stat' requires label")
  })

  it('allows a SECOND correction in the same turn, never a third', () => {
    expect(planFenceFeedback({ ...base, correctionsThisTurn: 1, correctionsTurn: 1 })).not.toBeNull()
    expect(planFenceFeedback({ ...base, correctionsThisTurn: 2, correctionsTurn: 1 })).toBeNull()

    expect(planFenceFeedback({ ...base, correctionsThisTurn: 2, correctionsTurn: 0 })).not.toBeNull()
  })

  it('stays silent for a fence body already corrected', () => {
    expect(planFenceFeedback({ ...base, correctedSpec: new Set([fenceFingerprint(BROKEN)]) })).toBeNull()
  })

  it('corrects only the new fences when a reply repeats an old broken one', () => {
    const plan = planFenceFeedback({ ...base, text: reply(BROKEN, STAT_GROUP), correctedSpec: new Set([fenceFingerprint(BROKEN)]) })
    expect(plan).toBeNull()
    const other = planFenceFeedback({ ...base, text: reply(BROKEN, '{"items":[{"type":"table"}]}'), correctedSpec: new Set([fenceFingerprint(BROKEN)]) })
    expect(other!.fingerprints).toEqual([fenceFingerprint('{"items":[{"type":"table"}]}')])
  })

  it('stays silent when the turn is aborted or the reply renders', () => {
    expect(planFenceFeedback({ ...base, aborted: true })).toBeNull()
    expect(planFenceFeedback({ ...base, text: reply(STAT_GROUP) })).toBeNull()
    expect(planFenceFeedback({ ...base, text: '   ' })).toBeNull()
  })

  it('reminds only after a formal validate call that produced no delivery', () => {
    const idle = { text: '', turn: 2, correctedSpec: new Set<string>(), aborted: false }

    expect(planFenceFeedback(idle)).toBeNull()

    const plan = planFenceFeedback({ ...idle, validatedThisTurn: true })
    expect(plan).not.toBeNull()
    expect(plan!.kind).toBe('delivery')
    expect(plan!.fingerprints).toEqual([])
    expect(plan!.text).toContain('status=nothing_delivered')
    expect(plan!.text).toContain('本轮尚未产生正式回答')

    expect(plan!.text).not.toContain('```')

    expect(planFenceFeedback({ ...idle, validatedThisTurn: true, deliveryRemindedTurns: new Set([2]) })).toBeNull()

    expect(planFenceFeedback({ ...idle, turn: 3, validatedThisTurn: true, deliveryRemindedTurns: new Set([2]) })).not.toBeNull()
  })

  it('says nothing when the turn already delivered something formal', () => {
    const delivered = { text: '', turn: 5, correctedSpec: new Set<string>(), aborted: false, validatedThisTurn: true, deliveredThisTurn: true }
    expect(planFenceFeedback(delivered)).toBeNull()

    expect(planFenceFeedback({ ...delivered, deliveredThisTurn: false })).not.toBeNull()
  })

  it('has no reasoning input at all: the decision is formal-event only', () => {

    const input = { ...base, validatedThisTurn: true }
    expect(Object.keys(input).some(key => key.toLowerCase().includes('reason') || key.toLowerCase().includes('draft'))).toBe(false)
  })
})

describe('the steered correction message', () => {
  it('uses the producer-owned source kind for Session format v4', () => {
    const failures = fenceFailures(reply(BROKEN))
    const text = fenceCorrectionText(failures)
    expect(text).toContain(`[genui-fence-repair #${failures[0]!.fingerprint}]`)
    expect(text).toContain('[genui-fence-repair]')
    expect(text).toContain('reply_language=conversation')
    expect(text).toContain("type 'stat' requires label")
    expect(text).not.toContain('[genui-validation]')
    expect(text).not.toContain('next=fix_and_revalidate')
    expect(text).not.toContain('围栏没有渲染成界面')
    expect(text).not.toContain('请只重发修正后的')
    const message = createFeedbackMessage(text, 4)
    expect(message.role).toBe('user')
    expect(typeof message.id).toBe('string')
    expect(message.source).toEqual({
      kind: FEEDBACK_SOURCE_KIND,
      form: 'notice',
      summary: 'genui fence repair requested',
    })
    expect(Object.isFrozen(message)).toBe(true)

    expect(text).not.toContain('```')
  })

  it('uses the legacy plugin source on older Session formats', () => {
    const message = createFeedbackMessage('repair', 0)

    expect(message.source).toEqual({
      kind: 'plugin',
      plugin: FEEDBACK_PLUGIN_NAME,
      form: 'notice',
      summary: 'genui fence repair requested',
    })
  })

  it('numbers each broken fence when a reply has several', () => {
    const failures = fenceFailures(reply(BROKEN, '{"items":[{"type":"table"}]}'))
    expect(failures).toHaveLength(2)
    const text = fenceCorrectionText(failures)
    expect(text).toContain('fence=1')
    expect(text).toContain('fence=2')
  })
})

describe('installFenceFeedback wiring', () => {
  it('does not request a duplicate card for an unclosed renderable reply (#288)', () => {
    const h = harness()
    h.emitSession(userEvent())
    h.emitSession(assistantEvent(`\`\`\`dsh-ui\n${STAT_GROUP}\n<|tool_calls_begin|>\n{"name":"render_ui",`))
    const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
    h.boundary({ agent, turn: 4, signal: new AbortController().signal })
    h.boundary({ agent, turn: 4, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('keeps stream recovery active and disables same-turn steering when configured off', () => {
    const h = harness({ enabled: false })
    expect(h.listeners.has('llm/stream')).toBe(true)
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.boundary({
      agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer },
      turn: 1,
      signal: new AbortController().signal,
    })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('steers once per turn when the reply has an unrenderable fence', () => {
    const h = harness()
    h.emitSession(userEvent())
    h.emitSession(assistantEvent(reply(BROKEN)))
    const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
    h.boundary({ agent, turn: 4, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
    const message = h.steer.mock.calls[0]![0] as { source: { kind: string } }
    expect(message.source.kind).toBe(FEEDBACK_SOURCE_KIND)

    h.boundary({ agent, turn: 4, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
  })

  const toolCallEvent = (name: string, callId?: string): unknown =>
    ({ type: 'tool/call', seq: 4, time: 2, data: callId === undefined ? { name } : { name, callId } }) as unknown as SessionEvent
  interface ToolResultOptions {
    internal?: boolean
    blockError?: boolean
    text?: string
    format?: 'legacy' | 'v4'
  }
  const toolResultEvent = (callId: string, options: ToolResultOptions = {}): unknown => {
    const text = options.text ?? '[genui-render]\nstatus=rendered\nrendered=1\nreply_language=conversation'
    const resultContent = [{ type: 'text', text }]
    const message = options.format === 'v4'
      ? { toolCallId: callId, isError: options.blockError === true, content: resultContent }
      : { content: [{ type: 'tool-result', toolCallId: callId, isError: options.blockError === true, content: resultContent }] }
    return {
      type: 'tool/result',
      seq: 6,
      time: 3,
      data: {
        message,
        ...(options.internal === true ? { error: { name: 'ToolError', code: 'render_failed' } } : {}),
      },
    } as unknown as SessionEvent
  }
  const feedbackMessageEvent = (id: string, text: string): unknown => ({
    type: 'user/message',
    seq: 4,
    time: 1,
    data: {
      id,
      content: [{ type: 'text', text }],
      source: { kind: FEEDBACK_SOURCE_KIND, form: 'notice', summary: 'x' },
    },
  }) as unknown as SessionEvent
  const contextMessageEvent = (kind: string): unknown => ({
    type: 'user/message',
    seq: 8,
    time: 4,
    data: { content: [{ type: 'text', text: '文件已变更' }], source: { kind } },
  }) as unknown as SessionEvent
  const turnStartEvent = (turn: number): unknown => ({ type: 'turn/start', seq: 1, time: 0, data: { turn } }) as unknown as SessionEvent
  const reasoningEvent = (text: string): unknown => ({
    type: 'assistant/message',
    seq: 5,
    time: 2,
    data: { message: { content: [{ type: 'reasoning', text }] } },
  }) as unknown as SessionEvent

  it('reminds when a formal validate call produced no delivery', () => {
    const h = harness()
    h.emitSession(userEvent())
    h.emitSession(toolCallEvent('validate_dsh_ui'))
    h.emitSession({ type: 'assistant/message', seq: 6, time: 3, data: { message: { content: [{ type: 'reasoning', text: '草稿' }] } } } as unknown as SessionEvent)
    const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
    h.boundary({ agent, turn: 7, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
    const message = h.steer.mock.calls[0]![0] as { content: Array<{ text: string }> }
    expect(message.content[0]!.text).toContain('status=nothing_delivered')
    expect(message.content[0]!.text).toContain('本轮尚未产生正式回答')
    expect(message.content[0]!.text).toContain('或明确调用 render_ui')

    h.boundary({ agent, turn: 7, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
  })

  it('never lets reasoning content change the decision (only formal events do)', () => {

    const drafts = [
      '',
      '```dsh-ui\n{"items":[{"type":"text","content":"候选一"}]}\n```',
      '```dsh-ui\n{"items":[{"type":"text","content":"候选一"}]}\n```\n推翻它\n```dsh-ui\n{"items":[{"type":"text","content":"候选二"}]}\n```',
    ]
    const decisions = drafts.map(draft => {
      const h = harness()
      h.emitSession(userEvent())
      h.emitSession(toolCallEvent('validate_dsh_ui'))
      if (draft !== '') h.emitSession(reasoningEvent(draft))
      const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
      h.boundary({ agent, turn: 3, signal: new AbortController().signal })
      return h.steer.mock.calls.length
    })
    expect(decisions).toEqual([1, 1, 1])
  })

  it('stays silent when the turn delivered a body or a successful render_ui result', () => {
    const delivered = harness()
    delivered.emitSession(userEvent())
    delivered.emitSession(toolCallEvent('validate_dsh_ui'))
    delivered.emitSession(assistantEvent('就是这些，没有别的要汇报。'))
    const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: delivered.steer }
    delivered.boundary({ agent, turn: 8, signal: new AbortController().signal })
    expect(delivered.steer).not.toHaveBeenCalled()

    const card = harness()
    card.emitSession(userEvent())
    card.emitSession(toolCallEvent('validate_dsh_ui'))
    card.emitSession(toolCallEvent('render_ui', 'render-1'))
    card.emitSession({ type: 'assistant/message', seq: 7, time: 4, data: { message: { content: [{ type: 'tool-call', name: 'render_ui', arguments: '{}' }] } } } as unknown as SessionEvent)
    card.emitSession(toolResultEvent('render-1'))
    card.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: card.steer }, turn: 9, signal: new AbortController().signal })
    expect(card.steer).not.toHaveBeenCalled()
  })

  it('does not count a FAILED render_ui result as delivery', () => {
    for (const failure of [{ internal: true }, { blockError: true }]) {
      const h = harness()
      h.emitSession(userEvent())
      h.emitSession(toolCallEvent('validate_dsh_ui'))
      h.emitSession(toolCallEvent('render_ui', 'render-fail'))
      h.emitSession(toolResultEvent('render-fail', failure))
      const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
      h.boundary({ agent, turn: 5, signal: new AbortController().signal })
      expect(h.steer).toHaveBeenCalledTimes(1)
      const message = h.steer.mock.calls[0]![0] as { content: Array<{ text: string }> }
      expect(message.content[0]!.text).toContain('status=nothing_delivered')
    }
  })

  it('counts only explicit rendered status as render_ui delivery in legacy and v4 events', () => {
    for (const format of ['legacy', 'v4'] as const) {
      const h = harness()
      h.emitSession(userEvent())
      h.emitSession(toolCallEvent('validate_dsh_ui'))
      h.emitSession(toolCallEvent('render_ui', `render-${format}`))
      h.emitSession(toolResultEvent(`render-${format}`, { format }))
      h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }, turn: 12, signal: new AbortController().signal })
      expect(h.steer).not.toHaveBeenCalled()
    }
  })

  it('keeps normally returned invalid and unrecognized render_ui results undelivered', () => {
    for (const text of [
      '[genui-render]\nstatus=invalid\nerror=invalid_spec\nnext=fix_and_retry',
      'Tool completed. status=rendered',
      '[genui-render]\nstatus=unknown',
    ]) {
      const h = harness()
      h.emitSession(userEvent())
      h.emitSession(toolCallEvent('validate_dsh_ui'))
      h.emitSession(toolCallEvent('render_ui', 'render-unrecognized'))
      h.emitSession(toolResultEvent('render-unrecognized', { text }))
      h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }, turn: 13, signal: new AbortController().signal })
      expect(h.steer).toHaveBeenCalledTimes(1)
      const correction = h.steer.mock.calls[0]![0] as { content: Array<{ text: string }> }
      expect(correction.content[0]!.text).toContain('status=nothing_delivered')
    }
  })

  it('stays silent while a render_ui result is outstanding, then decides on the result', () => {
    const h = harness()
    h.emitSession(userEvent())
    h.emitSession(toolCallEvent('validate_dsh_ui'))
    h.emitSession(toolCallEvent('render_ui', 'render-late'))
    const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }

    h.boundary({ agent, turn: 6, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()

    h.emitSession(toolResultEvent('render-late', { blockError: true }))
    h.boundary({ agent, turn: 6, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
    const message = h.steer.mock.calls[0]![0] as { content: Array<{ text: string }> }
    expect(message.content[0]!.text).toContain('status=nothing_delivered')
  })

  it('does not let synthetic same-turn context messages clear the turn state', () => {

    for (const kind of ['tool', 'agent', 'member']) {
      const h = harness()
      h.emitSession(userEvent())
      h.emitSession(toolCallEvent('validate_dsh_ui'))
      h.emitSession(contextMessageEvent(kind))
      const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
      h.boundary({ agent, turn: 3, signal: new AbortController().signal })
      expect(h.steer).toHaveBeenCalledTimes(1)
      const message = h.steer.mock.calls[0]![0] as { content: Array<{ text: string }> }
      expect(message.content[0]!.text).toContain('status=nothing_delivered')
    }
  })

  it('resets the turn state on the formal turn/start boundary', () => {
    const h = harness()
    h.emitSession(turnStartEvent(1))
    h.emitSession(userEvent())
    h.emitSession(toolCallEvent('validate_dsh_ui'))
    const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
    h.boundary({ agent, turn: 1, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)

    h.emitSession(turnStartEvent(2))
    h.emitSession(userEvent())
    h.emitSession(toolCallEvent('validate_dsh_ui'))
    h.boundary({ agent, turn: 2, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(2)
  })

  it('keeps the delivery ledger separate from the render-failure ledger', () => {
    const h = harness()
    h.emitSession(userEvent())
    h.emitSession(toolCallEvent('validate_dsh_ui'))
    const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
    h.boundary({ agent, turn: 4, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.boundary({ agent, turn: 4, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(2)
    const second = h.steer.mock.calls[1]![0] as { content: Array<{ text: string }> }
    expect(second.content[0]!.text).toContain('next=resend_corrected_fence_only')
  })

  it('blocks a third render correction after two different fingerprints in one turn', () => {
    const h = harness()
    h.emitSession(userEvent())
    const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
    const replies = [
      reply(BROKEN),
      reply('{"items":[{"type":"stat","label":"second"}]}'),
      reply('{"items":[{"type":"stat","label":"third"}]}'),
    ]
    for (const text of replies) {
      h.emitSession(assistantEvent(text))
      h.boundary({ agent, turn: 14, signal: new AbortController().signal })
    }
    expect(h.steer).toHaveBeenCalledTimes(2)
  })

  it('never steers for a subagent session', () => {
    const h = harness({ parentSession: 'parent-1' })
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.boundary({
      agent: { session: { id: 'sess-1', header: { id: 'sess-1', parentSession: 'parent-1' } }, steer: h.steer },
      turn: 1,
      signal: new AbortController().signal,
    })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('never steers into an aborted turn', () => {
    const h = harness()
    h.emitSession(assistantEvent(reply(BROKEN)))
    const controller = new AbortController()
    controller.abort()
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 1, signal: controller.signal })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('adopts the fingerprints of its own correction so a reload cannot repeat it', () => {
    const h = harness()
    const failures = fenceFailures(reply(BROKEN))
    h.emitSession(turnStartEvent(9))
    h.emitSession({
      type: 'user/message',
      seq: 4,
      time: 1,
      data: {
        content: [{ type: 'text', text: fenceCorrectionText(failures) }],
        source: { kind: FEEDBACK_SOURCE_KIND, form: 'notice', summary: 'x' },
      },
    } as unknown as SessionEvent)
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 9, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('restores a replayed delivery reminder, then shares the second slot with render feedback', () => {
    const h = harness()
    h.emitSession(turnStartEvent(7))
    h.emitSession(feedbackMessageEvent('delivery-7', missingBodyCorrectionText(7)))
    h.emitSession(toolCallEvent('validate_dsh_ui'))
    const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
    h.boundary({ agent, turn: 7, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()

    h.emitSession(assistantEvent(reply(BROKEN)))
    h.boundary({ agent, turn: 7, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
    h.emitSession(assistantEvent(reply('{"items":[{"type":"stat","label":"third"}]}')))
    h.boundary({ agent, turn: 7, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
  })

  it('restores render correction budget for a replayed turn and allows exactly one new fingerprint', () => {
    const h = harness()
    h.emitSession(turnStartEvent(9))
    h.emitSession(userEvent())
    h.emitSession(feedbackMessageEvent('render-9-a', fenceCorrectionText(fenceFailures(reply(BROKEN)))))
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.emitSession(toolCallEvent('validate_dsh_ui'))
    const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
    h.boundary({ agent, turn: 9, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()

    h.emitSession(assistantEvent(reply('{"items":[{"type":"stat","label":"second"}]}')))
    h.boundary({ agent, turn: 9, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
    h.emitSession(assistantEvent(reply('{"items":[{"type":"stat","label":"third"}]}')))
    h.boundary({ agent, turn: 9, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
  })

  it('does not count a live correction message twice when the session re-observes it', () => {
    const h = harness()
    h.emitSession(userEvent())
    const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.boundary({ agent, turn: 10, signal: new AbortController().signal })
    const message = h.steer.mock.calls[0]![0] as { id: string; content: Array<{ text: string }>; source: { kind: string; form: 'notice'; summary: string } }
    h.emitSession(feedbackMessageEvent(message.id, message.content[0]!.text))

    h.emitSession(assistantEvent(reply('{"items":[{"type":"stat","label":"second"}]}')))
    h.boundary({ agent, turn: 10, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(2)
  })

  it('counts two persisted delivery messages by distinct IDs even when their turn marker matches', () => {
    const h = harness()
    h.emitSession(turnStartEvent(11))
    h.emitSession(feedbackMessageEvent('delivery-11-a', missingBodyCorrectionText(11)))
    h.emitSession(feedbackMessageEvent('delivery-11-b', missingBodyCorrectionText(11)))
    h.emitSession(toolCallEvent('validate_dsh_ui'))
    h.emitSession(assistantEvent(reply('{"items":[{"type":"stat","label":"third"}]}')))
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }, turn: 11, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('adopts fingerprints from legacy repair markers', () => {
    const h = harness()
    const fingerprint = fenceFingerprint(BROKEN)
    h.emitSession({
      type: 'user/message',
      seq: 4,
      time: 1,
      data: {
        content: [{ type: 'text', text: `[genui 自修 #${fingerprint}]\nlegacy repair notice` }],
        source: { kind: FEEDBACK_SOURCE_KIND, form: 'notice', summary: 'legacy' },
      },
    } as unknown as SessionEvent)
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 9, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('recognizes original legacy plugin source wrappers', () => {
    const h = harness()
    const failures = fenceFailures(reply(BROKEN))
    h.emitSession({
      type: 'user/message',
      seq: 4,
      time: 1,
      data: {
        content: [{ type: 'text', text: fenceCorrectionText(failures) }],
        source: { kind: 'plugin', plugin: FEEDBACK_PLUGIN_NAME, form: 'notice', summary: 'legacy' },
      },
    } as unknown as SessionEvent)
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 9, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('stays silent when the reply renders', () => {
    const h = harness()
    h.emitSession(assistantEvent(reply(STAT_GROUP, BARE_STEPS)))
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 1, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('clears the latest reply when a plain assistant message replaces it', () => {
    const h = harness()
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.emitSession(assistantEvent('普通文本'))
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 1, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('releases session feedback state after session disposal', () => {
    const h = harness()
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.disposeSession()
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 1, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()
  })
})

describe('GenUI reasoning-only stream recovery', () => {
  const reasoningOnly: StreamChunk[] = [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'private reasoning draft' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'private reasoning draft' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]

  it('rewrites a validated top-level GenUI reasoning-only stop as EMPTY_RESPONSE', async () => {
    const h = streamHarness()
    h.emitSession(userEvent() as SessionEvent)
    h.emitSession({ type: 'tool/call', seq: 3, time: 1, data: { name: 'validate_dsh_ui', callId: 'validate-1' } } as unknown as SessionEvent)
    const chunks = await collectChunks(h.stream(agentRequest(), reasoningOnly))

    expect(chunks.slice(0, -1)).toEqual(reasoningOnly.slice(0, -1))
    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          message: 'GenUI turn completed with reasoning only and no deliverable response',
          code: 'EMPTY_RESPONSE',
        },
      },
    })
  })

  it('preserves text, tool-call, max-tokens, empty-stop, and existing error finishes', async () => {
    const h = streamHarness()
    h.emitSession(userEvent() as SessionEvent)
    h.emitSession({ type: 'tool/call', seq: 3, time: 1, data: { name: 'validate_dsh_ui', callId: 'validate-1' } } as unknown as SessionEvent)
    const unchanged: StreamChunk[][] = [
      [
        ...reasoningOnly.slice(0, -1),
        { type: 'block-start', index: 1, blockType: 'text' },
        { type: 'text-delta', index: 1, text: 'final answer' },
        { type: 'block-end', index: 1, block: { type: 'text', text: 'final answer' } },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
      [
        ...reasoningOnly.slice(0, -1),
        { type: 'block-start', index: 1, blockType: 'tool-call' },
        { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'call-1', name: 'render_ui', arguments: '{}' } },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ],
      [ ...reasoningOnly.slice(0, -1), { type: 'finish', reason: { kind: 'max-tokens' } } ],
      [{ type: 'finish', reason: { kind: 'stop' } }],
      [{ type: 'finish', reason: { kind: 'error', failure: { message: 'provider failed', code: 'SERVER' } } }],
      [{ type: 'finish', reason: { kind: 'aborted', failure: { message: 'cancelled', code: 'ABORTED' } } }],
    ]

    for (const stream of unchanged) {
      expect(await collectChunks(h.stream(agentRequest(), stream))).toEqual(stream)
    }
  })

  it('leaves ordinary turns, unmarked requests, subagents, and auxiliary calls unchanged', async () => {
    const unvalidated = streamHarness()
    unvalidated.emitSession(userEvent() as SessionEvent)
    const ordinaryRequest: GenerateOptions = {
      provider: 'test-provider',
      model: 'test-model',
      messages: [],
      sessionId: 'sess-1' as NonNullable<GenerateOptions['sessionId']>,
    }
    expect(await collectChunks(unvalidated.stream(agentRequest(), reasoningOnly))).toEqual(reasoningOnly)

    const validated = streamHarness()
    validated.emitSession(userEvent() as SessionEvent)
    validated.emitSession({ type: 'tool/call', seq: 3, time: 1, data: { name: 'validate_dsh_ui', callId: 'validate-1' } } as unknown as SessionEvent)
    expect(await collectChunks(validated.stream(ordinaryRequest, reasoningOnly))).toEqual(reasoningOnly)
    expect(await collectChunks(validated.stream(agentRequest({ purpose: 'compaction' }), reasoningOnly))).toEqual(reasoningOnly)

    const subagent = streamHarness({ parentSession: 'parent-1' })
    subagent.emitSession(userEvent() as SessionEvent)
    subagent.emitSession({ type: 'tool/call', seq: 3, time: 1, data: { name: 'validate_dsh_ui', callId: 'validate-1' } } as unknown as SessionEvent)
    expect(await collectChunks(subagent.stream(agentRequest(), reasoningOnly))).toEqual(reasoningOnly)
  })

  it('keeps the validation signal for a host retry that returns a text answer', async () => {
    const h = streamHarness()
    h.emitSession(userEvent() as SessionEvent)
    h.emitSession({ type: 'tool/call', seq: 3, time: 1, data: { name: 'validate_dsh_ui', callId: 'validate-1' } } as unknown as SessionEvent)
    const failedAttempt = await collectChunks(h.stream(agentRequest(), reasoningOnly))
    const answer: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'final answer' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'final answer' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const retriedAttempt = await collectChunks(h.stream(agentRequest(), answer))

    expect((failedAttempt.at(-1) as Extract<StreamChunk, { type: 'finish' }>).reason.kind).toBe('error')
    expect(retriedAttempt).toEqual(answer)
  })

  it('keeps host retry recovery enabled when same-turn fence corrections are disabled', async () => {
    const h = streamHarness({ enabled: false })
    h.emitSession(userEvent() as SessionEvent)
    h.emitSession({ type: 'tool/call', seq: 3, time: 1, data: { name: 'validate_dsh_ui', callId: 'validate-1' } } as unknown as SessionEvent)

    const chunks = await collectChunks(h.stream(agentRequest(), reasoningOnly))
    expect((chunks.at(-1) as Extract<StreamChunk, { type: 'finish' }>).reason.kind).toBe('error')
  })
})

describe('persisted fence feedback lifecycle', () => {
  it.each([false, true])('allows the same broken fence in a new turn while preserving reload deduplication (reload=%s)', async (reload) => {
    const h = await persistedFeedbackHarness()
    try {
      h.startTurn()
      h.assistant(BROKEN)
      h.boundary()
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(1)

      h.startTurn(8)
      if (reload) await h.reload()
      h.assistant(BROKEN)
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(2)

      await h.reload()
      h.assistant(BROKEN)
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(2)
      h.assistant('{"items":[{"type":"stat","label":"second"}]}')
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(3)
      h.assistant('{"items":[{"type":"stat","label":"third"}]}')
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(3)
    } finally {
      await h.dispose()
    }
  })

  it('keeps the two-correction cap across a real plugin reload and resets it for the next turn', async () => {
    const h = await persistedFeedbackHarness()
    try {
      h.startTurn()
      h.assistant(BROKEN)
      h.boundary()
      h.assistant('{"items":[{"type":"stat","label":"second"}]}')
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(2)
      await h.reload()
      h.assistant('{"items":[{"type":"stat","label":"third"}]}')
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(2)

      h.startTurn(8)
      h.assistant('{"items":[{"type":"stat","label":"new-turn"}]}')
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(3)
    } finally {
      await h.dispose()
    }
  })

  it('restores the correction cap before a new message arrives during plugin reload', async () => {
    const h = await persistedFeedbackHarness()
    try {
      h.startTurn()
      h.assistant(BROKEN)
      h.boundary()
      h.assistant('{"items":[{"type":"stat","label":"second"}]}')
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(2)

      await h.reload(() => h.assistant('{"items":[{"type":"stat","label":"third"}]}'))
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(2)
    } finally {
      await h.dispose()
    }
  })

  it('restores pending feedback before a turn boundary arrives during plugin reload', async () => {
    const h = await persistedFeedbackHarness()
    try {
      h.startTurn()
      h.assistant(BROKEN)
      await h.reload(() => h.boundary())
      expect(h.steer).toHaveBeenCalledTimes(1)
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(1)
    } finally {
      await h.dispose()
    }
  })

  it('keeps reasoning-only host recovery active for a model request during plugin reload', async () => {
    const h = await persistedFeedbackHarness()
    try {
      h.startTurn()
      h.validate()

      const first = await collectChunks(h.ctx.waterfall('llm/stream', agentRequest({ sessionId: h.session.id }), () => streamChunks([
        { type: 'block-start', index: 0, blockType: 'reasoning' },
        { type: 'reasoning-delta', index: 0, text: 'private reasoning draft' },
        { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'private reasoning draft' } },
        { type: 'finish', reason: { kind: 'stop' } },
      ])))
      expect((first.at(-1) as Extract<StreamChunk, { type: 'finish' }>).reason.kind).toBe('stop')

      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(1)

      let chunks: StreamChunk[] = []
      await h.reload(async () => {
        chunks = await collectChunks(h.ctx.waterfall('llm/stream', agentRequest({ sessionId: h.session.id }), () => streamChunks([
          { type: 'block-start', index: 0, blockType: 'reasoning' },
          { type: 'reasoning-delta', index: 0, text: 'private reasoning draft' },
          { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'private reasoning draft' } },
          { type: 'finish', reason: { kind: 'stop' } },
        ])))
      })
      expect(chunks.at(-1)).toMatchObject({
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'EMPTY_RESPONSE' } },
      })
    } finally {
      await h.dispose()
    }
  })

  it('keeps a persisted delivery reminder silent after reload and shares the remaining slot with render feedback', async () => {
    const h = await persistedFeedbackHarness()
    try {
      h.startTurn()
      h.validate()
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(1)
      await h.reload()
      h.validate()
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(1)

      h.assistant(BROKEN)
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(2)
      await h.reload()
      h.assistant('{"items":[{"type":"stat","label":"third"}]}')
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(2)
    } finally {
      await h.dispose()
    }
  })

  it('adopts correction history when the host restores a session from its stored events', async () => {
    const h = await persistedFeedbackHarness()
    try {
      h.startTurn()
      h.assistant(BROKEN)
      h.boundary()
      h.assistant('{"items":[{"type":"stat","label":"second"}]}')
      h.boundary()
      const restored = h.ctx.sessions.create('restored-feedback', { seed: h.session.snapshotEvents() })
      const steer = vi.fn()
      restored.append('assistant/message', {
        turn: 7, step: 1, stream: [],
        message: createAssistantMessage({
          content: [{ type: 'text', text: reply('{"items":[{"type":"stat","label":"third"}]}') }],
          source: { provider: 'test', model: 'test' },
        }),
      }, { surfaceOp: 'append' })
      h.ctx.emit('agent/turn-stopping', {
        agent: { session: restored, steer } as never, turn: 7, signal: new AbortController().signal,
      })
      expect(steer).not.toHaveBeenCalled()
    } finally {
      await h.dispose()
    }
  })
})

describe('reasoning-only 交付提醒进入下一次模型请求', () => {

  const reasoningOnlyStream: StreamChunk[] = [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'private reasoning draft' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'private reasoning draft' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]

  it('lets the turn finish so turn-stopping can steer the reminder into the conversation', async () => {
    const h = await persistedFeedbackHarness()
    try {
      h.startTurn()
      h.validate()

      const chunks = await collectChunks(h.ctx.waterfall(
        'llm/stream',
        agentRequest({ sessionId: h.session.id }),
        () => streamChunks(reasoningOnlyStream),
      ))
      expect((chunks.at(-1) as Extract<StreamChunk, { type: 'finish' }>).reason.kind).toBe('stop')

      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(1)

      const lastUserMessage = h.session.snapshotEvents()
        .filter(event => event.type === 'user/message')
        .at(-1)
      const text = JSON.stringify(lastUserMessage)
      expect(text).toContain('本轮尚未产生正式回答')
      expect(text).toContain('next=emit_fence_in_body')
    } finally {
      await h.dispose()
    }
  })

  it('falls back to EMPTY_RESPONSE only after the reminder was already sent', async () => {
    const h = await persistedFeedbackHarness()
    try {
      h.startTurn()
      h.validate()

      const first = await collectChunks(h.ctx.waterfall(
        'llm/stream',
        agentRequest({ sessionId: h.session.id }),
        () => streamChunks(reasoningOnlyStream),
      ))
      expect((first.at(-1) as Extract<StreamChunk, { type: 'finish' }>).reason.kind).toBe('stop')

      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(1)

      const second = await collectChunks(h.ctx.waterfall(
        'llm/stream',
        agentRequest({ sessionId: h.session.id }),
        () => streamChunks(reasoningOnlyStream),
      ))
      expect(second.at(-1)).toMatchObject({
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'EMPTY_RESPONSE' } },
      })
    } finally {
      await h.dispose()
    }
  })

  it('falls back to EMPTY_RESPONSE when the shared correction budget is exhausted', async () => {
    const h = await persistedFeedbackHarness()
    try {
      h.startTurn()
      h.validate()

      h.assistant(BROKEN)
      h.boundary()
      h.assistant('{"items":[{"type":"table"}]}')
      h.boundary()
      expect(h.steer).toHaveBeenCalledTimes(MAX_CORRECTIONS_PER_TURN)

      const chunks = await collectChunks(h.ctx.waterfall(
        'llm/stream',
        agentRequest({ sessionId: h.session.id }),
        () => streamChunks(reasoningOnlyStream),
      ))

      expect(chunks.at(-1)).toMatchObject({
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'EMPTY_RESPONSE' } },
      })
    } finally {
      await h.dispose()
    }
  })
})
