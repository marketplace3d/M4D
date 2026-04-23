import type { TargetBucket } from '@pwa/lib/computePriceTargets';

export const SOLO_DOCK_KEY = 'm4d.tvLw.soloDock';
export const TARGET_UI_KEY = 'm4d.tvLw.targetUi';
export const SOLO_PARTICIPATION_FLOOR_PCT = 15;

export type TargetFilter = 'all' | TargetBucket;
export type SoloDockSide = 'left' | 'right';
/** 0 = up (under app header), 1 = mid, 2 = down (over chart) */
export type SoloDockTier = 0 | 1 | 2;
export type SoloDockState = { side: SoloDockSide; tier: SoloDockTier; visible: boolean };

export function loadTargetUi(): { hud: boolean; filter: TargetFilter } {
  try {
    const raw = localStorage.getItem(TARGET_UI_KEY);
    if (!raw) return { hud: false, filter: 'all' };
    const j = JSON.parse(raw) as { hud?: boolean; filter?: string };
    const filter: TargetFilter =
      j.filter === 'vp' || j.filter === 'sess' || j.filter === 'ob' || j.filter === 'liq'
        ? j.filter
        : 'all';
    return { hud: j.hud === true, filter };
  } catch {
    return { hud: false, filter: 'all' };
  }
}

export function loadSoloDock(): SoloDockState {
  try {
    const raw = localStorage.getItem(SOLO_DOCK_KEY);
    if (!raw) return { side: 'right', tier: 1, visible: true };
    const j = JSON.parse(raw) as Partial<SoloDockState>;
    const side = j.side === 'left' ? 'left' : 'right';
    const tier = j.tier === 0 || j.tier === 1 || j.tier === 2 ? j.tier : 1;
    return { side, tier, visible: j.visible !== false };
  } catch {
    return { side: 'right', tier: 1, visible: true };
  }
}

export function saveSoloDock(s: SoloDockState): void {
  try {
    localStorage.setItem(SOLO_DOCK_KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}
