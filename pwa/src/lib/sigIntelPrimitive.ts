import type { OrderBlockZone } from './orderBlocks';
import type { SwingRay } from './swingLevels';
import type {
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

export type SigIntelOpts = {
  showOrderBlocks: boolean;
  showSwingRays: boolean;
  alphaScale?: number;
};

const defaultOpts: SigIntelOpts = {
  showOrderBlocks: true,
  showSwingRays: true,
  alphaScale: 1,
};

/**
 * Combined “sig intel art”: order-block bodies (demand/supply) + swing pivot rays.
 * Drawn in drawBackground behind candles; OB fills first, then thin structure lines.
 */
export function createSigIntelPrimitive(
  orderBlocks: readonly OrderBlockZone[],
  swingRays: readonly SwingRay[],
  opts: SigIntelOpts = defaultOpts,
): ISeriesPrimitive {
  const o = { ...defaultOpts, ...opts };
  const alphaScale = Math.max(0, Math.min(1, o.alphaScale ?? 1));
  const rgba = (r: number, g: number, b: number, a: number) =>
    `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a * alphaScale))})`;
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
          if (o.showOrderBlocks) {
            for (const z of orderBlocks) {
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
              // LuxAlgo SMC palette: subtle fills, clear border edges
              const fill =
                z.dir === 1
                  ? rgba(8, 153, 129, 0.22)   // teal (bull)
                  : rgba(242, 54, 69, 0.22);  // red (bear)
              const edge =
                z.dir === 1
                  ? rgba(8, 153, 129, 0.75)
                  : rgba(242, 54, 69, 0.75);
              ctx.fillStyle = fill;
              ctx.fillRect(left, top, w, h);
              ctx.strokeStyle = edge;
              ctx.lineWidth = 1;
              ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
            }
          }

          if (o.showSwingRays) {
            ctx.lineWidth = 1;
            for (const r of swingRays) {
              const xa = ts.timeToCoordinate(r.time as Time);
              const xb = ts.timeToCoordinate(r.endTime as Time);
              const y = series!.priceToCoordinate(r.price);
              if (xa === null || xb === null || y === null) continue;
              const left = Math.min(xa, xb);
              const w = Math.max(1, Math.abs(xb - xa));
              ctx.strokeStyle =
                r.kind === 'H'
                  ? rgba(178, 181, 190, 0.45)   // neutral silver — swing highs
                  : rgba(178, 181, 190, 0.35);  // swing lows
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(left, y);
              ctx.lineTo(left + w, y);
              ctx.stroke();
            }
            ctx.setLineDash([]);
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
