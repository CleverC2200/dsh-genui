import { loadGenuiAsset } from './asset-loader.ts'
export { assertSafeSvg, ensureFlowchartKind, repairMermaidSource } from './mermaid-safe.ts'

interface MermaidAssetApi {
  renderMermaid: (code: string, target?: HTMLElement) => Promise<string>
}

interface RenderJob {
  code: string
  signal: AbortSignal | undefined
  target: HTMLElement | undefined
  resolve: (svg: string) => void
  reject: (error: unknown) => void
  abort: () => void
}

const jobs: RenderJob[] = []
let active = false
let listening = false
let timer: ReturnType<typeof setTimeout> | undefined
let scrollUntil = 0

const SCROLL_QUIET_MS = 250
const onScroll = (): void => {
  scrollUntil = performance.now() + SCROLL_QUIET_MS
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  pump()
}
const onVisibility = (): void => { pump() }

function listenForActivity(): void {
  if (listening || typeof document === 'undefined') return
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  document.addEventListener('visibilitychange', onVisibility)
  listening = true
}

listenForActivity()

function pump(): void {
  if (active) return
  if (jobs.length === 0) {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    return
  }
  if (timer !== undefined || document.hidden) return

  timer = setTimeout(() => {
    timer = undefined
    if (document.hidden) return
    if (performance.now() < scrollUntil) { pump(); return }
    const job = jobs.shift()
    if (job === undefined) { pump(); return }
    active = true
    void (async () => {
      let deferred = false
      try {
        job.signal?.throwIfAborted()
        const api = await loadGenuiAsset<MermaidAssetApi>('mermaid')
        job.signal?.throwIfAborted()

        if (document.hidden || performance.now() < scrollUntil) {
          deferred = true
          jobs.unshift(job)
          return
        }
        const svg = await api.renderMermaid(job.code, job.target)
        job.signal?.throwIfAborted()
        job.resolve(svg)
      } catch (error) {
        job.reject(error)
      } finally {
        if (!deferred) job.signal?.removeEventListener('abort', job.abort)
        active = false
        pump()
      }
    })()
  }, Math.max(0, scrollUntil - performance.now()))
}

export function renderMermaid(code: string, options: { signal?: AbortSignal; target?: HTMLElement } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const signal = options.signal
    if (signal?.aborted) { reject(signal.reason); return }
    const job: RenderJob = { code, signal, target: options.target, resolve, reject, abort: () => {
      const index = jobs.indexOf(job)
      if (index !== -1) jobs.splice(index, 1)
      reject(signal?.reason)
      signal?.removeEventListener('abort', job.abort)
      pump()
    } }
    signal?.addEventListener('abort', job.abort, { once: true })
    jobs.push(job)
    listenForActivity()
    pump()
  })
}
