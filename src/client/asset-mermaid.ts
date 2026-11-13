import { renderMermaid } from './mermaid-core.ts'
import { assertSafeSvg, repairMermaidSource } from './mermaid-safe.ts'

const win = globalThis as unknown as { __GenuiAssets__?: Record<string, unknown> }
const assets = win.__GenuiAssets__ ?? (win.__GenuiAssets__ = {})
assets.mermaid = { assertSafeSvg, repairMermaidSource, renderMermaid }
