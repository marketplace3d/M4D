import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bar } from '$indicators/boom3d-tech';
import type { AutoscaleInfo, LogicalRange, Time } from 'lightweight-charts';
import { createSeriesMarkers, LineSeries } from 'lightweight-charts';
/** mountBoomChart uses the shared pwa `lightweight-charts` instance; use `any` to avoid duplicate IChartApi typings. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LwcChart = any
import { mountBoomChart } from '@pwa/lib/boomChartBuild';
import type { ChartControls } from '@pwa/lib/chartControls';

function barsFingerprint(b: Bar[]): string {
  if (b.length === 0) return '';
  return `${b[0]!.time}-${b[b.length - 1]!.time}-${b.length}`;
}

export type HeatTarget = {
  price: number
  tier: string
  /** rgba/hex override — bypasses obiConfirmTargets colour logic */
  color?: string
  /** 0–1 alpha applied to color via rgba(); default 0.65 */
  opacity?: number
  lineWidth?: 1 | 2 | 3 | 4
  /** 0=solid 1=dotted 2=dashed 3=large-dashed 4=sparse-dotted */
  lineStyle?: 0 | 1 | 2 | 3 | 4
}

/** Keeps liquidity-glow math compatible with `HeatTarget.lineWidth` literals. */
export function clampHeatLineWidth(n: number): 1 | 2 | 3 | 4 {
  const x = Math.min(4, Math.max(1, Math.round(n)))
  return (x <= 1 ? 1 : x === 2 ? 2 : x === 3 ? 3 : 4) as 1 | 2 | 3 | 4
}

function applyAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

type Props = {
  bars: Bar[];
  controls: ChartControls;
  compactUi?: boolean;
  /** Let chart outer fully follow parent height (no fixed min-height). */
  fitContainer?: boolean;
  /** ICT page: override `controls.showVwap` without persisting (avoids chart key churn). */
  showVwap?: boolean;
  /** Reserved for future zoom persistence; ignored by mount. */
  storageKey?: string;
  /** Heatseeker target level — draws horizontal line when set. */
  heatTarget?: HeatTarget | null;
  /** Multiple target lines (LT levels, etc.) — draws a line per entry. */
  heatTargets?: HeatTarget[];
  /**
   * OBI / trade-confirm: thick blue above last close, red below, ICT purple ~at price.
   */
  obiConfirmTargets?: boolean;
  /**
   * Symbol identifier (e.g. 'EURUSD', 'XAUUSD', 'BTC').
   * When provided, triggers MTF ICT level fetch (PWH/PWL/PMH/PML) and MM Brain next stop line.
   */
  symbol?: string;
  /** Polygon.io API key for MTF daily bar fetch. Falls back to VITE_POLYGON_KEY env. */
  polygonKey?: string;
  /** Liquidity-thermal visual tuning (LT2/LT3). */
  ltViz?: {
    actionGlowGain?: number;
    showActionBubbles?: boolean;
    bubbleThreshold?: number;
    obPressure?: number;
    obConfidence?: number;
    lt2PriceBins?: number;
    lt2TimeBins?: number;
    lt2OpacityGain?: number;
    lt3MiniArrowGain?: number;
    lt3MainArrowGain?: number;
  };
  /** Sim/live entry + exit trade markers. */
  tradeMarkers?: Array<{
    time: number
    side: 'LONG' | 'SHORT'
    text?: string
    kind?: 'entry' | 'exit'
  }>;
};

/** Mirrors `pwa/src/lib/BoomChart.svelte` — Lightweight Charts + BOOM3D build. */
const OBI_CONFIRM_ABOVE = '#2563eb';
const OBI_CONFIRM_BELOW = '#dc2626';
const OBI_CONFIRM_ICT = '#a78bfa';

const lineNoAutoscale = {
  autoscaleInfoProvider: (_base: () => AutoscaleInfo | null) => null,
};

export default function BoomLwChart({ bars, controls, compactUi = false, fitContainer = false, showVwap, storageKey, heatTarget, heatTargets, obiConfirmTargets = false, symbol, polygonKey, ltViz, tradeMarkers }: Props) {
  void storageKey;
  const chartControls = useMemo(
    () => (showVwap === undefined ? controls : { ...controls, showVwap }),
    [controls, showVwap],
  );
  const elRef = useRef<HTMLDivElement>(null);
  const [chartApi, setChartApi] = useState<LwcChart | null>(null);
  const savedLogicalRangeRef = useRef<LogicalRange | null>(null);
  const savedBarsFpRef = useRef('');

  const barsKey = barsFingerprint(bars);
  const controlsKey = JSON.stringify(chartControls);
  const ltVizKey = useMemo(() => {
    if (!ltViz) return '';
    return JSON.stringify({
      ...ltViz,
      obPressure: typeof ltViz.obPressure === 'number' ? Number(ltViz.obPressure.toFixed(2)) : undefined,
      obConfidence: typeof ltViz.obConfidence === 'number' ? Number(ltViz.obConfidence.toFixed(2)) : undefined,
    });
  }, [ltViz]);

  useEffect(() => {
    const el = elRef.current;
    if (!el || bars.length === 0) return;

    const fp = barsKey;
    const canRestore =
      savedBarsFpRef.current !== '' &&
      savedBarsFpRef.current === fp &&
      savedLogicalRangeRef.current !== null;

    let alive = true;
    let chart: LwcChart | null = null;
    let ro: ResizeObserver | null = null;

    void mountBoomChart(el, bars, chartControls, {
      snapToLatest: !canRestore,
      initialLogicalRange: canRestore ? savedLogicalRangeRef.current! : undefined,
      compactUi,
      symbol,
      polygonKey: polygonKey ?? import.meta.env.VITE_POLYGON_KEY as string | undefined,
      ltViz,
    }).then((x) => {
      if (!alive) {
        x.ro.disconnect();
        x.chart.remove();
        return;
      }
      chart = x.chart;
      ro = x.ro;
      setChartApi(x.chart);
      savedLogicalRangeRef.current = null;
      savedBarsFpRef.current = '';
    });

    return () => {
      alive = false;
      setChartApi(null);
      if (chart) {
        savedBarsFpRef.current = fp;
        savedLogicalRangeRef.current = chart.timeScale().getVisibleLogicalRange() ?? null;
      }
      ro?.disconnect();
      chart?.remove();
      chart = null;
      ro = null;
    };
  }, [barsKey, controlsKey, ltVizKey, bars, chartControls, compactUi, symbol, polygonKey]);

  // ── Heatseeker target level line ────────────────────────────────────────────
  useEffect(() => {
    if (!chartApi || !heatTarget || bars.length === 0) return;
    const color = heatTarget.tier === 'S' ? '#00ffaa' : '#ffee00';
    let series: LwcChart | null = null;
    try {
      series = (chartApi as LwcChart).addSeries(LineSeries, {
        ...lineNoAutoscale,
        color,
        lineWidth: 2,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        title: `${heatTarget.tier}-TARGET`,
      });
      series?.setData(
        bars.map((b) => ({ time: b.time as unknown as Time, value: heatTarget.price })),
      );
    } catch {
      /* chart already removed */
    }
    return () => {
      if (series) {
        try { chartApi.removeSeries(series); } catch { /* removed with chart */ }
      }
    };
  }, [chartApi, heatTarget, bars]);

  // ── Multi-target lines — structural levels first (z behind), ranked targets last (z front)
  useEffect(() => {
    if (!chartApi || !heatTargets || heatTargets.length === 0 || bars.length === 0) return;
    const last = bars[bars.length - 1]!.close;
    const atEps = Math.max(last * 1.5e-6, 1e-9);
    const seriesList: LwcChart[] = [];
    for (const ht of heatTargets) {
      let color: string;
      let lineWidth: 1 | 2 | 3 | 4;
      let lineStyle: 0 | 1 | 2 | 3 | 4;

      if (ht.color) {
        // Explicit colour from caller (OBI ranked/structural system)
        const alpha = ht.opacity ?? 0.65;
        color = ht.color.startsWith('#') ? applyAlpha(ht.color, alpha) : ht.color;
        lineWidth = (ht.lineWidth ?? 1) as 1 | 2 | 3 | 4;
        lineStyle = (ht.lineStyle ?? 0) as 0 | 1 | 2 | 3 | 4;
      } else if (obiConfirmTargets) {
        if (Math.abs(ht.price - last) <= atEps) {
          color = OBI_CONFIRM_ICT;
        } else if (ht.price > last) {
          color = OBI_CONFIRM_ABOVE;
        } else {
          color = OBI_CONFIRM_BELOW;
        }
        lineWidth = 3;
        lineStyle = 0;
      } else {
        const isPoc = ht.tier === 'POC';
        const isResist = ht.tier.startsWith('R');
        color = isPoc ? '#ff9500' : isResist ? '#ff4466' : '#00cc88';
        lineWidth = isPoc ? 2 : 1;
        lineStyle = isPoc ? 0 : 2;
      }

      try {
        const s = (chartApi as LwcChart).addSeries(LineSeries, {
          ...lineNoAutoscale,
          color,
          lineWidth,
          lineStyle,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: ht.tier,
        });
        s.setData(bars.map((b) => ({ time: b.time as unknown as Time, value: ht.price })));
        seriesList.push(s);
      } catch { /* chart removed */ }
    }
    return () => {
      for (const s of seriesList) {
        try { chartApi.removeSeries(s); } catch { /* removed with chart */ }
      }
    };
  }, [chartApi, heatTargets, bars, obiConfirmTargets]);

  // ── Trade arrows (entry / exit) — full close line so marker times match series. ─
  useEffect(() => {
    if (!chartApi || !tradeMarkers || tradeMarkers.length === 0 || bars.length === 0) return;
    let series: LwcChart | null = null;
    try {
      series = (chartApi as LwcChart).addSeries(LineSeries, {
        ...lineNoAutoscale,
        color: 'rgba(0,0,0,0)',
        lineWidth: 1,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: 'TRADE_MARKERS',
      });
      series.setData(
        bars.map((b) => ({ time: b.time as unknown as Time, value: b.close })),
      );
      createSeriesMarkers(
        series,
        tradeMarkers.map((m) => {
          const isExit = m.kind === 'exit'
          if (isExit) {
            if (m.side === 'LONG') {
              return {
                time: m.time as unknown as Time,
                position: 'aboveBar' as const,
                color: '#fbbf24',
                shape: 'arrowDown' as const,
                size: 2,
                text: m.text ?? 'OUT',
              }
            }
            return {
              time: m.time as unknown as Time,
              position: 'belowBar' as const,
              color: '#22d3ee',
              shape: 'arrowUp' as const,
              size: 2,
              text: m.text ?? 'OUT',
            }
          }
          return {
            time: m.time as unknown as Time,
            position: m.side === 'LONG' ? ('belowBar' as const) : ('aboveBar' as const),
            color: m.side === 'LONG' ? '#22c55e' : '#ef4444',
            shape: m.side === 'LONG' ? ('arrowUp' as const) : ('arrowDown' as const),
            size: 2,
            text: m.text ?? (m.side === 'LONG' ? 'BUY' : 'SELL'),
          }
        }),
      );
    } catch {
      /* chart removed */
    }
    return () => {
      if (series) {
        try { chartApi.removeSeries(series); } catch { /* removed with chart */ }
      }
    };
  }, [chartApi, tradeMarkers, bars]);

  function jumpToLatest() {
    chartApi?.timeScale().scrollToRealTime();
  }

  return (
    <div className={fitContainer || compactUi ? 'tv-lw-chart-outer tv-lw-chart-outer--compact' : 'tv-lw-chart-outer'}>
      <div className="tv-lw-chart-wrap" ref={elRef} />
      {chartApi ? (
        <button
          type="button"
          className="tv-lw-chart-jump"
          aria-label="Scroll to latest bar"
          title="Latest bar"
          onClick={jumpToLatest}
        >
          <span className="tv-lw-chart-jump__glyph" aria-hidden>
            ➤
          </span>
        </button>
      ) : null}
    </div>
  );
}
