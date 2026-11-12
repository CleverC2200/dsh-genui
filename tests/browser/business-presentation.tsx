import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { GenuiBlock } from '../../src/client/GenuiBlock.tsx'
import { GenuiActionContext } from '../../src/client/action-context.ts'
import { STANDALONE_THEME_CSS } from '../../src/client/artifact/standalone-theme.ts'
import { parseGenuiSpec, type GenuiSpec } from '../../src/client/spec.ts'
import data from '../fixtures/business-presentation.json'

type MountOptions = { width?: 360 | 960; hostFontSize?: 14 | 17 | 22; reset?: boolean }
type FixtureId = keyof typeof data.specs
const container = document.getElementById('root')!
const root = createRoot(container)
const style = document.createElement('style')
style.textContent = STANDALONE_THEME_CSS
document.head.append(style)
let revision = 0

const fixture = {
  events: [] as Array<{ action: string; payload: Record<string, unknown> }>,
  provenance: data.provenance,
  mount(spec: GenuiSpec, { width = 960, hostFontSize = 17, reset = true }: MountOptions = {}) {
    container.style.width = `${width}px`
    container.style.maxWidth = '100%'
    container.style.setProperty('--dsh-content-font-size', `${hostFontSize}px`)
    container.style.fontSize = `${hostFontSize}px`
    if (reset) {
      revision += 1
      fixture.events.length = 0
    }
    flushSync(() => root.render(
      <GenuiActionContext.Provider value={(action, payload) => { fixture.events.push({ action, payload }) }}>
        <GenuiBlock key={revision} spec={spec} animateEntrance={false} />
      </GenuiActionContext.Provider>,
    ))
  },
  mountCase(id: FixtureId, options?: MountOptions) {
    const spec = parseGenuiSpec(JSON.stringify(data.specs[id]))
    if (!spec) throw new Error(`Invalid business presentation fixture: ${id}`)
    fixture.mount(spec, options)
  },
}

Object.assign(window, { genuiPresentation: fixture })
fixture.mountCase('pagination')
