<!-- XSocial — Grok × X Mega Scanner
     45% PULSE expert signal. Per-asset: sentiment velocity, smart money,
     retail FOMO (contrarian), catalyst loading, narrative momentum -->
<script>
  import { onMount, onDestroy } from 'svelte'
  import { fetchXSocial, runXSocialScan } from '../lib/api.js'


  let snap = null
  let loading = true
  let scanning = false
  let error = null
  let sortKey = 'composite_x'  // composite_x | sentiment_velocity | smart_money | confidence
  let dirFilter = 'all'         // all | long | short | fomo
  let pollTimer

  onMount(async () => {
    await load()
    pollTimer = setInterval(load, 60000)
  })
  onDestroy(() => clearInterval(pollTimer))

  async function load() {
    try {
      snap = await fetchXSocial()
    } catch (e) {
      error = e.message
    } finally {
      loading = false
    }
  }

  async function runScan() {
    scanning = true
    try {
      await runXSocialScan(null)
      await load()
    } finally {
      scanning = false
    }
  }

  $: assets = snap?.assets ?? {}
  $: macro = snap?.macro ?? {}
  $: age = snap?.age_seconds ?? null
  $: stale = snap?.stale ?? false

  $: rows = Object.entries(assets)
    .map(([sym, d]) => ({ sym, ...d }))
    .filter(r => !r.error)
    .filter(r => {
      if (dirFilter === 'all')   return true
      if (dirFilter === 'long')  return (r.composite_x ?? 0) > 0.1
      if (dirFilter === 'short') return (r.composite_x ?? 0) < -0.1
      if (dirFilter === 'fomo')  return (r.retail_fomo ?? 0) > 0.65
    })
    .sort((a, b) => {
      if (sortKey === 'composite_x')         return Math.abs(b.composite_x ?? 0) - Math.abs(a.composite_x ?? 0)
      if (sortKey === 'sentiment_velocity')  return Math.abs(b.sentiment_velocity ?? 0) - Math.abs(a.sentiment_velocity ?? 0)
      if (sortKey === 'smart_money')         return Math.abs(b.smart_money_signal ?? 0) - Math.abs(a.smart_money_signal ?? 0)
      if (sortKey === 'confidence')          return (b.confidence ?? 0) - (a.confidence ?? 0)
    })

  function cx(v) {
    const pct = Math.min(100, Math.abs(v ?? 0) * 100)
    const col = (v ?? 0) > 0 ? 'bg-green-500' : 'bg-red-500'
    return { pct, col }
  }

  function scoreColor(v) {
    if (!v) return 'text-slate-500'
    return v > 0.2 ? 'text-green-400' : v < -0.2 ? 'text-red-400' : 'text-slate-400'
  }

  function fomoColor(v) {
    if ((v ?? 0) > 0.75) return 'text-red-400 font-bold'
    if ((v ?? 0) > 0.5)  return 'text-orange-400'
    return 'text-slate-500'
  }

  function regimeColor(r) {
    return { RISK_ON: 'text-green-400', RISK_OFF: 'text-red-400', NEUTRAL: 'text-yellow-400' }[r] ?? 'text-slate-500'
  }
</script>

<div class="space-y-4">

  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <h1 class="text-cyan-400 font-bold glow">X SOCIAL ALPHA</h1>
      <span class="text-slate-600 text-xs font-mono">Grok × X · 45% PULSE weight</span>
      {#if !loading}
        <span class="text-xs px-2 py-0.5 rounded font-mono border"
          class:bg-green-900={!stale} class:text-green-400={!stale} class:border-green-800={!stale}
          class:bg-slate-800={stale}  class:text-slate-500={stale}  class:border-slate-700={stale}
        >{stale ? 'STALE' : 'LIVE'}</span>
        {#if age != null}<span class="text-slate-700 text-xs">{age}s ago</span>{/if}
      {/if}
    </div>
    <button
      on:click={runScan}
      disabled={scanning}
      class="px-3 py-1 bg-navy-700 hover:bg-navy-600 border border-navy-600 rounded text-xs font-mono text-cyan-400 transition-colors disabled:opacity-50"
    >{scanning ? 'scanning X...' : 'mega scan'}</button>
  </div>

  <!-- Macro panel -->
  {#if macro.macro_regime}
    <div class="card grid grid-cols-4 gap-4 text-xs">
      <div>
        <div class="text-slate-600 mb-1">X MACRO REGIME</div>
        <div class="text-lg font-bold {regimeColor(macro.macro_regime)}">{macro.macro_regime}</div>
      </div>
      <div>
        <div class="text-slate-600 mb-1">FED SENTIMENT</div>
        <div class="font-bold {scoreColor(macro.fed_sentiment)}">{macro.fed_sentiment?.toFixed(2) ?? '—'}</div>
      </div>
      <div>
        <div class="text-slate-600 mb-1">$ PRESSURE</div>
        <div class="font-bold {scoreColor(macro.dollar_pressure)}">{macro.dollar_pressure?.toFixed(2) ?? '—'}</div>
      </div>
      <div>
        <div class="text-slate-600 mb-1">SYSTEMIC RISK</div>
        <div class="font-bold" class:text-red-400={(macro.systemic_risk ?? 0) > 0.5} class:text-slate-400={(macro.systemic_risk ?? 0) <= 0.5}>
          {macro.systemic_risk?.toFixed(2) ?? '—'}
        </div>
      </div>
      {#if macro.narrative_shift}
        <div class="col-span-4 border-t border-navy-700 pt-2 text-slate-400 italic">
          "{macro.narrative_shift}"
        </div>
      {/if}
    </div>
  {/if}

  <!-- Filters + sort -->
  <div class="flex gap-2 flex-wrap items-center">
    <div class="flex bg-navy-800 rounded border border-navy-700 overflow-hidden">
      {#each ['all','long','short','fomo'] as f}
        <button class="px-3 py-1 text-xs font-mono transition-colors"
          class:bg-navy-600={dirFilter === f} class:text-cyan-400={dirFilter === f}
          class:text-slate-500={dirFilter !== f}
          on:click={() => dirFilter = f}
        >{f === 'fomo' ? '⚠ FOMO' : f}</button>
      {/each}
    </div>
    <div class="flex bg-navy-800 rounded border border-navy-700 overflow-hidden">
      {#each [['composite_x','COMPOSITE'],['sentiment_velocity','VELOCITY'],['smart_money','SMART $'],['confidence','CONF']] as [k, label]}
        <button class="px-3 py-1 text-xs font-mono transition-colors"
          class:bg-navy-600={sortKey === k} class:text-cyan-400={sortKey === k}
          class:text-slate-500={sortKey !== k}
          on:click={() => sortKey = k}
        >{label}</button>
      {/each}
    </div>
    <span class="text-slate-600 text-xs ml-auto">{rows.length} assets</span>
  </div>

  <!-- Asset table -->
  <div class="card p-0 overflow-hidden">
    {#if loading}
      <div class="p-8 text-center text-slate-600 text-sm">querying X via Grok...</div>
    {:else if error || !snap}
      <div class="p-8 text-center space-y-2">
        <div class="text-red-400 text-sm">XSocial not connected</div>
        <div class="text-slate-600 text-xs">{error ?? 'No data'}</div>
        <div class="text-slate-700 text-xs">Start grok_pulse.py — XSocial runs every 5 min</div>
      </div>
    {:else if rows.length === 0}
      <div class="p-8 text-center text-slate-600 text-sm">no data for filter</div>
    {:else}
      <table class="w-full text-xs font-mono">
        <thead>
          <tr class="border-b border-navy-700 text-slate-500">
            <th class="text-left px-4 py-2">SYMBOL</th>
            <th class="text-right px-4 py-2">COMPOSITE</th>
            <th class="text-right px-4 py-2">VELOCITY</th>
            <th class="text-right px-4 py-2">SMART $</th>
            <th class="text-right px-4 py-2">CATALYST</th>
            <th class="text-right px-4 py-2 text-orange-400">FOMO⚠</th>
            <th class="text-right px-4 py-2">CONF</th>
            <th class="px-4 py-2 w-28">STRENGTH</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r}
            {@const bar = cx(r.composite_x)}
            <tr class="border-b border-navy-800/40 hover:bg-navy-700/20 group {(r.retail_fomo ?? 0) > 0.75 ? 'bg-red-950/20' : ''}">
              <td class="px-4 py-2">
                <div class="text-slate-100 font-bold">{r.sym}</div>
                {#if r.x_volume_spike}
                  <div class="text-cyan-600 text-xs">X spike</div>
                {/if}
              </td>
              <td class="px-4 py-2 text-right font-bold {scoreColor(r.composite_x)}">
                {r.composite_x > 0 ? '+' : ''}{(r.composite_x ?? 0).toFixed(2)}
              </td>
              <td class="px-4 py-2 text-right {scoreColor(r.sentiment_velocity)}">
                {(r.sentiment_velocity ?? 0).toFixed(2)}
              </td>
              <td class="px-4 py-2 text-right {scoreColor(r.smart_money_signal)}">
                {(r.smart_money_signal ?? 0).toFixed(2)}
              </td>
              <td class="px-4 py-2 text-right {scoreColor(r.catalyst_loading)}">
                {(r.catalyst_loading ?? 0).toFixed(2)}
              </td>
              <td class="px-4 py-2 text-right {fomoColor(r.retail_fomo)}">
                {((r.retail_fomo ?? 0) * 100).toFixed(0)}%
                {#if (r.retail_fomo ?? 0) > 0.75}<span class="ml-0.5">⚠</span>{/if}
              </td>
              <td class="px-4 py-2 text-right text-slate-500">
                {((r.confidence ?? 0) * 100).toFixed(0)}%
              </td>
              <td class="px-4 py-2">
                <div class="relative h-1.5 bg-navy-700 rounded overflow-hidden">
                  <div class="absolute h-full rounded {bar.col}" style="width:{bar.pct}%"></div>
                </div>
              </td>
            </tr>
            <!-- Expanded signals row -->
            {#if r.top_signals?.length}
              <tr class="border-b border-navy-800/40 bg-navy-900/50">
                <td colspan="8" class="px-6 py-1 text-slate-600 text-xs italic">
                  {r.top_signals.join(' · ')}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

</div>
