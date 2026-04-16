import { BarChart, BoxplotChart, CustomChart, GraphChart, LineChart, PieChart } from 'echarts/charts'
import {
    GridComponent,
    LegendComponent,
    MarkLineComponent,
    TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import * as echarts from 'echarts/core'

echarts.use([
    LineChart,
    BarChart,
    PieChart,
    BoxplotChart,
    GraphChart,
    CustomChart,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    MarkLineComponent,
    CanvasRenderer,
])

export { echarts }

const PIXEL_THEME_NAME = 'pixel'

const PIXEL_THEME = {
    color: ['#26a8ff', '#f5a524', '#7f5af0', '#2ec27e', '#d7263d', '#00b8d4', '#ff5c8a'],
    backgroundColor: 'transparent',
    textStyle: {
        fontFamily: "'Noto Sans SC', 'Microsoft YaHei', sans-serif",
        color: '#2a220f',
    },
    title: {
        textStyle: {
            fontFamily: "'Press Start 2P', monospace",
            fontSize: 11,
            color: '#2a220f',
        },
    },
    legend: {
        textStyle: {
            color: '#5d5035',
            fontSize: 13,
            fontWeight: 600,
        },
    },
    tooltip: {
        backgroundColor: '#fffaf0',
        borderColor: '#2a220f',
        borderWidth: 2,
        textStyle: {
            color: '#2a220f',
            fontSize: 13,
        },
        extraCssText: 'border-radius:0;box-shadow:3px 3px 0 #2a220f;',
    },
    categoryAxis: {
        axisLine: { lineStyle: { color: '#8f7f5c', width: 2 } },
        axisTick: { lineStyle: { color: '#8f7f5c' } },
        axisLabel: { color: '#8f7f5c', fontSize: 12 },
        splitLine: { lineStyle: { color: '#e8dcc4', type: 'dashed' } },
    },
    valueAxis: {
        axisLine: { lineStyle: { color: '#8f7f5c', width: 2 } },
        axisTick: { lineStyle: { color: '#8f7f5c' } },
        axisLabel: { color: '#8f7f5c', fontSize: 12 },
        splitLine: { lineStyle: { color: '#e8dcc4', type: 'dashed' } },
    },
    grid: { left: 50, right: 24, top: 30, bottom: 48 },
}

let themeRegistered = false

export const STRAND_COLORS = {
    quest: '#26a8ff',
    fire: '#ff5c8a',
    constellation: '#7f5af0',
}

export const FORESHADOWING_COLORS = {
    overdue: '#d7263d',
    urgent: '#f5a524',
    active: '#26a8ff',
    resolved: '#2ec27e',
}

export function ensurePixelTheme() {
    if (themeRegistered) return
    echarts.registerTheme(PIXEL_THEME_NAME, PIXEL_THEME)
    themeRegistered = true
}

function quantile(sortedValues, ratio) {
    if (!sortedValues.length) return 0
    const index = (sortedValues.length - 1) * ratio
    const lower = Math.floor(index)
    const upper = Math.ceil(index)
    if (lower === upper) return sortedValues[lower]
    const weight = index - lower
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

export function buildBoxplotData(groups) {
    return groups.map(group => {
        const values = [...group.values]
            .map(item => Number(item))
            .filter(item => Number.isFinite(item))
            .sort((left, right) => left - right)

        if (!values.length) return [0, 0, 0, 0, 0]

        return [
            values[0],
            quantile(values, 0.25),
            quantile(values, 0.5),
            quantile(values, 0.75),
            values[values.length - 1],
        ].map(item => Math.round(item))
    })
}
