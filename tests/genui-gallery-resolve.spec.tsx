import { describe, expect, it } from 'vitest'
import { gallerySpec } from '../src/client/gallery.ts'
import { resolveGenuiSpec } from '../src/client/fence-render.tsx'
import { validateRenderableChartSemantics } from '../src/plugin/chart-contract.ts'

describe('gallery through the real fence path', () => {
  it('resolves to a renderable spec', () => {
    const raw = JSON.stringify(gallerySpec)
    const chartErrors = validateRenderableChartSemantics(gallerySpec)
    const spec = resolveGenuiSpec(raw)
    expect(chartErrors).toEqual([])
    expect(spec, `resolveGenuiSpec returned null (chartErrors=${JSON.stringify(chartErrors)})`).not.toBeNull()
  })
})
