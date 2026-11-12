import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { GenuiActionContext, type GenuiActionHandler } from './action-context.ts'
import { withFileLinkContext, type FileLinkAvailability, type FileLinkCordisContext } from './file-link-context.tsx'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ExportableGenuiBlock } from './artifact/ExportableGenuiBlock.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { TemplateDrawer } from './TemplateDrawer.tsx'
import { clearSessionPanel, getPanelExpandToken, getPanelSpec, getPanelStateKey, setLocalPanel, subscribePanel, subscribePanelExpand } from './panel-store.ts'
import { useT } from './i18n/index.ts'
import css from './GenuiBlock.module.css'

const PANEL_HEIGHT_MIN = 120
const PANEL_HEIGHT_MAX = 600

const ONBOARD_KEY = 'dsh.genui.panel-hint'

import { recordPanel, recordTemplateUse } from './achievement-store.ts'

export interface GenuiPanelInjected {
  sessionId: string
  sendGenuiAction: GenuiActionHandler
  fileLinkContext?: { ctx: FileLinkCordisContext; availability: FileLinkAvailability }

  insertTemplate: (text: string) => void
}

export type GenuiPanelProps = PropsRuntime<'conversation.input.dock'> & GenuiPanelInjected

export function GenuiPanel({ sessionId, sendGenuiAction, insertTemplate, fileLinkContext }: GenuiPanelProps) {
  const t = useT()
  const spec = useSyncExternalStore(subscribePanel, () => getPanelSpec(sessionId))
  const expandToken = useSyncExternalStore(subscribePanelExpand, () => getPanelExpandToken(sessionId))
  const [collapsed, setCollapsed] = useState(true)

  const [bodyHeight, setBodyHeight] = useState<number | null>(null)
  const [resizing, setResizing] = useState(false)
  const dragStart = useRef<{ y: number; height: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  const [drawer, setDrawer] = useState<null | 'templates' | 'achievements'>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const flashTimer = useRef(0)
  const hasSpec = spec !== null && spec.items.length > 0

  const [hint, setHint] = useState<boolean>(() => {
    try {
      return hasSpec && localStorage.getItem(ONBOARD_KEY) !== '1'
    } catch {
      return hasSpec
    }
  })
  useEffect(() => {
    if (!hint) return
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(ONBOARD_KEY, '1')
      } catch {

      }
      setHint(false)
    }, 6000)
    return () => window.clearTimeout(t)
  }, [hint])

  useEffect(() => {
    if (!hasSpec) return
    recordPanel()
  }, [hasSpec])

  useEffect(() => {
    if (expandToken > 0) setCollapsed(false)
  }, [expandToken])

  useEffect(() => {
    return () => {
      clearSessionPanel(sessionId)
    }
  }, [sessionId])

  useEffect(() => {
    if (!resizing) return
    return () => {
      dragStart.current = null
    }
  }, [resizing])

  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget

    const startHeight = bodyHeight ?? 360
    dragStart.current = { y: e.clientY, height: startHeight }
    setResizing(true)
    try {
      handle.setPointerCapture(e.pointerId)
    } catch {

    }
    const onMove = (ev: PointerEvent): void => {
      const start = dragStart.current
      if (start === null) return

      const next = Math.min(PANEL_HEIGHT_MAX, Math.max(PANEL_HEIGHT_MIN, start.height + (start.y - ev.clientY)))
      setBodyHeight(next)
    }
    const onUp = (): void => {
      dragStart.current = null
      setResizing(false)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }, [bodyHeight])

  if (!hasSpec) return null

  const showFlash = (text: string): void => {
    setFlash(text)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(null), 2500)
  }

  return (
    <div className={css.panel} data-genui-panel>
      {

                             }
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('panel.resize.aria')}
          className={`${css.panelResizeHandle}${resizing ? ` ${css.panelResizeHandleActive}` : ''}`}
          onPointerDown={startResize}
        />
      )}
      <div className={css.panelHeader}>
        <button
          type="button"
          className={css.panelToggle}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(c => !c)}
        >
          <span className={css.panelBadge}>{t('panel.badge')}</span>
          <span className={css.panelTitle}>{spec?.title ?? t(drawer !== null ? 'panel.title.explore' : 'panel.title.default')}</span>
          <span className={css.panelChevron} aria-hidden>
            {                }
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d={collapsed ? 'M12 10L8.70711 6.70711C8.31658 6.31658 7.68342 6.31658 7.29289 6.70711L4 10' : 'M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6'} stroke="currentColor" />
            </svg>
          </span>
        </button>
        {
                                                              }
        <button
          type="button"
          className={`${css.panelTpl}${drawer === 'templates' ? ` ${css.panelTplActive}` : ''}`}
          aria-label={t('panel.templates.aria')}
          title={t('panel.templates.title')}
          onClick={() => { setCollapsed(false); setDrawer(d => (d === 'templates' ? null : 'templates')) }}
        >
          {t('panel.templates')}
        </button>
        {
                                   }
        <button
          type="button"
          className={`${css.panelTpl}${drawer === 'achievements' ? ` ${css.panelTplActive}` : ''}`}
          aria-label={t('panel.achievements.aria')}
          title={t('panel.achievements.title')}
          onClick={() => { setCollapsed(false); setDrawer(d => (d === 'achievements' ? null : 'achievements')) }}
        >
          {t('panel.achievements')}
        </button>
        {

                                                                  }
        <button
          type="button"
          className={css.panelClose}
          aria-label={t('panel.close.aria')}
          title={t('panel.close.aria')}
          onClick={() => setLocalPanel(sessionId, null)}
        >
          <span aria-hidden>✕</span>
        </button>
      </div>
      {hint && drawer === null && (
        <div className={css.panelHint} role="status">
          {t('panel.hint')}
        </div>
      )}
      {!collapsed && (
        <div
          ref={bodyRef}
          className={css.panelBody}
          data-genui-panel-body
          style={bodyHeight === null ? undefined : { height: bodyHeight }}
        >
          {drawer !== null ? (
            <TemplateDrawer
              tab={drawer}
              onUse={(text) => {
                recordTemplateUse()
                insertTemplate(text)
                showFlash(t('panel.flash.inserted'))
              }}
            />
          ) : spec !== null ? (
            <GenuiActionContext.Provider value={sendGenuiAction}>
              {fileLinkContext === undefined
                ? <ErrorBoundary label={t('panel.boundary')}>
                  {                           }
                  <ExportableGenuiBlock spec={spec} stateKey={getPanelStateKey(sessionId)} />
                </ErrorBoundary>
                : withFileLinkContext(
                  fileLinkContext.ctx,
                  fileLinkContext.availability,
                  sessionId,
                  false,
                  <ErrorBoundary label={t('panel.boundary')}>
                    {                           }
                    <ExportableGenuiBlock spec={spec} stateKey={getPanelStateKey(sessionId)} />
                  </ErrorBoundary>,
                )}
            </GenuiActionContext.Provider>
          ) : null}
        </div>
      )}
      {flash !== null && (
        <div className={css.panelFlash} role="status">{flash}</div>
      )}
    </div>
  )
}
