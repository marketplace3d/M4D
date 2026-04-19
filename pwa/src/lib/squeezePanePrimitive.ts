import type {
  IChartApiBase,
  ITimeScaleApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

function barWidthPx(ts: ITimeScaleApi<Time>, times: readonly number[], i: number): number {
  if (i > 0) {
    const x0 = ts.timeToCoordinate(times[i - 1]! as Time);
    const x1 = ts.timeToCoordinate(times[i]! as Time);
    if (x0 !== null && x1 !== null) return Math.max(1, x1 - x0);
  }
  if (i + 1 < times.length) {
    const x0 = ts.timeToCoordinate(times[i]! as Time);
    const x1 = ts.timeToCoordinate(times[i + 1]! as Time);
    if (x0 !== null && x1 !== null) return Math.max(1, x1 - x0);
  }
  return 6;
}

function squeezeRuns(mask: readonly boolean[]): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = [];
  let from = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      if (from < 0) from = i;
    } else if (from >= 0) {
      runs.push({ from, to: i - 1 });
      from = -1;
    }
  }
  if (from >= 0) runs.push({ from, to: mask.length - 1 });
  return runs;
}

function paintBands(
  target: CanvasRenderingTarget2D,
  chart: IChartApiBase,
  barTimes: readonly number[],
  mask: readonly boolean[],
  fillRgba: string,
): void {
  if (barTimes.length === 0) return;
  const ts = chart.timeScale();
  const runs = squeezeRuns(mask);
  target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
    ctx.fillStyle = fillRgba;
    const h = mediaSize.height;
    for (const { from, to } of runs) {
      const t0 = barTimes[from]! as Time;
      const x0 = ts.timeToCoordinate(t0);
      if (x0 === null) continue;
      const nextIdx = to + 1;
      const x1 =
        nextIdx < barTimes.length ? ts.timeToCoordinate(barTimes[nextIdx]! as Time) : null;
      const w = x1 !== null ? Math.max(1, x1 - x0) : barWidthPx(ts, barTimes, to);
      ctx.fillRect(x0, 0, w, h);
    }
  });
}

/**
 * Full-height translucent vertical bands. Attach to the candlestick series with
 * `zOrder: 'normal'` and paint in `drawBackground` so the fill sits behind candles
 * in the main pane pass (more reliable than `bottom` + `draw` on some builds).
 */
export function createSqueezeBandsSeriesPrimitive(
  barTimes: readonly number[],
  highlight: readonly boolean[],
  fillRgba: string,
): ISeriesPrimitive {
  let chart: IChartApiBase | null = null;
  let onLogicalRange: (() => void) | null = null;

  const paneView = {
    zOrder: () => 'normal' as const,
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (_target: CanvasRenderingTarget2D) => {
        /* paint in drawBackground — behind series body */
      },
      drawBackground: (target: CanvasRenderingTarget2D) => {
        if (!chart) return;
        paintBands(target, chart, barTimes, highlight, fillRgba);
      },
    }),
  };

  return {
    attached: (param) => {
      chart = param.chart;
      onLogicalRange = () => param.requestUpdate();
      param.chart.timeScale().subscribeVisibleLogicalRangeChange(onLogicalRange);
      queueMicrotask(() => param.requestUpdate());
    },
    detached: () => {
      if (chart && onLogicalRange) {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(onLogicalRange);
      }
      chart = null;
      onLogicalRange = null;
    },
    paneViews: () => [paneView],
  };
}
