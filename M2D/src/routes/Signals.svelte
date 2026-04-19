<!-- Holly-style surge table — Trade Ideas equivalent
     Data from: /ds/v1/algo/holly/ (Django DS scanner)
     Fallback: derive from /api/v1/assets if Holly not yet wired -->
<script>
  import { onMount } from 'svelte'

  import { fetchHolly } from '../lib/api.js'

  let hollyData = null
  let loading = true
  let error = null
  let activeAlgo = 'all'
  let dirFilter = 'all'  // all | long | short

  const ALGO_TABS = ['all', 'breakout', 'vwap_pullback', 'mean_reversion']

  onMount(async () => {
    try {
      hollyData = await fetchHolly()
    } catch (e) {
      error = e.message
    } finally {
      loading = false
    }
  })

  // Flatten all signals from all algos
  $: allSignals = hollyData
    ? Object.entries(hollyData.signals ?? {}).flatMap(([algo, rows]) =>
        rows.map(r => ({ ...r, algo }))
      )
    : []

  $: filtered = allSignals
    .filter(r => activeAlgo === 'all' || r.algo === activeAlgo)
    .filter(r => {
      if (dirFilter === 'all') return true
      if (dirFilter === 'long')  return r.score > 0
      if (dirFilter === 'short') return r.score < 0
    })
    .sort((a, b) => Math.abs(b.score ?? 0) - Math.abs(a.score ?? 0))

  $: topAlgos = hollyData?.top_algos ?? []

  function evColor(ev) {
    if (!ev) return 'text-slate-500'
    return ev > 0 ? 'text-green-400' : 'text-red-400'
  }

  function scoreBar(score) {
    const pct = Math.min(100, Math.abs(score ?? 0) * 200)
    return pct
  }
</script>

<div class="space-y-4">

  <div class="flex items-center justify-between">
    <h1 class="text-cyan-400 font-bold glow">SURGE SCANNER</h1>
    <div class="text-slate-600 text-xs">Holly-style · Top algos selected daily</div>
  </div>

  <!-- Top algos selected today -->
  {#if topAlgos.length}
    <div class="card">
      <div class="text-slate-500 text-xs mb-2">TODAY'S ACTIVE ALGOS</div>
      <div class="flex gap-3 flex-wrap">
        {#each topAlgos as a}
          <div class="bg-navy-700 rounded px-3 py-1 text-xs">
            <span class="text-cyan-400 font-bold">{a.algo}</span>
            <span class="text-slate-500 ml-2">EV {(a.expectancy * 100).toFixed(2)}%</span>
            <span class="text-slate-500 ml-2">WR {(a.win_rate * 100).toFixed(0)}%</span>
            <span class="text-slate-500 ml-2">{a.trades}T</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Filters -->
  <div class="flex gap-2 items-center">
    <div class="flex bg-navy-800 rounded border border-navy-700 overflow-hidden">
      {#each ALGO_TABS as t}
        <button
          class="px-3 py-1 text-xs font-mono transition-colors"
          class:bg-navy-600={activeAlgo === t}
          class:text-cyan-400={activeAlgo === t}
          class:text-slate-500={activeAlgo !== t}
          on:click={() => activeAlgo = t}
        >{t}</button>
      {/each}
    </div>
    <div class="flex bg-navy-800 rounded border border-navy-700 overflow-hidden">
      {#each ['all','long','short'] as d}
        <button
          class="px-3 py-1 text-xs font-mono transition-colors"
          class:bg-navy-600={dirFilter === d}
          class:text-cyan-400={dirFilter === d}
          class:text-slate-500={dirFilter !== d}
          on:click={() => dirFilter = d}
        >{d}</button>
      {/each}
    </div>
    <span class="text-slate-600 text-xs ml-auto">{filtered.length} signals</span>
  </div>

  <!-- Signal table -->
  <div class="card p-0 overflow-hidden">
    {#if loading}
      <div class="p-8 text-center text-slate-600 text-sm">scanning...</div>
    {:else if error}
      <div class="p-8 text-center">
        <div class="text-red-400 text-sm mb-1">Holly scanner not connected</div>
        <div class="text-slate-600 text-xs">{error}</div>
        <div class="text-slate-600 text-xs mt-2">Wire up /ds/v1/algo/holly/ in Django DS</div>
      </div>
    {:else if filtered.length === 0}
      <div class="p-8 text-center text-slate-600 text-sm">no signals</div>
    {:else}
      <table class="w-full text-xs font-mono">
        <thead>
          <tr class="border-b border-navy-700 text-slate-500">
            <th class="text-left px-4 py-2">SYMBOL</th>
            <th class="text-left px-4 py-2">ALGO</th>
            <th class="text-left px-4 py-2">DIR</th>
            <th class="text-right px-4 py-2">SCORE</th>
            <th class="text-right px-4 py-2">REL VOL</th>
            <th class="text-right px-4 py-2">RET%</th>
            <th class="px-4 py-2 w-32">STRENGTH</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered.slice(0, 50) as r}
            <tr class="border-b border-navy-800/50 hover:bg-navy-700/30 transition-colors">
              <td class="px-4 py-2 text-slate-100 font-bold">{r.symbol}</td>
              <td class="px-4 py-2 text-slate-400">{r.algo}</td>
              <td class="px-4 py-2">
                {#if (r.score ?? 0) > 0}
                  <span class="tag-long">LONG</span>
                {:else}
                  <span class="tag-short">SHORT</span>
                {/if}
              </td>
              <td class="px-4 py-2 text-right {evColor(r.score)}">{(r.score ?? 0).toFixed(3)}</td>
              <td class="px-4 py-2 text-right text-slate-400">{(r.rel_vol ?? 0).toFixed(2)}x</td>
              <td class="px-4 py-2 text-right text-slate-400">{((r.ret_1 ?? 0) * 100).toFixed(2)}%</td>
              <td class="px-4 py-2">
                <div class="h-1 bg-navy-700 rounded overflow-hidden">
                  <div
                    class="h-full rounded transition-all"
                    class:bg-green-500={(r.score ?? 0) > 0}
                    class:bg-red-500={(r.score ?? 0) <= 0}
                    style="width:{scoreBar(r.score)}%"
                  ></div>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

</div>
