import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'

afterEach(() => {
  cleanup()
})

function renderBlock(spec: unknown) {
  return render(
    <GenuiActionContext.Provider value={() => {}}>
      <GenuiBlock spec={repairGenuiSpec(spec)!} />
    </GenuiActionContext.Provider>,
  )
}

function valueText(container: HTMLElement): string | null | undefined {
  return container.querySelector('[class*="statValue"], [class*="heroValue"]')?.textContent
}

describe('stat value: decimal comma is not a thousands separator', () => {
  it('keeps a Russian decimal comma verbatim instead of multiplying by ten', () => {
    const { container } = renderBlock({
      items: [{ type: 'stat', label: 'Баланс', value: '1,6328 $' }],
    })
    expect(valueText(container)).toBe('1,6328$')
    expect(container.querySelector('[class*="statUnit"]')?.textContent).toBe('$')
  })

  it('keeps a comma in a percentage', () => {
    const { container } = renderBlock({
      items: [{ type: 'stat', label: 'Готовность', value: '99,9%' }],
    })
    expect(valueText(container)).toBe('99,9%')
  })

  it('keeps dot grouping plus comma decimals (ru long form) untouched', () => {
    const { container } = renderBlock({
      items: [{ type: 'stat', label: 'Оборот', value: '1.632,80 €' }],
    })
    expect(valueText(container)).toBe('1.632,80€')
  })

  it('does not count up a hero value with a decimal comma', () => {
    const { container } = renderBlock({
      items: [{ type: 'hero', title: 'Баланс', value: '1,6328 $' }],
    })
    expect(valueText(container)).toBe('1,6328$')
  })

  it('still splits a plain decimal and its unit (regression: "6.8 GB")', () => {
    const { container } = renderBlock({
      items: [{ type: 'stat', label: 'Память', value: '6.8 GB' }],
    })
    expect(valueText(container)).toBe('6.8GB')
  })

  it('still normalizes the unambiguous thousands shape', () => {
    const { container } = renderBlock({
      items: [{ type: 'stat', label: 'Requests', value: '1,234' }],
    })

    expect(valueText(container)).toBe('1234')
  })
})
