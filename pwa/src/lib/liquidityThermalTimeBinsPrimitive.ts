import type {
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { Bar } from '../../../indicators/boom3d-tech';

type Lt2Options = {
  period?: number;
  priceBins?: number;
  timeBins?: number;
  wallThreshold?: number;
  actionGlowGain?: number;
  showActionBubbles?: boolean;
  bubbleThreshold?: number;
  obPressure?: number;
  obConfidence?: number;
  opacityGain?: number;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

type Lt2Matrix = {
  levels: number[];
  step: number;
  slice: readonly Bar[];
  bucketStarts: number[];
  bucketEnds: number[];
  vol: number[][];
  maxByBucket: number[];
  rangeHigh: number;
  rangeLow: number;
};

function buildLt2Matrix(
  bars: readonly Bar[],
  period: number,
  priceBins: number,
  timeBins: number,
): Lt2Matrix | null {
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
  const vol = Array.from({ length: timeBins }, () => new Array(priceBins).fill(0));
  const maxByBucket = new Array(timeBins).fill(0);
  const bucketStarts = new Array(timeBins).fill(0);
  const bucketEnds = new Array(timeBins).fill(0);

  const n = slice.length;
  for (let tb = 0; tb < timeBins; tb++) {
    const start = Math.floor((tb * n) / timeBins);
    const end = Math.min(n, Math.floor(((tb + 1) * n) / timeBins));
    if (end <= start) continue;

    bucketStarts[tb] = slice[start]!.time as number;
    bucketEnds[tb] = slice[end - 1]!.time as number;

    for (let k = start; k < end; k++) {
      const b = slice[k]!;
      const v = b.volume ?? 0;
      if (v <= 0) continue;
      for (let i = 0; i < priceBins; i++) {
        const mid = levels[i]! + step / 2;
        if (Math.abs(b.close - mid) < step) {
          vol[tb]![i]! += v;
        }
      }
    }

    let mx = 0;
    for (let i = 0; i < priceBins; i++) {
      if (vol[tb]![i]! > mx) mx = vol[tb]![i]!;
    }
    maxByBucket[tb] = mx;
  }

  return {
    levels,
    step,
    slice,
    bucketStarts,
    bucketEnds,
    vol,
    maxByBucket,
    rangeHigh: H,
    rangeLow: L,
  };
}

export function createLiquidityThermalTimeBinsPrimitive(
  bars: readonly Bar[],
  opts?: Lt2Options,
): ISeriesPrimitive {
  const period = opts?.period ?? 300;
  const priceBins = opts?.priceBins ?? 31;
  const timeBins = opts?.timeBins ?? 12;
  const wallThreshold = opts?.wallThreshold ?? 0;
  const actionGlowGain = opts?.actionGlowGain ?? 1;
  const showActionBubbles = opts?.showActionBubbles ?? false;
  const bubbleThreshold = opts?.bubbleThreshold ?? 1;
  const obPressure = clamp(opts?.obPressure ?? 0, -1, 1);
  const obConfidence = clamp(opts?.obConfidence ?? 0, 0, 1);
  const opacityGain = clamp(opts?.opacityGain ?? 1, 0.35, 2.5);
  const lt2 = buildLt2Matrix(bars, period, priceBins, timeBins);

  let chartApi: IChartApiBase | null = null;
  let seriesApi: ISeriesApi<'Candlestick'> | null = null;
  let onRange: (() => void) | null = null;

  const paneView = {
    zOrder: () => 'normal' as const,
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (_t: CanvasRenderingTarget2D) => {},
      drawBackground: (target: CanvasRenderingTarget2D) => {
        if (!chartApi || !seriesApi || !lt2) return;

        const ts = chartApi.timeScale();
        const lastClose = bars[bars.length - 1]?.close ?? 0;

        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          for (let tb = 0; tb < timeBins; tb++) {
            const tStart = lt2.bucketStarts[tb];
            const tEnd = lt2.bucketEnds[tb];
            if (!tStart || !tEnd) continue;

            const x1 = ts.timeToCoordinate(tStart as unknown as Time);
            const x2 = ts.timeToCoordinate(tEnd as unknown as Time);
            if (x1 == null || x2 == null) continue;

            const left = Math.min(x1, x2);
            const right = Math.max(x1, x2);
            const w = Math.max(2, right - left + 2);
            const maxVol = lt2.maxByBucket[tb] ?? 0;
            if (maxVol <= 0) continue;

            for (let i = 0; i < priceBins; i++) {
              const ll = lt2.levels[i]!;
              const hh = ll + lt2.step;
              const y1 = seriesApi.priceToCoordinate(ll);
              const y2 = seriesApi.priceToCoordinate(hh);
              if (y1 == null || y2 == null) continue;

              const top = Math.min(y1, y2);
              const h = Math.max(1, Math.abs(y2 - y1));
              const v = lt2.vol[tb]![i]!;
              const norm = v / maxVol;
              if (norm <= 0) continue;
              if (wallThreshold > 0 && norm < wallThreshold) continue;

              const mid = ll + lt2.step / 2;
              const sellSide = mid >= lastClose;
              const [r, g, b] = sellSide ? [189, 43, 43] : [41, 180, 83];
              // Continuous heat gradient (no hard bin cut) when threshold is 0.
              const alpha = clamp((0.04 + norm * 0.54) * opacityGain, 0.04, 0.96);

              ctx.save();
              ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
              ctx.fillRect(left, top, w, h);

              // stronger edge on very high-density bins
              if (norm > 0.9) {
                ctx.strokeStyle = `rgba(${r},${g},${b},0.72)`;
                ctx.lineWidth = 1;
                ctx.strokeRect(left + 0.5, top + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
              }
              ctx.restore();
            }

            // faint vertical separators to reveal bin start/stop timing
            ctx.save();
            ctx.strokeStyle = 'rgba(120,150,180,0.14)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(left + 0.5, 0);
            ctx.lineTo(left + 0.5, mediaSize.height);
            ctx.stroke();
            ctx.restore();
          }

          // ── Last-3-candle winner pressure marker (no full-panel tint) ──────
          if (bars.length >= 3) {
            const recent = bars.slice(-3);
            const pressure = recent.reduce((s, b) => s + (b.close - b.open) * (b.volume ?? 0), 0);
            const absMax = Math.max(
              1e-9,
              ...bars.slice(-20).map((b) => Math.abs((b.close - b.open) * (b.volume ?? 0))),
            );
            const norm = clamp(Math.abs(pressure) / absMax, 0, 1);
            const obOverride = obConfidence > 0.25 ? obPressure : 0;
            const mergedPressure = obOverride !== 0 ? obOverride * absMax : pressure;
            const isBuy = mergedPressure >= 0;
            const [r, g, b] = isBuy ? [41, 180, 83] : [189, 43, 43];
            const alpha = clamp((0.16 + norm * 0.44) * actionGlowGain * (0.85 + obConfidence * 0.35), 0.08, 0.92);
            const prevPressure = recent.slice(0, 2).reduce((s, bb) => s + (bb.close - bb.open) * (bb.volume ?? 0), 0);
            const flipped = Math.sign(prevPressure) !== 0 && Math.sign(prevPressure) !== Math.sign(mergedPressure);

            const tA = recent[0]?.time;
            const tB = recent[2]?.time;
            if (tA != null && tB != null) {
              const xA = ts.timeToCoordinate(tA as unknown as Time);
              const xB = ts.timeToCoordinate(tB as unknown as Time);
              if (xA != null && xB != null) {
                const left = Math.min(xA, xB) - 4;
                const width = Math.max(8, Math.abs(xB - xA) + 8);
                const y = seriesApi.priceToCoordinate(recent[2]!.close);
                if (y != null) {
                  ctx.save();
                  ctx.strokeStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
                  ctx.lineWidth = Math.max(2, 2 + norm * 3);
                  ctx.beginPath();
                  ctx.moveTo(left, y);
                  ctx.lineTo(left + width, y);
                  ctx.stroke();

                  // Direction arrow to make flips visible when color is ambiguous.
                  const arrowX = left + width + 6;
                  const stem = 6 + norm * 16;
                  const head = 3 + norm * 4;
                  ctx.lineWidth = flipped ? 2.3 : 1.7;
                  ctx.beginPath();
                  if (isBuy) {
                    ctx.moveTo(arrowX, y + stem * 0.5);
                    ctx.lineTo(arrowX, y - stem * 0.5);
                  } else {
                    ctx.moveTo(arrowX, y - stem * 0.5);
                    ctx.lineTo(arrowX, y + stem * 0.5);
                  }
                  ctx.stroke();
                  ctx.beginPath();
                  if (isBuy) {
                    ctx.moveTo(arrowX, y - stem * 0.5 - head);
                    ctx.lineTo(arrowX - head, y - stem * 0.5 + head * 0.2);
                    ctx.lineTo(arrowX + head, y - stem * 0.5 + head * 0.2);
                  } else {
                    ctx.moveTo(arrowX, y + stem * 0.5 + head);
                    ctx.lineTo(arrowX - head, y + stem * 0.5 - head * 0.2);
                    ctx.lineTo(arrowX + head, y + stem * 0.5 - head * 0.2);
                  }
                  ctx.closePath();
                  ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(0.95, alpha + 0.1).toFixed(3)})`;
                  ctx.fill();
                  if (flipped) {
                    ctx.font = 'bold 8px monospace';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('FLIP', arrowX + 5, y);
                  }
                  ctx.restore();
                }
              }
            }

            // Optional pressure bubbles on last candles
            if (showActionBubbles) {
              for (const rb of recent) {
                const x = ts.timeToCoordinate(rb.time as unknown as Time);
                const y = seriesApi.priceToCoordinate(rb.close);
                if (x == null || y == null) continue;
                const p = Math.abs((rb.close - rb.open) * (rb.volume ?? 0));
                const n = clamp(p / absMax, 0, 1);
                if (n < bubbleThreshold / 8) continue;
                const rad = 3 + n * 10;
                const up = rb.close >= rb.open;
                const [cr, cg, cb] = up ? [41, 180, 83] : [189, 43, 43];
                ctx.save();
                ctx.fillStyle = `rgba(${cr},${cg},${cb},${(0.18 + n * 0.42).toFixed(3)})`;
                ctx.beginPath();
                ctx.arc(x, y, rad, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
              }
            }
          }

          // ── Fixed HUD pressure arrow (right side, anchored near live price) ─
          if (bars.length >= 3) {
            const recent = bars.slice(-3);
            const avgPressure = recent.reduce((s, b) => s + (b.close - b.open) * (b.volume ?? 0), 0) / 3;
            const absScale = Math.max(
              1e-9,
              ...bars.slice(-40).map((b) => Math.abs((b.close - b.open) * (b.volume ?? 0))),
            );
            // If OB confidence is solid, bias direction toward OB pressure.
            const merged = obConfidence > 0.25
              ? avgPressure * (1 - obConfidence) + obPressure * absScale * obConfidence
              : avgPressure;
            const norm = clamp(Math.abs(merged) / absScale, 0, 1);
            const up = merged >= 0;
            const [r, g, b] = up ? [41, 180, 83] : [189, 43, 43];
            const alpha = clamp(0.35 + norm * 0.58, 0.35, 0.95);
            const lineW = 2 + norm * 2.2;
            const stem = (10 + norm * 20) * Math.max(0.7, actionGlowGain);
            const head = 4 + norm * 5;

            const x = mediaSize.width - 22;
            const yRaw = seriesApi.priceToCoordinate(recent[2]!.close);
            const y = yRaw == null ? 26 : clamp(yRaw, 28, mediaSize.height - 28);
            ctx.save();
            ctx.strokeStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
            ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
            ctx.lineWidth = lineW;

            if (up) {
              ctx.beginPath();
              ctx.moveTo(x, y + stem * 0.5);
              ctx.lineTo(x, y - stem * 0.5);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(x, y - stem * 0.5 - head);
              ctx.lineTo(x - head, y - stem * 0.5 + head * 0.25);
              ctx.lineTo(x + head, y - stem * 0.5 + head * 0.25);
              ctx.closePath();
              ctx.fill();
            } else {
              ctx.beginPath();
              ctx.moveTo(x, y - stem * 0.5);
              ctx.lineTo(x, y + stem * 0.5);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(x, y + stem * 0.5 + head);
              ctx.lineTo(x - head, y + stem * 0.5 - head * 0.25);
              ctx.lineTo(x + head, y + stem * 0.5 - head * 0.25);
              ctx.closePath();
              ctx.fill();
            }

            // Tiny strength readout beside arrow
            ctx.font = 'bold 7px monospace';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${up ? 'UP' : 'DN'} ${(norm * 100).toFixed(0)}%`, x - 8, y);
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

