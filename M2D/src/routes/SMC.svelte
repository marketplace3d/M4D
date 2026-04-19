<!-- SMC — Smart Money Concepts: ICT Order Block → FVG Target
     GHOST Expert (Sharpe 1.8) — NOT YET BUILT
     Needs: engine OB/FVG detection, institutional liquidity sweep signals
     When built: trades from institutional OB → cumulative FVG target -->
<script>
  // [[[NOT BUILT — engine needs OB/FVG detection added]]]
  // ICT trading logic:
  //   1. Identify institutional Order Block (OB): last up/down candle before strong move
  //   2. Mark Fair Value Gap (FVG): imbalance between candle 1 and candle 3
  //   3. Wait for price to return to OB
  //   4. Entry: OB retest with volume confirmation
  //   5. Target: cumulative FVG fill (institutional target)
  //   6. Stop: below/above OB

  const NEEDED = [
    { label: 'Engine: OB detection',         status: 'TODO', detail: 'Last bull/bear candle before impulse move' },
    { label: 'Engine: FVG scanner',           status: 'TODO', detail: 'Candle 1 high < Candle 3 low (bull FVG)' },
    { label: 'Engine: Liquidity sweep scan',  status: 'TODO', detail: 'Equal highs/lows = institutional target' },
    { label: 'Django: /ds/v1/algo/smc/',      status: 'TODO', detail: 'Returns OB+FVG setup list per asset' },
    { label: 'GHOST expert wired into MoE',   status: 'TODO', detail: 'Signal: -1..+1 per asset' },
  ]
</script>

<div class="space-y-4">

  <div class="flex items-center justify-between">
    <h1 class="text-cyan-400 font-bold glow">SMC — GHOST EXPERT</h1>
    <span class="text-orange-500 text-xs font-mono border border-orange-800 px-2 py-0.5 rounded">[[[ NOT BUILT ]]]</span>
  </div>

  <!-- Strategy brief -->
  <div class="card border-orange-900/40">
    <div class="text-orange-400 text-xs font-bold mb-2">ICT SMART MONEY CONCEPTS</div>
    <div class="text-slate-400 text-sm leading-relaxed space-y-2">
      <p>Trade <strong class="text-slate-200">institutional Order Block → cumulative FVG target</strong>.</p>
      <p>Price raids equal highs/lows to grab liquidity, then reverses from institutional OB. Entry at OB retest. Target = FVG fill above/below.</p>
      <p class="text-slate-500">Sharpe target: <span class="text-orange-400">1.8</span> · MoE weight in TREND regime: <span class="text-orange-400">30%</span></p>
    </div>
  </div>

  <!-- ICT trade flow diagram -->
  <div class="card">
    <div class="text-slate-500 text-xs mb-3">ICT TRADE FLOW</div>
    <div class="flex items-center gap-2 text-xs font-mono text-slate-400 flex-wrap">
      <span class="bg-navy-700 px-2 py-1 rounded">Liquidity Sweep</span>
      <span class="text-slate-600">→</span>
      <span class="bg-navy-700 px-2 py-1 rounded">OB Retest</span>
      <span class="text-slate-600">→</span>
      <span class="bg-navy-700 px-2 py-1 rounded">Volume Confirm</span>
      <span class="text-slate-600">→</span>
      <span class="bg-green-900/50 text-green-400 px-2 py-1 rounded">ENTRY</span>
      <span class="text-slate-600">→</span>
      <span class="bg-cyan-900/50 text-cyan-400 px-2 py-1 rounded">FVG TARGET</span>
    </div>
  </div>

  <!-- Build TODO list -->
  <div class="card">
    <div class="text-slate-500 text-xs mb-3">BUILD REQUIREMENTS</div>
    <div class="space-y-2">
      {#each NEEDED as item}
        <div class="flex items-start gap-3 text-xs">
          <span class="text-orange-700 w-4 mt-0.5">□</span>
          <div>
            <div class="text-slate-300 font-bold">{item.label}</div>
            <div class="text-slate-600">{item.detail}</div>
          </div>
        </div>
      {/each}
    </div>
  </div>

  <div class="text-slate-700 text-xs text-center py-4">
    When built: OB/FVG setup cards appear here with entry price, FVG target, stop level, and R-ratio
  </div>

</div>
