import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bar } from '$indicators/boom3d-tech';
import type { IChartApi, ISeriesApi, LogicalRange, Time } from 'lightweight-charts';
import { mountBoomChart } from '@pwa/lib/boomChartBuild';
import type { ChartControls } from '@pwa/lib/chartControls';

function barsFingerprint(b: Bar[]): string {
  if (b.length === 0) return '';
  return `${b[0]!.time}-${b[b.length - 1]!.time}-${b.length}`;
}

export type HeatTarget = { price: number; tier: string };

type Props = {
  bars: Bar[];
  controls: ChartControls;
  compactUi?: boolean;
  /** ICT page: override `controls.showVwap` without persisting (avoids chart key churn). */
  showVwap?: boolean;
  /** Reserved for future zoom persistence; ignored by mount. */
  storageKey?: string;
  /** Heatseeker target level — draws horizontal line when set. */
  heatTarget?: HeatTarget | null;
  /** Multiple target lines (LT levels, etc.) — draws a line per entry. */
  heatTargets?: HeatTarget[];
  /**
   * Symbol identifier (e.g. 'EURUSD', 'XAUUSD', 'BTC').
   * When provided, triggers MTF ICT level fetch (PWH/PWL/PMH/PML) and MM Brain next stop line.
   */
  symbol?: string;
  /** Polygon.io API key for MTF daily bar fetch. Falls back to VITE_POLYGON_KEY env. */
  polygonKey?: string;
};

/** Mirrors `pwa/src/lib/BoomChart.svelte` — Lightweight Charts + BOOM3D build. */
export default function BoomLwChart({ bars, controls, compactUi = false, showVwap, storageKey, heatTarget, heatTargets, symbol, polygonKey }: Props) {
  void storageKey;
  const chartControls = useMemo(
    () => (showVwap === undefined ? controls : { ...controls, showVwap }),
    [controls, showVwap],
  );
  const elRef = useRef<HTMLDivElement>(null);
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const savedLogicalRangeRef = useRef<LogicalRange | null>(null);
  const savedBarsFpRef = useRef('');

  const barsKey = barsFingerprint(bars);
  const controlsKey = JSON.stringify(chartControls);

  useEffect(() => {
    const el = elRef.current;
    if (!el || bars.length === 0) return;

    const fp = barsKey;
    const canRestore =
      savedBarsFpRef.current !== '' &&
      savedBarsFpRef.current === fp &&
      savedLogicalRangeRef.current !== null;

    let alive = true;
    let chart: IChartApi | null = null;
    let ro: ResizeObserver | null = null;

    void mountBoomChart(el, bars, chartControls, {
      snapToLatest: !canRestore,
      initialLogicalRange: canRestore ? savedLogicalRangeRef.current! : undefined,
      compactUi,
      symbol,
      polygonKey: polygonKey ?? import.meta.env.VITE_POLYGON_KEY as string | undefined,
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
  }, [barsKey, controlsKey, bars, chartControls, compactUi]);

  // ── Heatseeker target level line ────────────────────────────────────────────
  useEffect(() => {
    if (!chartApi || !heatTarget || bars.length === 0) return;
    const color = heatTarget.tier === 'S' ? '#00ffaa' : '#ffee00';
    let series: ISeriesApi<'Line'> | null = null;
    try {
      series = (chartApi as any).addLineSeries({
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

  // ── Multi-target lines (LT levels) ──────────────────────────────────────────
  useEffect(() => {
    if (!chartApi || !heatTargets || heatTargets.length === 0 || bars.length === 0) return;
    const seriesList: ISeriesApi<'Line'>[] = [];
    for (const ht of heatTargets) {
      const isPoc = ht.tier === 'POC';
      const isResist = ht.tier.startsWith('R');
      const color = isPoc ? '#ff9500' : isResist ? '#ff4466' : '#00cc88';
      try {
        const s = (chartApi as any).addLineSeries({
          color,
          lineWidth: isPoc ? 2 : 1,
          lineStyle: isPoc ? 0 : 2,
          priceLineVisible: false,
          lastValueVisible: true,
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
  }, [chartApi, heatTargets, bars]);

  function jumpToLatest() {
    chartApi?.timeScale().scrollToRealTime();
  }

  return (
    <div className="tv-lw-chart-outer">
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
