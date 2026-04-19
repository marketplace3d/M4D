/**
 * Liquidity Thermal Map — full-canvas heat overlay.
 * Translates BigBeluga's Pine script directly:
 *   - fill(p0..p30): entire canvas width painted per bin, gradient opacity
 *   - box panel to right of last bar with POC fade
 *   - Glow effect on high-volume bins (shadowBlur)
 *
 * Pine opacity model:
 *   - Background fills: color.from_gradient(val, 0.25, 1, transparent, pocCol@50%)
 *   - POC bin: pocCol@80%
 *   - Right panel: transparency = 10 + fade*85 (10=near price, 95=at extremes)
 */
import type {
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { Bar } from '../../../indicators/boom3d-tech';
import { computeLiquidityThermal } from './liquidityThermal';

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

/** Pine: color.from_gradient(val, minVal, 1, transparent, baseColor@maxAlpha) */
function gradientAlpha(vol: number, maxVol: number, maxAlpha: number, minVal = 0.25): number {
  if (maxVol <= 0) return 0;
  const val = vol / maxVol;
  if (val <= minVal) return 0;
  return clamp01((val - minVal) / (1 - minVal)) * maxAlpha;
}

/** Pine box panel: transparency = 10 + fade*85 → opacity = 1 - transparency/100 */
function panelOpacity(idx: number, splitIdx: number, lastIdx: number): number {
  const dist    = Math.abs(idx - splitIdx);
  const maxDist = Math.max(splitIdx, lastIdx - splitIdx, 1);
  const fade    = dist / maxDist;
  const transp  = 10 + fade * 85;          // Pine: 10..95
  return clamp01(1 - transp / 100);        // opacity: 0.9..0.05
}

export function createLiquidityThermalPrimitive(
  bars: readonly Bar[],
  opts?: {
    period?: number;
    /** Width of the right-side profile panel in pixels */
    panelWidth?: number;
    showPanel?: boolean;
    showBackground?: boolean;
  },
): ISeriesPrimitive {
  const period     = opts?.period     ?? 300;
  const panelWidth = opts?.panelWidth ?? 52;
  const showPanel  = opts?.showPanel  !== false;
  const showBg     = opts?.showBackground !== false;

  const lt = computeLiquidityThermal(bars as Bar[], period);

  let chartApi:  IChartApiBase | null = null;
  let seriesApi: ISeriesApi<'Candlestick'> | null = null;
  let onRange:   (() => void) | null = null;

  const paneView = {
    zOrder: () => 'normal' as const,
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (_t: CanvasRenderingTarget2D) => {},
      drawBackground: (target: CanvasRenderingTarget2D) => {
        if (!chartApi || !seriesApi || !lt) return;

        const ts = chartApi.timeScale();
        const t1 = bars[bars.length - 1]?.time;
        if (t1 == null) return;
        const x1 = ts.timeToCoordinate(t1 as Time);
        if (x1 == null) return;

        const close   = bars[bars.length - 1]!.close;
        const maxVol  = lt.volBins.reduce((a, v) => Math.max(a, v), 0);
        const bins    = lt.levels.length;   // 31
        const lastIdx = bins - 1;
        const step    = (lt.rangeHigh - lt.rangeLow) / bins;

        let splitIdx = Math.floor((close - lt.rangeLow) / step);
        splitIdx = Math.max(0, Math.min(lastIdx, splitIdx));

        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const canvasW = ctx.canvas.width;

          // ── 1. Full-canvas thermal fills ────────────────────────────────
          if (showBg) {
            for (let i = 0; i < bins; i++) {
              const ll  = lt.levels[i]!;
              const hh  = ll + step;
              const mid = ll + step / 2;

              const yBot = seriesApi!.priceToCoordinate(ll);
              const yTop = seriesApi!.priceToCoordinate(hh);
              if (yBot == null || yTop == null) continue;

              const top = Math.min(yTop, yBot);
              const h   = Math.max(1, Math.abs(yBot - yTop));

              // Pine: skip active-candle bin
              if (close >= ll && close < hh) continue;

              const vol  = lt.volBins[i]!;
              const isPoc = i === lt.pocIdx;
              const isSell = mid >= close;

              // Pine opacity model
              const alpha = isPoc
                ? 0.80                                        // POC: 80%
                : gradientAlpha(vol, maxVol, 0.50);          // fills: 0→50%

              if (alpha < 0.005) continue;

              const [r, g, b] = isSell ? [189, 43, 43] : [41, 180, 83];

              ctx.save();

              // Glow on high-vol bins (POC + > 60% of max)
              const norm = maxVol > 0 ? vol / maxVol : 0;
              if (norm > 0.6 || isPoc) {
                const glowA = isPoc ? 0.55 : norm * 0.35;
                ctx.shadowColor = `rgba(${r},${g},${b},${glowA.toFixed(3)})`;
                ctx.shadowBlur  = isPoc ? 18 : 10;
              }

              ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
              ctx.fillRect(0, top, canvasW, h);
              ctx.restore();
            }
          }

          // ── 2. Right-side profile panel (Pine box.new style) ────────────
          if (showPanel) {
            const panelLeft = x1 + 6;

            // Dark backdrop
            const panelYTop = seriesApi!.priceToCoordinate(lt.rangeHigh);
            const panelYBot = seriesApi!.priceToCoordinate(lt.rangeLow);
            if (panelYTop != null && panelYBot != null) {
              const ptop = Math.min(panelYTop, panelYBot);
              const ph   = Math.max(2, Math.abs(panelYBot - panelYTop));
              ctx.fillStyle = 'rgba(8,10,14,0.55)';
              ctx.fillRect(panelLeft, ptop, panelWidth, ph);
            }

            for (let i = 0; i < bins; i++) {
              const ll  = lt.levels[i]!;
              const hh  = ll + step;
              const mid = ll + step / 2;

              const yBot = seriesApi!.priceToCoordinate(ll);
              const yTop = seriesApi!.priceToCoordinate(hh);
              if (yBot == null || yTop == null) continue;

              const top = Math.min(yTop, yBot);
              const h   = Math.max(1, Math.abs(yBot - yTop));

              const vol   = lt.volBins[i]!;
              const norm  = maxVol > 0 ? vol / maxVol : 0;
              const isPoc = i === lt.pocIdx;
              const isSell = mid >= close;

              // Pine: alpha = 1 - transparency/100, transparency = 10 + fade*85
              const op    = isPoc ? 0.90 : panelOpacity(i, splitIdx, lastIdx);
              const barW  = isPoc ? panelWidth : Math.max(2, Math.round(norm * panelWidth));

              const [r, g, b] = isSell ? [189, 43, 43] : [41, 180, 83];

              ctx.save();
              if (isPoc) {
                ctx.shadowColor = `rgba(${r},${g},${b},0.75)`;
                ctx.shadowBlur  = 14;
              }
              ctx.fillStyle = `rgba(${r},${g},${b},${op.toFixed(3)})`;
              ctx.fillRect(panelLeft, top, barW, h);

              if (isPoc) {
                ctx.shadowBlur = 0;
                ctx.font = 'bold 8px monospace';
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText('POC', panelLeft + 3, top + h / 2);
              }
              ctx.restore();
            }

            // BUY / SELL liq stats
            const statsY = (seriesApi!.priceToCoordinate(lt.rangeLow) ?? 0) + 6;
            ctx.save();
            ctx.font = '8px monospace';
            ctx.textBaseline = 'top';
            ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(41,180,83,0.95)';
            ctx.fillText(`B ${(lt.buyLiqPct * 100).toFixed(0)}%`, panelLeft, statsY);
            ctx.fillStyle = 'rgba(189,43,43,0.95)';
            ctx.fillText(`S ${(lt.sellLiqPct * 100).toFixed(0)}%`, panelLeft, statsY + 10);
            ctx.restore();
          }
        });
      },
    }),
  };

  return {
    attached: (param) => {
      chartApi  = param.chart;
      seriesApi = param.series as ISeriesApi<'Candlestick'>;
      onRange   = () => param.requestUpdate();
      param.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
      queueMicrotask(() => param.requestUpdate());
    },
    detached: () => {
      if (chartApi && onRange) chartApi.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chartApi = null; seriesApi = null; onRange = null;
    },
    paneViews: () => [paneView],
  };
}
