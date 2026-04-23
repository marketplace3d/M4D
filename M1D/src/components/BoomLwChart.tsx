import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bar } from '$indicators/boom3d-tech';
import type { IChartApi, LogicalRange } from 'lightweight-charts';
import { mountBoomChart } from '@pwa/lib/boomChartBuild';
import type { ChartControls } from '@pwa/lib/chartControls';

function barsFingerprint(b: Bar[]): string {
  if (b.length === 0) return '';
  return `${b[0]!.time}-${b[b.length - 1]!.time}-${b.length}`;
}

type Props = {
  bars: Bar[];
  controls: ChartControls;
  compactUi?: boolean;
  /** ICT page: override `controls.showVwap` without persisting (avoids chart key churn). */
  showVwap?: boolean;
  /** Reserved for future zoom persistence; ignored by mount. */
  storageKey?: string;
};

/** Mirrors `pwa/src/lib/BoomChart.svelte` — Lightweight Charts + BOOM3D build. */
export default function BoomLwChart({ bars, controls, compactUi = false, showVwap, storageKey }: Props) {
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
