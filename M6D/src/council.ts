/** Types for `public/council-algos.v1.json` — SSOT lives in `spec-kit/data/council-algos.v1.json` (copy to public at build/dev). */

export type CouncilTier = 'JEDI' | 'A' | 'B' | 'C' | 'D';

/** ALGO = coded rule-based signal. TRADER = human methodology under study. EDGE = isolated alpha extracted from trader/observation. */
export type AlphaType = 'ALGO' | 'TRADER' | 'EDGE';

/** ACTIVE = in live ensemble. RESERVE = proven Sharpe, benched (wrong regime). CANDIDATE = being studied, no weight yet. */
export type AlphaStatus = 'ACTIVE' | 'RESERVE' | 'CANDIDATE';

/** Regime labels used for Sharpe scoring and ensemble gating. */
export type RegimeLabel = 'TRENDING' | 'RANGING' | 'VOLATILE' | 'FOMC_FLAT';

export type RegimeSharpe = Partial<Record<RegimeLabel, number>>;

export type CouncilAlgo = {
  id: string;
  tier: 'A' | 'B' | 'C' | 'D';
  name: string;
  sub: string;
  color: string;
  method: string;
  horizon?: string;
  // Alpha Library fields
  type?: AlphaType;           // default 'ALGO' if absent (backwards compat)
  status?: AlphaStatus;       // default 'ACTIVE' if absent
  data_source?: string;       // 'ohlcv' | 'bookmap' | 'tape' | 'own' | 'footprint'
  studied?: boolean;          // false = placeholder, not yet scored
  weight?: number;            // live ensemble weight (0 if RESERVE/CANDIDATE)
  regime_sharpe?: RegimeSharpe; // filled as backtest/study matures
  notes?: string;             // free-form — what you've learned about this edge
};

export type CouncilHeader = {
  id: string;
  label: string;
  sub: string;
  desc: string;
  color: string;
  tier: string;
};

export type JediSpec = {
  id: string;
  label: string;
  sub: string;
  desc: string;
  tier: string;
  color: string;
  signals: string[];
};

export type CouncilBundle = {
  version: number;
  updated: string;
  jedi: JediSpec;
  councils: CouncilHeader[];
  algorithms: CouncilAlgo[];
};

export async function loadCouncilSpec(): Promise<CouncilBundle> {
  const res = await fetch(`${import.meta.env.BASE_URL}council-algos.v1.json`);
  if (!res.ok) throw new Error(`council-algos: ${res.status}`);
  return res.json() as Promise<CouncilBundle>;
}

export function algosByTier(algorithms: CouncilAlgo[]) {
  const a = algorithms.filter((x) => x.tier === 'A');
  const b = algorithms.filter((x) => x.tier === 'B');
  const c = algorithms.filter((x) => x.tier === 'C');
  return { A: a, B: b, C: c };
}

/** All Tier D entries — TRADER and EDGE types in the Alpha Library. */
export function alphaLibrary(algorithms: CouncilAlgo[]) {
  return algorithms.filter((x) => x.tier === 'D');
}

/** Partition Tier D by lifecycle status. */
export function alphaByStatus(algorithms: CouncilAlgo[]) {
  const lib = alphaLibrary(algorithms);
  return {
    active:    lib.filter((x) => (x.status ?? 'ACTIVE') === 'ACTIVE'),
    reserve:   lib.filter((x) => x.status === 'RESERVE'),
    candidate: lib.filter((x) => x.status === 'CANDIDATE'),
  };
}

/** Active ensemble: Tier A/B/C algos + any Tier D with status ACTIVE. */
export function liveEnsemble(algorithms: CouncilAlgo[]) {
  return algorithms.filter(
    (x) => x.tier !== 'D' || (x.status === 'ACTIVE' && (x.weight ?? 0) > 0)
  );
}
