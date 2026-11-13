import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type Key, type ReactNode } from 'react'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { codeBlockLabels } from './primitive-labels.ts'
import { t, useT } from './i18n/index.ts'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { ExportableGenuiBlock } from './artifact/ExportableGenuiBlock.tsx'
import { fenceStateKey } from './interaction-store.ts'
import { applyPanelOperation, diagnosePanelBudget, getPanelOperationError, subscribePanel, type PanelOperationStatus } from './panel-store.ts'
import type { GenuiSpec } from './spec.ts'
import { describeJsonFailure, isCompleteJson } from '../shared/fence-repair.ts'
import { resolveFence, resolveFenceSpec, type FenceResolution } from '../shared/fence-resolve.ts'

export interface GenuiFenceSource {

  readonly id: string

  readonly order: readonly [number, number, number]
}

export interface GenuiFenceContext {

  readonly sessionId?: string

  readonly source?: GenuiFenceSource
}

const FENCE_ERROR_STYLE: CSSProperties = {
  margin: '0 0 6px',
  padding: '6px 10px',
  borderRadius: 6,
  background: 'rgba(239, 68, 68, 0.14)',
  border: '1px solid rgba(239, 68, 68, 0.4)',
  color: '#f87171',
  fontSize: 12,
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
}

function formatChartProcessErrors(errors: string[]): string | null {
  const chartErrors = errors.filter(error => /(?:variant is unsupported|kind must be bars, line, or donut|requires data or series|(?:data|series) is required for|(?:\.data|\.series)(?:\[\d+\])?(?:\.(?:data|label|value|color))? must|series is only supported for bars)/.test(error))
  return chartErrors.length === 0 ? null : chartErrors.join('；')
}

function processSemanticFailure(resolution: FenceResolution): string | null {
  if (resolution.spec !== null || resolution.processed === null) return null
  const chartErrors = formatChartProcessErrors(resolution.processed.errors)
  return chartErrors === null
    ? t('err.fieldValidation', { errors: resolution.processed.errors.join('；') })
    : t('err.chartValidation', { errors: chartErrors })
}

export function describeFenceFailure(raw: string, options: { settled?: boolean } = {}): string | null {
  const resolution = resolveFence(raw, { settled: options.settled ?? true })
  if (resolution.spec !== null) return null
  const processDiagnostic = processSemanticFailure(resolution)
  if (processDiagnostic !== null) {
    return t('err.fenceKeptAsCode', { diagnostic: processDiagnostic })
  }
  if (raw.trim() === '') return null
  const parseDiagnostic = describeJsonFailure(raw)
  if (parseDiagnostic === null) return null
  return t('err.fenceParse', { diagnostic: parseDiagnostic })
}

export function FenceDiagnostic({ raw, settled = false }: { raw: string; settled?: boolean }): ReactNode {

  useT()
  const message = describeFenceFailure(raw, { settled })
  if (message === null) return null
  return <div style={FENCE_ERROR_STYLE} role="alert">{message}</div>
}

function FenceFallback({ raw, fenceKey }: { raw: string; fenceKey: Key }) {

  useT()
  const ref = useRef<HTMLDivElement | null>(null)
  const [settled, setSettled] = useState(false)
  useLayoutEffect(() => {
    const node = ref.current
    if (node !== null && node.closest('[data-streaming]') === null) setSettled(true)
  })
  const diagnostic = settled ? <FenceDiagnostic raw={raw} /> : null
  return (
    <div ref={ref}>
      {diagnostic}
      <CodeBlock key={fenceKey} {...codeBlockLabels()} code={`${raw}\n`} lang="dsh-ui" />
    </div>
  )
}

function FencePanelPublisher({ sessionId, sourceId, order, spec, raw }: {
  sessionId: string
  sourceId: string
  order: readonly [number, number, number]
  spec: GenuiSpec
  raw: string
}) {
  const error = useSyncExternalStore(subscribePanel, () => getPanelOperationError(sessionId, sourceId))
  useT()
  useEffect(() => {
    const status: PanelOperationStatus = applyPanelOperation(sessionId, {
      sourceId,
      order,
      mode: spec.append === true ? 'append' : 'replace',
      spec,
    })
    if (status === 'overflow') diagnosePanelBudget(sessionId, sourceId)
  }, [sessionId, sourceId, order, spec])
  if (error === null) return null
  return <div>
    <div style={FENCE_ERROR_STYLE} role="alert">{t('err.fieldValidation', { errors: error })}</div>
    <CodeBlock {...codeBlockLabels()} code={`${raw}\n`} lang="dsh-ui" />
  </div>
}

export function resolveGenuiSpec(raw: string, context?: GenuiFenceContext): GenuiSpec | null {
  return resolveFenceSpec(raw, { settled: context?.source !== undefined })
}

function renderInlineFence(key: Key, context: GenuiFenceContext | undefined, spec: GenuiSpec): ReactNode {
  const sessionId = context?.sessionId
  const stateKey = sessionId === undefined || context?.source === undefined
    ? undefined
    : fenceStateKey(sessionId, context.source.id, JSON.stringify(spec))
  return (

    <ErrorBoundary key={JSON.stringify([sessionId, key])} label={t('err.boundary.fence')}>
      <ExportableGenuiBlock spec={spec} animateEntrance={context?.source === undefined} stateKey={stateKey} exportEnabled={context?.source !== undefined} />
    </ErrorBoundary>
  )
}

export function renderResolvedFenceNode(raw: string, key: Key, context?: GenuiFenceContext): ReactNode | null {
  const spec = resolveGenuiSpec(raw, context)
  if (spec === null) return null
  if (spec.panel === true) {

    if (context !== undefined && context.sessionId !== undefined && context.source !== undefined) {
      if (spec.append === true && !isCompleteJson(raw)) return <Fragment key={key} />
      return (
        <FencePanelPublisher
          key={key}
          sessionId={context.sessionId}
          sourceId={context.source.id}
          order={context.source.order}
          spec={spec}
          raw={raw}
        />
      )
    }
    return <Fragment key={key} />
  }
  return renderInlineFence(key, context, spec)
}

export function renderGenuiFence(raw: string, key: Key, context?: GenuiFenceContext): ReactNode {
  const spec = resolveGenuiSpec(raw, context)
  if (spec === null) return <FenceFallback key={key} fenceKey={key} raw={raw} />
  if (spec.panel === true) {
    if (context !== undefined && context.sessionId !== undefined && context.source !== undefined) {
      if (spec.append === true && !isCompleteJson(raw)) return null
      return (
        <FencePanelPublisher
          key={key}
          sessionId={context.sessionId}
          sourceId={context.source.id}
          order={context.source.order}
          spec={spec}
          raw={raw}
        />
      )
    }
    return null
  }
  return renderInlineFence(key, context, spec)
}
