/** Shared 27-panel ids + vote helpers — keeps Council embed and #warriors simulation in lockstep. */

export const CONTROL27_PANEL_IDS = [
  'NS',
  'CI',
  'BQ',
  'CC',
  'WH',
  'SA',
  'HK',
  'GO',
  'EF',
  '8E',
  'VT',
  'MS',
  'DP',
  'WS',
  'RV',
  'HL',
  'AI',
  'VK',
  'SE',
  'IC',
  'WN',
  'CA',
  'TF',
  'RT',
  'MM',
  'OR',
  'DV',
] as const;

export function cr27RandVote(): number {
  return [-1, -1, -1, 0, 0, 0, 0, 1, 1, 1][Math.floor(Math.random() * 10)] ?? 0;
}

export function initCr27Votes(): Record<string, number> {
  const v: Record<string, number> = { jedi: 1 };
  for (const id of CONTROL27_PANEL_IDS) {
    v[id] = cr27RandVote();
  }
  return v;
}

export function initCr27Strengths(): Record<string, number> {
  const s: Record<string, number> = { jedi: 0.9 };
  for (const id of CONTROL27_PANEL_IDS) {
    s[id] = Math.random() * 0.88 + 0.1;
  }
  return s;
}
