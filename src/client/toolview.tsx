import { useEffect, useMemo } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { ExportableGenuiBlock } from './artifact/ExportableGenuiBlock.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { isRenderableProcess, processGenuiSpec } from './guard.ts'
import { toolStateKey } from './interaction-store.ts'
import { applyPanelOperation } from './panel-store.ts'
import css from './GenuiBlock.module.css'

export function GenuiToolView({ toolName, block, sessionId }: ToolCallViewProps) {

  const meta = 'meta' in block ? block.meta : undefined
  const spec = useMemo(() => {
    if (meta === undefined) return null
    const processed = processGenuiSpec(meta)
    return isRenderableProcess(processed) ? processed.spec : null
  }, [meta])
  useEffect(() => {

    if (spec !== null && spec.items.length > 0) {
      applyPanelOperation(sessionId, {
        sourceId: JSON.stringify(['render_ui', block.callId]),
        order: ['seq' in block && typeof block.seq === 'number' ? block.seq : 0, -1, 0],
        mode: 'replace',
        spec,
      })
    }
  }, [sessionId, spec, block])
  if (spec === null || spec.items.length === 0) {
    return (
      <div className={css.toolFallback} data-genui-tool>
        <span className={css.toolFallbackTitle}>{toolName}</span>
        <span className={css.toolFallbackMeta}>{block.callId}</span>
      </div>
    )
  }
  return (
    <div className={css.tool} data-genui-tool>
      <ErrorBoundary label="工具卡片">
        {                                                                             }
        <ExportableGenuiBlock spec={spec} stateKey={toolStateKey(sessionId, block.callId)} />
      </ErrorBoundary>
    </div>
  )
}
