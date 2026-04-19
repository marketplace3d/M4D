import type { FvgZone } from './fvgZones';
import type {
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

/** Heat from gap width (vs median) + recency (later zones hotter). */
function heatStyles(zones: readonly FvgZone[], alphaScale = 1): string[] {
  if (zones.length === 0) return [];
  const widths = zones.map((z) => Math.abs(z.top - z.bottom));
  const sorted = [...widths].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)]! || 1;
  return zones.map((z, i) => {
    const w = Math.abs(z.top - z.bottom);
    const sizeHeat = Math.min(1, w / (med * 1.5));
    const recency = zones.length <= 1 ? 1 : i / (zones.length - 1);
    const heat = 0.45 * sizeHeat + 0.55 * recency;
    const alpha = (0.25 + 0.35 * heat) * alphaScale;
    // LuxAlgo FVG palette: teal bull, red bear — subtle fill, clear stroke
    return z.dir === 1
      ? `rgba(8, 153, 129, ${alpha})`
      : `rgba(242, 54, 69, ${alpha})`;
  });
}

/**
 * Horizontal FVG “intel heat” bands: filled rectangles between top/bottom price
 * over [time, endTime], behind candles (drawBackground, zOrder normal).
 */
export function createFvgHeatZonesPrimitive(
  zones: readonly FvgZone[],
  fills: readonly string[],
): ISeriesPrimitive {
  let chart: IChartApiBase | null = null;
  let series: ISeriesApi<'Candlestick'> | null = null;
  let onLogicalRange: (() => void) | null = null;

  const paneView = {
    zOrder: () => 'normal' as const,
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (_target: CanvasRenderingTarget2D) => {},
      drawBackground: (target: CanvasRenderingTarget2D) => {
        if (!chart || !series) return;
        const ts = chart.timeScale();
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          for (let i = 0; i < zones.length; i++) {
            const z = zones[i]!;
            const fill = fills[i] ?? 'rgba(255, 160, 90, 0.18)';
            const x1 = ts.timeToCoordinate(z.time as Time);
            const x2 = ts.timeToCoordinate(z.endTime as Time);
            if (x1 === null || x2 === null) continue;
            const left = Math.min(x1, x2);
            const w = Math.max(1, Math.abs(x2 - x1));
            const yTop = series!.priceToCoordinate(z.top);
            const yBot = series!.priceToCoordinate(z.bottom);
            if (yTop === null || yBot === null) continue;
            const top = Math.min(yTop, yBot);
            const h = Math.max(1, Math.abs(yBot - yTop));
            ctx.fillStyle = fill;
            ctx.fillRect(left, top, w, h);
            ctx.strokeStyle = z.dir === 1 ? 'rgba(8,153,129,0.5)' : 'rgba(242,54,69,0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
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

export function fvgHeatFills(zones: readonly FvgZone[], alphaScale = 1): string[] {
  return heatStyles(zones, alphaScale);
}
