import { renderInline } from '../inline.ts'
import { useEffect, useId, useRef, useState } from 'react'
import css from '../GenuiBlock.module.css'
import { GENUI_LIMITS } from '../genui-runtime/index.ts'
import { useT } from '../i18n/index.ts'
import { parseDecimalNumber } from '../safe-math.ts'
import { isDatePickerValueValid } from '../date-picker.ts'
import { resolveSubmitState } from '../submission-registry.ts'
import type { RadioSubmissionMember } from '../submission-registry.ts'
import type { AnswersState, GenuiBlockProps } from './state.ts'
import type { GenuiInput, GenuiRadio, GenuiSelect, GenuiSlider, GenuiSubmit, GenuiSwitch, GenuiTextarea } from '../spec.ts'

export function RadioNode({ node, onAction, answers }: {
  node: GenuiRadio
  onAction?: GenuiBlockProps['onAction']
  answers?: AnswersState | undefined
}) {
  const action = node.action
  const group = node.group
  const grouped = group !== undefined
  const options = node.options.slice(0, GENUI_LIMITS.maxOptions)

  const restoredIndex = group !== undefined && answers?.answers[group] !== undefined
    ? options.indexOf(answers!.answers[group]!)
    : -1
  const [selected, setSelected] = useState<number | null>(restoredIndex >= 0 ? restoredIndex : (node.selected ?? null))
  const uid = useId()
  const locked = grouped && answers?.locked === true
  useEffect(() => {
    if (group === undefined) return

    if (node.selected !== undefined && options[node.selected] !== undefined && answers?.answers[group] === undefined) {
      answers?.setAnswer(group, options[node.selected]!)
    }

  }, [group, node.label, node.answer, node.explanation, node.options, node.selected])
  return (
    <div className={css.fieldGroup} role="radiogroup" aria-label={node.label}>
      {node.label !== undefined && <span className={css.fieldLabel}>{renderInline(node.label, false)}</span>}
      {options.map((opt, i) => (
        <label key={i} className={css.radio}>
          <input
            type="radio"
            name={`genui-radio-${uid}`}
            checked={selected === i}
            disabled={locked}
            onChange={() => {
              setSelected(i)
              if (grouped) {

                answers?.setAnswer(group, opt)
              } else if (action !== undefined && onAction !== undefined) {
                onAction(action, { type: 'radio', value: opt })
              }
            }}
          />
          <span>{renderInline(opt, false)}</span>
        </label>
      ))}
    </div>
  )
}

export function correctLabelOf(m: RadioSubmissionMember): string | undefined {
  if (m.answer === undefined) return undefined
  if (typeof m.answer === 'number') return m.options[m.answer]
  return m.answer
}

const EMPTY_KEYS: ReadonlySet<string> = new Set()

export function SubmitNode({ node, onAction, answers }: {
  node: GenuiSubmit
  onAction?: GenuiBlockProps['onAction']
  answers?: AnswersState | undefined
}) {
  const t = useT()

  const hidden = answers?.hidden ?? EMPTY_KEYS
  const visible = <T,>(record: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([key]) => !hidden.has(key)))
  const recorded = visible(answers?.answers ?? {})
  const multiRecorded = visible(answers?.multiAnswers ?? {})
  const fields = visible(answers?.fields ?? {})
  const validFields = Object.fromEntries(Object.entries(fields).filter(([id]) => !answers?.invalidNumericFields.has(id)))
  const expected = node.groups?.filter(group => !hidden.has(group))

  const filledFields = Object.fromEntries(
    Object.entries(validFields).filter(([id, v]) => {
      if (v.trim() === '' || answers?.secretFields.has(id)) return false
      const member = answers?.registry.members.get(id)
      return member?.kind !== 'field' || member.fieldType !== 'date-picker'
        || isDatePickerValueValid(v, member.datePicker?.mode ?? 'single', member.datePicker?.min, member.datePicker?.max)
    }),
  )
  const resolved = answers === undefined ? { scope: [], answered: 0, total: expected?.length ?? 0, localGradeEligible: false, hasOutOfScopePayload: false }
    : resolveSubmitState({
      registry: answers.registry,
      ...(expected === undefined ? {} : { groups: expected }),
      state: { answers: recorded, multiAnswers: multiRecorded, fields: validFields, secretFields: answers.secretFields, hidden },
    })
  const { scope, answered, total } = resolved
  const canSendAction = node.action !== undefined && onAction !== undefined
  const shouldGradeLocally = resolved.localGradeEligible && (!resolved.hasOutOfScopePayload || !canSendAction)
  const submitted = answers?.locked === true
  const collectedAnswers: Record<string, string | string[]> = {
    ...recorded,
    ...Object.fromEntries(Object.entries(multiRecorded).flatMap(([group, values]) => {
      const member = answers?.registry.members.get(group)
      if (member?.kind !== 'checkbox') return []
      return [[group, values.flatMap(value => {
        const label = member.choices.get(value)
        return label === undefined ? [] : [label]
      })]]
    })),
  }

  const ready = answered > 0 && answered >= total
    && (shouldGradeLocally || canSendAction)

  if (submitted) {

    const graded = scope.filter((member): member is RadioSubmissionMember => member.kind === 'radio' && recorded[member.key] !== undefined && member.answer !== undefined)
    const score = graded.filter(member => recorded[member.key] === correctLabelOf(member)).length
    return (
      <div className={css.gradeWrap} data-genui-grade>
        <div className={css.gradeScore}>
          <span className={css.gradeScoreValue}>{score} / {graded.length}</span>
          <span className={css.gradeScoreLabel}>{t('block.score')}{graded.length < scope.length ? t('block.scoreUngraded', { count: scope.length - graded.length }) : ''}</span>
        </div>
        <div className={css.gradeList}>
          {scope.map(m => {
            if (m.kind !== 'radio') return null
            const entry = recorded[m.key]
            if (entry === undefined) return null
            const correct = correctLabelOf(m)
            if (correct === undefined) {
              return (
                <div key={m.key} className={css.gradeItem}>
                  <span className={css.gradeQ}>{renderInline(m.label)}</span>
                  <span className={css.gradeAns}>{t('block.yourAnswer')}{renderInline(entry)}</span>
                </div>
              )
            }
            const isCorrect = entry === correct
            return (
              <div key={m.key} className={`${css.gradeItem} ${isCorrect ? css.gradeItemOk : css.gradeItemNo}`}>
                <span className={css.gradeQ}>{renderInline(m.label)}</span>
                <span className={css.gradeTag}>{isCorrect ? '✓' : '✗'}</span>
                <span className={css.gradeAns}>
                  {t('block.yourAnswer')}{renderInline(entry)}
                  {!isCorrect && <span className={css.gradeRight}>{t('block.correctAnswer')}{renderInline(correct ?? '')}</span>}
                </span>
                {m.explanation !== undefined && <span className={css.gradeExp}>{renderInline(m.explanation)}</span>}
              </div>
            )
          })}
        </div>
        <button
          type="button"
          className={`${css.button} ${css.ghost} ${css.submit}`}
          onClick={() => {
            answers?.clear()
            if (node.resetAction !== undefined && onAction !== undefined) {
              onAction(node.resetAction, { type: 'submit-reset', groups: expected ?? Object.keys(recorded) })
            }
          }}
        >
          {t('block.quizRetry')}
        </button>
      </div>
    )
  }

  return (
    <div className={css.submitRow}>
      <button
        type="button"
        className={`${css.button} ${css.primary} ${css.submit}`}
        disabled={!ready}
        onClick={ready ? () => {
          if (shouldGradeLocally) {

            answers?.setLocked(true)
          } else if (node.action !== undefined && onAction !== undefined) {

            onAction(node.action, {
              type: 'submit',
              answers: collectedAnswers,
              ...(Object.keys(filledFields).length > 0 ? { fields: filledFields } : {}),
              total,
              answered,
            })
          }
        } : undefined}
      >
        {renderInline(node.label, false)}
      </button>
      {total > 0 && <span className={css.submitHint} aria-live="polite">{t('block.selectedCount', { answered, total })}</span>}
    </div>
  )
}

export function SwitchNode({ node, onAction }: { node: GenuiSwitch; onAction?: GenuiBlockProps['onAction'] }) {
  const [on, setOn] = useState(node.checked === true)
  const action = node.action
  return (
    <label className={css.switchRow}>
      <span className={css.switchLabel}>{renderInline(node.label, false)}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={`${css.switch} ${on ? css.switchOn : ''}`}
        onClick={() => {
          const next = !on
          setOn(next)
          if (action !== undefined && onAction !== undefined) onAction(action, { type: 'switch', checked: next })
        }}
      >
        <span className={css.switchKnob} />
      </button>
    </label>
  )
}

export function SliderNode({ node, onAction, answers }: {
  node: GenuiSlider
  onAction?: GenuiBlockProps['onAction']
  answers?: AnswersState | undefined
}) {
  const action = node.action
  const id = node.id
  const restored = id !== undefined && answers?.fields !== undefined && Object.hasOwn(answers.fields, id)
    ? Number(answers!.fields[id]!)
    : NaN
  const initial = Number.isFinite(restored) ? restored : node.value ?? node.min ?? 0
  const [value, setValue] = useState<number>(initial)
  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    if (id !== undefined) answers?.setField(id, String(initial))

  }, [])
  const send = (v: number): void => {
    if (action !== undefined && onAction !== undefined) {
      onAction(action, { type: 'slider', value: v, ...(id !== undefined ? { id } : {}) })
    }
  }
  return (
    <label className={css.sliderRow}>
      {node.label !== undefined && <span className={css.fieldLabel}>{renderInline(node.label, false)}</span>}
      <input
        type="range"
        className={css.sliderInput}
        min={node.min}
        max={node.max}
        step={node.step ?? 1}
        value={value}
        aria-label={node.label}
        onChange={e => {
          const v = Number(e.currentTarget.value)
          setValue(v)
          if (id !== undefined) answers?.setField(id, String(v))
          send(v)
        }}
      />
      <span className={css.sliderValue}>{value}</span>
    </label>
  )
}

export function useImeComposing(): {
  isComposing: () => boolean
  onCompositionStart: () => void
  onCompositionEnd: () => void
} {
  const composing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])
  return {
    isComposing: () => composing.current,
    onCompositionStart: () => {
      composing.current = true
      if (timer.current !== null) {
        clearTimeout(timer.current)
        timer.current = null
      }
    },
    onCompositionEnd: () => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        composing.current = false
      }, 10)
    },
  }
}

export function isImeSubmitKeydown(e: React.KeyboardEvent): boolean {
  const native = e.nativeEvent
  return native.isComposing === true || native.keyCode === 229
}

export function SelectNode({ node, onAction, answers }: {
  node: GenuiSelect
  onAction?: GenuiBlockProps['onAction']
  answers?: AnswersState | undefined
}) {
  const t = useT()
  const action = node.action
  const id = node.id
  const options = node.options.slice(0, GENUI_LIMITS.maxOptions)
  const restored = id !== undefined && answers?.fields !== undefined && Object.hasOwn(answers.fields, id)
    ? options.indexOf(answers!.fields[id]!)
    : -1
  const defaultValue = restored >= 0
    ? options[restored]!
    : node.selected !== undefined && options[node.selected] !== undefined
      ? options[node.selected]!
      : null
  const [value, setValue] = useState<string | null>(defaultValue)

  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    if (id !== undefined && defaultValue !== null) {
      answers?.setField(id, defaultValue)
    }

  }, [])
  const send = (v: string): void => {
    if (action !== undefined && onAction !== undefined) {
      onAction(action, { type: 'select', value: v, ...(id !== undefined ? { id } : {}) })
    }
  }
  return (
    <label className={css.field}>
      {node.label !== undefined && <span>{renderInline(node.label, false)}</span>}
      <select
        className={css.select}
        value={value ?? ''}
        onChange={e => {
          const v = e.currentTarget.value
          setValue(v)
          if (id !== undefined) answers?.setField(id, v)
          send(v)
        }}
      >
        {value === null && <option value="" hidden disabled>{t('block.selectPlaceholder')}</option>}
        {options.map((o, i) => <option key={i} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

export function InputNode({ node, onAction, answers }: {
  node: GenuiInput
  onAction?: GenuiBlockProps['onAction']
  answers?: AnswersState | undefined
}) {
  const t = useT()
  const action = node.action
  const id = node.id
  const secret = node.inputType === 'password'
  const numeric = node.inputType === 'number'
  const restored = !secret && id !== undefined && answers?.fields !== undefined && Object.hasOwn(answers.fields, id)
    ? answers.fields[id]
    : undefined

  const [value, setValue] = useState<string>(() => {
    const initial = secret ? '' : (restored ?? node.value ?? '')

    return node.inputType === 'color'
      ? /^#[0-9a-f]{6}$/i.test(initial) ? initial.toLowerCase() : '#000000'
      : initial
  })

  const lastSent = useRef<string | null>(value)
  const setField = answers?.setField
  const send = (submit: boolean): void => {
    if (numeric && value.trim() !== '' && parseDecimalNumber(value) === undefined) return
    if (action !== undefined && onAction !== undefined) {
      lastSent.current = value
      onAction(action, { type: 'input', value, ...(id !== undefined ? { id } : {}), ...(submit ? { submit: true } : {}) })
    }
  }
  const ime = useImeComposing()

  useEffect(() => {
    if (!secret && id !== undefined && value.trim() !== '') setField?.(id, value)
  }, [id, value, secret, setField])
  return (
    <label className={css.field}>
      {node.label !== undefined && <span>{renderInline(node.label, false)}</span>}
      <input
        className={css.input}
        type={numeric ? 'text' : node.inputType ?? 'text'}
        inputMode={numeric ? 'decimal' : undefined}
        style={node.inputType === 'color' ? {
          width: 64,
          height: 40,
          padding: 4,
          boxSizing: 'border-box',
          alignSelf: 'flex-start',
          cursor: 'pointer',
        } : undefined}
        placeholder={node.placeholder}
        value={value}
        onChange={e => {
          const v = e.currentTarget.value
          setValue(v)
          if (!secret && id !== undefined) answers?.setField(id, v)
        }}
        onBlur={() => {
          if (value !== lastSent.current) send(false)
        }}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onKeyDown={e => {
          if (e.key !== 'Enter') return
          if (ime.isComposing() || isImeSubmitKeydown(e)) return
          e.preventDefault()
          send(true)
        }}
      />
      {numeric && value.trim() !== '' && parseDecimalNumber(value) === undefined && <span role="alert">{t('block.invalidNumber')}</span>}
    </label>
  )
}

export function TextareaNode({ node, onAction, answers }: {
  node: GenuiTextarea
  onAction?: GenuiBlockProps['onAction']
  answers?: AnswersState | undefined
}) {
  const action = node.action
  const id = node.id

  const restored = id !== undefined && answers?.fields !== undefined && Object.hasOwn(answers.fields, id)
    ? answers.fields[id]
    : undefined
  const [value, setValue] = useState<string>(() => restored ?? node.value ?? '')

  const lastSent = useRef<string | null>(value)
  const send = (submit: boolean): void => {
    if (action !== undefined && onAction !== undefined) {
      lastSent.current = value
      onAction(action, { type: 'textarea', value, ...(id !== undefined ? { id } : {}), ...(submit ? { submit: true } : {}) })
    }
  }
  const ime = useImeComposing()

  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    if (id !== undefined && value.trim() !== '') {
      answers?.setField(id, value)
    }

  }, [])
  return (
    <label className={css.field}>
      {node.label !== undefined && <span>{renderInline(node.label, false)}</span>}
      <textarea
        className={css.textarea}
        placeholder={node.placeholder}
        rows={node.rows ?? 4}
        value={value}
        onChange={e => {
          const v = e.currentTarget.value
          setValue(v)
          if (id !== undefined) answers?.setField(id, v)
        }}
        onBlur={() => {
          if (value !== lastSent.current) send(false)
        }}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onKeyDown={e => {
          if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return
          if (ime.isComposing() || isImeSubmitKeydown(e)) return
          e.preventDefault()
          send(true)
        }}
      />
    </label>
  )
}
