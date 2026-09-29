import type { GenuiEChart } from './spec.ts'

export const CORE_PRESETS: ReadonlySet<string> = new Set(['bar', 'line', 'area', 'pie', 'scatter', 'bigline'])

/** Choose the ECharts asset according to the preset rules shared with the renderer. */
export function echartEngineFor(node: GenuiEChart): 'echarts-core' | 'echarts-full' {
  if (node.option !== undefined) return 'echarts-full'
  return CORE_PRESETS.has(node.preset ?? 'bar') ? 'echarts-core' : 'echarts-full'
}
