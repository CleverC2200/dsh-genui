import { useCallback, useId, useMemo, useState, type ReactNode } from 'react'

import { useGenuiAction } from '../action-context.ts'
import { renderInline } from '../inline.ts'
import { useT } from '../i18n/index.ts'
import type { GenuiChoices } from '../spec.ts'
import type { AnswersState } from './state.ts'
import css from './choices.module.css'

const MAX_OPTIONS = 8

export function ChoicesNode({ node, onAction, answers }: {
  node: GenuiChoices
  onAction?: ((action: string, payload: Record<string, unknown>) => void) | undefined
  answers?: AnswersState | undefined
}): ReactNode {
  const t = useT()
  const contextAction = useGenuiAction()
  const send = onAction ?? contextAction
  const name = useId()
  const group = node.group

  const paper = group !== undefined && answers !== undefined
  const locked = paper && answers?.locked === true
  const mode = node.mode ?? 'single'
  const max = mode === 'multi' ? Math.max(1, Math.min(node.max ?? node.items.length, node.items.length)) : 1
  const items = useMemo(() => node.items.slice(0, MAX_OPTIONS), [node.items])
  const [localSelected, setLocalSelected] = useState<readonly string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const recorded = paper ? answers?.answers[group] : undefined
  const selected: readonly string[] = paper
    ? (recorded === undefined ? [] : [recorded])
    : localSelected

  const toggle = useCallback((label: string): void => {
    if (locked) return
    if (paper) {

      answers?.setAnswer(group, label)
      return
    }

    setSubmitted(false)
    setLocalSelected(previous => {
      if (previous.includes(label)) return previous.filter(item => item !== label)
      if (mode === 'single') return [label]
      if (previous.length >= max) return previous
      return [...previous, label]
    })
  }, [answers, group, locked, max, mode, paper])

  const submit = (): void => {
    if (selected.length === 0) return
    setSubmitted(true)
    if (node.action !== undefined && node.action !== '') {
      send?.(node.action, {
        question: node.prompt ?? node.title ?? '',
        selected: [...selected],
        mode,
      })
    }
  }

  const hint = mode === 'multi' && node.max !== undefined
    ? t('block.choices.maxHint', { max: String(max) })
    : mode === 'multi' ? t('block.choices.multiHint') : t('block.choices.singleHint')

  return (
    <section className={css.choices} data-genui-choices data-choice-mode={mode} aria-labelledby={`${name}-title`}>
      <h3 className={css.title} id={`${name}-title`}>{renderInline(node.title ?? t('block.choices'))}</h3>
      {node.prompt !== undefined && <p className={css.prompt}>{renderInline(node.prompt)}</p>}

      <div className={css.list} role={mode === 'single' ? 'radiogroup' : 'group'} aria-labelledby={`${name}-title`}>
        {items.map((item, index) => {
          const active = selected.includes(item.label)
          const unavailable = item.disabled === true || locked
          return (
            <label
              key={`${index}-${item.label}`}
              className={[css.row, active ? css.rowActive : '', unavailable ? css.rowDisabled : '']
                .filter(Boolean).join(' ')}
              data-selected={active ? '' : undefined}
            >
              <input
                className={css.control}
                type={mode === 'single' ? 'radio' : 'checkbox'}
                name={mode === 'single' ? `${name}-group` : undefined}
                checked={active}
                disabled={unavailable}
                onChange={() => toggle(item.label)}
              />
              <span className={css.body}>
                <span className={css.labelLine}>
                  <span className={css.label}>{renderInline(item.label)}</span>
                  {item.recommended === true && <span className={css.recommended}>{t('block.choices.recommended')}</span>}
                  {unavailable && <span className={css.unavailable}>{t('block.choices.unavailable')}</span>}
                </span>
                {(unavailable ? item.reason : item.hint) !== undefined && (
                  <span className={css.hint}>{renderInline(unavailable ? item.reason! : item.hint!)}</span>
                )}
              </span>
              {item.meta !== undefined && <span className={css.meta}>{renderInline(item.meta)}</span>}
            </label>
          )
        })}
      </div>

      <div className={css.footer}>
        {!paper && node.submit !== undefined && node.submit !== '' && (
          <button
            type="button"
            className={css.submit}
            disabled={selected.length === 0}
            onClick={submit}
          >
            {node.submit}
          </button>
        )}
        <span className={css.status} role="status" aria-live="polite">
          {submitted
            ? (node.action === undefined || node.action === ''

              ? t('block.choices.localOnly')
              : t('block.choices.sent'))
            : selected.length === 0
              ? hint
              : `${t('block.choices.count', { count: String(selected.length) })} · ${hint}`}
        </span>
      </div>
    </section>
  )
}
