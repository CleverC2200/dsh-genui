import { ICONS_FULL } from './icon-data-full.ts'

const win = globalThis as unknown as { __GenuiAssets__?: Record<string, unknown> }
const assets = win.__GenuiAssets__ ?? (win.__GenuiAssets__ = {})
assets.icons = ICONS_FULL
