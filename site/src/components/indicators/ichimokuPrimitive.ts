/**
 * Ichimoku Senkou cloud primitive — ported from M4D-REF ichimokuCloudPrimitive.ts
 * Opacity halved to 50% of original.
 */
import type {
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer as IPrimitivePaneRenderer,
  Time,
} from 'lightweight-charts'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type { Bar } from './indicatorMath'

// 50% of ref: fill 0.1 → 0.05, stroke 0.52 → 0.26
const FILL_ALPHA = 0.05
const LINE_ALPHA = 0.26

function cloudFill(a: number, b: number): string {
  return a >= b
    ? `rgba(46, 204, 113, ${FILL_ALPHA})`
    : `rgba(255, 23, 68, ${FILL_ALPHA})`
}
function cloudStroke(a: number, b: number): string {
  return a >= b
    ? `rgba(46, 204, 113, ${LINE_ALPHA})`
    : `rgba(255, 23, 68, ${LINE_ALPHA})`
}

export function createIchimokuCloudPrimitive(
  bars: Bar[],
  senkouA: number[],
  senkouB: number[],
): ISeriesPrimitive {
  let chart: IChartApiBase | null = null
  let series: ISeriesApi<'Candlestick'> | null = null
  let onRange: (() => void) | null = null

  const fillView = {
    zOrder: () => 'normal' as const,
    renderer: (): IPrimitivePaneRenderer => ({
      draw: () => {},
      drawBackground: (target: CanvasRenderingTarget2D) => {
        if (!chart || !series || bars.length < 2) return
        const ts = chart.timeScale()
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          for (let i = 0; i < bars.length - 1; i++) {
            const a0 = senkouA[i]!, b0 = senkouB[i]!
            const a1 = senkouA[i + 1]!, b1 = senkouB[i + 1]!
            if (!isFinite(a0) || !isFinite(b0) || !isFinite(a1) || !isFinite(b1)) continue
            const x0 = ts.timeToCoordinate(bars[i]!.time as Time)
            const x1 = ts.timeToCoordinate(bars[i + 1]!.time as Time)
            if (x0 === null || x1 === null) continue
            const yHi0 = series!.priceToCoordinate(Math.max(a0, b0))
            const yLo0 = series!.priceToCoordinate(Math.min(a0, b0))
            const yHi1 = series!.priceToCoordinate(Math.max(a1, b1))
            const yLo1 = series!.priceToCoordinate(Math.min(a1, b1))
            if (yHi0 === null || yLo0 === null || yHi1 === null || yLo1 === null) continue
            ctx.fillStyle = cloudFill((a0 + a1) / 2, (b0 + b1) / 2)
            ctx.beginPath()
            ctx.moveTo(x0, yHi0); ctx.lineTo(x1, yHi1)
            ctx.lineTo(x1, yLo1); ctx.lineTo(x0, yLo0)
            ctx.closePath(); ctx.fill()
          }
        })
      },
    }),
  }

  const lineView = {
    zOrder: () => 'top' as const,
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (target: CanvasRenderingTarget2D) => {
        if (!chart || !series || bars.length < 2) return
        const ts = chart.timeScale()
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          ctx.lineWidth = 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
          for (let i = 0; i < bars.length - 1; i++) {
            const a0 = senkouA[i]!, b0 = senkouB[i]!
            const a1 = senkouA[i + 1]!, b1 = senkouB[i + 1]!
            if (!isFinite(a0) || !isFinite(b0) || !isFinite(a1) || !isFinite(b1)) continue
            const x0 = ts.timeToCoordinate(bars[i]!.time as Time)
            const x1 = ts.timeToCoordinate(bars[i + 1]!.time as Time)
            if (x0 === null || x1 === null) continue
            const ya0 = series!.priceToCoordinate(a0), ya1 = series!.priceToCoordinate(a1)
            const yb0 = series!.priceToCoordinate(b0), yb1 = series!.priceToCoordinate(b1)
            if (ya0 === null || ya1 === null || yb0 === null || yb1 === null) continue
            const stroke = cloudStroke((a0 + a1) / 2, (b0 + b1) / 2)
            ctx.strokeStyle = stroke
            ctx.beginPath(); ctx.moveTo(x0, ya0); ctx.lineTo(x1, ya1); ctx.stroke()
            ctx.beginPath(); ctx.moveTo(x0, yb0); ctx.lineTo(x1, yb1); ctx.stroke()
          }
        })
      },
    }),
  }

  return {
    attached: (param) => {
      chart = param.chart
      series = param.series as ISeriesApi<'Candlestick'>
      onRange = () => param.requestUpdate()
      param.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange)
      queueMicrotask(() => param.requestUpdate())
    },
    detached: () => {
      if (chart && onRange) chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange)
      chart = null; series = null; onRange = null
    },
    paneViews: () => [fillView, lineView],
  }
}
