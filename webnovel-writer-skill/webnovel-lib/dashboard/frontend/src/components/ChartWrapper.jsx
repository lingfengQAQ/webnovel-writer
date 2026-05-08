import { useEffect } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import { echarts, ensurePixelTheme } from '../lib/charts.js'

export default function ChartWrapper({
    option,
    className = '',
    height = 320,
    loading = false,
    onChartReady,
}) {
    useEffect(() => {
        ensurePixelTheme()
    }, [])

    return (
        <ReactEChartsCore
            className={`chart-box ${className}`.trim()}
            echarts={echarts}
            theme="pixel"
            option={option}
            style={{ height }}
            showLoading={loading}
            notMerge
            lazyUpdate
            opts={{ renderer: 'canvas' }}
            onChartReady={onChartReady}
        />
    )
}
