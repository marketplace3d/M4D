/** Types for `public/council-algos.v1.json` — SSOT lives in `spec-kit/data/council-algos.v1.json` (copy to public at build/dev). */

export type CouncilTier = 'JEDI' | 'A' | 'B' | 'C';

export type CouncilAlgo = {
  id: string;
  tier: 'A' | 'B' | 'C';
  name: string;
  sub: string;
  color: string;
  method: string;
  horizon?: string;
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
