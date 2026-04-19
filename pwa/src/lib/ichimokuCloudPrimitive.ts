import type { Bar } from '../../../indicators/boom3d-tech';
import type {
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

/** Green when Senkou A ≥ B (bullish cloud), red when A < B. */
const CLOUD_FILL_ALPHA = 0.1;

function cloudFillRgba(senkouA: number, senkouB: number): string {
  const bull = senkouA >= senkouB;
  const a = CLOUD_FILL_ALPHA;
  return bull ? `rgba(46, 204, 113, ${a})` : `rgba(255, 23, 68, ${a})`;
}

/** Senkou A/B outline — same hue as cloud, softer than solid (subtle guide lines). */
const CLOUD_LINE_ALPHA = 0.52;

function cloudLineStroke(senkouA: number, senkouB: number): string {
  const bull = senkouA >= senkouB;
  const a = CLOUD_LINE_ALPHA;
  return bull ? `rgba(46, 204, 113, ${a})` : `rgba(255, 23, 68, ${a})`;
}

/**
 * Filled band between Senkou Span A and B, plus crisp strokes along A and B (not thicker fill).
 */
export function createIchimokuCloudPrimitive(
  bars: readonly Bar[],
  senkouA: readonly number[],
  senkouB: readonly number[],
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
          /** Interpolated quad between bar i and i+1 so top/bottom edges slope (not stepped boxes). */
          for (let i = 0; i < bars.length - 1; i++) {
            const a0 = senkouA[i]!;
            const b0 = senkouB[i]!;
            const a1 = senkouA[i + 1]!;
            const b1 = senkouB[i + 1]!;
            if (
              !Number.isFinite(a0) ||
              !Number.isFinite(b0) ||
              !Number.isFinite(a1) ||
              !Number.isFinite(b1)
            ) {
              continue;
            }
            const t0 = bars[i]!.time as Time;
            const t1 = bars[i + 1]!.time as Time;
            const x0 = ts.timeToCoordinate(t0);
            const x1 = ts.timeToCoordinate(t1);
            if (x0 === null || x1 === null) continue;
            const pHi0 = Math.max(a0, b0);
            const pLo0 = Math.min(a0, b0);
            const pHi1 = Math.max(a1, b1);
            const pLo1 = Math.min(a1, b1);
            const yHi0 = series!.priceToCoordinate(pHi0);
            const yLo0 = series!.priceToCoordinate(pLo0);
            const yHi1 = series!.priceToCoordinate(pHi1);
            const yLo1 = series!.priceToCoordinate(pLo1);
            if (yHi0 === null || yLo0 === null || yHi1 === null || yLo1 === null) continue;
            ctx.fillStyle = cloudFillRgba((a0 + a1) / 2, (b0 + b1) / 2);
            ctx.beginPath();
            ctx.moveTo(x0, yHi0);
            ctx.lineTo(x1, yHi1);
            ctx.lineTo(x1, yLo1);
            ctx.lineTo(x0, yLo0);
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
          ctx.lineWidth = 1;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (let i = 0; i < bars.length - 1; i++) {
            const a0 = senkouA[i]!;
            const b0 = senkouB[i]!;
            const a1 = senkouA[i + 1]!;
            const b1 = senkouB[i + 1]!;
            if (
              !Number.isFinite(a0) ||
              !Number.isFinite(b0) ||
              !Number.isFinite(a1) ||
              !Number.isFinite(b1)
            ) {
              continue;
            }
            const t0 = bars[i]!.time as Time;
            const t1 = bars[i + 1]!.time as Time;
            const x0 = ts.timeToCoordinate(t0);
            const x1 = ts.timeToCoordinate(t1);
            if (x0 === null || x1 === null) continue;
            const ya0 = series.priceToCoordinate(a0);
            const ya1 = series.priceToCoordinate(a1);
            const yb0 = series.priceToCoordinate(b0);
            const yb1 = series.priceToCoordinate(b1);
            if (ya0 === null || ya1 === null || yb0 === null || yb1 === null) continue;
            const stroke = cloudLineStroke((a0 + a1) / 2, (b0 + b1) / 2);
            ctx.strokeStyle = stroke;
            ctx.beginPath();
            ctx.moveTo(x0, ya0);
            ctx.lineTo(x1, ya1);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x0, yb0);
            ctx.lineTo(x1, yb1);
            ctx.stroke();
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
