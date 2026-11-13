import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PlotBlock } from '../src/client/PlotBlock.tsx'

afterEach(cleanup)

describe('plot y-axis lock', () => {
  it('keeps y ticks stable while the curve changes on slider drag', () => {
    const { container } = render(<PlotBlock series={[
      { expr: 'a*x', label: '直线', params: [{ name: 'a', value: 1, min: 0, max: 5 }] },
    ]} />)

    const yTicksBefore = [...container.querySelectorAll('g')]
      .map(g => g.querySelector('text')?.textContent)
      .filter(Boolean)
      .filter(t => !t!.includes('.'))
    const polyBefore = container.querySelector('polyline')!.getAttribute('points')!

    const slider = container.querySelector('input[type="range"]') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '3' } })
    const yTicksAfter = [...container.querySelectorAll('g')]
      .map(g => g.querySelector('text')?.textContent)
      .filter(Boolean)
      .filter(t => !t!.includes('.'))
    const polyAfter = container.querySelector('polyline')!.getAttribute('points')!

    expect(yTicksAfter).toEqual(yTicksBefore)

    expect(polyAfter).not.toBe(polyBefore)
  })
})
