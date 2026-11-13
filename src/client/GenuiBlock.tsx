import { renderInline } from './inline.ts'
import { CopyPreviewContext, useCopyPreviewState } from './copy-preview-state.ts'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGenuiAction } from './action-context.ts'
import css from './GenuiBlock.module.css'
import { loadBlockState, saveBlockState } from './interaction-store.ts'
import { GENUI_LIMITS } from './genui-runtime/index.ts'
import { recordFence, recordInteraction } from './achievement-store.ts'
import { renderNode } from './blocks/render-node.tsx'
import type { AnswersState, GenuiBlockProps } from './blocks/state.ts'
import { collectHiddenKeys } from './conditions.ts'
import type { GenuiSpec } from './spec.ts'
import { compileSubmissionRegistry } from './submission-registry.ts'
import { evaluateComputed, resolveComputedSpec } from './computed.ts'
import { parseDecimalNumber } from './safe-math.ts'
import { isDatePickerValueValid } from './date-picker.ts'
import { walkGenuiNodes } from './walk-spec.ts'
import { repairMap } from './map-data.ts'

export const GENUI_ACTION_DEBOUNCE_MS = 300

function useDebouncedAction(onAction: GenuiBlockProps['onAction'] | undefined): GenuiBlockProps['onAction'] {
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const actionRef = useRef(onAction)
  actionRef.current = onAction

  useEffect(() => {
    return () => {
      for (const timer of pending.current.values()) clearTimeout(timer)
      pending.current.clear()
    }
  }, [])

  const debounced = useCallback((action: string, payload: Record<string, unknown>): void => {
    if (payload.type !== 'slider') {
      actionRef.current?.(action, payload)
      return
    }
    const key = `${action}\u0000${typeof payload.id === 'string' ? payload.id : ''}`
    const existing = pending.current.get(key)
    if (existing !== undefined) clearTimeout(existing)
    pending.current.set(key, setTimeout(() => {
      pending.current.delete(key)
      actionRef.current?.(action, payload)
    }, GENUI_ACTION_DEBOUNCE_MS))
  }, [])

  return onAction === undefined ? undefined : debounced
}

function specEquivalent(a: GenuiSpec, b: GenuiSpec): boolean {
  if (a === b) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

function GenuiBlockInstance({ spec, stateKey, animateEntrance = true, initialState, onStateChange, onStateSnapshot }: GenuiBlockProps) {
  const gap = spec.gap ?? 16
  const copyPreviews = useCopyPreviewState(spec)
  const onAction = useDebouncedAction(useGenuiAction())
  const stateChangeRef = useRef(onStateChange)
  stateChangeRef.current = onStateChange
  const savesExternally = onStateChange !== undefined

  const [persisted] = useState(() => initialState ?? (onStateChange !== undefined || stateKey === undefined ? null : loadBlockState(stateKey)))
  const [storedAnswers, setAnswers] = useState<Record<string, string>>(persisted?.answers ?? {})
  const [storedMultiAnswers, setMultiAnswers] = useState<Record<string, string[]>>(persisted?.multiAnswers ?? {})
  const fieldKinds = useMemo(() => {
    const numeric = new Set<string>()
    const secret = new Set<string>()
    const declared = new Set<string>()
    const fieldOptions = new Map<string, Set<string>>()
    const segmentedDefaults = new Map<string, string>()
    const datePickers = new Map<string, { mode: 'single' | 'range'; min?: string; max?: string }>()
    walkGenuiNodes(spec, node => {
      if ((node.type === 'input' || node.type === 'textarea' || node.type === 'editor' || node.type === 'select' || node.type === 'slider' || node.type === 'map' || node.type === 'date-picker' || node.type === 'segmented-control' || node.type === 'diagram') && node.id !== undefined) declared.add(node.id)
      if (node.type === 'date-picker' && node.id !== undefined) {
        datePickers.set(node.id, { mode: node.mode ?? 'single', ...(node.min === undefined ? {} : { min: node.min }), ...(node.max === undefined ? {} : { max: node.max }) })
      }
      if (node.type === 'map' && node.id !== undefined) {
        fieldOptions.set(node.id, new Set(repairMap(node)?.locations.map(location => location.id)))
      }
      if (node.type === 'segmented-control' && node.id !== undefined) {
        fieldOptions.set(node.id, new Set(node.options))
        if (node.value !== undefined && node.options.includes(node.value)) segmentedDefaults.set(node.id, node.value)
      }
      if (node.type === 'diagram' && node.id !== undefined) {
        fieldOptions.set(node.id, new Set(node.nodes.slice(0, GENUI_LIMITS.maxDiagramNodes).map(item => item.id)))
      }
      if (node.type !== 'input' || node.id === undefined) return
      if (node.inputType === 'number') numeric.add(node.id)
      if (node.inputType === 'password') secret.add(node.id)
    })
    return { numeric, secret, declared, fieldOptions, datePickers, segmentedDefaults }
  }, [spec])
  const secretFields = fieldKinds.secret

  const [fieldState, setFieldState] = useState(() => {
    const fields = Object.fromEntries(Object.entries(persisted?.fields ?? {}).filter(([id]) => !secretFields.has(id)))
    const numericValues = Object.fromEntries(Object.entries(fields).filter(([id, value]) =>
      fieldKinds.numeric.has(id) && (value.trim() === '' || parseDecimalNumber(value) !== undefined)))
    return { fields, numericValues }
  })
  const fields = useMemo(() => Object.fromEntries(Object.entries(fieldState.fields)
    .filter(([id]) => fieldKinds.declared.has(id) && !secretFields.has(id))
    .map(([id, value]) => {
      const datePicker = fieldKinds.datePickers.get(id)
      if (datePicker !== undefined && value !== '' && !isDatePickerValueValid(value, datePicker.mode, datePicker.min, datePicker.max)) return [id, '']
      return [id, fieldKinds.fieldOptions.get(id)?.has(value) === false ? (fieldKinds.segmentedDefaults.get(id) ?? '') : value]
    })), [fieldState.fields, fieldKinds, secretFields])

  useEffect(() => {
    setFieldState(prev => {
      const entries = Object.entries(prev.fields).filter(([id]) => fieldKinds.declared.has(id) && !secretFields.has(id))
        .map(([id, value]): [string, string] => {
          const datePicker = fieldKinds.datePickers.get(id)
          if (datePicker !== undefined && value !== '' && !isDatePickerValueValid(value, datePicker.mode, datePicker.min, datePicker.max)) return [id, '']
          return [id, fieldKinds.fieldOptions.get(id)?.has(value) === false ? (fieldKinds.segmentedDefaults.get(id) ?? '') : value]
        })
      if (entries.length === Object.keys(prev.fields).length && entries.every(([id, value]) => prev.fields[id] === value)) return prev
      return { fields: Object.fromEntries(entries), numericValues: Object.fromEntries(Object.entries(prev.numericValues)
        .filter(([id]) => fieldKinds.numeric.has(id) && !secretFields.has(id))) }
    })
  }, [fieldKinds, secretFields])
  const computedSpec = useMemo(() => {
    const numericValues = Object.fromEntries(Object.entries(fieldState.numericValues).filter(([id]) => fieldKinds.numeric.has(id)))
    return resolveComputedSpec(spec, evaluateComputed(spec, { ...fields, ...numericValues }))
  }, [spec, fields, fieldState.numericValues, fieldKinds])
  const submissionRegistry = useMemo(() => compileSubmissionRegistry(computedSpec), [computedSpec])
  const answers = useMemo(() => Object.fromEntries(Object.entries(storedAnswers).filter(([group, choice]) => {
    const member = submissionRegistry.members.get(group)
    return member?.kind === 'radio' && member.options.includes(choice)
  })), [storedAnswers, submissionRegistry])
  const multiAnswers = useMemo(() => Object.fromEntries(Object.entries(storedMultiAnswers).flatMap(([group, choices]) => {
    const member = submissionRegistry.members.get(group)
    return member?.kind === 'checkbox' ? [[group, choices.filter(choice => member.choices.has(choice))]] : []
  })), [storedMultiAnswers, submissionRegistry])
  const [locked, setLocked] = useState(persisted?.locked === true)
  const [round, setRound] = useState(0)

  const invalidNumericFields = useMemo(() => new Set(Object.entries(fields)
    .filter(([id, value]) => fieldKinds.numeric.has(id) && value.trim() !== '' && parseDecimalNumber(value) === undefined)
    .map(([id]) => id)), [fields, fieldKinds])

  const hiddenKeys = useMemo(
    () => collectHiddenKeys(computedSpec.items, { fields, answers, multiAnswers }),
    [computedSpec, fields, answers, multiAnswers],
  )
  const setAnswer = useCallback((group: string, choice: string) => {
    setAnswers(prev => (prev[group] === choice ? prev : { ...prev, [group]: choice }))
  }, [])
  const setMultiAnswer = useCallback((group: string, choice: string, checked: boolean) => {
    setMultiAnswers(prev => {
      const current = prev[group] ?? []
      const next = checked
        ? current.includes(choice) ? current : [...current, choice]
        : current.filter(item => item !== choice)
      const hadGroup = Object.prototype.hasOwnProperty.call(prev, group)
      if (hadGroup && next.length === current.length && next.every((item, index) => item === current[index])) {
        return prev
      }

      return { ...prev, [group]: next }
    })
  }, [])
  const setField = useCallback((id: string, value: string) => {

    if (secretFields.has(id)) return
    setFieldState(prev => {
      const validNumber = fieldKinds.numeric.has(id) && (value.trim() === '' || parseDecimalNumber(value) !== undefined)
      let numericValues = prev.numericValues
      if (validNumber && numericValues[id] !== value) numericValues = { ...numericValues, [id]: value }
      else if (!fieldKinds.numeric.has(id) && Object.hasOwn(numericValues, id)) {
        numericValues = { ...numericValues }
        delete numericValues[id]
      }
      if (Object.hasOwn(prev.fields, id) && prev.fields[id] === value && numericValues === prev.numericValues) return prev
      return {
        fields: { ...prev.fields, [id]: value },
        numericValues,
      }
    })
  }, [fieldKinds, secretFields])
  const clear = useCallback(() => {
    setAnswers({})
    setMultiAnswers({})
    setLocked(false)
    setRound(r => r + 1)
  }, [])
  const answersState = useMemo<AnswersState>(
    () => ({
      answers, multiAnswers, fields, secretFields, invalidNumericFields, hidden: hiddenKeys, conditionHidden: hiddenKeys, registry: submissionRegistry, locked, round,
      setAnswer, setMultiAnswer, setField, clear, setLocked,
    }),
    [answers, multiAnswers, fields, secretFields, invalidNumericFields, hiddenKeys, submissionRegistry, locked, round, setAnswer, setMultiAnswer, setField, clear],
  )
  const durableState = useMemo(() => {
    const safeFields = Object.fromEntries(Object.entries(fields).filter(([id]) => !secretFields.has(id)))
    return {
      answers,
      ...(Object.keys(multiAnswers).length > 0 ? { multiAnswers } : {}),
      locked,
      ...(Object.keys(safeFields).length > 0 ? { fields: safeFields } : {}),
    }
  }, [answers, multiAnswers, locked, fields, secretFields])
  useEffect(() => {
    onStateSnapshot?.(durableState)
  }, [durableState, onStateSnapshot])
  const durableRef = useRef(durableState)
  durableRef.current = durableState

  useEffect(() => () => {
    if (!savesExternally && stateKey !== undefined) saveBlockState(stateKey, durableRef.current)
  }, [stateKey, savesExternally])

  const trackedAction = useMemo(() => {
    if (onAction === undefined) return undefined
    return (action: string, payload: Record<string, unknown>): void => {
      recordInteraction()
      onAction(action, payload)
    }
  }, [onAction])

  useEffect(() => {
    if (savesExternally) {
      stateChangeRef.current?.(durableState)
      return
    }
    if (stateKey === undefined) return
    const timer = setTimeout(() => saveBlockState(stateKey, durableState), 300)
    return () => clearTimeout(timer)
  }, [stateKey, durableState, savesExternally])

  useEffect(() => {
    recordFence(spec)
  }, [spec])
  return (
    <CopyPreviewContext.Provider value={copyPreviews}>
      <div className={css.block} data-genui>
        {computedSpec.title !== undefined && <div className={css.banner}>{renderInline(computedSpec.title)}</div>}
        <div className={css.col} style={{ gap: `${gap}px` }}>
          {computedSpec.items.map((c, i) => (

            <div
              key={i}
              className={css.reveal}
              style={{
                animationDelay: `${Math.min(i * 90, 160)}ms`,
                ...(!animateEntrance || persisted !== null ? { animation: 'none' } : {}),
              }}
              onAnimationEnd={event => {

                if (event.target === event.currentTarget) event.currentTarget.style.animation = 'none'
              }}
            >
              {renderNode(c, i, trackedAction, 0, answersState)}
            </div>
          ))}
        </div>
      </div>
    </CopyPreviewContext.Provider>
  )
}

export const GenuiBlock = memo(function GenuiBlock(props: GenuiBlockProps) {
  const [identity, setIdentity] = useState({ stateKey: props.stateKey, generation: 0 })
  if (identity.stateKey !== props.stateKey) {
    setIdentity({
      stateKey: props.stateKey,
      generation: identity.generation + (identity.stateKey === undefined ? 0 : 1),
    })
  }
  return <GenuiBlockInstance key={identity.generation} {...props} />
}, (prev, next) => prev.stateKey === next.stateKey
  && prev.animateEntrance === next.animateEntrance && prev.onStateChange === next.onStateChange
  && prev.onStateSnapshot === next.onStateSnapshot
  && specEquivalent(prev.spec, next.spec))
