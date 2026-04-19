<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';

  onMount(() => {
    import('virtual:pwa-register')
      .then(({ registerSW }) => registerSW({ immediate: true }))
      .catch(() => {});
  });
</script>

<svelte:head>
  <title>M4D — BOOM3D Tech</title>
  <meta name="description" content="Lightweight Charts + BOOM3D-TECH indicator (PWA)" />
  <link rel="manifest" href="/manifest.webmanifest" />
</svelte:head>

<main class="shell">
  <header class="header">
    <h1>M4D</h1>
    <span class="sub">BOOM3D-TECH · Lightweight Charts · PWA</span>
  </header>
  <div class="slot-fill">
    <slot />
  </div>
  <footer class="footer">
    <code>M3D site</code> <a href="http://127.0.0.1:5500">:5500</a>
  </footer>
</main>
