import { loadGenuiAsset } from './asset-loader.ts'
export { CORE_PRESETS } from './echarts-engine.ts'

export interface EChartsInstance {
  setOption: (opt: unknown, notMerge?: boolean) => void
  resize: () => void
  dispose: () => void
}

interface EChartsAssetApi {
  createChart: (el: HTMLElement, option: unknown, opts?: { height?: number }) => EChartsInstance
}

export async function createChart(
  el: HTMLElement,
  option: unknown,
  opts?: { height?: number },
  engine: 'core' | 'full' = 'core',
): Promise<EChartsInstance> {
  const api = await loadGenuiAsset<EChartsAssetApi>(engine === 'full' ? 'echarts-full' : 'echarts-core')
  return api.createChart(el, option, opts)
}
