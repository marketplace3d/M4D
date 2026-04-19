<script lang="ts">
  import { onMount } from 'svelte';
  import type { Bar } from '$indicators/boom3d-tech';
  import {
    type ChartSymbol,
    SYMBOLS,
    fetchBarsForSymbol,
  } from '$lib/fetchBars';
  import {
    TIMEFRAME_OPTIONS,
    type TimeframePreset,
    loadTimeframe,
    saveTimeframe,
  } from '$lib/chartTimeframes';
  import BoomChart from '$lib/BoomChart.svelte';
  import {
    defaultControls,
    defaultControlsAllOff,
    loadControls,
    saveControls,
    type ChartControls,
  } from '$lib/chartControls';

  const vitePolygonKey = (import.meta.env.VITE_POLYGON_IO_KEY ||
    import.meta.env.VITE_POLYGON_API_KEY) as string | undefined;

  let bars: Bar[] = $state([]);
  let sym: ChartSymbol = $state('EURUSD');
  let err = $state('');
  let loading = $state(true);

  let controls: ChartControls = $state(loadControls());
  let tf: TimeframePreset = $state(loadTimeframe());

  function persist() {
    saveControls(controls);
  }

  function setMaster(v: boolean) {
    controls = { ...controls, masterOn: v };
    persist();
  }

  function allOn() {
    controls = { ...defaultControls, masterOn: true };
    persist();
  }

  function allOff() {
    controls = { ...defaultControlsAllOff };
    persist();
  }

  async function load(s: ChartSymbol) {
    sym = s;
    loading = true;
    err = '';
    try {
      bars = await fetchBarsForSymbol(s, vitePolygonKey, tf);
      if (bars.length === 0) err = 'No bars returned';
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      bars = [];
    } finally {
      loading = false;
    }
  }

  function setTimeframe(next: TimeframePreset) {
    tf = next;
    saveTimeframe(next);
    load(sym);
  }

  onMount(() => load('EURUSD'));
</script>

<div class="page">
<div class="toolbar toolbar-main" role="group" aria-label="Symbol and timeframe">
  <div class="toolbar-group" role="toolbar" aria-label="Instruments">
    {#each SYMBOLS as s}
      <button type="button" class:active={sym === s.id} onclick={() => load(s.id)}>{s.label}</button>
    {/each}
  </div>
  <span class="toolbar-sep" aria-hidden="true"></span>
  <div class="toolbar-group" role="toolbar" aria-label="Timeframe">
    {#each TIMEFRAME_OPTIONS as o}
      <button type="button" class:active={tf === o.id} onclick={() => setTimeframe(o.id)}>{o.label}</button>
    {/each}
  </div>
</div>

<section class="controls" aria-label="Chart layers">
  <div class="row actions">
    <button type="button" class:active={controls.masterOn} onclick={() => setMaster(!controls.masterOn)}>
      Indicators {controls.masterOn ? 'ON' : 'OFF'}
    </button>
    <button type="button" class="ghost" onclick={allOn}>All on</button>
    <button type="button" class="ghost" onclick={allOff}>All OFF</button>
  </div>
  <div class="row toggles">
    <label
      ><input
        type="checkbox"
        checked={controls.showIchimoku}
        onchange={(e) => {
          controls = { ...controls, showIchimoku: e.currentTarget.checked };
          persist();
        }}
      /> Ichimoku cloud</label
    >
    <label
      ><input
        type="checkbox"
        checked={controls.showGrid}
        onchange={(e) => {
          controls = { ...controls, showGrid: e.currentTarget.checked };
          persist();
        }}
      /> Grid</label
    >
    <label
      ><input
        type="checkbox"
        checked={controls.showBB}
        onchange={(e) => {
          controls = { ...controls, showBB: e.currentTarget.checked };
          persist();
        }}
      /> BB</label
    >
    <label
      ><input
        type="checkbox"
        checked={controls.showKC}
        onchange={(e) => {
          controls = { ...controls, showKC: e.currentTarget.checked };
          persist();
        }}
      /> KC</label
    >
    <label
      ><input
        type="checkbox"
        checked={controls.showMas}
        onchange={(e) => {
          controls = { ...controls, showMas: e.currentTarget.checked };
          persist();
        }}
      /> MAs</label
    >
    <label
      ><input
        type="checkbox"
        checked={controls.showSar}
        onchange={(e) => {
          controls = { ...controls, showSar: e.currentTarget.checked };
          persist();
        }}
      /> SAR</label
    >
    <label
      ><input
        type="checkbox"
        checked={controls.squeezeLinesGreen}
        onchange={(e) => {
          controls = { ...controls, squeezeLinesGreen: e.currentTarget.checked };
          persist();
        }}
      /> Squeeze lines</label
    >
    <label
      ><input
        type="checkbox"
        checked={controls.squeezePurpleBg}
        onchange={(e) => {
          controls = { ...controls, squeezePurpleBg: e.currentTarget.checked };
          persist();
        }}
      /> Squeeze purple</label
    >
    <label
      ><input
        type="checkbox"
        checked={controls.showDarvas}
        onchange={(e) => {
          controls = { ...controls, showDarvas: e.currentTarget.checked };
          persist();
        }}
      /> Darvas box</label
    >
    <label
      ><input
        type="checkbox"
        checked={controls.showCouncilArrows}
        onchange={(e) => {
          controls = { ...controls, showCouncilArrows: e.currentTarget.checked };
          persist();
        }}
      /> Council arrows</label
    >
    <label
      ><input
        type="checkbox"
        checked={controls.showVoteDots}
        onchange={(e) => {
          controls = { ...controls, showVoteDots: e.currentTarget.checked };
          persist();
        }}
      /> Vote dots</label
    >
    <label
      ><input
        type="checkbox"
        checked={controls.showFvg}
        onchange={(e) => {
          controls = { ...controls, showFvg: e.currentTarget.checked };
          persist();
        }}
      /> FVG heat</label
    >
    <label
      ><input
        type="checkbox"
        checked={controls.showOrderBlocks}
        onchange={(e) => {
          controls = { ...controls, showOrderBlocks: e.currentTarget.checked };
          persist();
        }}
      /> Order blocks</label
    >
    <label
      ><input
        type="checkbox"
        checked={controls.showSwingRays}
        onchange={(e) => {
          controls = { ...controls, showSwingRays: e.currentTarget.checked };
          persist();
        }}
      /> Swing levels</label
    >
    <label
      ><input
        type="checkbox"
        checked={controls.showSessionLevels}
        onchange={(e) => {
          controls = { ...controls, showSessionLevels: e.currentTarget.checked };
          persist();
        }}
      /> OR / PDH / PDL</label
    >
  </div>
  <div class="row vote-row">
    <label>
      Min vote (6–7)
      <input
        type="range"
        min="6"
        max="7"
        step="1"
        value={controls.minVote}
        oninput={(e) => {
          const v = Number(e.currentTarget.value);
          controls = { ...controls, minVote: v === 7 ? 7 : 6 };
          persist();
        }}
      />
      <span>{controls.minVote}</span>
    </label>
    <p class="hint"><code>VITE_MOCK_SENTIMENT</code> in <code>pwa/.env</code> (0–1)</p>
  </div>
</section>

{#if err}
  <p class="err">{err}</p>
{/if}

<div class="chart-stage">
{#if loading}
  <p class="muted">Loading…</p>
{:else if bars.length}
  {#key `${sym}-${tf}-${bars[0].time}-${bars[bars.length - 1].time}-${bars.length}`}
    <BoomChart {bars} {controls} />
  {/key}
{/if}
</div>

<section class="legend" aria-label="Series legend">
  <span
    ><i
      class="swatch"
      style="background:linear-gradient(90deg,rgba(46,204,113,0.1),rgba(239,68,68,0.1))"
    ></i> Ichimoku cloud</span
  >
  <span><i class="swatch" style="background:#58a6ff"></i> BB</span>
  <span><i class="swatch" style="background:#a371f7"></i> KC</span>
  <span
    ><i
      class="swatch"
      style="background:linear-gradient(90deg,rgba(46,204,113,0.25),rgba(239,68,68,0.25))"
    ></i> EMA (lines + ribbon)</span
  >
  <span><i class="swatch" style="background:#dcbe78"></i> Darvas</span>
  <span><i class="swatch" style="background:#8846e0"></i> Squeeze / PD</span>
  <span><i class="swatch" style="background:linear-gradient(90deg,#28d2ff,#ff6e37)"></i> FVG heat (bull / bear)</span>
  <span><i class="swatch" style="background:linear-gradient(90deg,#006eff,#ff3760)"></i> Order blocks (demand / supply)</span>
  <span><i class="swatch" style="background:linear-gradient(90deg,#8cc8ff,#ffc878)"></i> Swing rays (pivot H / L)</span>
  <span>Council = Darvas break + vote ≥ min</span>
</section>
</div>
