// =============================================================================
// ICTSMC V1 (Isolated Experimental Engine)
// Goal: earlier ICT entries with strict risk discipline and human-factor guards.
// This module is intentionally separate from legacy BRK logic.
// =============================================================================

export type Regime = "TRENDING" | "RANGING" | "VOLATILE";
export type Direction = "LONG" | "SHORT" | "HOLD";

export interface IctSmcInputs {
  ts: number;
  price: number;
  atr: number;
  regime: Regime;
  session: "LONDON" | "NY_AM" | "NY_PM" | "ASIA";

  // Layer signals (normalized 0..1 unless noted)
  liquidityDrawLong: number;
  liquidityDrawShort: number;
  purgeConfirmed: boolean; // L3: Judas purge observed
  displacementLong: number;
  displacementShort: number;
  pdConfluenceLong: number;
  pdConfluenceShort: number;

  // L6 structure is confidence-only (not gating)
  bosLong: boolean;
  bosShort: boolean;
  chochLong: boolean;
  chochShort: boolean;

  // Non-gating sentiment (0..1)
  sentimentLong: number;
  sentimentShort: number;

  // Basic entry geometry
  entryLong: number;
  entryShort: number;
  invalidationLong: number;
  invalidationShort: number;

  // Liquidity-draw exits
  nextLiquidityLevelLong?: number;
  nextLiquidityLevelShort?: number;
  boomExpansionLong?: number;  // 0..1 expansion quality
  boomExpansionShort?: number; // 0..1 expansion quality
  boomExpansionVelocityLong?: number;  // 0..1 velocity quality
  boomExpansionVelocityShort?: number; // 0..1 velocity quality

  // Alignment controls (required to avoid dumb trades)
  councilAlignedLong?: boolean;
  councilAlignedShort?: boolean;
  htfAlignedLong?: boolean;
  htfAlignedShort?: boolean;
  ictBiasStrongLong?: boolean;
  ictBiasStrongShort?: boolean;
  crossAssetRegime?: "RISK_ON" | "NEUTRAL" | "RISK_OFF";

  // P1 SIGNAL: HMM posterior probabilities (sum ~1.0).
  hmmTrendProb?: number;
  hmmRangeProb?: number;
  hmmVolatileProb?: number;
  barsSinceLastExit?: number; // for re-entry time-decay control
}

export interface HumanFactors {
  // 0 = bad, 1 = excellent
  sleepQuality: number;
  stressLoad: number; // 0 calm .. 1 overloaded
  disciplineScore: number;
  revengeTradeUrge: number; // 0 none .. 1 high
  overtradeRisk: number; // 0 low .. 1 high
}

export interface IctSmcConfig {
  earlyThreshold: number;
  lateThreshold: number;
  sentimentWeight: number; // keep small, default 0.04
  structureBoostMax: number; // L6 confidence add only
  kellyFractionCap: number; // quarter kelly = 0.25
  maxRiskPct: number; // absolute risk cap per trade
  volatileSizeCut: number; // e.g. 0.5
  allowOffSessionOnlyAtEdge: number; // avoid low-quality off-session entries
  requirePdConfluenceMin: number; // avoid over-thin setup quality
  accountMode: "STARTER" | "PRO";
  exitPolicy: "LIQUIDITY_LEVEL" | "EMA13";
  allowRetestReentry: boolean;
  expansionRunnerMin: number; // BOOM expansion threshold to keep a runner
  requireCouncilAlignment: boolean;
  requireHtfAlignment: boolean;
  biasStrongKellyMult: number; // e.g. 1.2x
  crossAssetKellyOn: number;   // e.g. 1.2x
  crossAssetKellyOff: number;  // e.g. 0.7x
  requireKillzoneForPro: boolean;
  requireBiasStrongForPro: boolean;
  reentryRiskScalar: number; // re-entry size as fraction of initial risk
  runnerTrailEma: boolean;   // execution-layer trail hint
  closeReentryTp: boolean;   // tighten second leg TP when re-entering
  minEdgeForReentry: number; // explicit re-entry edge floor
  reentryTargetR: number; // tighter re-entry TP in R
  reentryMaxBarsSinceExit: number; // max bars to permit retest re-entry
  minExpansionVelocityForRunner: number;
  hmmSoftRoutingOn: boolean;
  hmmMinConfidence: number; // minimum top-state posterior to avoid heavy dampening
  hmmTrendEdgeMult: number;
  hmmRangeEdgeMult: number;
  hmmVolatileEdgeMult: number;
  hmmLowConfidenceDampen: number;
  kellySizingOn: boolean;
  fractionalKelly: number; // 0.5 half-Kelly baseline
  regimeKellyMult: Record<Regime, number>;
  minEdgeForFullFraction: number;
}

export interface IctSmcDecision {
  direction: Direction;
  profile: "EARLY" | "LATE" | "NONE";
  edgeScoreLong: number;
  edgeScoreShort: number;
  chosenEdge: number;
  kellyFraction: number;
  finalRiskPct: number;
  exitMode: "LIQUIDITY_LEVEL" | "EMA13";
  eodForceClose: boolean;
  useCisEmergency: boolean;
  runnerEnabled: boolean;
  reentryAllowed: boolean;
  reentryRiskPct?: number;
  runnerTrailEma: boolean;
  entry?: number;
  stop?: number;
  tp1?: number;
  nextLevelTp?: number;
  reasons: string[];
}

export const DEFAULT_ICTSMC_CONFIG: IctSmcConfig = {
  earlyThreshold: 70,
  lateThreshold: 74,
  sentimentWeight: 0.04,
  structureBoostMax: 10,
  kellyFractionCap: 0.25,
  maxRiskPct: 1.0,
  volatileSizeCut: 0.5,
  allowOffSessionOnlyAtEdge: 88,
  requirePdConfluenceMin: 0.55,
  accountMode: "PRO",
  exitPolicy: "LIQUIDITY_LEVEL",
  allowRetestReentry: false,
  expansionRunnerMin: 0.72,
  requireCouncilAlignment: true,
  requireHtfAlignment: true,
  biasStrongKellyMult: 1.2,
  crossAssetKellyOn: 1.2,
  crossAssetKellyOff: 0.65,
  requireKillzoneForPro: true,
  requireBiasStrongForPro: true,
  reentryRiskScalar: 0.6,
  runnerTrailEma: false,
  closeReentryTp: true,
  minEdgeForReentry: 82,
  reentryTargetR: 1.2,
  reentryMaxBarsSinceExit: 6,
  minExpansionVelocityForRunner: 0.62,
  hmmSoftRoutingOn: true,
  hmmMinConfidence: 0.45,
  hmmTrendEdgeMult: 1.08,
  hmmRangeEdgeMult: 0.92,
  hmmVolatileEdgeMult: 0.84,
  hmmLowConfidenceDampen: 0.88,
  kellySizingOn: true,
  fractionalKelly: 0.5,
  regimeKellyMult: { TRENDING: 1.25, RANGING: 0.75, VOLATILE: 0.5 },
  minEdgeForFullFraction: 82,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function sessionMultiplier(session: IctSmcInputs["session"]): number {
  if (session === "LONDON" || session === "NY_AM") return 1.1;
  if (session === "NY_PM") return 0.85;
  return 0.65;
}

function runnerThresholdForContext(i: IctSmcInputs, c: IctSmcConfig): number {
  // Trending + main killzones can run with a lower expansion bar.
  const inPrimarySession = i.session === "LONDON" || i.session === "NY_AM";
  if (i.regime === "TRENDING" && inPrimarySession) return 0.55;
  if (i.regime === "RANGING") return 0.72;
  return c.expansionRunnerMin;
}

function applyHmmSoftRouting(baseEdge: number, i: IctSmcInputs, c: IctSmcConfig): { edge: number; note: string } {
  if (!c.hmmSoftRoutingOn) return { edge: baseEdge, note: "HMM routing off" };
  const pT = clamp(i.hmmTrendProb ?? 0.34, 0, 1);
  const pR = clamp(i.hmmRangeProb ?? 0.33, 0, 1);
  const pV = clamp(i.hmmVolatileProb ?? 0.33, 0, 1);
  const norm = Math.max(1e-9, pT + pR + pV);
  const t = pT / norm;
  const r = pR / norm;
  const v = pV / norm;
  const top = Math.max(t, r, v);
  const regimeMult = t * c.hmmTrendEdgeMult + r * c.hmmRangeEdgeMult + v * c.hmmVolatileEdgeMult;
  const confMult = top < c.hmmMinConfidence ? c.hmmLowConfidenceDampen : 1.0;
  const edge = clamp(baseEdge * regimeMult * confMult, 0, 100);
  return { edge, note: `HMM mult ${regimeMult.toFixed(3)} conf ${top.toFixed(2)}` };
}

function edgeToWinProb(edge: number, regime: Regime): number {
  let baseProb = 0.5 + (edge - 50) * 0.0055;
  if (regime === "TRENDING") baseProb += 0.04;
  if (regime === "VOLATILE") baseProb -= 0.05;
  return clamp(baseProb, 0.48, 0.82);
}

function computeKellyFraction(
  edge: number,
  regime: Regime,
  cfg: IctSmcConfig,
  rr = 2.0,
): number {
  if (edge < 50) return 0;
  const winProb = edgeToWinProb(edge, regime);
  const b = Math.max(0.5, rr);
  let kelly = (winProb * (b + 1) - 1) / b;
  kelly *= cfg.fractionalKelly;
  kelly *= cfg.regimeKellyMult?.[regime] ?? 1.0;
  if (edge >= cfg.minEdgeForFullFraction) kelly *= 1.15;
  return clamp(kelly, 0, cfg.kellyFractionCap);
}

function structureBoost(longOrShortSignals: boolean[], maxBoost: number): number {
  const hits = longOrShortSignals.filter(Boolean).length;
  // 0..3 mapped to 0..maxBoost
  return (hits / 3) * maxBoost;
}

function applyHumanPenalty(baseRiskPct: number, hf: HumanFactors): { riskPct: number; notes: string[] } {
  const notes: string[] = [];
  let risk = baseRiskPct;

  if (hf.sleepQuality < 0.45) {
    risk *= 0.8;
    notes.push("Sleep low -> size reduced 20%");
  }
  if (hf.stressLoad > 0.7) {
    risk *= 0.8;
    notes.push("Stress high -> size reduced 20%");
  }
  if (hf.revengeTradeUrge > 0.6 || hf.overtradeRisk > 0.6) {
    risk *= 0.7;
    notes.push("Behavioral risk high -> size reduced 30%");
  }
  if (hf.disciplineScore < 0.4) {
    risk = Math.min(risk, 0.35);
    notes.push("Discipline low -> hard cap 0.35% risk");
  }

  return { riskPct: risk, notes };
}

function edgeScoreForSide(
  side: "LONG" | "SHORT",
  i: IctSmcInputs,
  c: IctSmcConfig,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const draw = side === "LONG" ? i.liquidityDrawLong : i.liquidityDrawShort;
  const disp = side === "LONG" ? i.displacementLong : i.displacementShort;
  const pd = side === "LONG" ? i.pdConfluenceLong : i.pdConfluenceShort;
  const sent = side === "LONG" ? i.sentimentLong : i.sentimentShort;

  // Purge gate precedes displacement: no purge = no setup
  if (!i.purgeConfirmed) {
    reasons.push("L3 purge missing -> setup blocked");
    return { score: 0, reasons };
  }
  if (pd < c.requirePdConfluenceMin) {
    reasons.push("PD confluence below minimum");
    return { score: 0, reasons };
  }
  if (disp < 0.35) {
    reasons.push("L4 displacement too weak");
    return { score: 0, reasons };
  }

  // Core weighted blend (0..100)
  const structureCore = pd * 45;
  const liquidityCore = draw * 30;
  const volatilityCore = disp * 21;
  const sentimentCore = sent * (c.sentimentWeight * 100);
  const sessionAdj = sessionMultiplier(i.session);

  let score = (structureCore + liquidityCore + volatilityCore + sentimentCore) * sessionAdj;
  reasons.push(`Core score ${score.toFixed(1)} after session adj`);

  // BOS/CHoCH confidence-only add (+5..+10 typical when multiple confirmations)
  const boost = side === "LONG"
    ? structureBoost([i.bosLong, i.chochLong, i.purgeConfirmed], c.structureBoostMax)
    : structureBoost([i.bosShort, i.chochShort, i.purgeConfirmed], c.structureBoostMax);
  score += boost;
  reasons.push(`L6 confidence boost +${boost.toFixed(1)}`);

  return { score: clamp(score, 0, 100), reasons };
}

export function decideIctSmc(
  input: IctSmcInputs,
  human: HumanFactors,
  cfg: IctSmcConfig = DEFAULT_ICTSMC_CONFIG,
): IctSmcDecision {
  const longEval = edgeScoreForSide("LONG", input, cfg);
  const shortEval = edgeScoreForSide("SHORT", input, cfg);
  const reasons = [...longEval.reasons.map((r) => `LONG: ${r}`), ...shortEval.reasons.map((r) => `SHORT: ${r}`)];

  let direction: Direction = "HOLD";
  let profile: "EARLY" | "LATE" | "NONE" = "NONE";
  let chosenEdge = 0;
  let entry: number | undefined;
  let stop: number | undefined;
  let tp1: number | undefined;
  let nextLevelTp: number | undefined;

  const longHmm = applyHmmSoftRouting(longEval.score, input, cfg);
  const shortHmm = applyHmmSoftRouting(shortEval.score, input, cfg);
  const longEdge = longHmm.edge;
  const shortEdge = shortHmm.edge;
  reasons.push(`LONG: ${longHmm.note}`);
  reasons.push(`SHORT: ${shortHmm.note}`);

  if (longEdge >= cfg.earlyThreshold || shortEdge >= cfg.earlyThreshold) {
    if (longEdge > shortEdge && longEdge >= cfg.earlyThreshold) {
      direction = "LONG";
      chosenEdge = longEdge;
      profile = longEdge >= cfg.lateThreshold ? "LATE" : "EARLY";
      entry = input.entryLong;
      stop = input.invalidationLong;
    } else if (shortEdge > longEdge && shortEdge >= cfg.earlyThreshold) {
      direction = "SHORT";
      chosenEdge = shortEdge;
      profile = shortEdge >= cfg.lateThreshold ? "LATE" : "EARLY";
      entry = input.entryShort;
      stop = input.invalidationShort;
    } else {
      reasons.push("Edge tie -> HOLD");
    }
  } else {
    reasons.push("Both sides below threshold -> HOLD");
  }

  // Hard anti-dumb-trade guard: Council + HTF alignment required.
  if (direction === "LONG") {
    if (cfg.requireCouncilAlignment && !input.councilAlignedLong) {
      reasons.push("Council misaligned for LONG -> HOLD");
      direction = "HOLD";
    }
    if (cfg.requireHtfAlignment && !input.htfAlignedLong) {
      reasons.push("HTF misaligned for LONG -> HOLD");
      direction = "HOLD";
    }
  } else if (direction === "SHORT") {
    if (cfg.requireCouncilAlignment && !input.councilAlignedShort) {
      reasons.push("Council misaligned for SHORT -> HOLD");
      direction = "HOLD";
    }
    if (cfg.requireHtfAlignment && !input.htfAlignedShort) {
      reasons.push("HTF misaligned for SHORT -> HOLD");
      direction = "HOLD";
    }
  }
  if (direction === "HOLD") {
    profile = "NONE";
    chosenEdge = 0;
    entry = undefined;
    stop = undefined;
  }

  // Killzone discipline: outside London/NY_AM only trade exceptional edge.
  const inKillzone = input.session === "LONDON" || input.session === "NY_AM";
  if (!inKillzone && direction !== "HOLD" && chosenEdge < cfg.allowOffSessionOnlyAtEdge) {
    reasons.push("Off-session edge below exceptional threshold -> HOLD");
    direction = "HOLD";
    profile = "NONE";
    chosenEdge = 0;
    entry = undefined;
    stop = undefined;
  }
  // Strict pro mode: no off-killzone entries.
  if (cfg.accountMode === "PRO" && cfg.requireKillzoneForPro && direction !== "HOLD" && !inKillzone) {
    reasons.push("PRO mode strict: killzone required -> HOLD");
    direction = "HOLD";
    profile = "NONE";
    chosenEdge = 0;
    entry = undefined;
    stop = undefined;
  }

  // Cross-asset risk-off gating: avoid weak SMC trades when broader risk posture is negative.
  if (input.crossAssetRegime === "RISK_OFF" && direction !== "HOLD" && chosenEdge < 82) {
    reasons.push("Cross-asset RISK_OFF + weak edge -> HOLD");
    direction = "HOLD";
    profile = "NONE";
    chosenEdge = 0;
    entry = undefined;
    stop = undefined;
  }

  // Strict pro mode: require biasStrong in chosen direction.
  if (cfg.accountMode === "PRO" && cfg.requireBiasStrongForPro && direction !== "HOLD") {
    const biasStrong = direction === "LONG" ? !!input.ictBiasStrongLong : !!input.ictBiasStrongShort;
    if (!biasStrong) {
      reasons.push("PRO mode strict: biasStrong required -> HOLD");
      direction = "HOLD";
      profile = "NONE";
      chosenEdge = 0;
      entry = undefined;
      stop = undefined;
    }
  }

  // Fractional Kelly with regime-aware multipliers.
  const kellyFraction = cfg.kellySizingOn
    ? computeKellyFraction(chosenEdge, input.regime, cfg, 2.0)
    : 0;
  let riskPct = cfg.kellySizingOn
    ? clamp(kellyFraction * 4, 0, cfg.maxRiskPct)
    : (direction === "HOLD" ? 0 : cfg.maxRiskPct);
  if (!cfg.kellySizingOn && direction !== "HOLD") {
    reasons.push("Kelly sizing OFF -> fixed max risk mode");
  }

  if (input.regime === "VOLATILE") {
    riskPct *= cfg.volatileSizeCut;
    reasons.push("Volatile regime -> half size");
  }
  if (input.regime === "RANGING" && direction !== "HOLD" && profile === "EARLY") {
    reasons.push("Ranging regime -> early entries discouraged");
  }

  // Kelly multiplier path: ICT bias strong + cross-asset regime.
  if (direction === "LONG" && input.ictBiasStrongLong) {
    riskPct *= cfg.biasStrongKellyMult;
    reasons.push(`ICT bias strong LONG -> Kelly x${cfg.biasStrongKellyMult.toFixed(2)}`);
  }
  if (direction === "SHORT" && input.ictBiasStrongShort) {
    riskPct *= cfg.biasStrongKellyMult;
    reasons.push(`ICT bias strong SHORT -> Kelly x${cfg.biasStrongKellyMult.toFixed(2)}`);
  }
  if (input.crossAssetRegime === "RISK_ON") {
    riskPct *= cfg.crossAssetKellyOn;
    reasons.push(`Cross-asset RISK_ON -> Kelly x${cfg.crossAssetKellyOn.toFixed(2)}`);
  } else if (input.crossAssetRegime === "RISK_OFF") {
    riskPct *= cfg.crossAssetKellyOff;
    reasons.push(`Cross-asset RISK_OFF -> Kelly x${cfg.crossAssetKellyOff.toFixed(2)}`);
  }

  const humanAdj = applyHumanPenalty(riskPct, human);
  riskPct = clamp(humanAdj.riskPct, 0, cfg.maxRiskPct);
  reasons.push(...humanAdj.notes);

  if (entry !== undefined && stop !== undefined) {
    const riskDist = Math.abs(entry - stop);
    tp1 = direction === "LONG" ? entry + riskDist * 2 : entry - riskDist * 2;
    if (cfg.exitPolicy === "LIQUIDITY_LEVEL") {
      nextLevelTp = direction === "LONG" ? input.nextLiquidityLevelLong : input.nextLiquidityLevelShort;
      if (nextLevelTp === undefined) {
        nextLevelTp = tp1;
        reasons.push("Next liquidity level unavailable -> fallback TP to risk multiple");
      }
    }
  }

  const exitMode: "LIQUIDITY_LEVEL" | "EMA13" = cfg.exitPolicy;
  const eodForceClose = true;
  const useCisEmergency = cfg.accountMode === "STARTER";
  if (useCisEmergency) {
    reasons.push("STARTER mode -> CIS emergency enabled");
  } else {
    reasons.push("PRO mode -> CIS emergency disabled");
  }

  let runnerEnabled = false;
  if (direction !== "HOLD" && cfg.exitPolicy === "LIQUIDITY_LEVEL") {
    const expansion = direction === "LONG"
      ? (input.boomExpansionLong ?? 0)
      : (input.boomExpansionShort ?? 0);
    const velocity = direction === "LONG"
      ? (input.boomExpansionVelocityLong ?? 0)
      : (input.boomExpansionVelocityShort ?? 0);
    const threshold = runnerThresholdForContext(input, cfg);
    runnerEnabled = expansion >= threshold && velocity >= cfg.minExpansionVelocityForRunner;
    if (runnerEnabled) reasons.push("BOOM expansion strong -> keep runner after first liquidity target");
  }

  const reentryAllowed =
    cfg.allowRetestReentry &&
    direction !== "HOLD" &&
    runnerEnabled &&
    chosenEdge >= cfg.minEdgeForReentry;
  const reentryInWindow = (input.barsSinceLastExit ?? 0) <= cfg.reentryMaxBarsSinceExit;
  const reentryAllowedFinal = reentryAllowed && reentryInWindow;
  if (reentryAllowed && !reentryInWindow) reasons.push("Re-entry stale (> max bars since exit) -> blocked");
  if (reentryAllowedFinal) reasons.push("Retest re-entry enabled after liquidity target completion");

  // Re-entry leg should size down to reduce expectancy drag.
  let reentryRiskPct: number | undefined;
  if (reentryAllowedFinal) {
    reentryRiskPct = clamp(riskPct * cfg.reentryRiskScalar, 0, cfg.maxRiskPct);
  }

  // Optional tighter re-entry TP (execution layer consumes this as second-leg target).
  if (reentryAllowedFinal && cfg.closeReentryTp && entry !== undefined && stop !== undefined) {
    const riskDist = Math.abs(entry - stop);
    const tightR = cfg.reentryTargetR;
    nextLevelTp = direction === "LONG" ? entry + riskDist * tightR : entry - riskDist * tightR;
    reasons.push(`Re-entry TP tightened to ${tightR.toFixed(2)}R`);
  }

  return {
    direction,
    profile,
    edgeScoreLong: longEdge,
    edgeScoreShort: shortEdge,
    chosenEdge,
    kellyFraction,
    finalRiskPct: riskPct,
    exitMode,
    eodForceClose,
    useCisEmergency,
    runnerEnabled,
    reentryAllowed: reentryAllowedFinal,
    reentryRiskPct,
    runnerTrailEma: cfg.runnerTrailEma,
    entry,
    stop,
    tp1,
    nextLevelTp,
    reasons,
  };
}
