<!-- TradeI — Real-time scanner
     Crypto: Rust API /ws/scanner (Binance 1m, 50 assets, real threads)
     Funding + StatArb: Django DS (kept for arb analytics) -->
<script>
  import { onMount, onDestroy } from 'svelte'
  import { fetchFunding, fetchStatArb } from '../lib/api.js'

  let loading = true
  let connected = false
  let ws = null
  let pollTimer
  let activeTab    = 'surge'
  let marketFilter = 'all'

  let alerts       = []    // flat array from Rust scanner
  let scanMeta     = { last_scan: null, symbols_scanned: 0 }
  let fundingData  = null
  let statArbData  = null

  const TABS = [
    ['surge',    '⚡ SURGE'],
    ['breakout', '▲ BREAK'],
    ['momentum', '→ MOM'],
    ['reversal', '↩ REV'],
    ['gaps',     '◈ GAPS'],
    ['funding',  '$ FUND'],
    ['statarb',  '∞ ARB'],
  ]

  const ALERT_BADGE = {
    SURGE:    'bg-orange-950/40 text-orange-400',
    BREAKOUT: 'bg-green-950/40 text-green-400',
    MOMENTUM: 'bg-cyan-950/40 text-cyan-400',
    REVERSAL: 'bg-yellow-950/40 text-yellow-400',
    GAP:      'bg-purple-950/40 text-purple-400',
  }

  // ── WebSocket (Rust scanner at /ws/scanner → :3030) ──────────────────────
  function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    // Vite proxy: /ws/* → ws://localhost:3030
    ws = new WebSocket(`${proto}://${location.host}/ws/scanner`)

    ws.onopen = () => { connected = true; loading = false }

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        // WS sends flat alerts array
        if (Array.isArray(data)) {
          alerts = data
        } else if (data.alerts) {
          // REST snapshot shape
          alerts = data.alerts
          scanMeta = { last_scan: data.last_scan, symbols_scanned: data.symbols_scanned }
        }
        loading = false
      } catch (_) {}
    }

    ws.onclose = () => {
      connected = false
      // Reconnect after 5s
      setTimeout(connectWs, 5000)
    }

    ws.onerror = () => ws.close()
  }

  // ── DS polling (funding + stat-arb only) ─────────────────────────────────
  async function refreshDs() {
    const [funding, arb] = await Promise.allSettled([fetchFunding(), fetchStatArb()])
    if (funding.status === 'fulfilled') fundingData = funding.value
    if (arb.status     === 'fulfilled') statArbData = arb.value
  }

  onMount(() => {
    connectWs()
    refreshDs()
    pollTimer = setInterval(refreshDs, 60000)
  })
  onDestroy(() => {
    clearInterval(pollTimer)
    ws?.close()
  })

  // ── Derived ───────────────────────────────────────────────────────────────
  function alertsOfType(type) {
    const typeMap = { gaps: 'GAP', surge: 'SURGE', breakout: 'BREAKOUT', momentum: 'MOMENTUM', reversal: 'REVERSAL' }
    const t = typeMap[type] ?? type.toUpperCase()
    const rows = alerts.filter(a => a.alert_type === t)
    if (marketFilter === 'all') return rows
    return rows.filter(a => a.market === marketFilter)
  }

  $: surgeRows   = alertsOfType('surge')
  $: breakRows   = alertsOfType('breakout')
  $: momRows     = alertsOfType('momentum')
  $: revRows     = alertsOfType('reversal')
  $: gapRows     = alertsOfType('gaps')
  $: counts      = {
    SURGE:    alerts.filter(a => a.alert_type === 'SURGE').length,
    BREAKOUT: alerts.filter(a => a.alert_type === 'BREAKOUT').length,
    MOMENTUM: alerts.filter(a => a.alert_type === 'MOMENTUM').length,
    REVERSAL: alerts.filter(a => a.alert_type === 'REVERSAL').length,
    GAP:      alerts.filter(a => a.alert_type === 'GAP').length,
  }
  $: totalAlerts = alerts.length
  $: fundingRows = fundingData?.rows    ?? []
  $: fundingSigs = fundingData?.signals ?? []
  $: arbPairs    = statArbData?.pairs   ?? []
  $: arbSignals  = statArbData?.signals ?? []

  // ── Helpers ───────────────────────────────────────────────────────────────
  function pctColor(v) {
    if (v == null) return 'text-slate-500'
    return v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-slate-500'
  }
  function rvColor(v) {
    if (!v) return 'text-slate-500'
    if (v >= 3)   return 'text-red-400'
    if (v >= 2)   return 'text-orange-400'
    if (v >= 1.5) return 'text-yellow-400'
    return 'text-slate-500'
  }
  function zColor(z) {
    const az = Math.abs(z ?? 0)
    if (az >= 2.5) return z > 0 ? 'text-red-400' : 'text-green-400'
    if (az >= 2.0) return z > 0 ? 'text-orange-400' : 'text-cyan-400'
    return 'text-slate-500'
  }
  function annColor(v) {
    if (!v) return 'text-slate-400'
    if (v > 10) return 'text-green-400'
    if (v > 5)  return 'text-yellow-400'
    return 'text-slate-400'
  }
  function fmtTs(ts) {
    if (!ts) return '—'
    return new Date(ts * 1000).toLocaleTimeString('en-US', { hour12: false })
  }
  function fmtPrice(p) {
    if (p == null) return '—'
    if (p < 0.001) return p.toFixed(8)
    if (p < 1)     return p.toFixed(5)
    if (p < 100)   return p.toFixed(3)
    return p.toFixed(2)
  }
  // Score is 0-100 from Rust
  function scoreBarWidth(s) { return Math.min(100, Math.max(0, s)).toFixed(0) }
</script>

<div class="space-y-3">

  <!-- Header -->
  <div class="flex items-center justify-between flex-wrap gap-2">
    <div class="flex items-center gap-3">
      <h1 class="text-cyan-400 font-bold glow">TRADE-I SCANNER</h1>
      {#if connected}
        <span class="text-green-500 text-xs font-mono">● LIVE</span>
      {:else}
        <span class="text-red-500 text-xs font-mono animate-pulse">● CONNECTING</span>
      {/if}
      {#if totalAlerts > 0}
        <span class="text-orange-400 font-mono text-sm font-bold">{totalAlerts} alerts</span>
      {/if}
      {#if scanMeta.symbols_scanned > 0}
        <span class="text-slate-600 text-xs">{scanMeta.symbols_scanned} symbols · {fmtTs(scanMeta.last_scan)}</span>
      {/if}
    </div>
    <div class="flex bg-navy-800 rounded border border-navy-700 overflow-hidden text-xs">
      {#each [['all','ALL'],['crypto','CRYPTO'],['stock','STOCKS']] as [v, label]}
        <button
          class="px-3 py-1.5 transition-colors {marketFilter === v ? 'bg-navy-600 text-cyan-400' : 'text-slate-500'}"
          on:click={() => marketFilter = v}
        >{label}</button>
      {/each}
    </div>
  </div>

  <!-- Tabs -->
  <div class="flex flex-wrap gap-1">
    <div class="flex bg-navy-800 rounded border border-navy-700 overflow-hidden">
      {#each TABS.slice(0,5) as [t, label]}
        {@const typeKey = t === 'gaps' ? 'GAP' : t.toUpperCase()}
        <button
          class="px-3 py-1.5 text-xs font-mono transition-colors relative"
          class:bg-navy-600={activeTab === t}
          class:text-cyan-400={activeTab === t}
          class:text-slate-500={activeTab !== t}
          on:click={() => activeTab = t}
        >
          {label}
          {#if counts[typeKey]}
            <span class="absolute -top-1 -right-1 bg-orange-500 text-white rounded-full w-4 h-4 flex items-center justify-center font-bold" style="font-size:9px">
              {counts[typeKey]}
            </span>
          {/if}
        </button>
      {/each}
    </div>
    <div class="flex bg-navy-800 rounded border border-navy-700 overflow-hidden">
      {#each TABS.slice(5) as [t, label]}
        <button
          class="px-3 py-1.5 text-xs font-mono transition-colors"
          class:bg-navy-600={activeTab === t}
          class:text-cyan-400={activeTab === t}
          class:text-slate-500={activeTab !== t}
          on:click={() => activeTab = t}
        >{label}</button>
      {/each}
    </div>
  </div>

  {#if loading}
    <div class="card text-center text-slate-600 py-12 text-sm">connecting to Rust scanner...</div>
  {:else}

  <!-- ── SCANNER ALERT TABS ── -->
  {#if ['surge','breakout','momentum','reversal','gaps'].includes(activeTab)}
    {@const rows = activeTab === 'surge' ? surgeRows
                 : activeTab === 'breakout' ? breakRows
                 : activeTab === 'momentum' ? momRows
                 : activeTab === 'reversal' ? revRows
                 : gapRows}
    <div class="card p-0 overflow-hidden">
      <table class="w-full text-xs font-mono">
        <thead>
          <tr class="border-b border-navy-700 text-slate-500">
            <th class="text-left px-4 py-2">SYMBOL</th>
            <th class="text-left px-4 py-2">MKT</th>
            <th class="text-left px-4 py-2">TYPE</th>
            <th class="text-right px-4 py-2">PRICE</th>
            <th class="text-right px-4 py-2">CHG%</th>
            <th class="text-right px-4 py-2">REL VOL</th>
            <th class="text-left px-4 py-2">DIR</th>
            <th class="px-4 py-2 w-24">SCORE</th>
            <th class="text-left px-4 py-2">DETAIL</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as a}
            <tr class="border-b border-navy-800/40 {a.direction === 'LONG' ? 'hover:bg-green-950/5' : 'hover:bg-red-950/5'}">
              <td class="px-4 py-1.5 text-slate-100 font-bold">{a.symbol}</td>
              <td class="px-4 py-1.5 text-slate-600">{a.market === 'crypto' ? '₿' : '$'}</td>
              <td class="px-4 py-1.5">
                <span class="px-1.5 py-0.5 rounded text-xs {ALERT_BADGE[a.alert_type] ?? 'text-slate-400'}">{a.alert_type}</span>
              </td>
              <td class="px-4 py-1.5 text-right text-slate-300">{fmtPrice(a.price)}</td>
              <td class="px-4 py-1.5 text-right font-bold {pctColor(a.change_pct)}">{a.change_pct > 0 ? '+' : ''}{a.change_pct?.toFixed(3)}%</td>
              <td class="px-4 py-1.5 text-right {rvColor(a.rel_vol)}">{a.rel_vol?.toFixed(2)}x</td>
              <td class="px-4 py-1.5">
                {#if a.direction === 'LONG'}<span class="tag-long">LONG</span>
                {:else if a.direction === 'SHORT'}<span class="tag-short">SHORT</span>
                {:else}<span class="text-slate-600">—</span>{/if}
              </td>
              <td class="px-4 py-1.5">
                <div class="flex items-center gap-1">
                  <div class="flex-1 h-1 bg-navy-700 rounded overflow-hidden">
                    <div class="h-full bg-cyan-500 rounded" style="width:{scoreBarWidth(a.score)}%"></div>
                  </div>
                  <span class="text-slate-600 w-8 text-right">{scoreBarWidth(a.score)}</span>
                </div>
              </td>
              <td class="px-4 py-1.5 text-slate-500 truncate max-w-40">{a.detail}</td>
            </tr>
          {:else}
            <tr><td colspan="9" class="px-4 py-8 text-center text-slate-600">
              {connected ? `no ${activeTab} alerts` : 'connecting...'}
            </td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <!-- ── FUNDING ── -->
  {#if activeTab === 'funding'}
    {#if fundingSigs.length}
      <div class="card bg-green-950/20 border-green-900/40 text-xs mb-2">
        <span class="text-green-400 font-bold">{fundingSigs.length} active signals</span>
        <span class="text-slate-500 ml-2">threshold {fundingData?.threshold_pct ?? '—'}% annualized</span>
      </div>
    {/if}
    <div class="card p-0 overflow-hidden">
      <table class="w-full text-xs font-mono">
        <thead>
          <tr class="border-b border-navy-700 text-slate-500">
            <th class="text-left px-4 py-2">SYMBOL</th>
            <th class="text-right px-4 py-2">RATE/8H</th>
            <th class="text-right px-4 py-2">ANN%</th>
            <th class="text-left px-4 py-2">TRADE</th>
            <th class="text-right px-4 py-2">X-SPREAD</th>
            <th class="px-4 py-2 w-6"></th>
          </tr>
        </thead>
        <tbody>
          {#each fundingRows as r}
            <tr class="border-b border-navy-800/40 hover:bg-navy-700/20 {r.strong ? 'bg-green-950/10' : ''}">
              <td class="px-4 py-1.5 text-slate-100 font-bold">{r.symbol}</td>
              <td class="px-4 py-1.5 text-right {pctColor(r.avg_rate)}">{(r.avg_rate * 100).toFixed(4)}%</td>
              <td class="px-4 py-1.5 text-right font-bold {annColor(r.annualized_pct)}">{r.annualized_pct?.toFixed(1)}%</td>
              <td class="px-4 py-1.5 text-slate-500">{r.direction === 'LONG_SPOT_SHORT_PERP' ? 'L spot / S perp' : 'S spot / L perp'}</td>
              <td class="px-4 py-1.5 text-right text-slate-500">{r.cross_spread_pct != null ? r.cross_spread_pct.toFixed(1) + '%' : '—'}</td>
              <td class="px-4 py-1.5 text-center">{r.strong ? '◉' : r.signal ? '·' : ''}</td>
            </tr>
          {:else}
            <tr><td colspan="6" class="px-4 py-8 text-center text-slate-600">no funding data</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <!-- ── STAT ARB ── -->
  {#if activeTab === 'statarb'}
    {#if arbSignals.length}
      <div class="card bg-cyan-950/20 border-cyan-900/40 text-xs mb-2">
        <span class="text-cyan-400 font-bold">{arbSignals.length} active pairs</span>
        <span class="text-slate-500 ml-2">|z| &gt; 2.0 — ARB expert signals</span>
      </div>
    {/if}
    <div class="card p-0 overflow-hidden">
      <table class="w-full text-xs font-mono">
        <thead>
          <tr class="border-b border-navy-700 text-slate-500">
            <th class="text-left px-4 py-2">PAIR</th>
            <th class="text-right px-4 py-2">Z-SCORE</th>
            <th class="text-right px-4 py-2">HALF-LIFE</th>
            <th class="text-right px-4 py-2">CONF</th>
            <th class="text-left px-4 py-2">TRADE</th>
            <th class="px-4 py-2 w-6"></th>
          </tr>
        </thead>
        <tbody>
          {#each arbPairs as r}
            <tr class="border-b border-navy-800/40 hover:bg-navy-700/20 {r.strong ? 'bg-cyan-950/10' : ''}">
              <td class="px-4 py-1.5 text-slate-100 font-bold">{r.pair}</td>
              <td class="px-4 py-1.5 text-right font-bold {zColor(r.z_score)}">{r.z_score?.toFixed(2)}</td>
              <td class="px-4 py-1.5 text-right text-slate-400">{r.half_life != null ? r.half_life + 'b' : '—'}</td>
              <td class="px-4 py-1.5 text-right text-slate-400">{r.confidence != null ? (r.confidence * 100).toFixed(0) + '%' : '—'}</td>
              <td class="px-4 py-1.5 text-slate-500 truncate max-w-32">{r.direction === 'FLAT' ? '—' : r.direction?.replace(/_/g,' ').toLowerCase()}</td>
              <td class="px-4 py-1.5 text-center text-cyan-400">{r.strong ? '◉' : r.signal ? '·' : ''}</td>
            </tr>
          {:else}
            <tr><td colspan="6" class="px-4 py-8 text-center text-slate-600">no pairs — engine data needed</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {/if}
</div>
