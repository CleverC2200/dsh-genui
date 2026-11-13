import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import {
  DataZoomComponent, DatasetComponent, GridComponent, LegendComponent, MarkAreaComponent,
  MarkLineComponent, MarkPointComponent, TitleComponent, TooltipComponent, TransformComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption, EChartsType } from 'echarts/core'

echarts.use([
  BarChart, LineChart, PieChart, ScatterChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  DataZoomComponent, MarkLineComponent, MarkAreaComponent, MarkPointComponent,
  DatasetComponent, TransformComponent,
  CanvasRenderer,
])

function createChart(el: HTMLElement, option: EChartsCoreOption, opts?: { height?: number }): EChartsType {
  const initOpts = opts !== undefined && opts.height !== undefined ? { height: opts.height } : undefined
  const instance = echarts.init(el, undefined, initOpts)
  instance.setOption(option)
  return instance
}

const win = globalThis as unknown as { __GenuiAssets__?: Record<string, unknown> }
const assets = win.__GenuiAssets__ ?? (win.__GenuiAssets__ = {})
assets.echartsCore = { createChart }
