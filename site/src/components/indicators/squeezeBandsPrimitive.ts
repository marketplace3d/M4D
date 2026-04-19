/**
 * Full-height squeeze bands primitive — ported from M4D-REF squeezePanePrimitive.ts
 * Opacity halved to 50% of original (22% → 11%).
 */
import type {
  IChartApiBase,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer as IPrimitivePaneRenderer,
  ITimeScaleApi,
  Time,
} from 'lightweight-charts'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'

function barWidth(ts: ITimeScaleApi<Time>, times: number[], i: number): number {
  if (i > 0) {
    const x0 = ts.timeToCoordinate(times[i - 1]! as Time)
    const x1 = ts.timeToCoordinate(times[i]! as Time)
    if (x0 !== null && x1 !== null) return Math.max(1, x1 - x0)
  }
  if (i + 1 < times.length) {
    const x0 = ts.timeToCoordinate(times[i]! as Time)
    const x1 = ts.timeToCoordinate(times[i + 1]! as Time)
    if (x0 !== null && x1 !== null) return Math.max(1, x1 - x0)
  }
  return 6
}

function squeezeRuns(mask: boolean[]): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = []
  let from = -1
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      if (from < 0) from = i
    } else if (from >= 0) {
      runs.push({ from, to: i - 1 })
      from = -1
    }
  }
  if (from >= 0) runs.push({ from, to: mask.length - 1 })
  return runs
}

export function createSqueezeBandsPrimitive(
  barTimes: number[],
  mask: boolean[],
  fillRgba: string,
): ISeriesPrimitive {
  let chart: IChartApiBase | null = null
  let onRange: (() => void) | null = null

  const paneView = {
    zOrder: () => 'normal' as const,
    renderer: (): IPrimitivePaneRenderer => ({
      draw: () => {},
      drawBackground: (target: CanvasRenderingTarget2D) => {
        if (!chart || barTimes.length === 0) return
        const ts = chart.timeScale()
        const runs = squeezeRuns(mask)
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          ctx.fillStyle = fillRgba
          const h = mediaSize.height
          for (const { from, to } of runs) {
            const x0 = ts.timeToCoordinate(barTimes[from]! as Time)
            if (x0 === null) continue
            const nextIdx = to + 1
            const x1 = nextIdx < barTimes.length
              ? ts.timeToCoordinate(barTimes[nextIdx]! as Time)
              : null
            const w = x1 !== null ? Math.max(1, x1 - x0) : barWidth(ts, barTimes, to)
            ctx.fillRect(x0, 0, w, h)
          }
        })
      },
    }),
  }

  return {
    attached: (param) => {
      chart = param.chart
      onRange = () => param.requestUpdate()
      param.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange)
      queueMicrotask(() => param.requestUpdate())
    },
    detached: () => {
      if (chart && onRange) chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange)
      chart = null; onRange = null
    },
    paneViews: () => [paneView],
  }
}
