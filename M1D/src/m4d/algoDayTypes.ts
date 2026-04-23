/** Mirrors `m4d-engine` `algo_day.json` (and vote rows for SQLite). */

export type VoteTally = {
  long_bars: number;
  short_bars: number;
  flat_bars: number;
};

export type LastBarVoteEntry = {
  vote: number;
  strength: number;
  payload?: unknown;
};

export type AlgoDayJson = {
  session_id?: string;
  symbol: string;
  bar_count: number;
  warmup: number;
  generated_at: string;
  per_algo: Record<string, VoteTally>;
  last_bar_index: number;
  last_bar_time: number;
  last_bar_votes: Record<string, LastBarVoteEntry>;
};

export type AlgoTableRow = {
  id: string;
  tier: string;
  name: string;
  sub: string;
  color: string;
  long: number;
  short: number;
  flat: number;
  lastVote: number | null;
  lastStrength: number | null;
  stub: boolean;
};

export function getAlgoDayUrl(): string {
  const u = import.meta.env.VITE_M4D_ALGO_DAY_URL as string | undefined;
  if (u && u.length > 0) return u;
  const base = import.meta.env.BASE_URL;
  return `${base}m4d-latest/algo_day.json`;
}
