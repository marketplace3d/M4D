<script>
  import { onMount, onDestroy } from 'svelte'
  import { page } from './lib/stores.js'
  import { createAlgoWS } from './lib/ws.js'

  import Alpha    from './routes/Alpha.svelte'
  import TradeI   from './routes/TradeI.svelte'
  import Signals  from './routes/Signals.svelte'
  import Pulse    from './routes/Pulse.svelte'
  import SMC      from './routes/SMC.svelte'
  import XSocial  from './routes/XSocial.svelte'

  const NAV = [
    { id: 'alpha',    icon: '◉', label: 'Alpha'    },
    { id: 'xsocial',  icon: 'X', label: 'XSocial'  },
    { id: 'tradei',   icon: '⚡', label: 'TradeI'   },
    { id: 'signals',  icon: '∿', label: 'Signals'  },
    { id: 'pulse',    icon: '◈', label: 'Pulse'    },
    { id: 'smc',      icon: 'Ι', label: 'SMC'      },
  ]

  // WS for live engine ticks (optional — Alpha falls back to poll)
  const algoWS = createAlgoWS()
  const unsubWS = algoWS.subscribe(() => {})  // connection only; Alpha.svelte polls

  onMount(() => algoWS.connect())
  onDestroy(() => { algoWS.stop(); unsubWS() })
</script>

<div class="flex h-screen overflow-hidden bg-navy-950">

  <!-- Sidebar -->
  <nav class="w-40 flex-shrink-0 flex flex-col bg-navy-900 border-r border-navy-700 py-4">
    <div class="px-4 mb-6">
      <span class="text-cyan-400 font-mono font-bold text-lg glow">M2D</span>
    </div>
    {#each NAV as n}
      <button
        class="nav-btn mx-2"
        class:active={$page === n.id}
        on:click={() => page.set(n.id)}
      >
        <span class="w-4 text-center text-xs">{n.icon}</span>
        {n.label}
      </button>
    {/each}
  </nav>

  <!-- Page -->
  <main class="flex-1 overflow-y-auto p-4">
    {#if $page === 'alpha'}        <Alpha />
    {:else if $page === 'xsocial'}  <XSocial />
    {:else if $page === 'tradei'}   <TradeI />
    {:else if $page === 'signals'}  <Signals />
    {:else if $page === 'pulse'}    <Pulse />
    {:else if $page === 'smc'}      <SMC />
    {/if}
  </main>

</div>
