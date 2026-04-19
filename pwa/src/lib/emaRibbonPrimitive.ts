import type { Bar } from '../../../indicators/boom3d-tech';
import type {
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

/** Fill alpha; line alpha = fill + 0.15 (15 percentage points stronger than fill, capped at 1). */
const RIBBON_FILL_ALPHA = 0.12;
const RIBBON_LINE_ALPHA = Math.min(1, RIBBON_FILL_ALPHA + 0.15);

/** Green when fast EMA ≥ slow (cross up / bull side); red when fast < slow (cross down). */
function ribbonFillRgba(fastAbove: boolean): string {
  const a = RIBBON_FILL_ALPHA;
  return fastAbove ? `rgba(46, 204, 113, ${a})` : `rgba(255, 23, 68, ${a})`;
}

/** Strokes — same RGB as fill; opacity 15% above fill (12% → 27%). */
function ribbonStrokeStyle(fastAbove: boolean): string {
  const a = RIBBON_LINE_ALPHA;
  return fastAbove ? `rgba(46, 204, 113, ${a})` : `rgba(255, 23, 68, ${a})`;
}

const EPS = 1e-9;

/**
 * Smooth fill between two EMA curves (same interpolation as Ichimoku cloud quads).
 * Splits at an intra-bar cross so green/red meet at the crossover.
 */
export function createEmaRibbonPrimitive(
  bars: readonly Bar[],
  emaFast: readonly number[],
  emaSlow: readonly number[],
): ISeriesPrimitive {
  let chart: IChartApiBase | null = null;
  let series: ISeriesApi<'Candlestick'> | null = null;
  let onLogicalRange: (() => void) | null = null;

  const fillPaneView = {
    zOrder: () => 'normal' as const,
    renderer: (): IPrimitivePaneRenderer => ({
      draw: () => {},
      drawBackground: (target: CanvasRenderingTarget2D) => {
        if (!chart || !series || bars.length < 2) return;
        const ts = chart.timeScale();
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          for (let i = 0; i < bars.length - 1; i++) {
            const f0 = emaFast[i]!;
            const f1 = emaFast[i + 1]!;
            const s0 = emaSlow[i]!;
            const s1 = emaSlow[i + 1]!;
            if (
              !Number.isFinite(f0) ||
              !Number.isFinite(f1) ||
              !Number.isFinite(s0) ||
              !Number.isFinite(s1)
            ) {
              continue;
            }

            const time0 = bars[i]!.time as Time;
            const time1 = bars[i + 1]!.time as Time;
            const x0 = ts.timeToCoordinate(time0);
            const x1 = ts.timeToCoordinate(time1);
            if (x0 === null || x1 === null) continue;

            const denom = f1 - f0 - (s1 - s0);
            let tCross: number | null = null;
            if (Math.abs(denom) > EPS) {
              const t = (s0 - f0) / denom;
              if (t > EPS && t < 1 - EPS) tCross = t;
            }

            const fillQuad = (
              xa: number,
              xb: number,
              fa: number,
              fb: number,
              sa: number,
              sb: number,
              bull: boolean,
            ) => {
              const pHiA = Math.max(fa, sa);
              const pLoA = Math.min(fa, sa);
              const pHiB = Math.max(fb, sb);
              const pLoB = Math.min(fb, sb);
              const yHiA = series!.priceToCoordinate(pHiA);
              const yLoA = series!.priceToCoordinate(pLoA);
              const yHiB = series!.priceToCoordinate(pHiB);
              const yLoB = series!.priceToCoordinate(pLoB);
              if (yHiA === null || yLoA === null || yHiB === null || yLoB === null) return;
              ctx.fillStyle = ribbonFillRgba(bull);
              ctx.beginPath();
              ctx.moveTo(xa, yHiA);
              ctx.lineTo(xb, yHiB);
              ctx.lineTo(xb, yLoB);
              ctx.lineTo(xa, yLoA);
              ctx.closePath();
              ctx.fill();
            };

            if (tCross == null) {
              const bull = (f0 + f1) / 2 >= (s0 + s1) / 2;
              fillQuad(x0, x1, f0, f1, s0, s1, bull);
              continue;
            }

            const tc = Number(bars[i]!.time) + tCross * (Number(bars[i + 1]!.time) - Number(bars[i]!.time));
            const timeC = tc as Time;
            const xC = ts.timeToCoordinate(timeC);
            if (xC === null) continue;

            const fc = f0 + tCross * (f1 - f0);
            const yC = series.priceToCoordinate(fc);
            if (yC === null) continue;

            const bullLeft = f0 >= s0;
            const bullRight = f1 >= s1;

            const yHi0 = series.priceToCoordinate(Math.max(f0, s0));
            const yLo0 = series.priceToCoordinate(Math.min(f0, s0));
            const yHi1 = series.priceToCoordinate(Math.max(f1, s1));
            const yLo1 = series.priceToCoordinate(Math.min(f1, s1));
            if (yHi0 === null || yLo0 === null || yHi1 === null || yLo1 === null) continue;

            ctx.fillStyle = ribbonFillRgba(bullLeft);
            ctx.beginPath();
            ctx.moveTo(x0, yHi0);
            ctx.lineTo(xC, yC);
            ctx.lineTo(x0, yLo0);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = ribbonFillRgba(bullRight);
            ctx.beginPath();
            ctx.moveTo(xC, yC);
            ctx.lineTo(x1, yHi1);
            ctx.lineTo(x1, yLo1);
            ctx.closePath();
            ctx.fill();
          }
        });
      },
    }),
  };

  const linePaneView = {
    zOrder: () => 'top' as const,
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (target: CanvasRenderingTarget2D) => {
        if (!chart || !series || bars.length < 2) return;
        const ts = chart.timeScale();
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (let i = 0; i < bars.length - 1; i++) {
            const f0 = emaFast[i]!;
            const f1 = emaFast[i + 1]!;
            const s0 = emaSlow[i]!;
            const s1 = emaSlow[i + 1]!;
            if (
              !Number.isFinite(f0) ||
              !Number.isFinite(f1) ||
              !Number.isFinite(s0) ||
              !Number.isFinite(s1)
            ) {
              continue;
            }

            const time0 = bars[i]!.time as Time;
            const time1 = bars[i + 1]!.time as Time;
            const x0 = ts.timeToCoordinate(time0);
            const x1 = ts.timeToCoordinate(time1);
            if (x0 === null || x1 === null) continue;

            const yf0 = series.priceToCoordinate(f0);
            const yf1 = series.priceToCoordinate(f1);
            const ys0 = series.priceToCoordinate(s0);
            const ys1 = series.priceToCoordinate(s1);
            if (yf0 === null || yf1 === null || ys0 === null || ys1 === null) continue;

            const denom = f1 - f0 - (s1 - s0);
            let tCross: number | null = null;
            if (Math.abs(denom) > EPS) {
              const t = (s0 - f0) / denom;
              if (t > EPS && t < 1 - EPS) tCross = t;
            }

            const strokeSeg = (xa: number, xb: number, ya: number, yb: number, bull: boolean) => {
              ctx.strokeStyle = ribbonStrokeStyle(bull);
              ctx.beginPath();
              ctx.moveTo(xa, ya);
              ctx.lineTo(xb, yb);
              ctx.stroke();
            };

            if (tCross == null) {
              const bull = (f0 + f1) / 2 >= (s0 + s1) / 2;
              strokeSeg(x0, x1, yf0, yf1, bull);
              strokeSeg(x0, x1, ys0, ys1, bull);
              continue;
            }

            const tc = Number(bars[i]!.time) + tCross * (Number(bars[i + 1]!.time) - Number(bars[i]!.time));
            const timeC = tc as Time;
            const xC = ts.timeToCoordinate(timeC);
            if (xC === null) continue;

            const fc = f0 + tCross * (f1 - f0);
            const yC = series.priceToCoordinate(fc);
            if (yC === null) continue;

            const bullLeft = f0 >= s0;
            const bullRight = f1 >= s1;

            strokeSeg(x0, xC, yf0, yC, bullLeft);
            strokeSeg(x0, xC, ys0, yC, bullLeft);
            strokeSeg(xC, x1, yC, yf1, bullRight);
            strokeSeg(xC, x1, yC, ys1, bullRight);
          }
        });
      },
    }),
  };

  return {
    attached: (param) => {
      chart = param.chart;
      series = param.series as ISeriesApi<'Candlestick'>;
      onLogicalRange = () => param.requestUpdate();
      param.chart.timeScale().subscribeVisibleLogicalRangeChange(onLogicalRange);
      queueMicrotask(() => param.requestUpdate());
    },
    detached: () => {
      if (chart && onLogicalRange) {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(onLogicalRange);
      }
      chart = null;
      series = null;
      onLogicalRange = null;
    },
    paneViews: () => [fillPaneView, linePaneView],
  };
}
