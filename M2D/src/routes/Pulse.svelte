<!-- Grok Pulse — live news triggers feed -->
<script>
  import { onMount, onDestroy } from 'svelte'
  import { fetchPulse, triggerPulse } from '../lib/api.js'

  let data = null
  let loading = true
  let firing = false
  let filter = 'all'  // all | NOW | HIGH | LONG | SHORT
  let expanded = null
  let pollTimer

  const urgencyOrder = { NOW: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

  onMount(async () => {
    await load()
    pollTimer = setInterval(load, 30000)
  })

  onDestroy(() => clearInterval(pollTimer))

  async function load() {
    try {
      data = await fetchPulse()
    } catch(e) {
      // DS not running yet
    } finally {
      loading = false
    }
  }

  async function runNow() {
    firing = true
    try {
      await triggerPulse()
      await load()
    } finally {
      firing = false
    }
  }

  $: triggers = (data?.triggers ?? [])
    .filter(t => {
      if (filter === 'all')   return true
      if (filter === 'NOW')   return t.urgency === 'NOW'
      if (filter === 'HIGH')  return t.urgency === 'HIGH' || t.urgency === 'NOW'
      if (filter === 'LONG')  return t.direction === 'LONG'
      if (filter === 'SHORT') return t.direction === 'SHORT'
    })
    .sort((a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9))

  $: stale = data?.stale ?? false
  $: age = data?.age_seconds ? `${Math.round(data.age_seconds)}s ago` : ''

  function urgencyBadge(u) {
    return {
      NOW:    'bg-red-900/60 text-red-300 border border-red-700',
      HIGH:   'bg-orange-900/50 text-orange-300 border border-orange-800',
      MEDIUM: 'bg-yellow-900/40 text-yellow-400 border border-yellow-900',
      LOW:    'bg-slate-800 text-slate-400 border border-slate-700',
    }[u] ?? 'bg-slate-800 text-slate-500'
  }

  function dirBadge(d) {
    return d === 'LONG' ? 'tag-long' : d === 'SHORT' ? 'tag-short' : 'tag-flat'
  }

  function confBar(c) { return Math.round((c ?? 0) * 100) }
</script>

<div class="space-y-4">

  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <h1 class="text-cyan-400 font-bold glow">GROK PULSE</h1>
      {#if !loading}
        <span class="text-xs px-2 py-0.5 rounded font-mono"
          class:bg-green-900={!stale} class:text-green-400={!stale}
          class:bg-slate-800={stale} class:text-slate-500={stale}
        >{stale ? 'STALE' : 'LIVE'}</span>
      {/if}
      {#if age}
        <span class="text-slate-600 text-xs">{age}</span>
      {/if}
    </div>
    <button
      on:click={runNow}
      disabled={firing}
      class="px-3 py-1 bg-navy-700 hover:bg-navy-600 border border-navy-600 rounded text-xs font-mono text-slate-300 transition-colors disabled:opacity-50"
    >{firing ? 'scanning...' : 'scan now'}</button>
  </div>

  <!-- Filters -->
  <div class="flex gap-1">
    {#each ['all','NOW','HIGH','LONG','SHORT'] as f}
      <button
        class="px-3 py-1 text-xs font-mono rounded transition-colors"
        class:bg-navy-600={filter === f} class:text-cyan-400={filter === f}
        class:bg-navy-800={filter !== f} class:text-slate-500={filter !== f}
        on:click={() => filter = f}
      >{f}</button>
    {/each}
    <span class="ml-auto text-xs text-slate-600">{triggers.length} triggers</span>
  </div>

  <!-- Triggers list -->
  {#if loading}
    <div class="text-slate-600 text-sm text-center py-12">connecting to pulse...</div>
  {:else if triggers.length === 0}
    <div class="card text-center text-slate-600 py-12 text-sm">
      {data ? 'no triggers matching filter' : 'pulse daemon not running — start with ./go.sh ds'}
    </div>
  {:else}
    <div class="space-y-2">
      {#each triggers as t, i}
        <div
          class="card cursor-pointer hover:border-navy-600 transition-colors"
          on:click={() => expanded = expanded === i ? null : i}
        >
          <!-- Row header -->
          <div class="flex items-center gap-2 text-xs">
            <span class="px-2 py-0.5 rounded text-xs font-mono {urgencyBadge(t.urgency)}">{t.urgency}</span>
            <span class="{dirBadge(t.direction)}">{t.direction}</span>
            <span class="text-slate-200 flex-1 font-bold truncate">{t.asset ?? t.symbol}</span>
            <div class="h-1 w-16 bg-navy-700 rounded overflow-hidden">
              <div class="h-full bg-cyan-600 rounded" style="width:{confBar(t.confidence)}%"></div>
            </div>
            <span class="text-slate-500 w-8 text-right">{confBar(t.confidence)}%</span>
            <span class="text-slate-600 w-4 text-right">{expanded === i ? '▲' : '▼'}</span>
          </div>

          <!-- Expanded -->
          {#if expanded === i}
            <div class="mt-3 pt-3 border-t border-navy-700 space-y-2 text-xs">
              {#if t.headline}
                <p class="text-slate-300 leading-relaxed">{t.headline}</p>
              {/if}
              <div class="flex gap-4 text-slate-500 flex-wrap">
                {#if t.trigger_class}<span>class: <span class="text-slate-400">{t.trigger_class}</span></span>{/if}
                {#if t.source_confidence}<span>src confidence: <span class="text-slate-400">{(t.source_confidence * 100).toFixed(0)}%</span></span>{/if}
                {#if t.halo_auto}<span class="text-green-600">HALO AUTO</span>{/if}
              </div>
              {#if t.reasoning}
                <p class="text-slate-500 leading-relaxed italic">{t.reasoning}</p>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

</div>
