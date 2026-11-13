import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createElement } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { installDomFenceRenderer } from './dom-fence.tsx'
import { installSidechatAdapter, type SidechatSurfaceService } from './sidechat-surface.tsx'
import { createFileLinkAvailability, withFileLinkContext, type FileLinkCordisContext } from './file-link-context.tsx'
import { createPanelSlashSource } from './panel-command.ts'
import { GenuiPanel, type GenuiPanelInjected } from './panel.tsx'
import { GenuiToolView } from './toolview.tsx'
import { mountAchievementToasts } from './achievement-toast.tsx'
import { bridgeHostLocale, t } from './i18n/index.ts'
import type { InputTriggerServiceContract } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { assetUrl } from './asset-loader.ts'

export function prefetchGenuiAssets(): void {
  if (typeof document === 'undefined') return
  for (const file of ['mermaid.js', 'three.js']) {
    if (document.head.querySelector(`link[rel="prefetch"][href="${assetUrl(file)}"]`) !== null) continue
    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.as = 'script'
    link.href = assetUrl(file)
    document.head.appendChild(link)
  }
}

function panelActionSend(ctx: Context, sessionId: SessionId): GenuiPanelInjected {
  const scoped = ctx.sessions.scope(sessionId)
  const conversation = scoped?.get('conversation') as IConversation | undefined
  return {
    sessionId,
    sendGenuiAction: (action, payload) => {
      if (conversation === undefined) return
      const payloadText = Object.keys(payload).length === 0
        ? ''
        : t('action.payload', { json: JSON.stringify(payload) })
      void conversation.send(t('action.panel', { action, payload: payloadText })).catch((err: unknown) => {

        console.warn(`[genui] 面板动作 "${action}" 发送失败（session ${sessionId}）：`, err instanceof Error ? err.message : String(err))
      })
    },
    insertTemplate: (text) => {

      const input = (conversation as unknown as {
        input?: { for?(actx: unknown): { setDraft(text: string): void } | undefined }
      } | undefined)?.input?.for?.(scoped)
      input?.setDraft(text)
    },
  }
}

function sendPanelInstruction(ctx: Context, sessionId: SessionId, instruction: string): void {
  const scoped = ctx.sessions.scope(sessionId)
  const conversation = scoped?.get('conversation') as IConversation | undefined
  if (conversation === undefined) return
  void conversation.send(`用户执行了 /panel 并请求：${instruction}。请只输出一个 panel:true 的 dsh-ui 围栏来更新会话面板，内容按请求定制；回复文本至多一行 10 字以内的确认（如"已更新"），不要解释、不要普通围栏。`).catch((err: unknown) => {

    console.warn(`[genui] /panel 指令发送失败（session ${sessionId}）：`, err instanceof Error ? err.message : String(err))
  })
}

function sendInlineGenuiAction(ctx: Context, sessionId: SessionId, action: string, payload: Record<string, unknown>): void {
  const scoped = ctx.sessions.scope(sessionId)
  const conversation = scoped?.get('conversation') as IConversation | undefined
  if (conversation === undefined) return
  const payloadText = Object.keys(payload).length === 0
    ? ''
    : t('action.payload', { json: JSON.stringify(payload) })
  void conversation.send(t('action.inline', { action, payload: payloadText })).catch(() => {

  })
}

export function apply(ctx: Context): () => void {

  ctx.inject(['genuiSidechat'], scope => {
    scope.effect(() => installSidechatAdapter(scope.get('genuiSidechat') as Partial<SidechatSurfaceService> | undefined), 'genui: host sidechat surface')
  })

  ctx.inject(['betterSidebar'], scope => {
    scope.effect(() => installSidechatAdapter(scope.get('betterSidebar') as Partial<SidechatSurfaceService> | undefined), 'genui: sidechat surface')
  })

  const localeDispose = bridgeHostLocale(ctx)
  const fileLinkAvailability = createFileLinkAvailability(ctx as unknown as FileLinkCordisContext)
  console.info('[genui] client active; fence-channel=dom')
  const disposers: Array<() => void> = [
    localeDispose,
    installDomFenceRenderer(ctx, (sessionId, action, payload) => sendInlineGenuiAction(ctx, sessionId, action, payload), fileLinkAvailability),
  ]

  prefetchGenuiAssets()

  disposers.push(mountAchievementToasts())

  disposers.push(ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'render_ui',
  }, (props: ToolCallViewProps) => withFileLinkContext(
    ctx as unknown as FileLinkCordisContext,
    fileLinkAvailability,
    props.sessionId,
    false,
    createElement(GenuiToolView, props),
  ))))

  disposers.push(ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'genui-panel',
    order: 50,
    inject: (sessionId: SessionId): GenuiPanelInjected => ({
      ...panelActionSend(ctx, sessionId),
      fileLinkContext: { ctx: ctx as unknown as FileLinkCordisContext, availability: fileLinkAvailability },
    }),
  }, GenuiPanel)))

  ctx.inject(['inputTriggers'], (scope) => {
    const slash = scope.get('inputTriggers') as InputTriggerServiceContract | undefined
    if (slash === undefined) return
    scope.effect(() => slash.registerSource(
      createPanelSlashSource((sessionId, instruction) => sendPanelInstruction(ctx, sessionId, instruction)),
    ), 'genui: /panel')
  })
  return () => {
    for (const dispose of disposers) dispose()
  }
}

export type { SidechatSurface, SidechatSurfaceService } from './sidechat-surface.tsx'

export const inject = ['slots', 'sessions']

export { GenuiMapContext, setGenuiMapConfig } from './map-config.ts'
export type { GenuiMapConfig, GenuiMapStyle } from './map-config.ts'
