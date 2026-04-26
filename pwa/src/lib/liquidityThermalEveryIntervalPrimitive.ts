import type {
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { Bar } from '../../../indicators/boom3d-tech';

type Lt3Options = {
  period?: number;
  priceBins?: number;
  intervalStep?: number;
  actionGlowGain?: number;
  showActionBubbles?: boolean;
  bubbleThreshold?: number;
  obPressure?: number;
  obConfidence?: number;
  miniArrowGain?: number;
  mainArrowGain?: number;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

type Lt3Data = {
  slice: readonly Bar[];
  levels: number[];
  step: number;
  cells: number[][];
  signedCells: number[][];
  maxCell: number;
  maxSignedAbs: number;
};

function buildLt3Data(
  bars: readonly Bar[],
  period: number,
  priceBins: number,
  intervalStep: number,
): Lt3Data | null {
  if (bars.length < 20) return null;
  const slice = bars.slice(-period);
  if (slice.length < 10) return null;

  let H = -Infinity;
  let L = Infinity;
  for (const b of slice) {
    if (b.high > H) H = b.high;
    if (b.low < L) L = b.low;
  }
  if (!Number.isFinite(H) || !Number.isFinite(L) || H <= L) return null;
  const step = (H - L) / priceBins;
  if (step <= 0) return null;

  const levels = Array.from({ length: priceBins }, (_, i) => L + step * i);

  // One time-cell per interval step (step=1 => every bar).
  const cells: number[][] = [];
  const signedCells: number[][] = [];
  let maxCell = 0;
  let maxSignedAbs = 0;
  for (let t = 0; t < slice.length; t += Math.max(1, intervalStep)) {
    const volBins = new Array(priceBins).fill(0);
    const signedBins = new Array(priceBins).fill(0);
    const end = Math.min(slice.length, t + Math.max(1, intervalStep));
    for (let k = t; k < end; k++) {
      const b = slice[k]!;
      const v = b.volume ?? 0;
      if (v <= 0) continue;
      const dir = b.close >= b.open ? 1 : -1;
      for (let i = 0; i < priceBins; i++) {
        const mid = levels[i]! + step / 2;
        if (Math.abs(b.close - mid) < step) {
          volBins[i]! += v;
          signedBins[i]! += v * dir;
        }
      }
    }
    for (let i = 0; i < priceBins; i++) {
      if (volBins[i]! > maxCell) maxCell = volBins[i]!;
      const sAbs = Math.abs(signedBins[i]!);
      if (sAbs > maxSignedAbs) maxSignedAbs = sAbs;
    }
    cells.push(volBins);
    signedCells.push(signedBins);
  }

  return { slice, levels, step, cells, signedCells, maxCell, maxSignedAbs };
}

export function createLiquidityThermalEveryIntervalPrimitive(
  bars: readonly Bar[],
  opts?: Lt3Options,
): ISeriesPrimitive {
  const period = opts?.period ?? 220;
  const priceBins = opts?.priceBins ?? 31;
  const intervalStep = opts?.intervalStep ?? 1;
  const actionGlowGain = opts?.actionGlowGain ?? 1;
  const showActionBubbles = opts?.showActionBubbles ?? false;
  const bubbleThreshold = opts?.bubbleThreshold ?? 1;
  const obPressure = clamp(opts?.obPressure ?? 0, -1, 1);
  const obConfidence = clamp(opts?.obConfidence ?? 0, 0, 1);
  const miniArrowGain = clamp(opts?.miniArrowGain ?? 1, 0.5, 2.5);
  const mainArrowGain = clamp(opts?.mainArrowGain ?? 1, 0.5, 3.0);
  const d = buildLt3Data(bars, period, priceBins, intervalStep);

  let chartApi: IChartApiBase | null = null;
  let seriesApi: ISeriesApi<'Candlestick'> | null = null;
  let onRange: (() => void) | null = null;

  const paneView = {
    zOrder: () => 'normal' as const,
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (_t: CanvasRenderingTarget2D) => {},
      drawBackground: (target: CanvasRenderingTarget2D) => {
        if (!chartApi || !seriesApi || !d || d.maxCell <= 0) return;
        const ts = chartApi.timeScale();
        const close = bars[bars.length - 1]?.close ?? 0;

        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          const barSpacing = Math.max(2, ts.options().barSpacing ?? 6);

          // LT3 background heat blocks removed by request.

          // LT3 signal mechanic:
          // - 3 flip arrows above last 3 candles (mechanical, low-noise)
          // - 1 large permanent combined arrow on right from 3-bar avg pressure
          if (bars.length >= 3) {
            const recent = bars.slice(-3);
            const pVals = recent.map((b) => (b.close - b.open) * (b.volume ?? 0));
            const avgP = (pVals[0]! + pVals[1]! + pVals[2]!) / 3;
            const scale = Math.max(
              1e-9,
              ...bars.slice(-40).map((b) => Math.abs((b.close - b.open) * (b.volume ?? 0))),
            );
            const mergedAvg = obConfidence > 0.25
              ? avgP * (1 - obConfidence) + obPressure * scale * obConfidence
              : avgP;
            const avgNorm = clamp(Math.abs(mergedAvg) / scale, 0, 1);
            const avgUp = mergedAvg >= 0;

            // A fixed top guide line so arrows stay readable.
            const yGuide = 34;
            ctx.save();
            ctx.strokeStyle = 'rgba(148,163,184,0.35)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(10, yGuide);
            ctx.lineTo(mediaSize.width - 44, yGuide);
            ctx.stroke();
            ctx.restore();

            // Last 3 candle arrows above line, color + strength; mark flips.
            let prevSign = 0;
            for (let i = 0; i < recent.length; i++) {
              const rb = recent[i]!;
              const x = ts.timeToCoordinate(rb.time as unknown as Time);
              if (x == null) continue;
              const sign = pVals[i]! >= 0 ? 1 : -1;
              const flip = prevSign !== 0 && prevSign !== sign;
              const n = clamp(Math.abs(pVals[i]!) / scale, 0, 1);
              const stem = (10 + n * 20) * miniArrowGain;
              const head = (4 + n * 4) * Math.max(0.8, miniArrowGain * 0.85);
              const y = yGuide - 10;
              const [ar, ag, ab] = sign > 0 ? [41, 180, 83] : [189, 43, 43];
              const a = clamp((0.35 + n * 0.6) * Math.max(0.75, miniArrowGain * 0.9), 0.35, 0.99);
              ctx.save();
              ctx.strokeStyle = `rgba(${ar},${ag},${ab},${a.toFixed(3)})`;
              ctx.fillStyle = `rgba(${ar},${ag},${ab},${a.toFixed(3)})`;
              ctx.lineWidth = ((flip ? 2.8 : 1.8) + n * 1.2) * Math.max(0.8, miniArrowGain * 0.9);
              if (sign > 0) {
                ctx.beginPath();
                ctx.moveTo(x, y + stem * 0.5);
                ctx.lineTo(x, y - stem * 0.5);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x, y - stem * 0.5 - head);
                ctx.lineTo(x - head, y - stem * 0.5 + head * 0.2);
                ctx.lineTo(x + head, y - stem * 0.5 + head * 0.2);
                ctx.closePath();
                ctx.fill();
              } else {
                ctx.beginPath();
                ctx.moveTo(x, y - stem * 0.5);
                ctx.lineTo(x, y + stem * 0.5);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x, y + stem * 0.5 + head);
                ctx.lineTo(x - head, y + stem * 0.5 - head * 0.2);
                ctx.lineTo(x + head, y + stem * 0.5 - head * 0.2);
                ctx.closePath();
                ctx.fill();
              }
              if (flip) {
                ctx.font = 'bold 8px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText('FLIP', x, y - stem * 0.5 - head - 2);
              }
              ctx.restore();
              prevSign = sign;
            }

            // Single large combined arrow on right (color only here).
            const [rr, gg, bb] = avgUp ? [41, 180, 83] : [189, 43, 43];
            const alpha = clamp((0.35 + avgNorm * 0.6) * actionGlowGain * Math.max(0.75, mainArrowGain * 0.9), 0.35, 0.99);
            // Align vertical column with lower targeting arrow.
            const xR = mediaSize.width - 54;
            const yR = yGuide + 13;
            const stemR = (44 + avgNorm * 76) * mainArrowGain;
            const headR = (14 + avgNorm * 14) * Math.max(0.9, mainArrowGain * 0.95);
            const shaftHalfW = Math.max(3, ((6.2 + avgNorm * 5.2) * Math.max(0.9, mainArrowGain * 0.95)) * 0.5);
            ctx.save();
            ctx.fillStyle = `rgba(${rr},${gg},${bb},${alpha.toFixed(3)})`;
            // Single polygon arrow (no overlap seam between shaft/head).
            if (avgUp) {
              const headBaseY = yR - stemR * 0.5;
              ctx.beginPath();
              ctx.moveTo(xR - shaftHalfW, yR + stemR * 0.5);
              ctx.lineTo(xR + shaftHalfW, yR + stemR * 0.5);
              ctx.lineTo(xR + shaftHalfW, headBaseY);
              ctx.lineTo(xR + headR, headBaseY);
              ctx.lineTo(xR, headBaseY - headR);
              ctx.lineTo(xR - headR, headBaseY);
              ctx.lineTo(xR - shaftHalfW, headBaseY);
              ctx.closePath();
              ctx.fill();
            } else {
              const headBaseY = yR + stemR * 0.5;
              ctx.beginPath();
              ctx.moveTo(xR - shaftHalfW, yR - stemR * 0.5);
              ctx.lineTo(xR + shaftHalfW, yR - stemR * 0.5);
              ctx.lineTo(xR + shaftHalfW, headBaseY);
              ctx.lineTo(xR + headR, headBaseY);
              ctx.lineTo(xR, headBaseY + headR);
              ctx.lineTo(xR - headR, headBaseY);
              ctx.lineTo(xR - shaftHalfW, headBaseY);
              ctx.closePath();
              ctx.fill();
            }
            ctx.font = `bold ${Math.round(10 * Math.max(0.85, mainArrowGain * 0.8))}px monospace`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${avgUp ? 'UP' : 'DN'} ${(avgNorm * 100).toFixed(0)}%`, xR - 8, yR);
            ctx.restore();
          }
        });
      },
    }),
  };

  return {
    attached: (param) => {
      chartApi = param.chart;
      seriesApi = param.series as ISeriesApi<'Candlestick'>;
      onRange = () => param.requestUpdate();
      param.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
      queueMicrotask(() => param.requestUpdate());
    },
    detached: () => {
      if (chartApi && onRange) chartApi.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chartApi = null;
      seriesApi = null;
      onRange = null;
    },
    paneViews: () => [paneView],
  };
}

