import type {
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingContext2D as CanvasCtx } from 'fancy-canvas';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { Bar } from '../../../indicators/boom3d-tech';

export type VolumeBin = {
  top: number;
  bottom: number;
  volume: number;
  norm: number; // 0–1, 1 = POC
  isHVN: boolean; // local maxima above HVN threshold
};

/** Volume-at-price profile (same math as on-chart VP heat primitive). */
export type VolumeProfile = {
  bins: VolumeBin[];
  vpoc: number | null;
  vah: number | null;
  val: number | null;
  totalVolume: number;
  priceRange: number;
  hvnsAbove: number[];
  hvnsBelow: number[];
};

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

/** TV-style heat: cold blue → amber → hot red */
function heatRgb(norm: number): [number, number, number] {
  if (norm < 0.5) {
    const t = norm * 2;
    return [Math.round(30 + t * 190), Math.round(55 + t * 90), Math.round(140 - t * 110)];
  }
  const t = (norm - 0.5) * 2;
  return [Math.round(220 + t * 20), Math.round(145 - t * 95), Math.round(30 - t * 30)];
}

export function buildVolumeProfile(bars: readonly Bar[], binCount: number): VolumeProfile {
  const empty: VolumeProfile = {
    bins: [],
    vpoc: null,
    vah: null,
    val: null,
    totalVolume: 0,
    priceRange: 0,
    hvnsAbove: [],
    hvnsBelow: [],
  };
  if (bars.length === 0) return empty;

  let minP = Number.POSITIVE_INFINITY, maxP = Number.NEGATIVE_INFINITY;
  for (const b of bars) { minP = Math.min(minP, b.low); maxP = Math.max(maxP, b.high); }
  if (!Number.isFinite(minP) || maxP <= minP) return empty;

  const pad  = (maxP - minP) * 0.005;
  const lo   = minP - pad;
  const hi   = maxP + pad;
  const step = (hi - lo) / binCount;
  const vols = new Float64Array(binCount);

  let totalVolume = 0;
  for (const b of bars) {
    const vol = Math.max(0, b.volume ?? 0);
    if (vol <= 0) continue;
    totalVolume += vol;
    const bLo = Math.max(lo, b.low);
    const bHi = Math.min(hi, b.high);
    if (bHi <= bLo) continue;
    const i0 = Math.max(0, Math.floor((bLo - lo) / step));
    const i1 = Math.min(binCount - 1, Math.floor((bHi - lo) / step));
    const touched = Math.max(1, i1 - i0 + 1);
    const alloc = vol / touched;
    for (let i = i0; i <= i1; i++) vols[i]! += alloc;
  }

  let maxVol = 0, vpocIdx = -1;
  for (let i = 0; i < binCount; i++) { if (vols[i]! > maxVol) { maxVol = vols[i]!; vpocIdx = i; } }
  if (maxVol <= 0) return empty;

  // Normalise
  const bins: VolumeBin[] = Array.from({ length: binCount }, (_, i) => ({
    top:    lo + step * (i + 1),
    bottom: lo + step * i,
    volume: vols[i]!,
    norm:   clamp01(vols[i]! / maxVol),
    isHVN:  false,
  }));

  // Detect HVNs — local maxima where norm > 0.55
  const HVN_THRESH = 0.55;
  for (let i = 1; i < bins.length - 1; i++) {
    if (bins[i]!.norm > HVN_THRESH &&
        bins[i]!.norm >= bins[i - 1]!.norm &&
        bins[i]!.norm >= bins[i + 1]!.norm) {
      bins[i]!.isHVN = true;
    }
  }
  if (vpocIdx >= 0) bins[vpocIdx]!.isHVN = true;

  // Value area 70% — expand from VPOC outward
  let captured = vols[vpocIdx] ?? 0;
  const target70 = totalVolume * 0.70;
  let vaLo = vpocIdx, vaHi = vpocIdx;
  while (captured < target70 && (vaLo > 0 || vaHi < binCount - 1)) {
    const addHi = vaHi < binCount - 1 ? vols[vaHi + 1]! : 0;
    const addLo = vaLo > 0 ? vols[vaLo - 1]! : 0;
    if (addHi >= addLo) { vaHi++; captured += addHi; }
    else { vaLo--; captured += addLo; }
  }

  const vpoc = vpocIdx >= 0 ? lo + step * vpocIdx + step * 0.5 : null;
  const vah  = lo + step * (vaHi + 1);
  const val  = lo + step * vaLo;
  const priceRange = maxP - minP;

  // HVN target levels — nearest above and below last close
  const lastClose = bars[bars.length - 1]!.close;
  const hvnsAbove: number[] = [];
  const hvnsBelow: number[] = [];
  for (const bin of bins) {
    if (!bin.isHVN) continue;
    const mid = (bin.top + bin.bottom) * 0.5;
    if (mid > lastClose) hvnsAbove.push(mid);
    else if (mid < lastClose) hvnsBelow.push(mid);
  }
  hvnsAbove.sort((a, b) => a - b);  // nearest first
  hvnsBelow.sort((a, b) => b - a);  // nearest first

  return { bins, vpoc, vah, val, totalVolume, priceRange, hvnsAbove, hvnsBelow };
}

export function createVolumeProfileHeatPrimitive(
  bars: readonly Bar[],
  opts?: { lookbackBars?: number; binCount?: number; alphaScale?: number; showVpoc?: boolean },
): ISeriesPrimitive {
  const binCount   = opts?.binCount   ?? 60;
  const alphaScale = clamp01(opts?.alphaScale ?? 0.5);
  const showVpoc   = opts?.showVpoc !== false;

  // Cumulative = use ALL bars (ignore lookbackBars)
  const profile = buildVolumeProfile(bars, binCount);

  let chartApi:  IChartApiBase | null = null;
  let seriesApi: ISeriesApi<'Candlestick'> | null = null;
  let onRange:   (() => void) | null = null;

  const lastClose  = bars.length ? bars[bars.length - 1]!.close : 0;
  const vpocPrice  = profile.vpoc;
  const biasUp     = vpocPrice != null && lastClose > vpocPrice;
  const biasStrPct = vpocPrice != null && profile.priceRange > 0
    ? Math.abs(lastClose - vpocPrice) / profile.priceRange * 100
    : 0;

  const paneView = {
    zOrder: () => 'normal' as const,
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (_t: CanvasRenderingTarget2D) => {},
      drawBackground: (target: CanvasRenderingTarget2D) => {
        if (!chartApi || !seriesApi || !profile.bins.length) return;
        const ts  = chartApi.timeScale();
        const t0  = bars[0]?.time;
        const t1  = bars[bars.length - 1]?.time;
        if (t0 == null || t1 == null) return;
        const x0 = ts.timeToCoordinate(t0 as Time);
        const x1 = ts.timeToCoordinate(t1 as Time);
        if (x0 == null || x1 == null) return;
        const left  = Math.min(x0, x1);
        const width = Math.max(1, Math.abs(x1 - x0));

        target.useMediaCoordinateSpace(({ context: ctx }) => {
          // ── 1. Heat fills ────────────────────────────────────────────────
          for (const bin of profile.bins) {
            const yTop = seriesApi!.priceToCoordinate(bin.top);
            const yBot = seriesApi!.priceToCoordinate(bin.bottom);
            if (yTop == null || yBot == null) continue;
            const top = Math.min(yTop, yBot);
            const h   = Math.max(1, Math.abs(yBot - yTop));
            const a   = (0.04 + bin.norm * 0.32) * alphaScale;
            const [r, g, b] = heatRgb(bin.norm);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
            ctx.fillRect(left, top, width, h);
          }

          // ── 2. Value Area High / Low ─────────────────────────────────────
          if (profile.vah != null) drawDashedH(ctx, seriesApi!, profile.vah, left, width, 'rgba(8,153,129,0.55)', [5, 4]);
          if (profile.val != null) drawDashedH(ctx, seriesApi!, profile.val, left, width, 'rgba(242,54,69,0.55)',  [5, 4]);

          // ── 3. VPOC line ─────────────────────────────────────────────────
          if (showVpoc && profile.vpoc != null) {
            drawDashedH(ctx, seriesApi!, profile.vpoc, left, width, 'rgba(255,205,110,0.90)', [6, 3], 1.5);
          }

          // ── 4. HVN Target lines (T1/T2 above, T1/T2 below) ───────────────
          const targets: { price: number; label: string; color: string }[] = [];
          profile.hvnsAbove.slice(0, 2).forEach((p, i) => targets.push({ price: p, label: `T${i + 1}↑`, color: 'rgba(8,153,129,0.75)' }));
          profile.hvnsBelow.slice(0, 2).forEach((p, i) => targets.push({ price: p, label: `T${i + 1}↓`, color: 'rgba(242,54,69,0.75)' }));
          for (const t of targets) drawTargetLine(ctx, seriesApi!, t.price, left, width, t.label, t.color);

          // ── 5. Bias label (top-right corner) ─────────────────────────────
          drawBiasLabel(ctx, biasUp, biasStrPct, left + width);
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function drawDashedH(
  ctx: CanvasCtx,
  s: ISeriesApi<'Candlestick'>,
  price: number,
  left: number,
  width: number,
  color: string,
  dash: number[],
  lineWidth = 1,
) {
  const y = s.priceToCoordinate(price);
  if (y == null) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = lineWidth;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(left, y + 0.5);
  ctx.lineTo(left + width, y + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawTargetLine(
  ctx: CanvasCtx,
  s: ISeriesApi<'Candlestick'>,
  price: number,
  left: number,
  width: number,
  label: string,
  color: string,
) {
  const y = s.priceToCoordinate(price);
  if (y == null) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(left, y + 0.5);
  ctx.lineTo(left + width, y + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  // label at right edge
  ctx.font        = 'bold 9px monospace';
  ctx.fillStyle   = color;
  ctx.textAlign   = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, left + width - 4, y - 5);
  ctx.restore();
}

function drawBiasLabel(ctx: CanvasCtx, biasUp: boolean, strPct: number, rightX: number) {
  const arrow  = biasUp ? '▲' : '▼';
  const color  = biasUp ? '#089981' : '#f23645';
  const label  = `VOL ${arrow} ${strPct.toFixed(1)}%`;
  ctx.save();
  ctx.font        = 'bold 9px monospace';
  ctx.fillStyle   = color;
  ctx.textAlign   = 'right';
  ctx.textBaseline = 'top';
  ctx.globalAlpha = 0.75;
  ctx.fillText(label, rightX - 6, 6);
  ctx.restore();
}
