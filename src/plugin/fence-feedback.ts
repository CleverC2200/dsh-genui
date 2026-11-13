import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionStore, UserMessage } from '@deepseek-ai/dsh-session'
import { createHash, randomUUID } from 'node:crypto'
import { droppedNodeFailure } from './genui-diagnostic.ts'
import { resolveFence } from '../shared/fence-resolve.ts'
import { isGenuiFenceLanguage } from '../shared/fence-language.ts'

export const FEEDBACK_PLUGIN_NAME = '@changfenhuang/dsh-genui'

export const FEEDBACK_SOURCE_KIND = `plugin:${FEEDBACK_PLUGIN_NAME}` as const

const MARKER_PREFIX = '[genui-fence-repair #'

export const MAX_CORRECTIONS_PER_TURN = 2

const LEGACY_MARKER_PREFIX = '[genui 自修 #'

const FENCE_OPEN = /^ {0,3}```[ \t]*([^` \t]+)[ \t]*$/u

const FENCE_CLOSE = /^ {0,3}```[ \t]*$/u

const MAX_FENCES = 40

export interface ExtractedFence {

  readonly raw: string

  readonly closed: boolean

  readonly index: number
}

export function extractDshUiFences(text: string): ExtractedFence[] {
  const lines = text.split('\n')
  const fences: ExtractedFence[] = []
  let open: { start: number; index: number } | null = null
  for (let line = 0; line < lines.length; line++) {
    const current = lines[line] ?? ''
    if (open === null) {
      const label = FENCE_OPEN.exec(current)?.[1]
      if (isGenuiFenceLanguage(label)) open = { start: line + 1, index: fences.length + 1 }
      continue
    }
    if (!FENCE_CLOSE.test(current)) continue
    fences.push({ raw: lines.slice(open.start, line).join('\n'), closed: true, index: open.index })
    open = null
    if (fences.length >= MAX_FENCES) return fences
  }
  if (open !== null && fences.length < MAX_FENCES) {
    fences.push({ raw: lines.slice(open.start).join('\n'), closed: false, index: open.index })
  }
  return fences
}

export function fenceFingerprint(raw: string): string {
  return createHash('sha256').update(raw.trim()).digest('hex').slice(0, 12)
}

export interface FenceFailure {
  readonly index: number
  readonly fingerprint: string

  readonly detail: string
}

export function fenceFailures(text: string): FenceFailure[] {
  const failures: FenceFailure[] = []
  for (const fence of extractDshUiFences(text)) {
    const detail = fenceFailureDetail(fence)
    if (detail !== null) failures.push({ index: fence.index, fingerprint: fenceFingerprint(fence.raw), detail })
  }
  return failures
}

function fenceFailureDetail(fence: ExtractedFence): string | null {
  const resolution = resolveFence(fence.raw, { settled: true })
  if (resolution.spec !== null) return null

  if (!fence.closed) return 'error=unterminated_fence\nrequired=closing_fence'
  if (resolution.processed !== null) {
    const dropped = droppedNodeFailure(resolution.processed, resolution.value)
    return dropped?.join('\n')
      ?? ['error=invalid_spec', ...resolution.processed.errors.map(error => `diagnostic=${JSON.stringify(error)}`)].join('\n')
  }
  return 'error=invalid_json\nrepair=failed'
}

export function fenceCorrectionText(failures: readonly FenceFailure[]): string {
  const body = failures
    .map(failure => `fence=${failure.index}\nfingerprint=${failure.fingerprint}\n${failure.detail}`)
    .join('\n\n')
  const marker = failures.map(failure => `${MARKER_PREFIX}${failure.fingerprint}]`).join(' ')
  return `${marker}\n\n[genui-fence-repair]\nstatus=render_failed\nfences=${failures.length}\nnext=resend_corrected_fence_only\nrepeat_rendered_content=false\nreply_language=conversation\n\n${body}\n`
}

export function createFeedbackMessage(text: string, sessionFormatVersion: number): UserMessage {
  const source = sessionFormatVersion >= 4
    ? {
        kind: FEEDBACK_SOURCE_KIND,
        form: 'notice' as const,
        summary: 'genui fence repair requested',
      }
    : {
        kind: 'plugin' as const,
        plugin: FEEDBACK_PLUGIN_NAME,
        form: 'notice' as const,
        summary: 'genui fence repair requested',
      }
  const message = {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source,
  }
  Object.freeze(message.content)
  return Object.freeze(message) as unknown as UserMessage
}

interface SessionFeedback {

  text: string

  validatedThisTurn: boolean

  isSubagent: boolean

  deliveredThisTurn: boolean

  pendingRenders: Set<string>

  correctedSpec: Set<string>

  deliveryRemindedTurns: Set<number>

  correctionsThisTurn: number

  correctionsTurn: number | undefined

  currentTurn: number | undefined

  accountedCorrectionMessageIds: Set<string>
}

export interface FenceFeedbackPlanInput {

  readonly text: string
  readonly turn: number

  readonly correctedSpec: ReadonlySet<string>

  readonly deliveryRemindedTurns?: ReadonlySet<number> | undefined

  readonly validatedThisTurn?: boolean | undefined

  readonly deliveredThisTurn?: boolean | undefined
  readonly aborted: boolean

  readonly correctionsThisTurn?: number | undefined

  readonly correctionsTurn?: number | undefined

  readonly renderUiToolEnabled?: boolean | undefined
}

export interface FenceFeedbackPlan {
  readonly text: string
  readonly fingerprints: readonly string[]
  readonly turn: number

  readonly kind: 'render' | 'delivery'
}

export function planFenceFeedback(input: FenceFeedbackPlanInput): FenceFeedbackPlan | null {
  if (input.aborted) return null
  const used = input.correctionsTurn === input.turn ? (input.correctionsThisTurn ?? 0) : 0
  if (used >= MAX_CORRECTIONS_PER_TURN) return null
  const failures = fenceFailures(input.text).filter(failure => !input.correctedSpec.has(failure.fingerprint))
  if (failures.length > 0) {
    return {
      text: fenceCorrectionText(failures),
      fingerprints: failures.map(failure => failure.fingerprint),
      turn: input.turn,
      kind: 'render',
    }
  }

  if (input.validatedThisTurn !== true || input.deliveredThisTurn === true) return null
  if (input.deliveryRemindedTurns?.has(input.turn) === true) return null
  return {
    text: missingBodyCorrectionText(input.turn, used + 1, input.renderUiToolEnabled ?? true),
    fingerprints: [],
    turn: input.turn,
    kind: 'delivery',
  }
}

export function missingBodyCorrectionText(turn: number, attempt = 1, renderUiToolEnabled = true): string {
  const head = `${MARKER_PREFIX}turn-${turn}]\n\n[genui-fence-repair]\nstatus=nothing_delivered\nfences=0\nnext=emit_fence_in_body\nrepeat_rendered_content=false\nreply_language=conversation\n\n`
  const emphasis = attempt <= 1 ? '' : `（第 ${attempt} 次提醒）`
  const renderUiInstruction = renderUiToolEnabled ? '，或明确调用 render_ui' : ''
  return `${head}本轮尚未产生正式回答，也没有通过支持的通道交付结果${emphasis}。请根据用户当前请求完成正式答复；需要 UI 时，在回答正文输出你最终选定的 dsh-ui 围栏${renderUiInstruction}。可以修改或放弃此前候选；不能完成时，请在正文说明原因。\n`
}

async function* retryReasoningOnlyGenuiStream(
  options: GenerateOptions,
  source: AsyncIterable<StreamChunk>,
  state?: SessionFeedback,
  feedbackEnabled = true,
): AsyncGenerator<StreamChunk> {
  const { EMPTY_RESPONSE_CODE, isAgentLoopRequest } = await import('@deepseek-ai/dsh-llm')
  if (!isAgentLoopRequest(options)) {
    yield* source
    return
  }

  let hasReasoningBlock = false
  let hasOtherBlock = false
  for await (const chunk of source) {
    if (chunk.type === 'block-end') {
      if (chunk.block.type === 'reasoning') hasReasoningBlock = true
      else hasOtherBlock = true
    }
    if (chunk.type === 'finish' && chunk.reason.kind === 'stop' && hasReasoningBlock && !hasOtherBlock) {

      const reminderAvailable = feedbackEnabled
        && state !== undefined
        && state.currentTurn !== undefined
        && state.pendingRenders.size === 0
        && planFenceFeedback({
          text: '',
          turn: state.currentTurn,
          correctedSpec: state.correctedSpec,
          deliveryRemindedTurns: state.deliveryRemindedTurns,
          validatedThisTurn: state.validatedThisTurn,
          deliveredThisTurn: state.deliveredThisTurn,
          aborted: options.signal?.aborted ?? false,
          correctionsThisTurn: state.correctionsThisTurn,
          correctionsTurn: state.correctionsTurn,
        })?.kind === 'delivery'
      if (reminderAvailable) {
        yield chunk
        continue
      }
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            message: 'GenUI turn completed with reasoning only and no deliverable response',
            code: EMPTY_RESPONSE_CODE,
          },
        },
      }
    } else {
      yield chunk
    }
  }
}

function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (typeof block !== 'object' || block === null) return ''
      const record = block as { type?: unknown; text?: unknown }
      return record.type === 'text' && typeof record.text === 'string' ? record.text : ''
    })
    .filter(part => part !== '')
    .join('\n')
}

type RenderResultStatus = 'rendered' | 'invalid'

function renderResultStatus(content: unknown): RenderResultStatus | undefined {
  const lines = textOfContent(content).split(/\r?\n/u)
  if (lines[0]?.trim() !== '[genui-render]') return undefined
  for (const line of lines.slice(1)) {
    if (line === 'status=rendered') return 'rendered'
    if (line === 'status=invalid') return 'invalid'
  }
  return undefined
}

interface ObservedToolResult {
  readonly callId: string
  readonly isError: boolean
  readonly content: unknown
}

function observedToolResult(message: unknown): ObservedToolResult | null {
  if (typeof message !== 'object' || message === null) return null
  const record = message as { toolCallId?: unknown; isError?: unknown; content?: unknown }
  if (typeof record.toolCallId === 'string') {
    return { callId: record.toolCallId, isError: record.isError === true, content: record.content }
  }
  if (!Array.isArray(record.content)) return null
  const block = record.content.find(part => typeof part === 'object' && part !== null
    && (part as { type?: unknown }).type === 'tool-result') as {
      toolCallId?: unknown
      isError?: unknown
      content?: unknown
    } | undefined
  if (typeof block?.toolCallId !== 'string') return null
  return { callId: block.toolCallId, isError: block.isError === true, content: block.content }
}

const DELIVERY_TOOL = 'render_ui'

function deliveredBodyText(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some(block => {
    if (typeof block !== 'object' || block === null) return false
    const record = block as { type?: unknown; text?: unknown }
    return record.type === 'text' && typeof record.text === 'string' && record.text.trim() !== ''
  })
}

interface FeedbackMarkers {
  readonly renderFingerprints: string[]
  readonly deliveryTurns: number[]
}

function feedbackMarkersIn(text: string): FeedbackMarkers {
  const renderFingerprints: string[] = []
  const deliveryTurns: number[] = []
  let cursor = 0
  while (cursor < text.length) {
    const current = text.indexOf(MARKER_PREFIX, cursor)
    const legacy = text.indexOf(LEGACY_MARKER_PREFIX, cursor)
    if (current < 0 && legacy < 0) break
    const useLegacy = legacy >= 0 && (current < 0 || legacy < current)
    const prefix = useLegacy ? LEGACY_MARKER_PREFIX : MARKER_PREFIX
    const index = useLegacy ? legacy : current
    const end = text.indexOf(']', index + prefix.length)
    if (end < 0) break
    const marker = text.slice(index + prefix.length, end)
    const turn = /^turn-(\d+)$/u.exec(marker)
    if (turn !== null) deliveryTurns.push(Number(turn[1]))
    else renderFingerprints.push(marker)
    cursor = end + 1
  }
  return { renderFingerprints, deliveryTurns }
}

function accountReplayedCorrection(state: SessionFeedback, turn: number): void {
  if (state.correctionsTurn !== turn) {
    state.correctionsTurn = turn
    state.correctionsThisTurn = 1
    return
  }
  state.correctionsThisTurn = Math.min(MAX_CORRECTIONS_PER_TURN, state.correctionsThisTurn + 1)
}

function isFeedbackSource(source: { kind?: unknown; plugin?: unknown } | undefined): boolean {
  return source?.kind === FEEDBACK_SOURCE_KIND
    || (source?.kind === 'plugin' && source.plugin === FEEDBACK_PLUGIN_NAME)
}

export function installFenceFeedback(ctx: Context, enabled: boolean, renderUiToolEnabled = true): void {
  const sessions = new Map<string, SessionFeedback>()
  const stateOf = (sessionId: string): SessionFeedback => {
    let state = sessions.get(sessionId)
    if (state === undefined) {
      state = {
        text: '',
        validatedThisTurn: false,
        isSubagent: false,
        deliveredThisTurn: false,
        pendingRenders: new Set(),
        correctedSpec: new Set(),
        deliveryRemindedTurns: new Set(),
        correctionsThisTurn: 0,
        correctionsTurn: undefined,
        currentTurn: undefined,
        accountedCorrectionMessageIds: new Set(),
      }
      sessions.set(sessionId, state)
    }
    return state
  }

  ctx.on('session/disposed', (session): void => {
    sessions.delete(String(session.id))
  })

  const resetTurnState = (state: SessionFeedback, turn: number | undefined): void => {
    state.text = ''
    state.validatedThisTurn = false
    state.deliveredThisTurn = false
    state.pendingRenders.clear()
    state.currentTurn = turn
  }

  const observeEvent = (session: Session, event: SessionEvent): void => {
    const sessionId = String(session.id)
    if (event.type === 'turn/start') {

      const state = stateOf(sessionId)
      state.isSubagent = session.header.parentSession !== undefined

      state.correctedSpec.clear()
      resetTurnState(state, (event.data as { turn?: number }).turn)
      return
    }
    if (event.type === 'assistant/message') {
      const content = (event.data as { message?: { content?: unknown } }).message?.content
      const text = textOfContent(content)
      const state = stateOf(sessionId)
      state.isSubagent = session.header.parentSession !== undefined

      state.text = extractDshUiFences(text).length > 0 ? text : ''

      state.deliveredThisTurn = state.deliveredThisTurn || deliveredBodyText(content)
      return
    }
    if (event.type === 'tool/call') {
      const data = event.data as { name?: unknown; callId?: unknown }
      const state = stateOf(sessionId)
      state.isSubagent = session.header.parentSession !== undefined

      if (data.name === 'validate_dsh_ui') state.validatedThisTurn = true

      if (data.name === DELIVERY_TOOL && typeof data.callId === 'string') {
        state.pendingRenders.add(data.callId)
      }
      return
    }
    if (event.type === 'tool/result') {
      const data = event.data as { message?: unknown; error?: unknown }
      const result = observedToolResult(data.message)
      if (result === null) return
      const state = stateOf(sessionId)
      state.isSubagent = session.header.parentSession !== undefined
      if (!state.pendingRenders.delete(result.callId)) return
      if (data.error === undefined && result.isError !== true && renderResultStatus(result.content) === 'rendered') {
        state.deliveredThisTurn = true
      }
      return
    }
    if (event.type !== 'user/message') return
    const data = event.data as { id?: unknown; content?: unknown; source?: { kind?: unknown; plugin?: unknown } }
    if (isFeedbackSource(data.source)) {
      const markers = feedbackMarkersIn(textOfContent(data.content))
      if (markers.renderFingerprints.length === 0 && markers.deliveryTurns.length === 0) return
      const state = stateOf(sessionId)
      state.isSubagent = session.header.parentSession !== undefined
      for (const fingerprint of markers.renderFingerprints) state.correctedSpec.add(fingerprint)
      for (const turn of markers.deliveryTurns) state.deliveryRemindedTurns.add(turn)
      if (typeof data.id === 'string' && !state.accountedCorrectionMessageIds.has(data.id)) {
        state.accountedCorrectionMessageIds.add(data.id)
        const turn = markers.deliveryTurns[0] ?? state.currentTurn
        if (turn !== undefined) accountReplayedCorrection(state, turn)
      }
      return
    }

    if (data.source?.kind !== 'user') return
    const state = sessions.get(sessionId)
    if (state !== undefined) {
      state.isSubagent = session.header.parentSession !== undefined

      resetTurnState(state, state.currentTurn)
    }
  }

  const restoreHistory = (session: Session): void => {
    if (sessions.has(String(session.id))) return
    for (const event of session.snapshotEvents()) observeEvent(session, event)
  }
  ctx.on('session/event', (session, event) => {

    restoreHistory(session)
    observeEvent(session, event)
  })
  ctx.on('session/created', restoreHistory)
  const restoreSessions = (sessionCtx: Context): void => {
    const store = sessionCtx.reflect.get('sessions') as SessionStore | undefined
    if (store === undefined) return
    for (const session of store.list()) restoreHistory(session)
  }

  restoreSessions(ctx)
  ctx.inject(['sessions'], restoreSessions)

  ctx.on('llm/stream', (options, next) => {
    if (options.sessionId === undefined || options.purpose !== undefined) return next()
    const state = sessions.get(String(options.sessionId))
    if (state?.validatedThisTurn !== true || state.isSubagent) return next()
    return retryReasoningOnlyGenuiStream(options, next(), state, enabled)
  }, { global: true })

  ctx.on('agent/turn-stopping', ({ agent, turn, signal }): void => {
    if (!enabled) return

    if (agent.session.header.parentSession !== undefined) return
    const state = sessions.get(String(agent.session.id))
    if (state === undefined) return
    state.currentTurn = turn

    if (state.pendingRenders.size > 0) return
    const usedThisTurn = state.correctionsTurn === turn ? state.correctionsThisTurn : 0
    const plan = planFenceFeedback({
      text: state.text,
      turn,
      correctedSpec: state.correctedSpec,
      deliveryRemindedTurns: state.deliveryRemindedTurns,
      validatedThisTurn: state.validatedThisTurn,
      deliveredThisTurn: state.deliveredThisTurn,
      aborted: signal.aborted,
      correctionsThisTurn: usedThisTurn,
      correctionsTurn: state.correctionsTurn,
      renderUiToolEnabled,
    })
    if (plan === null) return

    for (const fingerprint of plan.fingerprints) state.correctedSpec.add(fingerprint)
    if (plan.kind === 'delivery') state.deliveryRemindedTurns.add(plan.turn)
    state.correctionsTurn = plan.turn
    state.correctionsThisTurn = usedThisTurn + 1
    try {
      const message = createFeedbackMessage(plan.text, agent.session.header.version)
      state.accountedCorrectionMessageIds.add(message.id)
      agent.steer(message)
    } catch (error) {
      ctx.logger?.warn?.(`dsh-genui: fence feedback steering failed (${error instanceof Error ? error.message : String(error)})`)
    }
  })
}
