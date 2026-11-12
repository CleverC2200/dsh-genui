import { cleanup, render, act, type ReactNode } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useEffect, useRef } from 'react'
import { PlotBlock } from '../src/client/PlotBlock.tsx'

afterEach(cleanup)

function ScrollHost({ seen, children }: { seen: boolean[]; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const onWheel = (e: Event): void => { seen.push(e.defaultPrevented) }
    el.addEventListener('wheel', onWheel)
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  return <div ref={ref} style={{ height: 400, overflowY: 'auto' }}>{children}</div>
}

function mockRect(svg: Element): void {
  svg.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 480, height: 320,
    right: 480, bottom: 320, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect)
}

const wheelAt = (svg: Element, deltaY: number, modifier = false): void => {
  act(() => {
    svg.dispatchEvent(new WheelEvent('wheel', {
      deltaY, clientX: 240, clientY: 160, bubbles: true, cancelable: true,
      metaKey: modifier, ctrlKey: modifier,
    }))
  })
}

describe('plot wheel-to-zoom lock', () => {
  it('leaves an unmodified wheel to the page so the conversation still scrolls', () => {
    const seen: boolean[] = []
    const { container } = render(
      <ScrollHost seen={seen}><PlotBlock series={[{ expr: 'sin(x)' }]} /></ScrollHost>,
    )
    const svg = container.querySelector('[data-genui-plot] svg') as Element
    mockRect(svg)
    const before = container.querySelector('polyline')!.getAttribute('points')!
    wheelAt(svg, -120)

    for (const prevented of seen) expect(prevented).toBe(false)
    expect(container.querySelector('polyline')!.getAttribute('points')).toBe(before)
  })

  it('cancels a MODIFIED wheel before it reaches the scroll container (#63)', () => {
    const seen: boolean[] = []
    const { container } = render(
      <ScrollHost seen={seen}><PlotBlock series={[{ expr: 'sin(x)' }]} /></ScrollHost>,
    )
    const svg = container.querySelector('[data-genui-plot] svg') as Element
    expect(svg).not.toBeNull()
    mockRect(svg)

    wheelAt(svg, -120, true)
    wheelAt(svg, 120, true)

    expect(seen.length).toBeGreaterThan(0)
    for (const prevented of seen) expect(prevented).toBe(true)
  })

  it('still zooms the curve around the cursor x-position', () => {
    const seen: boolean[] = []
    const { container } = render(
      <ScrollHost seen={seen}><PlotBlock series={[{ expr: 'sin(x)' }]} /></ScrollHost>,
    )
    const svg = container.querySelector('[data-genui-plot] svg') as Element
    mockRect(svg)
    const polyBefore = container.querySelector('polyline')!.getAttribute('points')!

    wheelAt(svg, -120, true)

    const polyAfter = container.querySelector('polyline')!.getAttribute('points')!
    expect(polyAfter).not.toBe(polyBefore)

    expect(polyAfter).not.toContain('NaN')

    expect(Number.isFinite(Number(polyAfter.trim().split(/[\s,]+/)[1]))).toBe(true)
  })
})
