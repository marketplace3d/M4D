// =============================================================================
// ICTSMC V1 Runner (isolated test harness)
// Usage: npx ts-node APP-DOC/ICT/files-ts/ictsmc-run.ts
// =============================================================================

import { DEFAULT_ICTSMC_CONFIG, decideIctSmc, type HumanFactors, type IctSmcInputs } from "./ictsmc";

function sampleInput(ticker: string, seed = 0): IctSmcInputs {
  const x = (v: number) => Math.max(0, Math.min(1, v));
  const wave = Math.sin(Date.now() / 7000 + seed);
  const regime = wave > 0.45 ? "TRENDING" : wave < -0.45 ? "VOLATILE" : "RANGING";
  const t = ticker.toUpperCase();
  const basePrice = t === "NQ" ? 18300 : t === "ES" ? 5250 : 43200;
  const atr = t === "NQ" ? 55 : t === "ES" ? 24 : 110;

  return {
    ts: Date.now(),
    price: basePrice + wave * atr * 2,
    atr,
    regime,
    session: "LONDON",
    liquidityDrawLong: x(0.65 + wave * 0.2),
    liquidityDrawShort: x(0.48 - wave * 0.2),
    purgeConfirmed: wave > -0.7,
    displacementLong: x(0.62 + wave * 0.15),
    displacementShort: x(0.44 - wave * 0.15),
    pdConfluenceLong: x(0.68 + wave * 0.18),
    pdConfluenceShort: x(0.46 - wave * 0.18),
    bosLong: wave > 0.2,
    bosShort: wave < -0.2,
    chochLong: wave > 0.1,
    chochShort: wave < -0.1,
    sentimentLong: x(0.55 + wave * 0.1),
    sentimentShort: x(0.45 - wave * 0.1),
    entryLong: basePrice - atr * 0.1,
    entryShort: basePrice + atr * 0.1,
    invalidationLong: basePrice - atr * 1.1,
    invalidationShort: basePrice + atr * 1.1,
    nextLiquidityLevelLong: basePrice + atr * 2.2,
    nextLiquidityLevelShort: basePrice - atr * 2.2,
    boomExpansionLong: x(0.58 + wave * 0.2),
    boomExpansionShort: x(0.46 - wave * 0.2),
    boomExpansionVelocityLong: x(0.6 + wave * 0.15),
    boomExpansionVelocityShort: x(0.48 - wave * 0.15),
    councilAlignedLong: wave > -0.2,
    councilAlignedShort: wave < 0.2,
    htfAlignedLong: wave > 0,
    htfAlignedShort: wave < 0,
    ictBiasStrongLong: wave > 0.35,
    ictBiasStrongShort: wave < -0.35,
    crossAssetRegime: wave > 0.25 ? "RISK_ON" : wave < -0.25 ? "RISK_OFF" : "NEUTRAL",
    hmmTrendProb: x(0.45 + wave * 0.25),
    hmmRangeProb: x(0.35 - Math.abs(wave) * 0.15),
    hmmVolatileProb: x(0.2 + (wave < -0.3 ? 0.25 : 0.05)),
    barsSinceLastExit: Math.floor((Math.sin(seed * 0.7) * 0.5 + 0.5) * 12),
  };
}

function sampleHuman(): HumanFactors {
  return {
    sleepQuality: 0.72,
    stressLoad: 0.34,
    disciplineScore: 0.78,
    revengeTradeUrge: 0.15,
    overtradeRisk: 0.28,
  };
}

function mkHumanFromSeed(seed: number): HumanFactors {
  const n = (v: number) => Math.max(0, Math.min(1, v));
  return {
    sleepQuality: n(0.7 + Math.sin(seed * 1.13) * 0.2),
    stressLoad: n(0.35 + Math.cos(seed * 0.9) * 0.25),
    disciplineScore: n(0.75 + Math.sin(seed * 0.47) * 0.18),
    revengeTradeUrge: n(0.2 + Math.cos(seed * 1.4) * 0.2),
    overtradeRisk: n(0.25 + Math.sin(seed * 1.7) * 0.2),
  };
}

function walkForward(ticker: string, windows = 4, barsPerWindow = 60, isPct = 0.7) {
  let totalIS = 0;
  let totalOOS = 0;
  let winsIS = 0;
  let winsOOS = 0;
  let countIS = 0;
  let countOOS = 0;

  const fmt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}bp`;
  console.log(`\nWalk-forward: ${ticker.toUpperCase()} | windows=${windows} bars/window=${barsPerWindow} IS=${Math.round(isPct * 100)}%`);

  for (let w = 0; w < windows; w++) {
    const isBars = Math.floor(barsPerWindow * isPct);
    const oosBars = barsPerWindow - isBars;
    let pnlIS = 0;
    let pnlOOS = 0;
    let wIS = 0;
    let wOOS = 0;

    for (let i = 0; i < barsPerWindow; i++) {
      const seed = w * 100 + i;
      const input = sampleInput(ticker, seed / 8);
      const human = mkHumanFromSeed(seed / 10);
      const d = decideIctSmc(input, human, DEFAULT_ICTSMC_CONFIG);

      // Lightweight synthetic outcome proxy:
      // edge above threshold increases hit probability; low human quality penalizes.
      const humanQuality = (human.sleepQuality + human.disciplineScore + (1 - human.stressLoad)) / 3;
      const pWin = Math.max(0.2, Math.min(0.85, 0.35 + (d.chosenEdge - 60) / 100 + (humanQuality - 0.5) * 0.2));
      const rr = d.profile === "LATE" ? 1.7 : d.profile === "EARLY" ? 2.2 : 0.0;
      const didTrade = d.direction !== "HOLD";
      const isWin = didTrade && Math.sin(seed * 2.37) * 0.5 + 0.5 < pWin;
      const r = !didTrade ? 0 : isWin ? rr : -1;
      const bp = r * d.finalRiskPct * 100; // basis-point style score proxy

      if (i < isBars) {
        pnlIS += bp;
        totalIS += bp;
        countIS++;
        if (bp > 0) wIS++;
      } else {
        pnlOOS += bp;
        totalOOS += bp;
        countOOS++;
        if (bp > 0) wOOS++;
      }
    }

    winsIS += wIS;
    winsOOS += wOOS;
    console.log(
      `  W${w + 1}: IS ${fmt(pnlIS)} (${wIS}/${isBars} up) -> OOS ${fmt(pnlOOS)} (${wOOS}/${oosBars} up)`,
    );
  }

  const avgIS = countIS ? totalIS / countIS : 0;
  const avgOOS = countOOS ? totalOOS / countOOS : 0;
  const stab = avgIS !== 0 ? (avgOOS / avgIS) * 100 : 0;

  console.log(`  IS avg/bar: ${fmt(avgIS)} | OOS avg/bar: ${fmt(avgOOS)} | stability: ${stab.toFixed(1)}%`);
  console.log(`  IS up-rate: ${(winsIS / Math.max(1, countIS) * 100).toFixed(1)}% | OOS up-rate: ${(winsOOS / Math.max(1, countOOS) * 100).toFixed(1)}%`);
}

function reentrySim(ticker: string, cycles = 120) {
  let baseSumR = 0;
  let stairSumR = 0;
  let baseTrades = 0;
  let stairTrades = 0;
  let reentries = 0;

  for (let i = 0; i < cycles; i++) {
    const seed = i * 1.37;
    const input = sampleInput(ticker, seed);
    const human = mkHumanFromSeed(seed);
    const d = decideIctSmc(input, human, DEFAULT_ICTSMC_CONFIG);
    if (d.direction === "HOLD" || d.entry === undefined || d.stop === undefined) continue;

    const risk = Math.max(1e-9, Math.abs(d.entry - d.stop));
    const edge = d.chosenEdge;
    const pHit = Math.max(0.28, Math.min(0.86, 0.36 + (edge - 60) / 120));
    const noise = Math.sin(seed * 2.71) * 0.5 + 0.5;
    const hitFirst = noise < pHit;

    // Baseline single-shot: take one target then flat
    const baseR = hitFirst ? 1.8 : -1.0;
    baseSumR += baseR;
    baseTrades += 1;

    // Staircase model:
    // hit level1 -> possible retest re-entry -> run to next level if BOOM expansion
    // If re-entry policy is disabled, staircase path should equal baseline.
    let stairR = d.reentryAllowed ? (hitFirst ? 1.6 : -1.0) : baseR;
    let tookReentry = false;
    if (hitFirst && d.reentryAllowed && d.runnerEnabled && d.chosenEdge >= 78) {
      const retestProb = 0.62;
      const retestNoise = Math.cos(seed * 1.91) * 0.5 + 0.5;
      if (retestNoise < retestProb) {
        tookReentry = true;
        const secondHitProb = 0.60;
        const secondNoise = Math.sin(seed * 3.19) * 0.5 + 0.5;
        stairR += secondNoise < secondHitProb ? 1.2 : -0.6;
      }
    }
    if (tookReentry) reentries += 1;
    stairSumR += stairR;
    stairTrades += 1;
  }

  const baseExp = baseTrades ? baseSumR / baseTrades : 0;
  const stairExp = stairTrades ? stairSumR / stairTrades : 0;
  const uplift = stairExp - baseExp;

  console.log(`\nICTSMC Re-entry Simulation — ${ticker.toUpperCase()}`);
  console.log("------------------------------------------------");
  console.log(`Samples: ${cycles} | executed: ${baseTrades}`);
  console.log(`Baseline expectancy (R/trade): ${baseExp.toFixed(3)}`);
  console.log(`Staircase expectancy (R/trade): ${stairExp.toFixed(3)}`);
  console.log(`Delta expectancy: ${uplift >= 0 ? "+" : ""}${uplift.toFixed(3)} R/trade`);
  console.log(`Re-entry usage: ${(reentries / Math.max(1, stairTrades) * 100).toFixed(1)}%`);
}

function alignmentReplay(ticker: string, sessions = 30, barsPerSession = 96, maxTradesPerDay = 0) {
  let total = 0;
  let holds = 0;
  let entries = 0;
  let longs = 0;
  let shorts = 0;
  let councilPass = 0;
  let htfPass = 0;
  let bothAlign = 0;
  let killzoneBars = 0;
  let tradesPerDaySum = 0;
  let days = 0;

  for (let s = 0; s < sessions; s++) {
    let dayEntries = 0;
    for (let b = 0; b < barsPerSession; b++) {
      const seed = s * 1000 + b;
      const input = sampleInput(ticker, seed / 11);
      // Session rotation to simulate day structure.
      const bucket = b % 4;
      input.session = bucket === 0 ? "LONDON" : bucket === 1 ? "NY_AM" : bucket === 2 ? "NY_PM" : "ASIA";
      const human = mkHumanFromSeed(seed / 13);
      const d = decideIctSmc(input, human, DEFAULT_ICTSMC_CONFIG);

      total++;
      if (input.session === "LONDON" || input.session === "NY_AM") killzoneBars++;
      const cAlign = (input.councilAlignedLong && input.councilAlignedShort) ? false : (input.councilAlignedLong || input.councilAlignedShort);
      const hAlign = (input.htfAlignedLong && input.htfAlignedShort) ? false : (input.htfAlignedLong || input.htfAlignedShort);
      if (cAlign) councilPass++;
      if (hAlign) htfPass++;
      if (cAlign && hAlign) bothAlign++;

      if (d.direction === "HOLD") {
        holds++;
      } else {
        if (maxTradesPerDay > 0 && dayEntries >= maxTradesPerDay) {
          holds++;
        } else {
          entries++;
          dayEntries++;
          if (d.direction === "LONG") longs++;
          if (d.direction === "SHORT") shorts++;
        }
      }
    }
    tradesPerDaySum += dayEntries;
    days++;
  }

  const pct = (n: number) => `${(n / Math.max(1, total) * 100).toFixed(1)}%`;
  console.log(`\nICTSMC Alignment Replay — ${ticker.toUpperCase()}`);
  console.log("------------------------------------------------");
  console.log(`Sessions: ${sessions} | Bars/session: ${barsPerSession} | Total bars: ${total}`);
  console.log(`Killzone bars: ${killzoneBars} (${pct(killzoneBars)})`);
  console.log(`Council pass bars: ${councilPass} (${pct(councilPass)})`);
  console.log(`HTF pass bars: ${htfPass} (${pct(htfPass)})`);
  console.log(`Council+HTF pass bars: ${bothAlign} (${pct(bothAlign)})`);
  console.log(`Entries: ${entries} (${pct(entries)}) | HOLD: ${holds} (${pct(holds)})`);
  console.log(`Direction split: LONG ${longs} | SHORT ${shorts}`);
  const capLabel = maxTradesPerDay > 0 ? ` (cap ${maxTradesPerDay}/day)` : "";
  console.log(`Avg trades/day: ${(tradesPerDaySum / Math.max(1, days)).toFixed(2)}${capLabel}`);
}

function run() {
  const args = process.argv.slice(2);
  const tickerArg = (() => {
    const idx = args.indexOf("--ticker");
    return idx >= 0 ? args[idx + 1] : "BTC";
  })();
  const wfMode = args.includes("--wf");
  const reentryMode = args.includes("--reentry-sim");
  const alignReplayMode = args.includes("--alignment-replay");
  const oneTradePerDay = args.includes("--one-trade-day");
  const maxTradesPerDay = (() => {
    const idx = args.indexOf("--max-trades-day");
    if (idx >= 0) return Math.max(0, Number.parseInt(args[idx + 1] ?? "0", 10) || 0);
    return oneTradePerDay ? 1 : 0;
  })();
  if (wfMode) {
    walkForward(tickerArg, 4, 60, 0.7);
    return;
  }
  if (reentryMode) {
    reentrySim(tickerArg, 140);
    return;
  }
  if (alignReplayMode) {
    alignmentReplay(tickerArg, 30, 96, maxTradesPerDay);
    return;
  }
  const input = sampleInput(tickerArg, 0.4);
  const human = sampleHuman();
  const starter = args.includes("--starter");
  const emaExit = args.includes("--ema-exit");
  const hmmOff = args.includes("--hmm-off");
  const kellyOff = args.includes("--kelly-off");
  const cfg = {
    ...DEFAULT_ICTSMC_CONFIG,
    accountMode: starter ? "STARTER" as const : "PRO" as const,
    exitPolicy: emaExit ? "EMA13" as const : "LIQUIDITY_LEVEL" as const,
    hmmSoftRoutingOn: !hmmOff,
    kellySizingOn: !kellyOff,
  };
  const decision = decideIctSmc(input, human, cfg);

  console.log("\nICTSMC V1 Decision");
  console.log("------------------");
  console.log(`Ticker: ${tickerArg.toUpperCase()}`);
  console.log(`Regime: ${input.regime}`);
  console.log(`Direction: ${decision.direction} (${decision.profile})`);
  console.log(`Edge L/S: ${decision.edgeScoreLong.toFixed(1)} / ${decision.edgeScoreShort.toFixed(1)}`);
  console.log(`Chosen edge: ${decision.chosenEdge.toFixed(1)}`);
  console.log(`Kelly frac (capped): ${(decision.kellyFraction * 100).toFixed(2)}%`);
  console.log(`Final risk pct: ${decision.finalRiskPct.toFixed(2)}%`);
  console.log(`Mode: ${cfg.accountMode} | Exit: ${decision.exitMode} | EOD close: ${decision.eodForceClose ? 'YES' : 'NO'}`);
  console.log(`HMM: ${cfg.hmmSoftRoutingOn ? "ON" : "OFF"} | Kelly: ${cfg.kellySizingOn ? "ON" : "OFF"}`);
  console.log(`CIS emergency: ${decision.useCisEmergency ? 'ON' : 'OFF'} | Runner: ${decision.runnerEnabled ? 'ON' : 'OFF'} | Re-entry: ${decision.reentryAllowed ? 'ON' : 'OFF'}`);
  if (decision.entry !== undefined) {
    console.log(`Entry: ${decision.entry.toFixed(2)}  Stop: ${decision.stop?.toFixed(2)}  TP1: ${decision.tp1?.toFixed(2)}  NextLvl: ${decision.nextLevelTp?.toFixed(2)}`);
  }
  console.log("\nReasons:");
  for (const r of decision.reasons) console.log(`- ${r}`);
}

run();
