import { renderInline } from '../inline.ts'
import { useEffect, useState } from 'react'
import css from '../GenuiBlock.module.css'
import type { GenuiCheckbox } from '../spec.ts'
import { GENUI_CHECKBOX_VALUE } from '../spec.ts'
import type { AnswersState, GenuiBlockProps } from './state.ts'

export function CheckboxNode({ node, onAction, answers }: {
  node: GenuiCheckbox
  onAction?: GenuiBlockProps['onAction']
  answers?: AnswersState | undefined
}) {
  const group = node.group
  const value = node[GENUI_CHECKBOX_VALUE] ?? node.label
  const grouped = group !== undefined
  const hasRecordedGroup = group !== undefined
    && Object.prototype.hasOwnProperty.call(answers?.multiAnswers ?? {}, group)
  const recorded = group === undefined ? undefined : answers?.multiAnswers[group]
  const groupChecked = hasRecordedGroup
    ? Array.isArray(recorded) && recorded.includes(value)
    : node.checked === true
  const [checked, setChecked] = useState(node.checked === true)

  useEffect(() => {
    if (group === undefined || node.checked !== true || hasRecordedGroup) return

    answers?.setMultiAnswer(group, value, true)

  }, [group, node.checked, value, hasRecordedGroup])

  return (
    <label className={css.checkbox}>
      <input
        type="checkbox"
        checked={grouped ? groupChecked : checked}
        onChange={e => {
          const next = e.currentTarget.checked
          setChecked(next)
          if (grouped) {

            answers?.setMultiAnswer(group, value, next)
          } else if (node.action !== undefined && onAction !== undefined) {
            onAction(node.action, { type: 'checkbox', checked: next })
          }
        }}
      />
      <span>{renderInline(node.label, false)}</span>
    </label>
  )
}
