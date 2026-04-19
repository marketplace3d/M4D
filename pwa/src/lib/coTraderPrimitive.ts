/**
 * Co-Trader Primitive — canvas overlay on LW chart.
 *
 * Draws two things in ONE primitive pass:
 *
 * 1. BRACKET ARROW  (vertical, level-to-level, right of last bar)
 *    Current close ──bracket── → destination price
 *    Label: destKind · ATR dist · magnet strength
 *    Color: LONG=cyan, SHORT=red, FLAT=slate
 *
 * 2. HUD CARD (top-left corner)
 *    Phase · direction · magnet bar · destination · session
 */
import type {
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { CoTraderSignal } from './coTraderSignal';

const PHASE_COL: Record<string, string> = {
  ACCUMULATION: 'rgba(129,140,248,0.95)',
  MANIPULATION: 'rgba(236,72,153,0.98)',
  DISPLACEMENT: 'rgba(34,211,238,0.98)',
  DISTRIBUTION: 'rgba(249,115,22,0.95)',
};
const LONG_COL  = 'rgba(34,211,238,0.95)';
const SHORT_COL = 'rgba(248,113,113,0.95)';
const FLAT_COL  = 'rgba(148,163,184,0.70)';

function dirCol(sig: CoTraderSignal) {
  return sig.direction === 'LONG' ? LONG_COL : sig.direction === 'SHORT' ? SHORT_COL : FLAT_COL;
}

export function createCoTraderPrimitive(
  sig: CoTraderSignal,
  currentPrice: number,
  lastBarTime: Time,
): ISeriesPrimitive {
  let chartApi:  IChartApiBase | null = null;
  let seriesApi: ISeriesApi<'Candlestick'> | null = null;
  let onRange: (() => void) | null = null;

  const paneView = {
    zOrder: () => 'top' as const,
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (target: CanvasRenderingTarget2D) => {
        if (!chartApi || !seriesApi) return;

        const ts = chartApi.timeScale();
        const x0 = ts.timeToCoordinate(lastBarTime);
        if (x0 == null) return;

        const yClose = seriesApi.priceToCoordinate(currentPrice);
        const yDest  = sig.destination != null
          ? seriesApi.priceToCoordinate(sig.destination) : null;

        const col = dirCol(sig);
        const phaseCol = PHASE_COL[sig.phase] ?? FLAT_COL;
        const mag = sig.magnetStrength;

        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {

          // ── 1. BRACKET ARROW ──────────────────────────────────────────────
          if (yClose != null && yDest != null) {
            const arrowX  = x0 + 18;
            const bracketW = 8;
            const arrowTip = arrowX + 36;
            const yC = yClose;
            const yD = yDest;
            const goingUp = yD < yC;   // canvas Y is inverted

            ctx.save();
            ctx.strokeStyle = col;
            ctx.fillStyle = col;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);

            // Left bracket at current price
            ctx.beginPath();
            ctx.moveTo(arrowX, yC - 6);
            ctx.lineTo(arrowX - bracketW, yC);
            ctx.lineTo(arrowX, yC + 6);
            ctx.stroke();

            // Vertical spine
            ctx.beginPath();
            ctx.moveTo(arrowX, yC);
            ctx.lineTo(arrowX, yD);
            ctx.stroke();

            // Horizontal arm to tip
            ctx.beginPath();
            ctx.moveTo(arrowX, yD);
            ctx.lineTo(arrowTip - 6, yD);
            ctx.stroke();

            // Arrow head at destination
            ctx.beginPath();
            ctx.moveTo(arrowTip - 6, yD - 5);
            ctx.lineTo(arrowTip, yD);
            ctx.lineTo(arrowTip - 6, yD + 5);
            ctx.fill();

            // Right bracket at destination
            ctx.beginPath();
            ctx.moveTo(arrowTip + 4, yD - 6);
            ctx.lineTo(arrowTip + 4 + bracketW, yD);
            ctx.lineTo(arrowTip + 4, yD + 6);
            ctx.stroke();

            // Mid-label: destKind + dist
            const midY = (yC + yD) / 2;
            const labelX = arrowX + 4;
            ctx.font = 'bold 9px ui-monospace, monospace';
            const distLabel = `${sig.destinationKind} ${sig.distAtr.toFixed(1)}ATR`;
            const tw = ctx.measureText(distLabel).width;

            // Background pill
            ctx.fillStyle = 'rgba(3,5,10,0.80)';
            ctx.fillRect(labelX - 2, midY - 11, tw + 8, 15);
            ctx.fillStyle = col;
            ctx.fillText(distLabel, labelX + 2, midY);

            // Magnet strength badge
            const magLabel = `⚡${mag}`;
            const magTw = ctx.measureText(magLabel).width;
            const badgeY = goingUp ? yD - 18 : yD + 6;
            const badgeCol = mag >= 80 ? 'rgba(251,191,36,0.95)' : mag >= 60 ? col : FLAT_COL;
            ctx.fillStyle = 'rgba(3,5,10,0.82)';
            ctx.fillRect(arrowTip - 2, badgeY, magTw + 8, 14);
            ctx.fillStyle = badgeCol;
            ctx.font = 'bold 9px ui-monospace, monospace';
            ctx.fillText(magLabel, arrowTip + 2, badgeY + 10);

            // Alternate stop tick (faint magenta)
            if (sig.alternateStop != null) {
              const yAlt = seriesApi!.priceToCoordinate(sig.alternateStop);
              if (yAlt != null) {
                ctx.strokeStyle = 'rgba(236,72,153,0.45)';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 4]);
                ctx.beginPath();
                ctx.moveTo(arrowTip + 14, yAlt);
                ctx.lineTo(arrowTip + 30, yAlt);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = 'rgba(236,72,153,0.45)';
                ctx.font = '8px ui-monospace, monospace';
                ctx.fillText('alt', arrowTip + 16, yAlt - 2);
              }
            }

            ctx.restore();
          }

          // ── 2. HUD CARD (top-left) ────────────────────────────────────────
          const HX = 10, HY = 10;
          const HW = 188, HH = 82;
          ctx.save();

          // Card background
          ctx.fillStyle = 'rgba(3,5,10,0.82)';
          ctx.beginPath();
          ctx.roundRect(HX, HY, HW, HH, 5);
          ctx.fill();

          // Phase color left bar
          ctx.fillStyle = phaseCol;
          ctx.fillRect(HX, HY, 3, HH);

          // Phase + direction
          ctx.font = 'bold 10px ui-monospace, monospace';
          ctx.fillStyle = phaseCol;
          ctx.fillText(sig.phase, HX + 10, HY + 15);

          const dirArrow = sig.direction === 'LONG' ? '▲' : sig.direction === 'SHORT' ? '▼' : '━';
          ctx.fillStyle = col;
          ctx.fillText(`${dirArrow} ${sig.direction}`, HX + 120, HY + 15);

          // Magnet bar
          const barX = HX + 10;
          const barY = HY + 22;
          const barW = HW - 20;
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(barX, barY, barW, 6);
          const barFill = mag >= 80 ? 'rgba(251,191,36,0.95)'
            : mag >= 60 ? col : 'rgba(148,163,184,0.7)';
          ctx.fillStyle = barFill;
          ctx.fillRect(barX, barY, Math.round(barW * mag / 100), 6);
          ctx.font = '8px ui-monospace, monospace';
          ctx.fillStyle = barFill;
          ctx.fillText(`MAGNET ${mag}/100`, barX, barY + 16);

          // Destination
          if (sig.destination != null) {
            ctx.font = 'bold 11px ui-monospace, monospace';
            ctx.fillStyle = 'rgba(253,224,71,0.95)';
            ctx.fillText(`▶ ${sig.destination.toFixed(4)}`, HX + 10, HY + 52);
            ctx.font = '8px ui-monospace, monospace';
            ctx.fillStyle = 'rgba(148,163,184,0.8)';
            ctx.fillText(`${sig.destinationKind} · ${sig.distAtr.toFixed(1)}× ATR`, HX + 10, HY + 64);
          }

          // Liq % right side
          ctx.font = '8px ui-monospace, monospace';
          ctx.fillStyle = 'rgba(34,197,94,0.85)';
          ctx.fillText(`B ${(sig.buyLiqPct * 100).toFixed(0)}%`, HX + 140, HY + 52);
          ctx.fillStyle = 'rgba(248,113,113,0.85)';
          ctx.fillText(`S ${(sig.sellLiqPct * 100).toFixed(0)}%`, HX + 140, HY + 64);

          // Session
          ctx.font = '8px ui-monospace, monospace';
          ctx.fillStyle = 'rgba(148,163,184,0.6)';
          ctx.fillText(sig.sessionName, HX + 10, HY + 76);
          ctx.fillStyle = 'rgba(148,163,184,0.5)';
          ctx.fillText(sig.regime, HX + 90, HY + 76);

          ctx.restore();
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
