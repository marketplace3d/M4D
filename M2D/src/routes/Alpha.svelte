<!-- Alpha — MoE Gating Engine → Risk Gate
     5 Expert Dimensions → Regime-Weighted Alpha → Pre-Trade Risk Check
     Institutional: meritocracy not democracy, nothing trades without the gate -->
<script>
  import { onMount, onDestroy } from 'svelte'
  import { engineAssets, regime, moeWeights, alphaSignals, pulse } from '../lib/stores.js'
  import { fetchAssets, fetchPulse, runRiskGate, fetchRiskStatus } from '../lib/api.js'
  import { detectRegime, computeAlpha } from '../lib/moe.js'

  let loading = true
  let gateLoading = false
  let pollTimer

  // gated[symbol] = { status, approved_size, reasons }
  let gated = {}
  let riskSnap = null

  const EXPERTS = [
    { key: 'vector',     label: 'VECTOR',     sub: 'MTF Momentum',           sharpe: '1.4', built: true  },
    { key: 'volatility', label: 'VOLATILITY', sub: 'Gamma / ATR Squeeze',    sharpe: '1.9', built: true  },
    { key: 'ghost',      label: 'GHOST',      sub: 'SMC Order Block/FVG',    sharpe: '1.8', built: false },
    { key: 'arb',        label: 'ARB',        sub: 'Stat Arb Cointegration', sharpe: '3.0+', built: false },
    { key: 'pulse',      label: 'PULSE',      sub: 'XAPI Sentiment Velocity',sharpe: '2.5', built: false },
  ]

  const REGIME_LABELS = {
    HIGH_VOL_NEWS:  { col: 'text-red-400',    desc: 'News-driven chaos → PULSE dominates' },
    MEAN_REVERSION: { col: 'text-blue-400',   desc: 'Low vol ranging → ARB dominates' },
    GAMMA_SQUEEZE:  { col: 'text-orange-400', desc: 'IV expanding → VOLATILITY dominates' },
    TREND:          { col: 'text-green-400',  desc: 'Directional → VECTOR + GHOST' },
    UNKNOWN:        { col: 'text-slate-500',  desc: 'Regime unclear — equal weight' },
  }

  $: pulseSignal = (() => {
    const triggers = $pulse?.triggers ?? []
    const bullish = triggers.filter(t => t.direction === 'LONG')
    const bearish  = triggers.filter(t => t.direction === 'SHORT')
    if (!triggers.length) return 0
    const now  = triggers.filter(t => t.urgency === 'NOW').length
    const high = triggers.filter(t => t.urgency === 'HIGH').length
    const score = (bullish.length - bearish.length) / Math.max(1, triggers.length)
    return score * (now > 0 ? 1.0 : high > 0 ? 0.6 : 0.3)
  })()

  async function refresh() {
    try {
      const [assets, p] = await Promise.allSettled([fetchAssets(), fetchPulse()])
      if (assets.status === 'fulfilled') {
        const data = assets.value
        engineAssets.set(data)
        const r = detectRegime(data)
        regime.set(r)
        const signals = data
          .map(a => computeAlpha(a, r, pulseSignal))
          .filter(s => s.direction !== 'FLAT')
          .sort((a, b) => Math.abs(b.alpha) - Math.abs(a.alpha))
        alphaSignals.set(signals)
        // pipe top 20 through Risk Gate
        await runGate(signals.slice(0, 20), r)
      }
      if (p.status === 'fulfilled') pulse.set(p.value)
    } finally {
      loading = false
    }
  }

  async function runGate(signals, r) {
    if (!signals.length) return
    gateLoading = true
    try {
      const payload = signals.map(s => ({
        symbol:         s.symbol,
        alpha:          s.alpha,
        direction:      s.direction,
        confidence:     Math.min(1, Math.abs(s.alpha) * 1.2),
        regime:         r,
        expert_weights: s.experts ?? {},
        proposed_size:  0.02,
      }))
      const res = await runRiskGate(payload)
      if (res.ok) {
        gated = {}
        for (const g of res.results) gated[g.symbol] = g
        riskSnap = { portfolio: res.portfolio, pods: res.pods }
      }
    } catch (_) {
      // gate offline — show signals without gate status
    } finally {
      gateLoading = false
    }
  }

  onMount(() => {
    refresh()
    fetchRiskStatus().then(r => { if (r.ok) riskSnap = r }).catch(() => {})
    pollTimer = setInterval(refresh, 15000)
  })
  onDestroy(() => clearInterval(pollTimer))

  $: regimeMeta = REGIME_LABELS[$regime] ?? REGIME_LABELS.UNKNOWN
  $: weights    = $moeWeights
  $: topSignals = ($alphaSignals ?? []).slice(0, 15)
  $: fireSignals = ($alphaSignals ?? []).filter(s => s.fire)

  function gateStatus(sym) { return gated[sym]?.status ?? null }
  function gateSize(sym)   { return gated[sym]?.approved_size ?? null }
  function gateReasons(sym){ return gated[sym]?.reasons ?? [] }

  function gateBg(sym) {
    const st = gateStatus(sym)
    if (st === 'APPROVED') return 'bg-green-950/20'
    if (st === 'FLAGGED')  return 'bg-yellow-950/20'
    if (st === 'REJECTED') return 'bg-red-950/20'
    return ''
  }

  function gateBadge(sym) {
    const st = gateStatus(sym)
    if (st === 'APPROVED') return { cls: 'text-green-400', label: '✓' }
    if (st === 'FLAGGED')  return { cls: 'text-yellow-400', label: '⚑' }
    if (st === 'REJECTED') return { cls: 'text-red-500',   label: '✗' }
    return null
  }

  function alphaBar(a)  { return Math.min(100, Math.abs(a) * 100) }
  function alphaColor(a){ return a > 0 ? 'bg-green-500' : 'bg-red-500' }
  function alphaText(a) { return a > 0 ? 'text-green-400' : 'text-red-400' }
  function wPct(w)      { return (w * 100).toFixed(0) + '%' }
</script>

<div class="space-y-4">

  <!-- Regime banner + daily halt indicator -->
  <div class="card flex items-center justify-between">
    <div>
      <div class="text-slate-500 text-xs">DETECTED REGIME</div>
      <div class="text-2xl font-bold {regimeMeta.col}">{$regime}</div>
      <div class="text-slate-500 text-xs mt-0.5">{regimeMeta.desc}</div>
    </div>
    <div class="flex gap-4 items-center">
      {#if riskSnap?.portfolio?.halted}
        <div class="text-center">
          <div class="text-red-500 text-xs font-bold animate-pulse-fast">DAILY HALT</div>
          <div class="text-red-400 text-sm font-mono">{(riskSnap.portfolio.daily_pnl * 100).toFixed(2)}%</div>
        </div>
      {:else if riskSnap}
        <div class="text-center">
          <div class="text-slate-500 text-xs">DAILY P&L</div>
          <div class="text-sm font-mono {riskSnap.portfolio.daily_pnl >= 0 ? 'text-green-400' : 'text-red-400'}">{(riskSnap.portfolio.daily_pnl * 100).toFixed(2)}%</div>
        </div>
      {/if}
      {#if fireSignals.length}
        <div class="text-right">
          <div class="text-red-400 text-xs font-bold animate-pulse-fast">FIRE</div>
          <div class="text-white text-2xl font-bold">{fireSignals.length}</div>
          <div class="text-slate-500 text-xs">α &gt; 0.85</div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Expert weights + pod kill status -->
  <div class="card">
    <div class="text-slate-500 text-xs mb-3">MOE GATING WEIGHTS — {$regime}</div>
    <div class="space-y-2">
      {#each EXPERTS as e}
        {@const w = weights[e.key] ?? 0}
        {@const pod = riskSnap?.pods?.[e.key]}
        <div class="flex items-center gap-3 text-xs">
          <div class="w-20 flex items-center gap-1">
            <span class="font-bold" class:text-cyan-400={e.built && !pod?.killed} class:text-red-500={pod?.killed} class:text-slate-600={!e.built}>{e.label}</span>
            {#if pod?.killed}<span class="text-red-500 text-xs">✗</span>{/if}
          </div>
          <div class="text-slate-600 w-32 truncate">{e.sub}</div>
          <div class="flex-1 h-1.5 bg-navy-700 rounded overflow-hidden">
            <div
              class="h-full rounded transition-all {pod?.killed ? 'bg-red-900' : e.built && w > 0 ? 'bg-cyan-500' : 'bg-navy-600'}"
              style="width:{w * 100}%"
            ></div>
          </div>
          <span class="w-8 text-right" class:text-cyan-400={w > 0.3} class:text-slate-500={w <= 0.3}>{wPct(w)}</span>
          {#if pod}
            <span class="w-12 text-right font-mono text-xs {pod.drawdown < -0.02 ? 'text-red-400' : 'text-slate-600'}">{(pod.drawdown * 100).toFixed(1)}%</span>
          {:else}
            <span class="w-12 text-right text-slate-700">S:{e.sharpe}</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <!-- Alpha signals table with gate status -->
  <div class="card p-0 overflow-hidden">
    <div class="px-4 py-2 border-b border-navy-700 flex items-center justify-between">
      <span class="text-slate-500 text-xs">GATED ALPHA → RISK GATE</span>
      <div class="flex gap-3 text-xs text-slate-600">
        {#if gateLoading}<span class="text-cyan-600">checking gate...</span>{/if}
        <span>✓ approved · ⚑ flagged · ✗ rejected</span>
      </div>
    </div>

    {#if loading}
      <div class="p-8 text-center text-slate-600 text-sm">computing alpha...</div>
    {:else if topSignals.length === 0}
      <div class="p-8 text-center text-slate-600 text-sm">no signals — engine running?</div>
    {:else}
      <table class="w-full text-xs font-mono">
        <thead>
          <tr class="text-slate-500 border-b border-navy-700">
            <th class="text-left px-4 py-2">SYMBOL</th>
            <th class="text-left px-4 py-2">DIR</th>
            <th class="text-right px-4 py-2">ALPHA</th>
            <th class="text-right px-4 py-2">VECTOR</th>
            <th class="text-right px-4 py-2">VOL</th>
            <th class="px-4 py-2 w-24">STRENGTH</th>
            <th class="text-right px-4 py-2">SIZE</th>
            <th class="text-center px-3 py-2">GATE</th>
          </tr>
        </thead>
        <tbody>
          {#each topSignals as s}
            {@const badge = gateBadge(s.symbol)}
            {@const reasons = gateReasons(s.symbol)}
            <tr class="border-b border-navy-800/40 hover:bg-navy-700/10 {gateBg(s.symbol)} {s.fire ? 'ring-1 ring-inset ring-orange-800/30' : ''}">
              <td class="px-4 py-1.5 text-slate-100 font-bold">{s.symbol}</td>
              <td class="px-4 py-1.5">
                {#if s.direction === 'LONG'}  <span class="tag-long">LONG</span>
                {:else if s.direction === 'SHORT'} <span class="tag-short">SHORT</span>
                {/if}
              </td>
              <td class="px-4 py-1.5 text-right font-bold {alphaText(s.alpha)}">{s.alpha.toFixed(3)}</td>
              <td class="px-4 py-1.5 text-right text-slate-400">{(s.experts?.vector ?? 0).toFixed(2)}</td>
              <td class="px-4 py-1.5 text-right text-slate-400">{(s.experts?.volatility ?? 0).toFixed(2)}</td>
              <td class="px-4 py-1.5">
                <div class="h-1 bg-navy-700 rounded overflow-hidden">
                  <div class="h-full rounded {alphaColor(s.alpha)}" style="width:{alphaBar(s.alpha)}%"></div>
                </div>
              </td>
              <td class="px-4 py-1.5 text-right text-slate-500">
                {#if gateSize(s.symbol) !== null}
                  {(gateSize(s.symbol) * 100).toFixed(1)}%
                {:else}—{/if}
              </td>
              <td class="px-3 py-1.5 text-center">
                {#if badge}
                  <span title={reasons.join(' · ')} class="cursor-default {badge.cls} text-sm font-bold">{badge.label}</span>
                {:else if s.fire}
                  <span class="text-orange-400 text-xs animate-pulse-fast">◉</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <!-- Not-built expert stubs -->
  <div class="grid grid-cols-3 gap-3">
    {#each EXPERTS.filter(e => !e.built) as e}
      <div class="card border-dashed border-navy-600 opacity-60">
        <div class="text-slate-600 text-xs font-bold">{e.label} EXPERT</div>
        <div class="text-slate-700 text-xs mt-1">{e.sub}</div>
        <div class="text-slate-700 text-xs mt-1">Sharpe target: {e.sharpe}</div>
        <div class="text-orange-800 text-xs mt-2">[[[ NOT BUILT ]]]</div>
      </div>
    {/each}
  </div>

</div>
