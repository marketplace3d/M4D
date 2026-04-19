import type { AlgoDayJson } from './algoDayTypes';
import { getAlgoDayUrl } from './algoDayTypes';

export type VoteLine = {
  session_id: string;
  bar_index: number;
  time: number;
  algo_id: string;
  vote: number;
  strength: number;
  payload: unknown;
};

export function getM4dApiBase(): string | undefined {
  const b = import.meta.env.VITE_M4D_API_URL;
  if (typeof b !== 'string') return undefined;
  const t = b.trim();
  if (!t) return undefined;
  const normalized = t.replace(/\/$/, '');
  /** `/` → same-origin calls to `/v1/...` (embed build behind Axum on :3330). */
  if (normalized === '') return '';
  return normalized;
}

export function getVotesJsonlUrl(): string {
  const u = import.meta.env.VITE_M4D_VOTES_JSONL_URL;
  if (typeof u === 'string' && u.trim()) return u.trim();
  const base = import.meta.env.BASE_URL;
  return `${base}m4d-latest/votes.jsonl`;
}

/** `algo_day` from `m4d-api` if `VITE_M4D_API_URL` set, else static JSON URL. */
export async function loadAlgoDayFlexible(staticUrl = getAlgoDayUrl()): Promise<AlgoDayJson> {
  const api = getM4dApiBase();
  if (api !== undefined) {
    const r = await fetch(`${api}/v1/algo-day`);
    if (!r.ok) throw new Error(`m4d-api GET /v1/algo-day → ${r.status}`);
    return r.json() as Promise<AlgoDayJson>;
  }
  const r = await fetch(staticUrl);
  if (!r.ok) {
    throw new Error(
      `algo_day ${r.status} (${staticUrl}) — set VITE_M4D_API_URL or copy m4d-engine/out/algo_day.json`,
    );
  }
  return r.json() as Promise<AlgoDayJson>;
}

export function algoDataSourceLabel(): string {
  return getM4dApiBase() !== undefined ? 'm4d-api' : 'static';
}

/** Vote series for one algo: API or parsed `votes.jsonl`. */
export async function loadVoteSeriesForAlgo(algoId: string): Promise<VoteLine[]> {
  const api = getM4dApiBase();
  if (api !== undefined) {
    const r = await fetch(`${api}/v1/votes?algo_id=${encodeURIComponent(algoId)}`);
    if (!r.ok) throw new Error(`m4d-api votes → ${r.status}`);
    const j = (await r.json()) as { votes: VoteLine[] };
    return j.votes;
  }
  const url = getVotesJsonlUrl();
  const r = await fetch(url);
  if (!r.ok) throw new Error(`votes.jsonl ${r.status} (${url})`);
  const text = await r.text();
  const out: VoteLine[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const v = JSON.parse(t) as VoteLine;
      if (v.algo_id === algoId) out.push(v);
    } catch {
      /* skip bad line */
    }
  }
  out.sort((a, b) => a.bar_index - b.bar_index);
  return out;
}
