<script lang="ts">
  import { browser } from '$app/environment';
  import type { Bar } from '$indicators/boom3d-tech';
  import type { LogicalRange } from 'lightweight-charts';
  import type { ChartControls } from './chartControls';
  import { mountBoomChart } from './boomChartBuild';

  interface Props {
    bars: Bar[];
    controls: ChartControls;
  }
  let { bars, controls }: Props = $props();

  let el = $state<HTMLDivElement | undefined>(undefined);
  let chartApi = $state<import('lightweight-charts').IChartApi | null>(null);

  /** Preserve zoom when only `controls` change (same OHLC series). */
  let savedLogicalRange: LogicalRange | null = null;
  let savedBarsFp = '';

  function barsFingerprint(b: Bar[]): string {
    if (b.length === 0) return '';
    return `${b[0].time}-${b[b.length - 1].time}-${b.length}`;
  }

  /** onMount + early return can skip mount when bind:this is not ready yet; $effect re-runs when el binds. */
  $effect(() => {
    if (!browser || !el || bars.length === 0) return;

    const fp = barsFingerprint(bars);
    const canRestore =
      savedBarsFp !== '' && savedBarsFp === fp && savedLogicalRange !== null;

    let alive = true;
    let chart: import('lightweight-charts').IChartApi | null = null;
    let ro: ResizeObserver | null = null;

    void mountBoomChart(el, bars, controls, {
      snapToLatest: !canRestore,
      initialLogicalRange: canRestore ? savedLogicalRange : undefined,
    }).then((x) => {
      if (!alive) {
        x.ro.disconnect();
        x.chart.remove();
        return;
      }
      chart = x.chart;
      chartApi = x.chart;
      ro = x.ro;

      savedLogicalRange = null;
      savedBarsFp = '';
    });

    return () => {
      alive = false;
      chartApi = null;
      if (chart) {
        savedBarsFp = fp;
        savedLogicalRange = chart.timeScale().getVisibleLogicalRange() ?? null;
      }
      ro?.disconnect();
      chart?.remove();
      chart = null;
      ro = null;
    };
  });

  function jumpToLatest() {
    chartApi?.timeScale().scrollToRealTime();
  }
</script>

<div class="chart-outer">
  <div class="chart-wrap" bind:this={el}></div>
  {#if chartApi}
    <button
      type="button"
      class="chart-jump-live"
      aria-label="Scroll to latest bar"
      title="Latest bar"
      onclick={jumpToLatest}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M10 6l6 6-6 6M14 6l6 6-6 6"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  {/if}
</div>
