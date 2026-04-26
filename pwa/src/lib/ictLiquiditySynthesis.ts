/**
 * ICT Liquidity Synthesis — one bundle for levels, next targets, and direction
 * for TSX, AI Council, and future institutional confirmation (CVD/tape) hooks.
 */
import type { Bar } from '../../../indicators/boom3d-tech';
import type { OracleSnapshot, PriceLevel } from './oracleSnapshot';
import { buildOracleSnapshot } from './oracleSnapshot';
import { computePriceTargets } from './computePriceTargets';
import { computeMMBrain, type MMPrediction } from './mmBrain';
import { computeCoTraderSignal, type CoTraderSignal } from './coTraderSignal';
import { computeMtfLevels } from './mtfLevels';

export type IctLevelClass = 'ERL' | 'IRL_RANGE' | 'IRL_INNER' | 'VALUE' | 'MICRO';

export type IctUnifiedLevel = {
  price: number;
  kind: string;
  class: IctLevelClass;
  /** 0–100: higher = more significant as a draw / magnet */
  gravity: number;
  /** proximity % from snapshot price */
  proxPct: number;
  dir: 'above' | 'below' | 'at';
  sources: string[];
};

export type IctNextStop = {
  price: number | null;
  kind: string;
  ictClass: IctLevelClass;
  distAtr: number;
  source: 'MM_BRAIN' | 'ERL_DRAW' | 'FALLBACK';
};

export type IctDirectionPriority = {
  bias: 'BULL' | 'BEAR' | 'NEUTRAL';
  /** 0..1 — pre-manipulation discount; use `strength` for gating */
  rawStrength: number;
  /** 0..1 — after MM phase adjusters (e.g. MANIPULATION = fade / lower chase conviction) */
  strength: number;
  drivers: string[];
};

export type IctSynthesisResult = {
  asset: string;
  tf: string;
  timestamp: number;
  price: number;
  atr: number;
  /** Unified, gravity-sorted (desc) */
  levels: IctUnifiedLevel[];
  /** Primary “next stop” the engines agree on (MM Brain default) */
  primaryNextStop: IctNextStop;
  /** Nearest ERL-class level in bias direction (macro draw) */
  nextErlInBias: IctNextStop;
  /** Direction + confidence from regime + bias + phase */
  direction: IctDirectionPriority;
  snapshot: OracleSnapshot;
  mm: MMPrediction;
  coTrader: CoTraderSignal;
  targets: ReturnType<typeof computePriceTargets>['targets'];
  /** Gaps to fill for true institutional validation */
  dataGaps: string[];
  /** One block for Council / external LLM */
  councilContext: string;
  /** True if `compact` was used when building `councilContext` */
  councilCompact: boolean;
  /** Mtf level count (0 if no daily) */
  mtfLevelCount: number;
};

const ERL_KINDS = new Set([
  'PWH', 'PWL', 'PMH', 'PML', 'PQH', 'PQL', 'PDH', 'PDL',
]);

const IRL_RANGE_KINDS = new Set(['CWH', 'CWL', 'CMH', 'CML']);

const IRL_INNER_KINDS = new Set([
  'FVG_BULL', 'FVG_BEAR', 'OB_BULL', 'OB_BEAR',
  'BREAKER_BULL', 'BREAKER_BEAR', 'EQH', 'EQL', 'ORH', 'ORL',
]);

const VALUE_KINDS = new Set(['POC', 'HVN']);
const MICRO_KINDS = new Set(['SWING_H', 'SWING_L']);

function classifyLevel(kind: string): IctLevelClass {
  if (ERL_KINDS.has(kind)) return 'ERL';
  if (IRL_RANGE_KINDS.has(kind)) return 'IRL_RANGE';
  if (IRL_INNER_KINDS.has(kind)) return 'IRL_INNER';
  if (VALUE_KINDS.has(kind)) return 'VALUE';
  if (MICRO_KINDS.has(kind)) return 'MICRO';
  return 'IRL_INNER';
}

const CLASS_GRAVITY: Record<IctLevelClass, number> = {
  ERL: 100,
  IRL_RANGE: 72,
  IRL_INNER: 58,
  VALUE: 52,
  MICRO: 34,
};

/** `proxPct` = % of price (Oracle); taper distance so far levels lose pull vs near. */
function proximityTaper(proxPct: number): number {
  const p = Math.max(0, proxPct / 100);
  return 1 / (1 + 8 * p);
}

function gravityFor(l: PriceLevel): number {
  const c = classifyLevel(l.kind);
  const base = CLASS_GRAVITY[c];
  const pMul = l.priority === 1 ? 1.0 : l.priority === 2 ? 0.88 : 0.76;
  const t = proximityTaper(l.proxPct);
  return Math.round(Math.min(100, base * pMul * (0.55 + 0.45 * t)));
}

function mergeUnified(snapshot: OracleSnapshot, extraLabels: { label: string; price: number; base: number }[]): IctUnifiedLevel[] {
  const map = new Map<string, IctUnifiedLevel>();
  for (const l of snapshot.levels) {
    const c = classifyLevel(l.kind);
    const key = `${c}:${l.price.toFixed(6)}`;
    const g = gravityFor(l);
    const ex = map.get(key);
    const entry: IctUnifiedLevel = {
      price: l.price,
      kind: l.kind,
      class: c,
      gravity: Math.max(ex?.gravity ?? 0, g),
      proxPct: l.proxPct,
      dir: l.dir,
      sources: ex ? [...ex.sources, l.kind] : [l.kind],
    };
    map.set(key, entry);
  }
  for (const e of extraLabels) {
    const c: IctLevelClass = e.label.startsWith('LT-') || e.label.startsWith('V') ? 'VALUE' : 'IRL_INNER';
    const key = `${c}:${e.price.toFixed(6)}`;
    const proxPct = (Math.abs(e.price - snapshot.price) / snapshot.price) * 100;
    const g = Math.min(
      100,
      Math.round((e.base * 0.6 + 20) * (0.55 + 0.45 * proximityTaper(proxPct))),
    );
    const dir = proxPct < 0.01 ? 'at' : e.price > snapshot.price ? 'above' : 'below';
    const ex = map.get(key);
    map.set(key, {
      price: e.price,
      kind: e.label,
      class: c,
      gravity: Math.max(ex?.gravity ?? 0, g),
      proxPct,
      dir,
      sources: ex ? [...ex.sources, e.label] : [e.label, 'priceTargets'],
    });
  }
  return [...map.values()].sort((a, b) => b.gravity - a.gravity);
}

function pickNearestErl(
  unified: IctUnifiedLevel[],
  snap: OracleSnapshot,
  direction: 'BULL' | 'BEAR' | 'NEUTRAL',
): IctNextStop {
  const atr = Math.max(snap.atr, 1e-9);
  const erl = unified.filter((u) => u.class === 'ERL' && (direction === 'BULL' ? u.dir === 'above' : direction === 'BEAR' ? u.dir === 'below' : true));
  if (!erl.length) {
    return { price: null, kind: 'NONE', ictClass: 'ERL', distAtr: 0, source: 'FALLBACK' };
  }
  const best = erl.sort((a, b) => a.proxPct - b.proxPct)[0]!;
  return {
    price: best.price,
    kind: best.kind,
    ictClass: 'ERL',
    distAtr: Math.abs(best.price - snap.price) / atr,
    source: 'ERL_DRAW',
  };
}

function directionFrom(mm: MMPrediction, snap: OracleSnapshot): IctDirectionPriority {
  const drivers: string[] = [];
  if (mm.phase === 'DISPLACEMENT') drivers.push('phase=DISPLACEMENT (displacement → higher conviction cap)');
  if (mm.phase === 'MANIPULATION') {
    drivers.push('phase=MANIPULATION (wick raid — target side is COUNTER to spike, not with retail breakout)');
  }
  if (mm.phase === 'ACCUMULATION') drivers.push('phase=ACCUMULATION (coil — await displacement)');
  if (mm.phase === 'DISTRIBUTION') drivers.push('phase=DISTRIBUTION (near liquidity — fade risk rises)');
  if (snap.regime === 'BULL' || snap.regime === 'BEAR') drivers.push(`regime=${snap.regime}`);
  const b = mm.direction;
  const bias: IctDirectionPriority['bias'] =
    b === 'BULL' ? 'BULL' : b === 'BEAR' ? 'BEAR' : 'NEUTRAL';
  let raw = mm.phaseConfidence * 0.5;
  if (Math.abs(mm.bias) > 0.25) raw += 0.2;
  if (snap.regime === 'BULL' || snap.regime === 'BEAR') raw += 0.15;
  raw = Math.min(1, Math.max(0, raw));
  if (bias === 'NEUTRAL') raw *= 0.5;

  // MM phase: do not let MANIPULATION read as "strong trend" — primary stop is vs the raid.
  let strength = raw;
  if (mm.phase === 'MANIPULATION') {
    strength = raw * 0.68;
    drivers.push('strength×0.68: manipulation fade — do not size like DISPLACEMENT');
  } else if (mm.phase === 'ACCUMULATION') {
    strength = raw * 0.82;
    drivers.push('strength×0.82: range / coil');
  } else if (mm.phase === 'DISTRIBUTION') {
    strength = Math.min(raw, 0.72);
    drivers.push('strength_cap: distribution / take-profit zone near terminus');
  } else if (mm.phase === 'DISPLACEMENT') {
    strength = Math.min(1, raw * 1.05);
    drivers.push('strength boost: aligned with displacement leg');
  }

  strength = Math.min(1, Math.max(0, strength));
  return { bias, rawStrength: raw, strength, drivers };
}

/**
 * Class for MM primary stop: kind-first (handles HTF vs LTF price grid), then price, then `classifyLevel(kind)`.
 */
function ictClassForPrimaryStop(
  nextStop: number | null,
  nextStopKind: string,
  unified: IctUnifiedLevel[],
  snap: OracleSnapshot,
): IctLevelClass {
  if (nextStop == null) return 'IRL_INNER';
  const tol = Math.max(snap.atr * 0.1, snap.price * 0.0005, 1e-8);
  const priceHit = (p: number) => Math.abs(p - nextStop) <= tol;

  const byKindPrice = unified.find((l) => l.kind === nextStopKind && priceHit(l.price));
  if (byKindPrice) return byKindPrice.class;
  const byKind = unified.find((l) => l.kind === nextStopKind);
  if (byKind) return byKind.class;
  const byPrice = unified.find((l) => priceHit(l.price));
  if (byPrice) return byPrice.class;
  return classifyLevel(nextStopKind);
}

export type IctSynthesisOptions = {
  asset?: string;
  tf?: string;
  dailyBars?: Bar[];
  /** Fewer level lines in `councilContext` for token limits (top 3 vs 6, shorter Oracle snippet). */
  compact?: boolean;
};

function buildCouncilContext(params: {
  asset: string;
  tf: string;
  snap: OracleSnapshot;
  direction: IctDirectionPriority;
  mm: MMPrediction;
  nextErlInBias: IctNextStop;
  co: CoTraderSignal;
  levels: IctUnifiedLevel[];
  compact: boolean;
}): string {
  const { asset, tf, snap, direction, mm, nextErlInBias, co, levels, compact } = params;
  const nTop = compact ? 3 : 6;
  const oracleLines = snap.context.split('\n').slice(0, compact ? 2 : 4).join(' | ');

  return [
    `ICT-SYNTH | ${asset} ${tf} | ${new Date().toISOString()}${compact ? ' | mode=COMPACT' : ''}`,
    `PRICE ${snap.price.toFixed(4)} ATR ${snap.atr.toFixed(4)} | ${snap.regime} | ${snap.sessionName}`,
    `DIR: ${direction.bias} str=${(direction.strength * 100).toFixed(0)}% (raw ${(direction.rawStrength * 100).toFixed(0)}%) | MM:${mm.phase}(${(mm.phaseConfidence * 100).toFixed(0)}%)`,
    mm.phase === 'MANIPULATION'
      ? 'COUNCIL: stop-raid context — fade spike; do not chase breakout side with full size'
      : 'COUNCIL: use strength for sizing; ERL for macro terminus',
    `NEXT_MM_STOP: ${mm.nextStop?.toFixed(4) ?? 'n/a'} (${mm.nextStopKind}) ${mm.nextStopDist.toFixed(1)}ATR | ERL_DRAW: ${nextErlInBias.price?.toFixed(4) ?? 'n/a'}`,
    `CO-TRADER magnet ${co.magnetStrength}/100 → ${co.destination?.toFixed(4) ?? 'n/a'}`,
    `TOP_LEVELS: ${levels.slice(0, nTop).map((l) => `${l.kind}@${l.price.toFixed(2)}(G${l.gravity})`).join(' | ')}`,
    oracleLines,
  ].join('\n');
}

const DATA_GAPS_DEFAULT = [
  'CVD (cumulative volume delta) not fused — add for absorption at levels',
  'Real depth / OBI tape optional — use when Polygon/Binance OBI available',
  'Institutional block prints / dark pool not connected',
  'News / calendar catalysts not in synthesis — add for Council veto',
] as const;

/**
 * Fuses: Oracle (FVG/OB/EQ/HTF/VP/session), `computePriceTargets` rows, MM Brain, Co-Trader.
 * Pass `dailyBars` when available so PWH/PWL/PMH/PML/PQH/PQL are populated.
 * Use `compact: true` to shorten `councilContext` (Council token budget).
 */
export function computeIctSynthesis(
  bars: Bar[],
  opts: IctSynthesisOptions = {},
): IctSynthesisResult {
  const asset = opts.asset ?? 'ASSET';
  const tf = opts.tf ?? 'chart';
  const dailyBars = opts.dailyBars;
  const compact = opts.compact === true;
  const snap = buildOracleSnapshot(bars, asset, tf, dailyBars);
  const mm = computeMMBrain(bars, snap);
  const co = computeCoTraderSignal(bars, snap, mm);
  const { targets } = computePriceTargets(bars);

  const extra = targets.map((t) => ({ label: t.label, price: t.price, base: t.rating }));
  const levels = mergeUnified(snap, extra);
  const mtfLevelCount = dailyBars && dailyBars.length >= 5 ? computeMtfLevels(dailyBars).length : 0;

  const primaryNextStop: IctNextStop = {
    price: mm.nextStop,
    kind: mm.nextStopKind,
    ictClass: ictClassForPrimaryStop(mm.nextStop, mm.nextStopKind, levels, snap),
    distAtr: mm.nextStopDist,
    source: 'MM_BRAIN',
  };

  const nextErlInBias = pickNearestErl(levels, snap, mm.direction);

  const direction = directionFrom(mm, snap);

  const councilContext = buildCouncilContext({
    asset,
    tf,
    snap,
    direction,
    mm,
    nextErlInBias,
    co,
    levels,
    compact,
  });

  return {
    asset,
    tf,
    timestamp: snap.timestamp,
    price: snap.price,
    atr: snap.atr,
    levels,
    primaryNextStop,
    nextErlInBias,
    direction,
    snapshot: snap,
    mm,
    coTrader: co,
    targets,
    dataGaps: [...DATA_GAPS_DEFAULT],
    councilContext,
    councilCompact: compact,
    mtfLevelCount,
  };
}
