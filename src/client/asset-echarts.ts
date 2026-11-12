import { init as echartsInit, type EChartsType, type EChartsCoreOption } from 'echarts'
import 'echarts-wordcloud'

export interface EChartsAssetApi {

  createChart: (el: HTMLElement, option: EChartsCoreOption, opts?: { height?: number }) => EChartsType
}

function createChart(el: HTMLElement, option: EChartsCoreOption, opts?: { height?: number }): EChartsType {
  const initOpts = opts !== undefined && opts.height !== undefined ? { height: opts.height } : undefined
  const instance = echartsInit(el, undefined, initOpts)
  instance.setOption(option)
  return instance
}

const win = globalThis as unknown as { __GenuiAssets__?: Record<string, unknown> }
const assets = win.__GenuiAssets__ ?? (win.__GenuiAssets__ = {})
assets.echartsFull = { createChart }
