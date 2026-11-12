// @vitest-environment jsdom
// The render_ui tool's keyed toolview: reads the repaired spec from the
// result node's meta and renders through GenuiBlock; falls back to a summary
// row while the call runs or when meta is missing (replay of old logs).
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { GenuiToolView } from '../src/client/toolview.tsx'
import { createRenderUiTool } from '../src/plugin/tool.ts'
import { apply } from '../src/client/index.tsx'

const disposers: Array<() => void> = []

afterEach(() => {
  cleanup()
  for (const dispose of disposers.splice(0)) dispose()
})

function registeredToolView() {
  let component: ((props: ToolCallViewProps) => ReactNode) | undefined
  const sendA = vi.fn().mockResolvedValue(undefined)
  const sendB = vi.fn().mockResolvedValue(undefined)
  const conversations = new Map([['session-a', { send: sendA }], ['session-b', { send: sendB }]])
  const scope = vi.fn((sessionId: string) => ({ get: () => conversations.get(sessionId) }))
  const ctx = {
    get: () => undefined,
    inject: () => {},
    sessions: { list: { getSnapshot: () => ({ ids: [] }) }, scope },
    slots: {
      inject: (_name: string, register: () => () => void) => register(),
      register: (options: { name: string; key?: string }, view: typeof component) => {
        if (options.name === 'tool.call.toolview' && options.key === 'render_ui') component = view
        return () => {}
      },
    },
  } as unknown as Context
  disposers.push(apply(ctx))
  return {
    render: (sessionId: string | undefined) => {
      if (component === undefined) throw new Error('render_ui tool view was not registered')
      return component(props(resultBlock({ items: [{ type: 'button', label: '刷新', action: 'refresh' }] }), sessionId))
    },
    sendA,
    sendB,
    scope,
  }
}

function props(block: ToolCallBlock, sessionId?: string): ToolCallViewProps {
  return {
    callId: 'call-1',
    toolName: 'render_ui',
    block,
    sessionId,
    openFile: () => {},
  } as unknown as ToolCallViewProps
}

const resultBlock = (meta: unknown): ToolCallBlock => ({
  kind: 'tool-result',
  seq: 1,
  time: 0,
  callId: 'call-1',
  call: { name: 'render_ui', argsRaw: '{}' },
  callTime: 1,
  content: [],
  isError: false,
  meta,
  callView: null,
  resultView: null,
  subCalls: [],
} as unknown as ToolCallBlock)

describe('GenuiToolView', () => {
  it('sends a registered tool view action once to its session conversation', () => {
    const host = registeredToolView()
    const view = render(host.render('session-a'))
    const button = view.getByRole<HTMLButtonElement>('button', { name: '刷新' })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(host.sendA.mock.calls).toEqual([['[genui-action] refresh。用户刚刚在界面中触发了动作 "refresh"，请根据组件数据执行相应操作，并用 dsh-ui 输出更新后的界面。 组件数据: {"type":"button","label":"刷新"}']])
    expect(host.sendB).not.toHaveBeenCalled()
  })

  it('routes actions to the current tool view session after a session switch', () => {
    const host = registeredToolView()
    const view = render(host.render('session-a'))
    view.rerender(host.render('session-b'))
    fireEvent.click(view.getByRole('button', { name: '刷新' }))
    expect(host.sendA).not.toHaveBeenCalled()
    expect(host.sendB).toHaveBeenCalledTimes(1)
    expect(host.sendB).toHaveBeenCalledWith(expect.stringContaining('[genui-action] refresh'))
    expect(host.scope).toHaveBeenCalledWith('session-b')
  })

  it('disables actions when the tool view has no session instead of guessing a conversation', () => {
    const host = registeredToolView()
    const view = render(host.render('session-a'))
    view.rerender(host.render(undefined))
    const button = view.getByRole<HTMLButtonElement>('button', { name: '刷新' })
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(host.scope).not.toHaveBeenCalled()
    expect(host.sendA).not.toHaveBeenCalled()
    expect(host.sendB).not.toHaveBeenCalled()
  })

  it('keeps an unavailable session action from reaching another conversation', () => {
    const host = registeredToolView()
    const view = render(host.render('unavailable-session'))
    fireEvent.click(view.getByRole('button', { name: '刷新' }))
    expect(host.scope).toHaveBeenCalledWith('unavailable-session')
    expect(host.sendA).not.toHaveBeenCalled()
    expect(host.sendB).not.toHaveBeenCalled()
  })

  it('renders and replays metadata that also carries a dsh-go native view', () => {
    const meta = createRenderUiTool().output.presentationMeta!({ spec: { title: 'Native + Web', items: [
      { type: 'stat', label: 'Revenue', value: '42' },
    ] } })
    expect((meta as Record<string, unknown>)['dsh-go/view']).toBeDefined()
    render(<GenuiToolView {...props(resultBlock(JSON.parse(JSON.stringify(meta))))} />)
    expect(document.querySelector('[data-genui]')?.textContent).toContain('Revenue')
    expect(document.querySelector('[data-genui]')?.textContent).toContain('42')
  })
  it('renders the spec from result meta', () => {
    render(<GenuiToolView {...props(resultBlock({ title: '监控面板', items: [
      { type: 'stat', label: 'CPU', value: '42%' },
      { type: 'progress', value: 72 },
    ] }))} />)
    const block = document.querySelector('[data-genui]')
    expect(block).not.toBeNull()
    expect(block!.textContent).toContain('监控面板')
    expect(document.body.textContent).toContain('CPU')
    expect(document.body.textContent).toContain('42%')
  })

  it('repairs a hostile meta spec before rendering (caps honored)', () => {
    render(<GenuiToolView {...props(resultBlock({ items: Array.from({ length: 500 }, (_, i) => ({ type: 'text', content: `t${i}` })) }))} />)
    expect(document.body.textContent).toContain('t0')
    expect(document.body.textContent).not.toContain('t499')
  })

  it('falls back to a summary row while the call is running (no meta)', () => {
    render(<GenuiToolView {...props({ callId: 'call-1', name: 'render_ui', argsRaw: '{}', turn: 1, step: 1, time: 0, callView: null, subCalls: [] } as unknown as ToolCallBlock)} />)
    const fallback = document.querySelector('[data-genui-tool]')
    expect(fallback).not.toBeNull()
    expect(fallback!.textContent).toContain('call-1')
    expect(document.querySelector('[data-genui]')).toBeNull()
  })

  it('falls back when meta is not a spec (replayed log without projection)', () => {
    render(<GenuiToolView {...props(resultBlock({ some: 'junk' }))} />)
    expect(document.querySelector('[data-genui-tool]')).not.toBeNull()
    expect(document.querySelector('[data-genui]')).toBeNull()
  })
})
