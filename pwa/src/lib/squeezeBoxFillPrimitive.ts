import type { Bar, Boom3dBarOut } from '$indicators/boom3d-tech';
import type {
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

/** Pine `boxcolor`: src > bh → aqua, src < bl → red, else purple. `fill(bh, bl, transp 70)`. */
function boxFillRgba(src: number, bh: number, bl: number): string | null {
  if (!Number.isFinite(bh) || !Number.isFinite(bl)) return null;
  const top = Math.max(bh, bl);
  const bot = Math.min(bh, bl);
  if (Math.abs(top - bot) < 1e-12) return null;
  if (src > top) return 'rgba(0, 230, 255, 0.13)';
  if (src < bot) return 'rgba(255, 23, 68, 0.15)';
  return 'rgba(168, 95, 255, 0.15)';
}

function hlc3(b: Bar): number {
  return (b.high + b.low + b.close) / 3;
}

/**
 * Filled band between BOOM squeeze box high/low plots (Pine `fill(bhplot, blplot, …)`).
 */
export function createSqueezeBoxFillPrimitive(
  bars: readonly Bar[],
  boom: readonly Boom3dBarOut[],
): ISeriesPrimitive {
  let chart: IChartApiBase | null = null;
  let series: ISeriesApi<'Candlestick'> | null = null;
  let onLogicalRange: (() => void) | null = null;

  const paneView = {
    zOrder: () => 'normal' as const,
    renderer: (): IPrimitivePaneRenderer => ({
      draw: () => {},
      drawBackground: (target: CanvasRenderingTarget2D) => {
        if (!chart || !series || bars.length < 2) return;
        const ts = chart.timeScale();
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          for (let i = 0; i < bars.length - 1; i++) {
            const b = bars[i]!;
            const bo = boom[i]!;
            const bh = bo.boxHighPlot;
            const bl = bo.boxLowPlot;
            const fill = boxFillRgba(hlc3(b), bh, bl);
            if (!fill) continue;
            const t0 = b.time as Time;
            const t1 = bars[i + 1]!.time as Time;
            const x0 = ts.timeToCoordinate(t0);
            const x1 = ts.timeToCoordinate(t1);
            if (x0 === null || x1 === null) continue;
            const left = Math.min(x0, x1);
            const w = Math.max(1, Math.abs(x1 - x0));
            const yTop = series!.priceToCoordinate(bh);
            const yBot = series!.priceToCoordinate(bl);
            if (yTop === null || yBot === null) continue;
            const top = Math.min(yTop, yBot);
            const h = Math.max(1, Math.abs(yBot - yTop));
            ctx.fillStyle = fill;
            ctx.fillRect(left, top, w, h);
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
    paneViews: () => [paneView],
  };
}
