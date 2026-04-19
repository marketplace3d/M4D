/**
 * EMA ribbon primitive — ported from M4D-REF emaRibbonPrimitive.ts
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

// 50% of ref: fill 0.12 → 0.06, line 0.27 → 0.135
const FILL_ALPHA = 0.06
const LINE_ALPHA = 0.135
const EPS = 1e-9

function fillRgba(bull: boolean): string {
  return bull ? `rgba(46, 204, 113, ${FILL_ALPHA})` : `rgba(255, 23, 68, ${FILL_ALPHA})`
}
function strokeStyle(bull: boolean): string {
  return bull ? `rgba(46, 204, 113, ${LINE_ALPHA})` : `rgba(255, 23, 68, ${LINE_ALPHA})`
}

export function createEmaRibbonPrimitive(
  bars: Bar[],
  emaFast: number[],
  emaSlow: number[],
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
            const f0 = emaFast[i]!, f1 = emaFast[i + 1]!
            const s0 = emaSlow[i]!, s1 = emaSlow[i + 1]!
            if (!isFinite(f0) || !isFinite(f1) || !isFinite(s0) || !isFinite(s1)) continue
            const x0 = ts.timeToCoordinate(bars[i]!.time as Time)
            const x1 = ts.timeToCoordinate(bars[i + 1]!.time as Time)
            if (x0 === null || x1 === null) continue

            const denom = f1 - f0 - (s1 - s0)
            let tCross: number | null = null
            if (Math.abs(denom) > EPS) {
              const t = (s0 - f0) / denom
              if (t > EPS && t < 1 - EPS) tCross = t
            }

            const fillQuad = (xa: number, xb: number, fa: number, fb: number, sa: number, sb: number, bull: boolean) => {
              const yHiA = series!.priceToCoordinate(Math.max(fa, sa))
              const yLoA = series!.priceToCoordinate(Math.min(fa, sa))
              const yHiB = series!.priceToCoordinate(Math.max(fb, sb))
              const yLoB = series!.priceToCoordinate(Math.min(fb, sb))
              if (yHiA === null || yLoA === null || yHiB === null || yLoB === null) return
              ctx.fillStyle = fillRgba(bull)
              ctx.beginPath()
              ctx.moveTo(xa, yHiA); ctx.lineTo(xb, yHiB)
              ctx.lineTo(xb, yLoB); ctx.lineTo(xa, yLoA)
              ctx.closePath(); ctx.fill()
            }

            if (tCross == null) {
              fillQuad(x0, x1, f0, f1, s0, s1, (f0 + f1) / 2 >= (s0 + s1) / 2)
              continue
            }

            const tc = Number(bars[i]!.time) + tCross * (Number(bars[i + 1]!.time) - Number(bars[i]!.time))
            const xC = ts.timeToCoordinate(tc as Time)
            if (xC === null) continue
            const fc = f0 + tCross * (f1 - f0)
            const yC = series!.priceToCoordinate(fc)
            if (yC === null) continue

            const yHi0 = series!.priceToCoordinate(Math.max(f0, s0))
            const yLo0 = series!.priceToCoordinate(Math.min(f0, s0))
            const yHi1 = series!.priceToCoordinate(Math.max(f1, s1))
            const yLo1 = series!.priceToCoordinate(Math.min(f1, s1))
            if (yHi0 === null || yLo0 === null || yHi1 === null || yLo1 === null) continue

            ctx.fillStyle = fillRgba(f0 >= s0)
            ctx.beginPath(); ctx.moveTo(x0, yHi0); ctx.lineTo(xC, yC); ctx.lineTo(x0, yLo0); ctx.closePath(); ctx.fill()

            ctx.fillStyle = fillRgba(f1 >= s1)
            ctx.beginPath(); ctx.moveTo(xC, yC); ctx.lineTo(x1, yHi1); ctx.lineTo(x1, yLo1); ctx.closePath(); ctx.fill()
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
          ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
          for (let i = 0; i < bars.length - 1; i++) {
            const f0 = emaFast[i]!, f1 = emaFast[i + 1]!
            const s0 = emaSlow[i]!, s1 = emaSlow[i + 1]!
            if (!isFinite(f0) || !isFinite(f1) || !isFinite(s0) || !isFinite(s1)) continue
            const x0 = ts.timeToCoordinate(bars[i]!.time as Time)
            const x1 = ts.timeToCoordinate(bars[i + 1]!.time as Time)
            if (x0 === null || x1 === null) continue

            const yf0 = series!.priceToCoordinate(f0), yf1 = series!.priceToCoordinate(f1)
            const ys0 = series!.priceToCoordinate(s0), ys1 = series!.priceToCoordinate(s1)
            if (yf0 === null || yf1 === null || ys0 === null || ys1 === null) continue

            const denom = f1 - f0 - (s1 - s0)
            let tCross: number | null = null
            if (Math.abs(denom) > EPS) {
              const t = (s0 - f0) / denom
              if (t > EPS && t < 1 - EPS) tCross = t
            }

            const seg = (xa: number, xb: number, ya: number, yb: number, bull: boolean) => {
              ctx.strokeStyle = strokeStyle(bull)
              ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke()
            }

            if (tCross == null) {
              const bull = (f0 + f1) / 2 >= (s0 + s1) / 2
              seg(x0, x1, yf0, yf1, bull); seg(x0, x1, ys0, ys1, bull)
              continue
            }

            const tc = Number(bars[i]!.time) + tCross * (Number(bars[i + 1]!.time) - Number(bars[i]!.time))
            const xC = ts.timeToCoordinate(tc as Time)
            if (xC === null) continue
            const fc = f0 + tCross * (f1 - f0)
            const yC = series!.priceToCoordinate(fc)
            if (yC === null) continue

            const bullL = f0 >= s0, bullR = f1 >= s1
            seg(x0, xC, yf0, yC, bullL); seg(x0, xC, ys0, yC, bullL)
            seg(xC, x1, yC, yf1, bullR); seg(xC, x1, yC, ys1, bullR)
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
