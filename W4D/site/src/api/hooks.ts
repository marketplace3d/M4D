import { useQuery } from "@tanstack/react-query";

const BASE = "/v1";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export type SummaryRow = { Metric: string; Value: string };
export type NavPoint = { date: string; nav: number; ret: number; gross: number; net: number };
export type SignalRow = { signal: string; family: string; mean_ic: number; ic_vol: number; icir: number; n_obs: number };
export type RegimePoint = { date: string; regime: string };
export type RegimeDist = Record<string, number>;
export type RiskPoint = { date: string; drawdown: number; gross: number; net: number; var_99: number; daily_pnl: number; n_pos: number; alerts: string[] };
export type WeightRow = { instrument: string; weight: number };
export type FoldResult = { fold: number; oos_start: string; oos_end: string; oos_sharpe: number; oos_ic: number; oos_max_dd_pct: number; hit_rate_pct: number };
export type WalkForwardResult = { oos_sharpe: number; is_sharpe: number; degradation: number; pbo_pct: number; max_dd_pct: number; mean_ic: number; n_folds: number; folds: FoldResult[] };
export type AttributionResult = { long_return_pct: number; short_return_pct: number; tc_drag_pct: number; signal_family: Record<string, number>; regime: Record<string, number> };
export type MonthlyRow = { year: number; months: Record<number, number> };

const opts = { staleTime: 60_000 };

export function useRun() {
  return useQuery({ queryKey: ["run"], queryFn: () => get<{ status: string; total_return_pct: number; days: number }>("/run"), ...opts });
}
export function useSummary() {
  return useQuery({ queryKey: ["summary"], queryFn: () => get<SummaryRow[]>("/summary"), ...opts });
}
export function useNav() {
  return useQuery({ queryKey: ["nav"], queryFn: () => get<NavPoint[]>("/nav"), ...opts });
}
export function useSignals() {
  return useQuery({ queryKey: ["signals"], queryFn: () => get<SignalRow[]>("/signals"), ...opts });
}
export function useRegime() {
  return useQuery({ queryKey: ["regime"], queryFn: () => get<RegimePoint[]>("/regime"), ...opts });
}
export function useRegimeDist() {
  return useQuery({ queryKey: ["regime/dist"], queryFn: () => get<RegimeDist>("/regime/dist"), ...opts });
}
export function useRisk() {
  return useQuery({ queryKey: ["risk"], queryFn: () => get<RiskPoint[]>("/risk?last_n=252"), ...opts });
}
export function useWeights() {
  return useQuery({ queryKey: ["weights"], queryFn: () => get<WeightRow[]>("/weights"), ...opts });
}
export function useWalkForward() {
  return useQuery({ queryKey: ["walkforward"], queryFn: () => get<WalkForwardResult>("/walkforward?instruments=50"), staleTime: 300_000 });
}
export function useAttribution() {
  return useQuery({ queryKey: ["attribution"], queryFn: () => get<AttributionResult>("/attribution"), ...opts });
}
export function useMonthly() {
  return useQuery({ queryKey: ["monthly"], queryFn: () => get<MonthlyRow[]>("/monthly"), ...opts });
}
