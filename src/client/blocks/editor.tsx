import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import type { GenuiEditor } from '../spec.ts'
import { GENUI_LIMITS } from '../genui-runtime/index.ts'
import { useT } from '../i18n/index.ts'
import { writeClipboard } from '../primitive-adapter.ts'
import type { AnswersState } from './state.ts'
import css from './editor.module.css'

export function EditorNode({ node, answers }: { node: GenuiEditor; answers?: AnswersState | undefined }): ReactElement {
  const t = useT()
  const id = useId()
  const [localValue, setLocalValue] = useState(node.value)
  const [copied, setCopied] = useState(false)
  const [edited, setEdited] = useState(false)
  const touched = useRef(false)
  const draft = answers !== undefined && Object.hasOwn(answers.fields, node.id)
    ? answers.fields[node.id] : undefined
  const initialDraft = useRef(draft)
  const registeredDefault = useRef<string | undefined>(undefined)
  const value = initialDraft.current === undefined ? localValue : draft ?? localValue

  useEffect(() => {
    if (initialDraft.current !== undefined || touched.current) return
    setLocalValue(node.value)
    if (node.value.trim() !== '') {
      registeredDefault.current = node.value
      answers?.setField(node.id, node.value)
    } else if (registeredDefault.current !== undefined) {
      registeredDefault.current = undefined
      answers?.setField(node.id, '')
    }
  }, [answers?.setField, node.id, node.value])

  const updateValue = (next: string): void => {
    touched.current = true
    setLocalValue(next)
    answers?.setField(node.id, next)
    setEdited(true)
  }

  const copyValue = (): void => {
    void writeClipboard(value).then((ok) => {
      if (ok) {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }
    })
  }

  const labelId = `genui-editor-${id}`
  return (
    <section className={css.editor} data-genui-editor>
      <div className={css.toolbar}>
        <label className={css.label} htmlFor={labelId}>{node.label ?? t('block.editor')}</label>
        <span className={css.status} role="status">{t(edited ? 'block.editorSaved' : 'block.editorSaving')}</span>
        <button type="button" className={css.copy} onClick={copyValue}>
          {copied ? t('label.copiedShort') : t('label.copy')}
        </button>
      </div>
      <textarea
        id={labelId}
        className={css.textarea}
        value={value}
        placeholder={node.placeholder}
        rows={node.rows ?? 8}
        maxLength={GENUI_LIMITS.maxEditorChars}
        onChange={event => updateValue(event.currentTarget.value)}
        aria-describedby={`${labelId}-status`}
      />
      <span id={`${labelId}-status`} className={css.visuallyHidden}>{t(edited ? 'block.editorSaved' : 'block.editorSaving')}</span>
    </section>
  )
}
