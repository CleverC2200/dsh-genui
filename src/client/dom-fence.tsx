import { Fragment, isValidElement, type Key, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { GenuiActionContext, type GenuiActionHandler } from './action-context.ts'
import { withFileLinkContext, type FileLinkAvailability, type FileLinkCordisContext } from './file-link-context.tsx'
import { renderSvgFence } from './svg-fence.tsx'
import { inferSkeleton } from './streaming-shape.ts'
import { flushSync } from 'react-dom'
import { GenuiSkeleton } from './blocks/skeleton.tsx'
import { repairFenceJson, trimToBalancedRoot } from '../shared/fence-repair.ts'
import { describeFenceFailure, FenceDiagnostic, renderResolvedFenceNode, type GenuiFenceContext } from './fence-render.tsx'
import { resolveViewedSessionId } from './session-resolver.ts'
import { validateCanonicalGenuiSpec } from './guard.ts'
import { diagnoseUnknownGenuiFields } from './genui-runtime/diagnostics.ts'
import { normalizeGenuiSpec } from './genui-runtime/normalize.ts'
import { sourceFencesOfAssistant, sourceLanguageAt } from './source-fence.ts'
import { normalizeFenceLanguage } from '../shared/fence-language.ts'

const CODE_BLOCK_SELECTORS = '.md-code-block, .code-block, .code-block-small'

export function codeBlockSurfaces(scope: ParentNode): HTMLElement[] {
  const surfaces = new Set(scope.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTORS))
  for (const content of scope.querySelectorAll<HTMLElement>('[data-code-block-content]')) {
    if (content.parentElement !== null) surfaces.add(content.parentElement)
  }
  return [...surfaces].sort((left, right) => left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
}

function closestCodeBlockSurface(
  element: Element | null,
  owners?: WeakMap<Element, Element | null>,
): Element | null {

  const visited: Element[] = []
  let owner: Element | null = null
  for (let current = element; current !== null; current = current.parentElement) {
    if (owners?.has(current)) {
      owner = owners.get(current) ?? null
      break
    }
    visited.push(current)
    if (current.matches(CODE_BLOCK_SELECTORS)
      || [...current.children].some(child => child.hasAttribute('data-code-block-content'))) {
      owner = current
      break
    }
  }
  for (const current of visited) owners?.set(current, owner)
  return owner
}

const PROCESSED = 'data-genui-rendered'

const STREAMING = '[data-streaming]'

function prefersReducedMotion(): boolean {
return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

const SWAP_MS = 220

export function swapWithTransition(container: HTMLElement, render: () => void): void {
const outgoing = container.firstElementChild
if (prefersReducedMotion() || outgoing === null || typeof outgoing.animate !== 'function') {
  render()
  return
}
const before = container.getBoundingClientRect().height
const ghost = outgoing.cloneNode(true) as HTMLElement
ghost.setAttribute('aria-hidden', 'true')
ghost.style.position = 'absolute'
ghost.style.inset = '0 0 auto 0'
ghost.style.pointerEvents = 'none'
ghost.style.zIndex = '1'
container.style.position = 'relative'
container.append(ghost)

flushSync(render)

const after = container.getBoundingClientRect().height
const incoming = container.firstElementChild as HTMLElement | null
const easing = 'cubic-bezier(0.22, 0.8, 0.24, 1)'

if (Number.isFinite(before) && Number.isFinite(after) && Math.abs(after - before) > 1) {

  container.style.height = `${before}px`
  container.style.overflow = 'hidden'
  void container.offsetHeight
  container.style.transition = `height ${SWAP_MS}ms ${easing}`
  container.style.height = `${after}px`
}

ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SWAP_MS, easing: 'ease-out', fill: 'forwards' })
incoming?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SWAP_MS, easing: 'ease-out', fill: 'both' })

const done = (): void => {
  ghost.remove()
  container.style.removeProperty('height')
  container.style.removeProperty('overflow')
  container.style.removeProperty('transition')
  container.style.removeProperty('position')
}
if (typeof ghost.animate === 'function') {
  Promise.all([
    ghost.getAnimations().map(a => a.finished).reduce<Promise<unknown>>((all, p) => all.then(() => p), Promise.resolve()),
  ]).then(done).catch(done)
  setTimeout(done, SWAP_MS + 120)
} else {
  done()
}
}

const CONTAINER_CLASS = 'genui-dom-fence'

const DIAGNOSTIC_CLASS = 'genui-dom-fence-diagnostic'

const SURFACE_EXCLUDES = `.${CONTAINER_CLASS}, .${DIAGNOSTIC_CLASS}, [data-genui-svg-fence], [data-genui-surface], [data-genui-sidechat-root]`

const TAG_TEXT_EXCLUDES = `.${CONTAINER_CLASS}, .${DIAGNOSTIC_CLASS}, [data-genui-surface], [data-genui-sidechat-root], [data-chat-group-part="reasoning"], [data-tool], [data-sidebar-chat], [data-sidebar-right-session], [data-sidebar-right-panel], [data-panel-conversation], [data-plugin-panel]`

const IGNORED_MUTATION_SCOPE = `${SURFACE_EXCLUDES}, [data-composer-seat], [data-composer-input]`

const FENCE_ATTRIBUTES = ['data-streaming', 'class', 'data-code-block-content', 'data-code-block-banner',
  'data-chat-anchor-key', 'data-chat-flow-key', 'data-chat-flow-kind', 'data-chat-node-key',
  'data-chat-group-part', 'data-tool', 'data-sidebar-chat', 'data-sidebar-right-session',
  'data-sidebar-right-panel', 'data-panel-conversation', 'data-plugin-panel', 'data-genui-svg-fence', 'data-genui-surface']

const SWEEP_MS = 1000

const SWEEP_BUDGET_MS = 8

const ROTATION_ROWS = 24
const ROTATION_TICKS = 5

const DIRTY_TARGET_LIMIT = 512

const CODE_CONTEXT = `pre, ${CODE_BLOCK_SELECTORS}, [data-code-block-content]`
const NO_FILE_LINK_AVAILABILITY: FileLinkAvailability = {
  subscribe: () => () => {},
  getSnapshot: () => false,
}

const SURFACE_HOPS = 4

const BLOCK_CONTENT_SELECTOR = 'p, ul, ol, dl, table, h1, h2, h3, h4, h5, h6, blockquote, hr, img, figure'

function isPlausibleFenceSurface(candidate: Element): boolean {
  const pres = candidate.querySelectorAll('pre')
  if (pres.length > 1) return false
  const pre = pres[0] ?? null
  for (const el of candidate.querySelectorAll(BLOCK_CONTENT_SELECTOR)) {
    if (pre !== null && pre.contains(el)) continue
    return false
  }
  return true
}

function isPanelRoot(node: ReactNode): boolean {
  return isValidElement(node) && node.type === Fragment
}

function looksLikeGenuiInProgress(raw: string): boolean {
  const text = raw.trimStart()
  if (text.length < 8 || !text.startsWith('{')) return false
  return /"(items|type|title|panel)"\s*:/.test(text)
}

interface Mount {
  root: Root
  container: HTMLElement
  block: HTMLElement
  lastRaw: string
  lastSettled: boolean
  language: 'dsh-ui' | 'svg'
  lastNode: ReactNode

  skeleton: boolean
}

function isTextNode(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE
}

function tagTextBodyOf(block: Element): string | null {
  if (block.tagName !== 'SPAN' || block.childElementCount !== 0) return null
  const text = block.textContent?.trim() ?? ''
  const opening = '<dsh-ui>'
  const closing = '</dsh-ui>'
  if (!text.startsWith(opening) || !text.endsWith(closing)) return null
  const flowKind = block.closest('[data-chat-flow-kind]')?.getAttribute('data-chat-flow-kind')
  if (flowKind !== undefined && flowKind !== null && flowKind !== 'assistant-step') return null
  return text.slice(opening.length, -closing.length).trim()
}

function infostringOf(block: Element): 'dsh-ui' | 'svg' | null {
  const pre = block.querySelector('pre')
  for (const el of block.querySelectorAll('*')) {
    if (el.childElementCount !== 0) continue
    const lang = normalizeFenceLanguage(el.textContent?.trim() ?? '')
    if (lang !== 'dsh-ui' && lang !== 'svg') continue
    if (pre !== null && pre.contains(el)) continue

    const owner = closestCodeBlockSurface(el)
    if (owner !== null && owner !== block) continue
    return lang
  }
  return null
}

const KNOWN_LANGUAGE_LABELS = new Set([

  'dsh-ui', 'svg',

  'json', 'json5', 'yaml', 'yml', 'toml', 'ini', 'xml', 'html', 'css', 'scss', 'sass', 'less',
  'markdown', 'md', 'text', 'txt', 'plain', 'plaintext', 'log', 'console', 'diff', 'patch',

  'js', 'jsx', 'javascript', 'ts', 'tsx', 'typescript', 'python', 'py', 'bash', 'sh', 'shell', 'zsh',
  'sql', 'graphql', 'gql', 'rust', 'go', 'golang', 'java', 'kotlin', 'kt', 'swift', 'scala', 'dart',
  'c', 'h', 'cpp', 'c++', 'cxx', 'cs', 'csharp', 'php', 'ruby', 'rb', 'perl', 'lua', 'r', 'matlab',
  'haskell', 'hs', 'elixir', 'ex', 'erlang', 'clojure', 'clj', 'groovy', 'objc', 'objective-c',
  'dockerfile', 'docker', 'makefile', 'make', 'cmake', 'protobuf', 'proto',
])

function domLanguageOf(block: Element): string | null {
  const label = normalizeFenceLanguage(labelTextOf(block))

  return label.toLowerCase().startsWith('dsh-ui') || KNOWN_LANGUAGE_LABELS.has(label.toLowerCase()) ? label : null
}

function resolveFenceLanguage(
  block: Element,
  sourceLanguage: (block: Element) => string | null | undefined,
): string | null | undefined {
  const domLanguage = tagTextBodyOf(block) !== null ? 'dsh-ui' : domLanguageOf(block)
  const language = domLanguage ?? sourceLanguage(block)
  return typeof language === 'string' ? normalizeFenceLanguage(language) : language
}

function labelTextOf(block: Element): string {
  const pre = block.querySelector('pre')
  for (const el of block.querySelectorAll('*')) {
    if (el.childElementCount !== 0) continue
    if (pre !== null && pre.contains(el)) continue
    return el.textContent?.trim() ?? ''
  }
  return ''
}

function isGenericGenuiFence(block: Element, raw: string): boolean {
  const row = block.closest<HTMLElement>(ASSISTANT_FLOW_ROW)
  if (row === null || row.dataset.chatGroupPart === 'reasoning') return false

  if (domLanguageOf(block) !== null || !block.querySelector('[data-code-block-banner]')) return false
  const repaired = repairFenceJson(raw)
  const candidate = repaired === null ? raw : repaired.text
  let value: unknown
  try {
    value = JSON.parse(candidate)
  } catch {

    const trimmed = trimToBalancedRoot(candidate)
    if (trimmed === null) return false
    try {
      value = JSON.parse(trimmed)
    } catch {
      return false
    }
  }
  if (!validateCanonicalGenuiSpec(value).ok || diagnoseUnknownGenuiFields(value).length > 0) return false
  return JSON.stringify(normalizeGenuiSpec(value).value) === JSON.stringify(value)
}

function rawOf(block: Element): string {
  const tagTextBody = tagTextBodyOf(block)
  if (tagTextBody !== null) return tagTextBody
  const pre = block.querySelector('pre')
  if (pre === null) return ''
  let text = ''
  for (const node of pre.childNodes) {
    if (isTextNode(node)) text += node.textContent ?? ''
    else text += node.textContent ?? ''
  }
  return text
}

function isSettled(block: Element): boolean {
  return block.closest(STREAMING) === null
}

function surfaceOf(pre: HTMLElement, scope: ParentNode = document): HTMLElement | null {
  let el: HTMLElement | null = pre.parentElement
  for (let hops = 0; el !== null && el !== scope && hops < SURFACE_HOPS; hops += 1, el = el.parentElement) {
    if (infostringOf(el) === null) continue
    if (!isPlausibleFenceSurface(el)) return null
    return el
  }
  return null
}

function implausibleLabeledAncestorOf(pre: HTMLElement, scope: ParentNode = document): HTMLElement | null {
  let el: HTMLElement | null = pre.parentElement
  for (let hops = 0; el !== null && el !== scope && hops < SURFACE_HOPS; hops += 1, el = el.parentElement) {
    if (infostringOf(el) === 'dsh-ui' && !isPlausibleFenceSurface(el)) return el
  }
  return null
}

type SurfaceRejection = 'nested' | 'plugin-owned' | 'implausible' | null

function surfaceRejection(candidate: Element, owners?: WeakMap<Element, Element | null>): SurfaceRejection {

  if (closestCodeBlockSurface(candidate.parentElement, owners) !== null) return 'nested'
  if (candidate.closest(SURFACE_EXCLUDES) !== null) return 'plugin-owned'

  if (!isPlausibleFenceSurface(candidate)) return 'implausible'
  return null
}

function isTakeoverTagText(span: Element, owners?: WeakMap<Element, Element | null>): boolean {
  if (tagTextBodyOf(span) === null) return false
  if (closestCodeBlockSurface(span, owners) !== null) return false
  return span.closest(TAG_TEXT_EXCLUDES) === null
}

function outermostSurfaceOf(node: Element | null): HTMLElement | null {
  let candidate = closestCodeBlockSurface(node)
  while (candidate !== null) {
    const parent = closestCodeBlockSurface(candidate.parentElement)
    if (parent === null) return candidate as HTMLElement
    candidate = parent
  }
  return null
}

function findFenceCandidates(scope: ParentNode = document, options: { includeScope?: boolean } = {}): HTMLElement[] {
  const self = options.includeScope === true && scope instanceof Element ? scope : null
  const surfaceOwners = new WeakMap<Element, Element | null>()
  const seen = new Set<HTMLElement>()
  const out: HTMLElement[] = []
  const surfaces = codeBlockSurfaces(scope)
  if (self !== null && (self.matches(CODE_BLOCK_SELECTORS)
    || [...self.children].some(child => child.hasAttribute('data-code-block-content')))) {
    surfaces.unshift(self as HTMLElement)
  }
  for (const el of surfaces) {
    if (seen.has(el)) continue
    const rejection = surfaceRejection(el, surfaceOwners)
    if (rejection !== null) {
      if (rejection === 'implausible' && infostringOf(el) === 'dsh-ui') warnImplausibleSurface(el)
      continue
    }
    out.push(el)
    seen.add(el)
  }
  const pres = [...scope.querySelectorAll<HTMLElement>('pre')]
  if (self !== null && self.tagName === 'PRE') pres.unshift(self as HTMLElement)

  const surfaceScope: ParentNode = self === null ? scope : self.parentElement ?? self
  for (const pre of pres) {

    if (closestCodeBlockSurface(pre, surfaceOwners) !== null
      || pre.closest(SURFACE_EXCLUDES) !== null) continue
    const surface = surfaceOf(pre, surfaceScope)
    if (surface === null) {

      const rejected = implausibleLabeledAncestorOf(pre, surfaceScope)
      if (rejected !== null) warnImplausibleSurface(rejected)
      continue
    }
    if (seen.has(surface)) continue

    if (!driftWarned) {
      driftWarned = true
      console.warn('[dsh-genui] 围栏表面类名未被已知选择器命中（宿主 DOM 漂移），已按 label+pre 结构识别 dsh-ui 围栏')
    }
    out.push(surface)
    seen.add(surface)
  }
  const spans = [...scope.querySelectorAll<HTMLElement>('span')]
  if (self !== null && self.tagName === 'SPAN') spans.unshift(self as HTMLElement)
  for (const span of spans) {

    if (!isTakeoverTagText(span, surfaceOwners)) continue
    out.push(span)
  }
  return out.sort((left, right) => left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
}

let driftWarned = false

let plausibilityWarned = new WeakSet<Element>()
function warnImplausibleSurface(surface: Element): void {
  if (plausibilityWarned.has(surface)) return
  plausibilityWarned.add(surface)
  const pres = surface.querySelectorAll('pre')
  const tags = [...surface.querySelectorAll(BLOCK_CONTENT_SELECTOR)]
    .filter(el => !el.closest('pre')).map(el => el.tagName.toLowerCase())
  console.warn(`[dsh-genui] 跳过带 dsh-ui 标签但疑似消息容器的节点：pre=${pres.length}, outside-code=${[...new Set(tags)].join(',') || 'none'}；保留原文，防止隐藏整条消息（issue #19）`)
}

let domRootFactory: (container: HTMLElement) => Root = createRoot

export function setDomRootFactory(factory: (container: HTMLElement) => Root): void {
  domRootFactory = factory
}

const FLOW_ROW = '[data-chat-flow-key], [data-chat-flow-kind]'
const ASSISTANT_FLOW_ROW = '[data-chat-flow-kind="assistant-step"]'
function rowOf(block: Element): Element {
  return block.closest('[data-chat-anchor-key]') ?? block.closest(FLOW_ROW) ?? block
}

function fenceIndexOf(row: Element, block: Element, sourceLanguage: (block: Element) => string | null | undefined, documentIndex: (block: Element) => number): number {
  if (row.getAttribute('data-chat-anchor-key') === null) return documentIndex(block)
  if (!row.matches(ASSISTANT_FLOW_ROW)) {
    let fallbackIndex = 0
    for (const candidate of findFenceCandidates(row)) {
      if (candidate.closest(STREAMING) !== null) continue
      const language = resolveFenceLanguage(candidate, sourceLanguage)
      if (language !== 'dsh-ui' && !(language === undefined && isGenericGenuiFence(candidate, rawOf(candidate)))) continue
      fallbackIndex += 1
      if (candidate === block) return fallbackIndex
    }
    return fallbackIndex + 1
  }
  let index = 0
  for (const candidate of findFenceCandidates(row)) {
    if (candidate.closest(STREAMING) !== null) continue
    if (candidate.closest(ASSISTANT_FLOW_ROW) !== row) continue
    if (candidate.closest('[data-chat-group-part="reasoning"]') !== null) continue
    const language = resolveFenceLanguage(candidate, sourceLanguage)
    if (language !== 'dsh-ui' && !(language === undefined && isGenericGenuiFence(candidate, rawOf(candidate)))) continue
    index += 1
    if (candidate === block) return index
  }
  return index + 1
}

function hostFenceBlocksOf(row: Element): HTMLElement[] {
  return codeBlockSurfaces(row).filter(candidate => {
    if (closestCodeBlockSurface(candidate.parentElement) !== null) return false
    if (candidate.closest(`.${CONTAINER_CLASS}, .${DIAGNOSTIC_CLASS}, [data-genui], [data-genui-svg-fence]`) !== null) return false
    if (candidate.closest('[data-genui-sidechat-root], [data-chat-group-part="reasoning"], [data-tool], [data-sidebar-chat], [data-sidebar-right-session], [data-sidebar-right-panel], [data-panel-conversation], [data-plugin-panel]') !== null) return false
    if (candidate.closest(ASSISTANT_FLOW_ROW) !== row) return false
    return isPlausibleFenceSurface(candidate) && candidate.querySelector('pre') !== null
  })
}

export function sourceLanguageOf(ctx: Context, block: Element): string | null | undefined {
  const row = block.closest<HTMLElement>(`${ASSISTANT_FLOW_ROW}[data-chat-node-key]`)
  if (row === null || row.dataset.chatGroupPart === 'reasoning') return undefined
  const nodeKey = row.dataset.chatNodeKey
  const index = hostFenceIndexOf(row, block)
  const sessionId = sessionIdOfForSource(ctx)
  if (!nodeKey || index < 0 || sessionId === undefined) return undefined
  const chat = chatSourceOf(ctx, sessionId)?.getSnapshot()
  return sourceLanguageAt(chat, nodeKey, index)
}

function createSourceLanguageResolver(ctx: Context): {
  beginSweep: () => void
  get: (block: Element) => string | null | undefined
  isSessionUnavailable: () => boolean
} {
  const stableLanguages = new WeakMap<Element, { sessionId: SessionId; nodeKey: string; language: string | null }>()
  let sweepLanguages = new Map<Element, string | null | undefined>()
  let parsedNodes = new Map<string, ReturnType<typeof sourceFencesOfAssistant>>()
  let sessionId: SessionId | undefined
  let chat: ChatSnapshot | undefined
  let chatRead = false
  let sessionUnavailable = false

  return {
    beginSweep() {
      sweepLanguages = new Map()
      parsedNodes = new Map()
      sessionId = undefined
      chat = undefined
      chatRead = false
      sessionUnavailable = false
    },
    isSessionUnavailable() {
      return sessionUnavailable
    },
    get(block) {
      if (sweepLanguages.has(block)) return sweepLanguages.get(block)
      const row = block.closest<HTMLElement>(`${ASSISTANT_FLOW_ROW}[data-chat-node-key]`)
      if (row === null || row.dataset.chatGroupPart === 'reasoning') return undefined
      const nodeKey = row.dataset.chatNodeKey
      const sourceSession = sourceSessionOf(ctx)
      if (!sourceSession.available) {
        sessionUnavailable = true
        sweepLanguages.set(block, undefined)
        return undefined
      }
      const activeSessionId = sourceSession.sessionId
      if (!nodeKey || activeSessionId === undefined) return undefined

      const stable = stableLanguages.get(block)
      if (stable?.sessionId === activeSessionId && stable.nodeKey === nodeKey) {
        sweepLanguages.set(block, stable.language)
        return stable.language
      }
      if (!chatRead || sessionId !== activeSessionId) {
        sessionId = activeSessionId
        chat = chatSourceOf(ctx, activeSessionId)?.getSnapshot()
        chatRead = true
      }
      const node = chat?.nodes.get(nodeKey)
      if (node?.kind !== 'assistant-step') return undefined
      const assistantNode = node as ChatNode<'assistant-step'>
      let fences = parsedNodes.get(nodeKey)
      if (fences === undefined) {
        fences = sourceFencesOfAssistant(assistantNode.data.blocks)
        parsedNodes.set(nodeKey, fences)
      }
      const index = hostFenceIndexOf(row, block)
      if (index < 0) return undefined
      const fence = fences[index]
      const language = fence?.lang
      if (fence !== undefined && fence.openingLineComplete) {
        stableLanguages.set(block, { sessionId: activeSessionId, nodeKey, language: fence.lang })
      }
      sweepLanguages.set(block, language)
      return language
    },
  }
}

export function hostFenceIndexOf(row: Element, block: Element): number {
  return hostFenceBlocksOf(row).indexOf(block as HTMLElement)
}

function sourceSessionOf(ctx: Context): { available: true; sessionId: SessionId | undefined } | { available: false } {
  try {
    return {
      available: true,
      sessionId: resolveViewedSessionId(
        ctx.sessions.list.getSnapshot(),
        sessionId => ctx.sessions.retainInfo(sessionId),
      ),
    }
  } catch {
    return { available: false }
  }
}

function sessionIdOfForSource(ctx: Context): SessionId | undefined {
  const sourceSession = sourceSessionOf(ctx)
  return sourceSession.available ? sourceSession.sessionId : undefined
}

function uiConversationOf(ctx: Context): Context['uiConversation'] | undefined {
  if (typeof ctx.get !== 'function') return undefined
  return ctx.get('uiConversation', false) as Context['uiConversation'] | undefined
}

function chatSourceOf(ctx: Context, sessionId: SessionId): { getSnapshot: () => ChatSnapshot | undefined; subscribe: (listener: () => void) => (() => void) | undefined } | undefined {
  try {
    const source = uiConversationOf(ctx)?.binding(sessionId).target('chat')
    if (source === undefined) return undefined
    return {
      getSnapshot: () => {
        try {
          return source.getSnapshot()
        } catch {
          return undefined
        }
      },
      subscribe: listener => {
        try {
          return source.subscribe(listener)
        } catch {
          return undefined
        }
      },
    }
  } catch {
    return undefined
  }
}

function anchorSeqOf(row: Element, documentRowIndex: (row: Element) => number): number {
  const key = row.getAttribute('data-chat-anchor-key') ?? ''
  const turnStep = /assistant-step(\d+):(\d+)$/.exec(key)
  if (turnStep !== null) {
    const turn = Number(turnStep[1])
    const step = Number(turnStep[2])
    if (Number.isFinite(turn) && Number.isFinite(step)) return turn * 1000 + step
  }
  return documentRowIndex(row)
}

export function installDomFenceRenderer(
  ctx: Context,
  sendAction: (sessionId: SessionId, action: string, payload: Record<string, unknown>) => void,
  fileLinkAvailability: FileLinkAvailability = NO_FILE_LINK_AVAILABILITY,
): () => void {
  if (typeof document === 'undefined') return () => {}
  driftWarned = false
  plausibilityWarned = new WeakSet<Element>()
  const mounts = new Map<HTMLElement, Mount>()

  const diagnostics = new Map<HTMLElement, { container: HTMLElement; root: Root; raw: string }>()

  const containerBlocks = new WeakMap<Node, HTMLElement>()

  const dirtyMounts = new Set<HTMLElement>()
  const dirtyDiagnostics = new Set<HTMLElement>()
  let fullMaintenance = false
  let disposed = false
  let rafId: number | null = null
  let activeChatSession: SessionId | undefined
  let unsubscribeChat: (() => void) | undefined
  const sourceLanguages = createSourceLanguageResolver(ctx)

  let documentFences: Map<Element, number> | undefined
  let documentOrdinalsDirty = true
  let settledFenceCount = 0
  let documentRows: Map<Element, number> | undefined

  function invalidateDocumentTopology(): void {
    documentFences = undefined
    documentOrdinalsDirty = true
    documentRows = undefined
  }

  function documentFenceIndex(block: Element): number {
    documentFences ??= new Map(findFenceCandidates().map(candidate => [candidate, 0]))
    if (documentOrdinalsDirty) {
      settledFenceCount = 0
      for (const candidate of documentFences.keys()) {
        const language = isSettled(candidate) ? resolveFenceLanguage(candidate, sourceLanguages.get) : null
        const eligible = language === 'dsh-ui'
          || (language === undefined && isGenericGenuiFence(candidate, rawOf(candidate)))
        documentFences.set(candidate, eligible ? ++settledFenceCount : 0)
      }
      documentOrdinalsDirty = false
    }
    return documentFences.get(block) || settledFenceCount + 1
  }

  function documentRowIndex(row: Element): number {
    documentRows ??= new Map(Array.from(document.querySelectorAll(`[data-chat-anchor-key], ${FLOW_ROW}`),
      (element, index) => [element, index]))
    return documentRows.get(row) ?? 0
  }

  function invalidateDocumentMutation(record: MutationRecord): void {
    if (documentFences === undefined && documentRows === undefined) return
    const element = record.target instanceof Element ? record.target : record.target.parentElement
    if (element === null) return
    if (record.type === 'attributes') {
      if (record.attributeName === 'data-streaming') documentOrdinalsDirty = true
      else if (record.attributeName !== 'class' || documentFences?.has(element)
        || element.matches(CODE_BLOCK_SELECTORS)
        || (element.closest('pre') === null && element.querySelector('pre') !== null)) {
        invalidateDocumentTopology()
      }
      return
    }
    if (record.type === 'childList') {
      const topology = `${CODE_BLOCK_SELECTORS}, [data-code-block-content], pre, [data-chat-anchor-key], ${FLOW_ROW}`
      for (const node of [...record.addedNodes, ...record.removedNodes]) {
        if (!(node instanceof Element)) continue

        if (documentFences?.has(node) || [...node.querySelectorAll('pre, span')].some(child => {
          for (let current: Element | null = child; current !== null && current !== node; current = current.parentElement) {
            if (documentFences?.has(current)) return true
          }
          return false
        })) {
          invalidateDocumentTopology()
          return
        }
        if (node.closest(IGNORED_MUTATION_SCOPE) !== null) continue
        if (node.matches(topology) || node.querySelector(topology) !== null
          || isTakeoverTagText(node) || [...node.querySelectorAll('span')].some(span => isTakeoverTagText(span))
          || (node.closest('pre') === null && (normalizeFenceLanguage(node.textContent?.trim() ?? '') === 'dsh-ui'
            || (node.childElementCount > 0 && infostringOf(node) === 'dsh-ui')))) {
          invalidateDocumentTopology()
          return
        }
      }
    }
    const pre = element.closest<HTMLElement>('pre')
    if (pre !== null) {
      const block = outermostSurfaceOf(pre) ?? surfaceOf(pre)

      if (block !== null && resolveFenceLanguage(block, sourceLanguages.get) === undefined) documentOrdinalsDirty = true
      return
    }
    if (element.tagName === 'SPAN') {
      const known = documentFences?.has(element) === true
      const eligible = isTakeoverTagText(element)
      if (known !== eligible) invalidateDocumentTopology()
      if (known || eligible) return
    }

    if (element.childElementCount === 0 && normalizeFenceLanguage(element.textContent?.trim() ?? '') === 'dsh-ui') {
      invalidateDocumentTopology()
      return
    }

    for (let current: Element | null = element; current !== null; current = current.parentElement) {
      if (documentFences?.has(current)) {
        invalidateDocumentTopology()
        return
      }
    }
  }

  const dirtyTargets = new Map<Node, boolean>()

  const pendingCandidates = new Set<HTMLElement>()

  const queuedCandidates = new WeakSet<Element>()

  const awaitingSource = new Set<HTMLElement>()

  let sourceChanged = false

  const deferredScans = new WeakSet<Node>()

  let rotationNext = 0

  function wrapFenceNode(node: ReactNode, context: GenuiFenceContext, handler: GenuiActionHandler, streaming: boolean): ReactNode {
    const actionTree = <GenuiActionContext.Provider value={handler}>{node}</GenuiActionContext.Provider>
    return withFileLinkContext(
      ctx as unknown as FileLinkCordisContext,
      fileLinkAvailability,
      context.sessionId,
      streaming,
      actionTree,
    )
  }

  const sessionIdOf = (): SessionId | undefined => sessionIdOfForSource(ctx)
  let lastAvailableSessionId = sessionIdOf()

  function sessionIdForRender(preserveWhenUnavailable: boolean): SessionId | undefined {
    const sourceSession = sourceSessionOf(ctx)
    if (!sourceSession.available) return preserveWhenUnavailable ? lastAvailableSessionId : undefined
    lastAvailableSessionId = sourceSession.sessionId
    return sourceSession.sessionId
  }

  function syncChatSubscription(sessionId: SessionId | undefined): void {
    if (sessionId !== activeChatSession) {
      unsubscribeChat?.()
      unsubscribeChat = undefined
      activeChatSession = sessionId
      fullMaintenance = true
      invalidateDocumentTopology()
    }
    if (sessionId !== undefined && unsubscribeChat === undefined) {
      unsubscribeChat = chatSourceOf(ctx, sessionId)?.subscribe(() => {

        sourceChanged = true
        documentOrdinalsDirty = true
        schedule()
      })
    }
  }

  function contextOf(row: Element, block: Element, settled: boolean, preserveSessionIdentity = false): { key: Key; context: GenuiFenceContext } {
    if (settled && row.getAttribute('data-chat-anchor-key') === null) {

      warnOnce(block, 'no [data-chat-anchor-key] ancestor for a dsh-ui fence (host render path without row anchor — e.g. Safari); using fallback identity dom:unknown:N')
    }
    const fenceIndex = fenceIndexOf(row, block, sourceLanguages.get, documentFenceIndex)
    const anchorKey = row.getAttribute('data-chat-anchor-key') ?? 'unknown'
    const key = `dom:${anchorKey}:${fenceIndex}` as Key
    const sessionId = sessionIdForRender(preserveSessionIdentity)
    const context: GenuiFenceContext = {
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(settled ? { source: { id: key as string, order: [anchorSeqOf(row, documentRowIndex), 0, fenceIndex] as const } } : {}),
    }
    return { key, context }
  }

  function unmountBlock(block: HTMLElement): void {
    const mount = mounts.get(block)
    if (mount === undefined) return
    mounts.delete(block)
    dirtyMounts.delete(block)
    containerBlocks.delete(mount.container)
    mount.root.unmount()
    mount.container.remove()
    block.style.display = ''
    block.removeAttribute(PROCESSED)
    clearDiagnostic(block)
  }

  function clearDiagnostic(block: HTMLElement): void {
    const diagnostic = diagnostics.get(block)
    if (diagnostic === undefined) return
    diagnostics.delete(block)
    dirtyDiagnostics.delete(block)
    containerBlocks.delete(diagnostic.container)
    try {
      diagnostic.root.unmount()
    } catch {

    }
    diagnostic.container.remove()
  }

  function renderDiagnostic(block: HTMLElement, raw: string): void {

    if (describeFenceFailure(raw, { settled: true }) === null) {
      clearDiagnostic(block)
      return
    }
    const existing = diagnostics.get(block)
    if (existing !== undefined) {

      if (existing.container.parentElement !== block.parentElement || existing.container.nextElementSibling !== block) {
        block.before(existing.container)
      }
      if (existing.raw === raw) return
      clearDiagnostic(block)
    }
    const container = document.createElement('div')
    container.className = DIAGNOSTIC_CLASS
    block.before(container)
    let root: Root
    try {
      root = domRootFactory(container)
      root.render(<FenceDiagnostic raw={raw} settled />)
    } catch (error) {
      container.remove()
      warnOnce(block, `failed to mount the dsh-ui diagnostic (${error instanceof Error ? error.message : String(error)}); keeping the stock code block visible`)
      return
    }
    diagnostics.set(block, { container, root, raw })
    containerBlocks.set(container, block)
  }

  function rebuildWipedDiagnostic(block: HTMLElement, raw: string): void {
    const existing = diagnostics.get(block)
    if (existing === undefined || existing.container.childElementCount > 0) return
    clearDiagnostic(block)
    renderDiagnostic(block, raw)
  }

  const warned = new WeakSet<Element>()
  function warnOnce(block: Element, message: string): void {
    if (warned.has(block)) return
    warned.add(block)
    console.warn(`[dsh-genui] ${message}`)
  }

  function sendActionForBlock(block: Element, action: string, payload: Record<string, unknown>): void {
    const sessionId = sessionIdOf()
    if (sessionId === undefined) {
      warnOnce(block, `cannot resolve the viewed session; action "${action}" was not sent`)
      return
    }
    sendAction(sessionId, action, payload)
  }

  function renderBlock(block: HTMLElement): void {
    if (block.hasAttribute(PROCESSED)) return
    const row = rowOf(block)
    const settled = isSettled(block)
    const language = resolveFenceLanguage(block, candidate => sourceLanguages.get(candidate))
    const raw = rawOf(block)

    const genericGenui = language === undefined && settled && isGenericGenuiFence(block, raw)
    if (language !== 'dsh-ui' && language !== 'svg' && !genericGenui) return
    if (!settled && language !== 'dsh-ui') return
    if (raw.trim() === '') {
      if (settled) warnOnce(block, `settled ${language ?? 'dsh-ui'} fence has an empty body; keeping the code block`)
      return
    }
    const { key, context } = contextOf(row, block, settled)
    const acceptedLanguage = language === 'svg' ? 'svg' : 'dsh-ui'
    const node: ReactNode | null = acceptedLanguage === 'svg' ? renderSvgFence(raw, key) : renderResolvedFenceNode(raw, key, context)

    let payload = node
    if (payload === null) {
      if (settled || !looksLikeGenuiInProgress(raw)) {
        if (settled) {
          renderDiagnostic(block, raw)
          warnOnce(block, 'settled dsh-ui fence body does not parse; keeping the code block')
        }
        return
      }

      const next = inferSkeleton(raw)
      if (next.shape === 'generic') return
      payload = <GenuiSkeleton {...next} />
    }
    clearDiagnostic(block)

    const container = document.createElement('div')
    container.className = CONTAINER_CLASS
    block.after(container)
    let root: Root
    try {
      root = domRootFactory(container)
    } catch (error) {
      container.remove()
      warnOnce(block, `failed to create a React root for a dsh-ui fence (${error instanceof Error ? error.message : String(error)}); keeping the stock code block visible`)
      return
    }
    try {
      const handler: GenuiActionHandler = (action, payload) => sendActionForBlock(block, action, payload)
      root.render(wrapFenceNode(payload, context, handler, !settled))
    } catch (error) {
      try {
        root.unmount()
      } catch {

      }
      container.remove()
      warnOnce(block, `failed to mount a dsh-ui fence (${error instanceof Error ? error.message : String(error)}); keeping the stock code block visible`)
      return
    }
    block.style.display = 'none'
    block.setAttribute(PROCESSED, '')
    mounts.set(block, { root, container, block, lastRaw: raw, lastSettled: settled, language: acceptedLanguage, lastNode: payload, skeleton: node === null })
    containerBlocks.set(container, block)
  }

  function enqueueCandidate(block: Element | null | undefined): void {
    if (block === null || block === undefined) return
    if (block.hasAttribute(PROCESSED) || queuedCandidates.has(block)) return
    queuedCandidates.add(block)
    pendingCandidates.add(block as HTMLElement)
  }

  function enqueueMutationTarget(target: Node, structural: boolean, deadline: number): void {
    const element = target instanceof Element ? target : target.parentElement
    if (element === null) return

    if (element.closest(SURFACE_EXCLUDES) !== null) return
    if (element.tagName === 'SPAN' && isTakeoverTagText(element)) enqueueCandidate(element)

    const context = element.closest(CODE_CONTEXT)
    if (context !== null) {
      const surface = outermostSurfaceOf(context)
      if (surface !== null && surfaceRejection(surface) === null) enqueueCandidate(surface)
      const pre = element.closest<HTMLElement>('pre')
      if (pre !== null) {
        const labeled = surfaceOf(pre)
        if (labeled !== null && surfaceRejection(labeled) === null) enqueueCandidate(labeled)
      }
    }
    if (!structural) return

    if (performance.now() >= deadline) {

      deferredScans.add(target)
      dirtyTargets.set(target, structural)
      return
    }
    const candidates = findFenceCandidates(element, { includeScope: true })

    for (let index = candidates.length - 1; index >= 0; index -= 1) enqueueCandidate(candidates[index])
  }

  function resolveDirtyTargets(deadline: number): void {
    for (const [target, structural] of dirtyTargets) {
      if (performance.now() >= deadline) return
      dirtyTargets.delete(target)

      if (!target.isConnected) continue

      const force = deferredScans.delete(target)
      enqueueMutationTarget(target, structural, force ? Number.POSITIVE_INFINITY : deadline)
    }
  }

  function drainCandidates(deadline: number): void {
    for (const block of pendingCandidates) {
      if (performance.now() >= deadline) return
      pendingCandidates.delete(block)

      queuedCandidates.delete(block)
      if (!block.isConnected) continue

      const eligible = tagTextBodyOf(block) !== null
        ? isTakeoverTagText(block)
        : surfaceRejection(block) === null
      if (!eligible) {
        awaitingSource.delete(block)
        continue
      }
      renderBlock(block)
      noteSourceDecision(block)
    }
  }

  function noteSourceDecision(block: HTMLElement): void {
    if (block.hasAttribute(PROCESSED)
        || tagTextBodyOf(block) !== null
        || domLanguageOf(block) !== null
        || sourceLanguages.get(block) !== undefined) {
      awaitingSource.delete(block)
      return
    }
    if (awaitingSource.size >= DIRTY_TARGET_LIMIT) return
    awaitingSource.add(block)
  }

  function requeueAwaitingSource(): void {
    for (const block of Array.from(awaitingSource)) {
      awaitingSource.delete(block)
      if (!block.isConnected || block.hasAttribute(PROCESSED)) continue
      enqueueCandidate(block)
    }
  }

  function keepDraining(): void {
    if (pendingCandidates.size > 0 || dirtyTargets.size > 0) schedule()
  }

  function markDirty(node: Node, structural: boolean): void {
    if (disposed) return
    const element = node instanceof Element ? node : node.parentElement
    if (element === null) return
    if (element.closest(IGNORED_MUTATION_SCOPE) !== null) return
    const known = dirtyTargets.get(node)
    if (known === undefined) {
      if (dirtyTargets.size >= DIRTY_TARGET_LIMIT) return
      dirtyTargets.set(node, structural)
      return
    }

    if (structural && !known) dirtyTargets.set(node, true)
  }

  function rotationSweep(deadline: number): void {
    const rows = document.querySelectorAll<HTMLElement>(FLOW_ROW)
    const total = rows.length
    if (total === 0) return
    const step = Math.min(ROTATION_ROWS, total)
    let visited = 0
    for (let offset = 0; offset < step; offset += 1) {

      if (performance.now() >= deadline) break

      const row = rows[total - 1 - ((rotationNext + offset) % total)]
      if (row === undefined) continue
      for (const candidate of findFenceCandidates(row)) enqueueCandidate(candidate)
      visited = offset + 1
    }
    rotationNext = (rotationNext + visited) % total
  }

  function markOwnedAncestors(node: Node | null): void {
    for (let current = node; current !== null; current = current.parentNode) {
      const block = containerBlocks.get(current) ?? current
      if (!(block instanceof HTMLElement)) continue
      if (mounts.has(block)) dirtyMounts.add(block)
      if (diagnostics.has(block)) dirtyDiagnostics.add(block)
    }
  }

  function markOwnedSubtree(node: Node): void {
    markOwnedAncestors(node)
    if (!(node instanceof Element)) return

    if (containerBlocks.has(node) || node.closest(IGNORED_MUTATION_SCOPE) !== null) return
    for (const element of node.querySelectorAll(`[${PROCESSED}], .${CONTAINER_CLASS}, .${DIAGNOSTIC_CLASS}`)) {
      markOwnedAncestors(element)
    }
  }

  function repairSurgery(mountBlocks: Iterable<HTMLElement>, diagnosticBlocks: Iterable<HTMLElement>): void {

    for (const block of diagnosticBlocks) {
      const diagnostic = diagnostics.get(block)
      if (diagnostic === undefined) continue
      if (!block.isConnected) {
        clearDiagnostic(block)
        continue
      }

      if (diagnostic.container.parentElement !== block.parentElement
          || diagnostic.container.nextElementSibling !== block) block.before(diagnostic.container)
    }
    for (const block of mountBlocks) {
      const mount = mounts.get(block)
      if (mount === undefined) continue

      if (!block.isConnected) {
        unmountBlock(block)
        continue
      }

      if (mount.container.parentElement !== block.parentElement
          || mount.container.previousElementSibling !== block) {
        block.after(mount.container)
      }
      if (!mount.container.isConnected) {

        block.style.display = ''
        block.removeAttribute(PROCESSED)
        mounts.delete(block)
        dirtyMounts.delete(block)
        containerBlocks.delete(mount.container)
        try {
          mount.root.unmount()
        } catch {

        }
        mount.container.remove()
        warnOnce(block, 'dsh-ui replacement container could not be re-attached after a host re-render; restoring the stock code block')
        continue
      }
      if (block.style.display !== 'none') block.style.display = 'none'
      if (!block.hasAttribute(PROCESSED)) block.setAttribute(PROCESSED, '')
    }
  }

  function sweep(full = false): void {
    if (disposed) return
    if (full) invalidateDocumentTopology()
    sourceLanguages.beginSweep()
    const sourceSession = sourceSessionOf(ctx)
    const sessionId = sourceSession.available ? sourceSession.sessionId : undefined
    if (sourceSession.available) lastAvailableSessionId = sourceSession.sessionId
    syncChatSubscription(sessionId)

    const all = full || fullMaintenance || sourceChanged
    fullMaintenance = false
    const mountBlocks = Array.from(all ? mounts.keys() : dirtyMounts)
    const diagnosticBlocks = Array.from(all ? diagnostics.keys() : dirtyDiagnostics)
    dirtyMounts.clear()
    dirtyDiagnostics.clear()
    for (const block of mountBlocks) {
      const mount = mounts.get(block)
      if (mount === undefined) continue
      if (!block.isConnected) {
        unmountBlock(block)
        continue
      }
      const raw = rawOf(block)
      const settled = isSettled(block)
      const domLanguage = tagTextBodyOf(block) !== null ? 'dsh-ui' : domLanguageOf(block)

      const language = resolveFenceLanguage(block, () => sourceLanguages.get(block))
      const sourceUnavailable = domLanguage === null
        && (!sourceSession.available || sourceLanguages.isSessionUnavailable())
      const validGenui = language === 'dsh-ui'
        || (language === undefined && settled && isGenericGenuiFence(block, raw))
      if (mount.language === 'svg' && language !== 'svg') {
        unmountBlock(block)
        continue
      }
      if (mount.language === 'dsh-ui' && !validGenui && !sourceUnavailable) {
        unmountBlock(block)
        continue
      }

      const contentWiped = !isPanelRoot(mount.lastNode) && mount.container.childElementCount === 0
      if (mount.lastRaw !== raw || mount.lastSettled !== settled || contentWiped) {
        const anchor = rowOf(block)
        const { key, context } = contextOf(anchor, block, settled, true)
        const node = mount.language === 'svg' ? renderSvgFence(raw, key) : renderResolvedFenceNode(raw, key, context)
        if (node === null) {
          if (mount.skeleton && !settled) {

            mount.lastRaw = raw
            mount.lastSettled = settled
            continue
          }

          unmountBlock(block)
          continue
        }
        if (contentWiped) {

          try {
            mount.root.unmount()
          } catch {

          }
          const fresh = document.createElement('div')
          fresh.className = CONTAINER_CLASS
          containerBlocks.delete(mount.container)
          mount.container.remove()
          block.after(fresh)
          try {
            const freshRoot = domRootFactory(fresh)
            const handler: GenuiActionHandler = (action, payload) => sendActionForBlock(block, action, payload)
            freshRoot.render(wrapFenceNode(node, context, handler, !settled))
            mount.root = freshRoot
            mount.container = fresh
            containerBlocks.set(fresh, block)
          } catch (error) {

            fresh.remove()
            block.style.display = ''
            block.removeAttribute(PROCESSED)
            mounts.delete(block)
            warnOnce(block, `failed to rebuild a wiped dsh-ui mount (${error instanceof Error ? error.message : String(error)}); restoring the stock code block`)
            continue
          }
        } else {
          try {
            const handler: GenuiActionHandler = (action, payload) => sendActionForBlock(block, action, payload)
            const render = (): void => { mount.root.render(wrapFenceNode(node, context, handler, !settled)) }

            if (mount.skeleton) swapWithTransition(mount.container, render)
            else render()
          } catch (error) {

            unmountBlock(block)
            warnOnce(block, `failed to re-render a dsh-ui fence (${error instanceof Error ? error.message : String(error)}); restoring the stock code block`)
            continue
          }
        }
        mount.lastRaw = raw
        mount.lastSettled = settled
        mount.lastNode = node
        mount.skeleton = false
      }
    }
    repairSurgery(mountBlocks, diagnosticBlocks)

    for (const block of diagnosticBlocks) {
      const diagnostic = diagnostics.get(block)
      if (diagnostic === undefined) continue
      if (!block.isConnected || block.hasAttribute(PROCESSED)) {
        clearDiagnostic(block)
        continue
      }

      if (isSettled(block)) {
        const language = resolveFenceLanguage(block, candidate => sourceLanguages.get(candidate))
        if (language !== 'dsh-ui') {
          clearDiagnostic(block)
          continue
        }
      }
      rebuildWipedDiagnostic(block, diagnostic.raw)
    }

    if (sourceChanged) {
      sourceChanged = false
      requeueAwaitingSource()
    }
    const deadline = performance.now() + SWEEP_BUDGET_MS
    resolveDirtyTargets(deadline)
    drainCandidates(deadline)
    keepDraining()
  }

  const schedule = (): void => {
    if (disposed || rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      if (disposed) return
      sweep()
    })
  }

  const unsubscribeSessions = typeof ctx.sessions.list.subscribe === 'function'
    ? ctx.sessions.list.subscribe(() => {
      fullMaintenance = true
      schedule()
    })
    : undefined

  const observer = new MutationObserver(records => {

    let relevant = false

    for (const record of [...records].reverse()) {
      if (record.removedNodes.length === 0 || record.target.childNodes.length > 0) continue
      const target = record.target
      const owner = containerBlocks.get(target)
      const mount = owner === undefined ? undefined : mounts.get(owner)
      if (mount !== undefined && mount.container === target) {
        dirtyMounts.add(mount.block)
        relevant = true
        if (!mount.block.isConnected || isPanelRoot(mount.lastNode)) continue
        mount.container.append(...record.removedNodes)
        continue
      }

      const diagnostic = owner === undefined ? undefined : diagnostics.get(owner)
      if (diagnostic !== undefined && diagnostic.container === target) {
        dirtyDiagnostics.add(owner!)
        relevant = true
        diagnostic.container.append(...record.removedNodes)
      }
    }

    for (const record of records) {
      const element = record.target instanceof Element ? record.target : record.target.parentElement

      if (record.type === 'attributes' && record.attributeName !== 'class') invalidateDocumentMutation(record)
      if (element !== null && element.closest(IGNORED_MUTATION_SCOPE) !== null) continue
      relevant = true
      if (record.type !== 'attributes' || record.attributeName === 'class') invalidateDocumentMutation(record)
      markOwnedAncestors(record.target)
      if (record.type === 'characterData') {
        markDirty(record.target, false)
        continue
      }
      if (record.type === 'childList') {

        if (element !== null && (element.tagName === 'SPAN' || element.closest(CODE_CONTEXT) !== null)) {
          markDirty(record.target, false)
        }
        markOwnedAncestors(record.previousSibling)
        markOwnedAncestors(record.nextSibling)
        for (const node of record.removedNodes) markOwnedSubtree(node)
        for (const node of record.addedNodes) {
          markOwnedSubtree(node)
          markDirty(node, true)
        }
        continue
      }

      markOwnedSubtree(record.target)
      markDirty(record.target, true)
    }
    if (!relevant) return

    repairSurgery(Array.from(dirtyMounts), Array.from(dirtyDiagnostics))
    schedule()
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: FENCE_ATTRIBUTES,

    characterData: true,
  })
  let slowTicks = 0
  const interval = window.setInterval(() => {
    sweep(true)

    slowTicks += 1
    if (slowTicks % ROTATION_TICKS === 0) rotationSweep(performance.now() + SWEEP_BUDGET_MS)
    keepDraining()
  }, SWEEP_MS)

  syncChatSubscription(sessionIdOf())
  const initial = findFenceCandidates()
  documentFences = new Map(initial.map(candidate => [candidate, 0]))
  for (let index = initial.length - 1; index >= 0; index -= 1) enqueueCandidate(initial[index])
  sweep()

  return () => {
    disposed = true
    observer.disconnect()
    unsubscribeSessions?.()
    unsubscribeChat?.()
    unsubscribeChat = undefined
    window.clearInterval(interval)
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    dirtyTargets.clear()
    dirtyMounts.clear()
    dirtyDiagnostics.clear()
    pendingCandidates.clear()
    awaitingSource.clear()
    invalidateDocumentTopology()
    for (const block of Array.from(mounts.keys())) unmountBlock(block)
    for (const block of Array.from(diagnostics.keys())) clearDiagnostic(block)
  }
}
