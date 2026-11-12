import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { GenuiSpec } from './spec.ts'
import { requestPanelExpand, setLocalPanel } from './panel-store.ts'
import { t } from './i18n/index.ts'

type PanelInputTriggerSource = InputTriggerSource & {
  matchClaim: (
    session: Parameters<InputTriggerSource['onPick']>[0]['session'],
    token: string,
    signal: AbortSignal,
  ) => Promise<ReturnType<typeof panelClaim> | undefined>
}

export function defaultPanelSpec(): GenuiSpec {
  return {
    title: t('panel.title.default'),
    items: [
      { type: 'text', size: 'h3', content: t('panel.default.heading') },
      { type: 'text', size: 'muted', content: t('panel.default.subtitle') },
      {
        type: 'grid', cols: 4, items: [
          { type: 'stat', label: t('panel.default.stat.components'), value: '38' },
          { type: 'stat', label: t('panel.default.stat.single'), value: '12' },
          { type: 'stat', label: t('panel.default.stat.composite'), value: '8' },
          { type: 'stat', label: t('panel.default.stat.advanced'), value: '18' },
        ],
      },
      {
        type: 'list', items: [
          { title: t('panel.default.group.single'), desc: 'text button input select checkbox link badge stat progress divider avatar spacer' },
          { title: t('panel.default.group.composite'), desc: 'row col grid card list table chart tabs' },
          { title: t('panel.default.group.data'), desc: 'plot callout steps keyvalue diff json code' },
          { title: t('panel.default.group.interactive'), desc: 'radio switch textarea accordion copy' },
          { title: t('panel.default.group.advanced'), desc: 'mermaid scene3d timeline file-tree breadcrumb' },
          { title: t('panel.default.group.teaching'), desc: 'quiz' },
        ],
      },
      { type: 'callout', tone: 'info', title: t('panel.default.callout.title'), content: t('panel.default.callout.body') },
    ],
  }
}

function applyPanelCommand(sessionId: string, args: string): void {
  const cmd = args.trim().toLowerCase()
  if (cmd === 'clear' || cmd === 'off' || cmd === 'close') {
    setLocalPanel(sessionId, null)
    return
  }
  setLocalPanel(sessionId, defaultPanelSpec())
  requestPanelExpand(sessionId)
}

function panelClaim(sessionId: SessionId, sendInstruction: (sessionId: SessionId, instruction: string) => void) {
  return {
    name: 'panel',
    token: '/panel',
    hint: t('panel.cmd.hint'),
    submit: async (args: string, _actx: ClientContext) => {
      const instruction = args.trim()
      if (instruction === '' ) {
        applyPanelCommand(sessionId, '')
      } else if (/^(clear|off|close)$/i.test(instruction)) {
        applyPanelCommand(sessionId, instruction)
      } else {

        applyPanelCommand(sessionId, '')
        sendInstruction(sessionId, instruction)
      }

      return { kind: 'success' as const }
    },
  }
}

export function createPanelSlashSource(sendInstruction: (sessionId: SessionId, instruction: string) => void): PanelInputTriggerSource {
  const source: PanelInputTriggerSource = {
    trigger: '/',
    name: 'genui',
    order: 60,
    candidates: async (_session, req) => {

      const query = req.query.toLowerCase()
      if (query !== '' && !'panel'.startsWith(query)) return []
      return [{
        name: 'panel',
        description: t('panel.cmd.description'),
        hint: '/panel',
      }]
    },
    onPick(pick) {
      return { claim: panelClaim(pick.session.sessionId, sendInstruction) }
    },
    matchEnter: async (session, line, _signal) => {
      if (!/^\/panel(?:\s|$)/.test(line.trim())) return undefined
      return { claim: panelClaim(session.sessionId, sendInstruction) }
    },
    matchClaim: async (session, token, signal) => {
      signal.throwIfAborted()
      if (token !== '/panel') return undefined
      return panelClaim(session.sessionId, sendInstruction)
    },
  }
  return source
}
