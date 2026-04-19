/**
 * Pivot-based Support / Resistance channels.
 * Port of TV-S&R-ZONES.pine (LonesomeTheBlue).
 *
 * Algorithm:
 *  1. Find pivot highs/lows (local extrema within `prd` bars each side).
 *  2. Keep pivots from last `loopback` bars.
 *  3. Cluster pivots within `channelPct` of the 300-bar H-L range.
 *  4. Rank by strength (pivot count × touches).
 *  5. Keep top `maxZones` channels, color by position vs current price.
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

export type SRZone = {
  hi: number;
  lo: number;
  strength: number;  // relative 0–1
  isResistance: boolean;
  isSupport: boolean;
  isInside: boolean;
};

export function detectSRZones(
  bars: Bar[],
  opts?: { prd?: number; loopback?: number; channelPct?: number; maxZones?: number },
): SRZone[] {
  const prd        = opts?.prd        ?? 8;
  const loopback   = opts?.loopback   ?? 200;
  const channelPct = opts?.channelPct ?? 1.2;
  const maxZones   = opts?.maxZones   ?? 6;
  const n = bars.length;
  if (n < prd * 2 + 1) return [];

  const lastClose = bars[n - 1]!.close;

  // 300-bar range for channel-width calc
  const slice300 = bars.slice(Math.max(0, n - 300));
  let hi300 = -Infinity, lo300 = Infinity;
  for (const b of slice300) { hi300 = Math.max(hi300, b.high); lo300 = Math.min(lo300, b.low); }
  const cwidth = (hi300 - lo300) * channelPct / 100;

  // Find pivots in last `loopback` bars
  const pivots: { price: number; bar: number }[] = [];
  const startIdx = Math.max(prd, n - loopback - prd);
  for (let i = startIdx; i < n - prd; i++) {
    const b = bars[i]!;
    // Pivot high
    let isPH = true;
    for (let j = i - prd; j <= i + prd; j++) {
      if (j === i) continue;
      if (bars[j]?.high! >= b.high) { isPH = false; break; }
    }
    if (isPH) pivots.push({ price: b.high, bar: i });

    // Pivot low
    let isPL = true;
    for (let j = i - prd; j <= i + prd; j++) {
      if (j === i) continue;
      if (bars[j]?.low! <= b.low) { isPL = false; break; }
    }
    if (isPL) pivots.push({ price: b.low, bar: i });
  }

  if (pivots.length === 0) return [];

  // Cluster pivots into channels
  type RawZone = { hi: number; lo: number; strength: number };
  const zones: RawZone[] = [];

  for (const pv of pivots) {
    // Try to merge into existing zone
    let merged = false;
    for (const z of zones) {
      const wdth = pv.price <= z.hi ? z.hi - pv.price : pv.price - z.lo;
      if (wdth <= cwidth) {
        z.lo = Math.min(z.lo, pv.price);
        z.hi = Math.max(z.hi, pv.price);
        z.strength += 1;
        merged = true;
        break;
      }
    }
    if (!merged) zones.push({ hi: pv.price, lo: pv.price, strength: 1 });
  }

  // Add touch-count bonus: count how many recent bars touched the zone
  const touchSlice = bars.slice(Math.max(0, n - loopback));
  for (const z of zones) {
    let touches = 0;
    for (const b of touchSlice) {
      if ((b.high >= z.lo && b.high <= z.hi) || (b.low >= z.lo && b.low <= z.hi)) touches++;
    }
    z.strength += touches * 0.5;
  }

  // Sort by strength desc, keep top maxZones, filter single-pivot zones
  zones.sort((a, b) => b.strength - a.strength);
  const kept = zones.slice(0, maxZones).filter((z) => z.strength >= 2);
  if (!kept.length) return [];

  const maxStr = kept[0]!.strength;

  return kept.map((z) => ({
    hi:           z.hi,
    lo:           z.lo,
    strength:     z.strength / maxStr,
    isResistance: z.lo > lastClose,
    isSupport:    z.hi < lastClose,
    isInside:     z.lo <= lastClose && z.hi >= lastClose,
  }));
}

export function createSRZonesPrimitive(
  bars: Bar[],
  zones: SRZone[],
): ISeriesPrimitive {
  let chartApi:  IChartApiBase | null = null;
  let seriesApi: ISeriesApi<'Candlestick'> | null = null;
  let onRange:   (() => void) | null = null;

  const t0 = bars[0]?.time;
  const t1 = bars[bars.length - 1]?.time;

  const paneView = {
    zOrder: () => 'normal' as const,
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (_t: CanvasRenderingTarget2D) => {},
      drawBackground: (target: CanvasRenderingTarget2D) => {
        if (!chartApi || !seriesApi || !zones.length || t0 == null || t1 == null) return;
        const ts = chartApi.timeScale();
        const x0 = ts.timeToCoordinate(t0 as Time);
        const x1 = ts.timeToCoordinate(t1 as Time);
        if (x0 == null || x1 == null) return;
        const left  = Math.min(x0, x1);
        const width = Math.max(1, Math.abs(x1 - x0));

        target.useMediaCoordinateSpace(({ context: ctx }) => {
          for (const z of zones) {
            const yTop = seriesApi!.priceToCoordinate(z.hi);
            const yBot = seriesApi!.priceToCoordinate(z.lo);
            if (yTop == null || yBot == null) continue;
            const top = Math.min(yTop, yBot);
            const h   = Math.max(2, Math.abs(yBot - yTop));

            // Fill
            const a = (0.10 + z.strength * 0.10);
            if (z.isResistance)  ctx.fillStyle = `rgba(242, 54,  69,  ${a.toFixed(3)})`;
            else if (z.isSupport) ctx.fillStyle = `rgba(8,  153, 129, ${a.toFixed(3)})`;
            else                   ctx.fillStyle = `rgba(139,148, 158, ${a.toFixed(3)})`;
            ctx.fillRect(left, top, width, h);

            // Top edge
            const edgeA = 0.30 + z.strength * 0.25;
            if (z.isResistance)  ctx.strokeStyle = `rgba(242, 54,  69,  ${edgeA.toFixed(3)})`;
            else if (z.isSupport) ctx.strokeStyle = `rgba(8,  153, 129, ${edgeA.toFixed(3)})`;
            else                   ctx.strokeStyle = `rgba(139,148, 158, ${edgeA.toFixed(3)})`;
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(left, top + 0.5);
            ctx.lineTo(left + width, top + 0.5);
            ctx.stroke();
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
