import type { ChartControls } from './chartControls';

/**
 * OBI #obi view: turn off all `mountBoomChart` line/heat layers so the chart is
 * candles (+ optional grid) + the React `BoomLwChart` LINES series only.
 * Does not change persisted `controls` — apply only when building props for the chart.
 */
export function obiBoomMinimalControls(c: ChartControls): ChartControls {
  return {
    ...c,
    masterOn: true,
    showBB: false,
    showKC: false,
    showMas: false,
    showSar: false,
    squeezeLinesGreen: false,
    squeezePurpleBg: false,
    showSqueeze: false,
    showDarvas: false,
    showCouncilArrows: false,
    showFvg: false,
    showOrderBlocks: false,
    showSwingRays: false,
    showSessionLevels: false,
    showVoteDots: false,
    showIchimoku: false,
    showPoc: false,
    showVwap: false,
    showLt: false,
    showKillzones: false,
    showEqualLevels: false,
    showBreakerBlocks: false,
    showVolBubbles: false,
    showMmBrain: false,
  };
}
