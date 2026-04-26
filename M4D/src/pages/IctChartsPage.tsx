import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bar } from '$indicators/boom3d-tech';
import {
  fetchBarsForSymbol,
  type ChartSymbol,
} from '@pwa/lib/fetchBars';
import {
  defaultSymbolForStrip,
  loadChartStripSymbol,
  saveChartStripSymbol,
  type ChartStripId,
} from '@pwa/lib/chartStripSymbol';
import {
  TIMEFRAME_OPTIONS,
  loadTimeframe,
  saveTimeframe,
  type TimeframePreset,
} from '@pwa/lib/chartTimeframes';
import {
  loadControls,
  saveControls,
  setMasLayer,
  type ChartControls,
} from '@pwa/lib/chartControls';
import BoomLwChart from '../components/BoomLwChart';
import ObiLivePanel from '../components/ObiLivePanel';
import BinanceObiPanel from '../components/BinanceObiPanel';
import { useObiStream } from '../hooks/useObiStream';
import { useBinanceObiStream } from '../hooks/useBinanceObiStream';
import { SoloMasterOrb, type SoloOrbDirection } from '../viz/SoloMasterOrb';
import {
  computePriceTargets,
  formatTargetPrice,
  type LiquidityThermalResult,
} from '@pwa/lib/computePriceTargets';
import type { HeatTarget } from '../components/BoomLwChart';
import {
  SOLO_PARTICIPATION_FLOOR_PCT,
  TARGET_UI_KEY,
  loadTargetUi,
  loadSoloDock,
  saveSoloDock,
  type TargetFilter,
  type SoloDockTier,
  type SoloDockState,
} from '../lib/chartPageUtils';
import './TvLwChartsPage.css';

const CHART_STRIP_ID: ChartStripId = 'ict';

export default function TvLwChartsPage() {
  const TOP_STOCKS = ['ES', 'EURUSD', 'XAUUSD', 'BTC', 'SPY', 'QQQ', 'TSLA', 'NVDA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL'] as const;
  const vitePolygonKey =
    (import.meta.env.VITE_POLYGON_IO_KEY || import.meta.env.VITE_POLYGON_API_KEY) as
      | string
      | undefined;

  const [bars, setBars] = useState<Bar[]>([]);
  const [sym, setSym] = useState<ChartSymbol>(
    () => loadChartStripSymbol(CHART_STRIP_ID) ?? defaultSymbolForStrip(CHART_STRIP_ID),
  );
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [controls, setControls] = useState<ChartControls>(() => loadControls());
  const [tf, setTf] = useState<TimeframePreset>(() => loadTimeframe());
  const [tickerInput, setTickerInput] = useState('');
  const [tickerFocus, setTickerFocus] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showObi, setShowObi] = useState(false);
  const [showDom, setShowDom] = useState(false);

  const CRYPTO_SYMS = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX']);
  const isCrypto = CRYPTO_SYMS.has(sym);
  const [targetUi] = useState(loadTargetUi);
  const [soloDock, setSoloDock] = useState<SoloDockState>(() => loadSoloDock());
  const obiSnap = useObiStream(sym, vitePolygonKey, showObi);
  const bnbSnap = useBinanceObiStream(sym, showDom);

  const preSafetySigRef = useRef<{
    sigMode: ChartControls['sigMode'];
    sigRvolMin: number;
    sigAtrExpandMin: number;
    sigBreakAtrFrac: number;
  } | null>(null);
  const allIndicatorsOn =
    controls.showBB &&
    controls.showKC &&
    controls.showSqueeze &&
    controls.showPoc &&
    controls.showLt &&
    controls.showVwap &&
    controls.showCouncilArrows &&
    controls.showIchimoku &&
    controls.showMas &&
    controls.showFvg &&
    controls.squeezePurpleBg &&
    controls.showOrderBlocks &&
    controls.showSwingRays &&
    controls.showSessionLevels;
  const allIctOn =
    controls.showOrderBlocks &&
    controls.showFvg &&
    controls.showPoc &&
    controls.showLt &&
    controls.showVwap &&
    controls.showSwingRays &&
    controls.showSessionLevels &&
    controls.showIchimoku &&
    controls.showMas;
  const safetySummary = `RV ${controls.sigRvolMin.toFixed(2)}x · ATR ${controls.sigAtrExpandMin.toFixed(
    2,
  )}x · BRK ${(controls.sigBreakAtrFrac * 100).toFixed(0)}% · ${controls.sigMode === 'strict' ? 'STR' : 'BAL'}`;
  const solo = useMemo(() => {
    if (bars.length < 35) {
      return {
        dir: 0,
        strength: 0,
        confidence: 0,
        volPct: 0,
        rvolRatio: 0,
        biasScore: 0,
        belowParticipationFloor: true,
        dirText: 'HOLD',
      };
    }
    const closes = bars.map((b) => b.close);
    const vols = bars.map((b) => b.volume ?? 0);
    const last = bars[bars.length - 1]!;
    const prev = bars[bars.length - 2]!;
    const ema = (len: number) => {
      const alpha = 2 / (len + 1);
      let v = closes[Math.max(0, closes.length - len)];
      for (let i = Math.max(0, closes.length - len + 1); i < closes.length; i++) {
        v = closes[i]! * alpha + v * (1 - alpha);
      }
      return v;
    };
    const emaFast = ema(9);
    const emaSlow = ema(21);
    const trendDir = emaFast > emaSlow ? 1 : emaFast < emaSlow ? -1 : 0;
    const lastMove = (last.close - prev.close) / Math.max(1e-9, prev.close);
    const moveDir = lastMove > 0 ? 1 : lastMove < 0 ? -1 : 0;
    const dirRaw = trendDir * 0.7 + moveDir * 0.3;
    /** ±1..±27 continuous bias; idle band trims chatter (tighter when already >=50% “on the move”). */
    const biasScore = Math.round(Math.max(-27, Math.min(27, dirRaw * 27)));

    let trSum = 0;
    const nAtr = 14;
    for (let i = bars.length - nAtr; i < bars.length; i++) {
      const b = bars[i]!;
      const bp = bars[i - 1] ?? b;
      trSum += Math.max(b.high - b.low, Math.abs(b.high - bp.close), Math.abs(b.low - bp.close));
    }
    const atr = trSum / nAtr;
    const atrNorm = atr / Math.max(1e-9, last.close);
    const moveStrength = Math.min(1, Math.abs(lastMove) / Math.max(1e-9, atrNorm));
    const volNow = vols[vols.length - 1]!;
    const volAvg = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const rvol = volAvg > 0 ? volNow / volAvg : 0;
    const volStrength = Math.min(1, rvol / 2);
    const strength = Math.round((moveStrength * 0.55 + volStrength * 0.45) * 100);

    const confBase = Math.abs(dirRaw) * 0.5 + (strength / 100) * 0.5;
    const safetyPenalty = controls.safetyDefenseOn ? 0.06 : 0;
    const confidence = Math.round(Math.max(0, Math.min(1, confBase - safetyPenalty)) * 100);
    const volPct = Math.round(volStrength * 100);
    const belowParticipationFloor = strength < SOLO_PARTICIPATION_FLOOR_PCT;
    const idleBand = strength >= 50 ? 5 : 9;
    let dir = 0;
    if (!belowParticipationFloor) {
      if (biasScore > idleBand) dir = 1;
      else if (biasScore < -idleBand) dir = -1;
    }
    return {
      dir,
      biasScore,
      belowParticipationFloor,
      strength,
      confidence,
      volPct,
      rvolRatio: rvol,
      dirText: dir > 0 ? 'UP' : dir < 0 ? 'DOWN' : 'HOLD',
    };
  }, [bars, controls.safetyDefenseOn]);

  const soloOrbDirection: SoloOrbDirection =
    solo.dir > 0 ? 'LONG' : solo.dir < 0 ? 'SHORT' : 'FLAT';
  const soloOrbScore = solo.belowParticipationFloor ? 0 : solo.biasScore;
  const soloOrbConviction = solo.belowParticipationFloor ? 0 : solo.confidence;
  const soloOnMove =
    !solo.belowParticipationFloor &&
    solo.strength >= 50 &&
    (soloOrbDirection === 'LONG' || soloOrbDirection === 'SHORT');

  const persist = useCallback((next: ChartControls) => {
    setControls(next);
    saveControls(next);
  }, []);

  const toggleAllIct = useCallback(() => {
    const next = !allIctOn;
    persist(
      setMasLayer(
        {
          ...controls,
          showOrderBlocks: next,
          showFvg: next,
          showPoc: next,
          showLt: next,
          showVwap: next,
          showSwingRays: next,
          showSessionLevels: next,
          showIchimoku: next,
        },
        next,
      ),
    );
  }, [allIctOn, controls, persist]);

  const setSoloDockPatch = useCallback(
    (patch: Partial<SoloDockState> | ((prev: SoloDockState) => Partial<SoloDockState>)) => {
      setSoloDock((prev) => {
        const delta = typeof patch === 'function' ? patch(prev) : patch;
        const next = { ...prev, ...delta };
        saveSoloDock(next);
        return next;
      });
    },
    [],
  );

  const load = useCallback(
    async (s: ChartSymbol, preset?: TimeframePreset) => {
      const activeTf = preset ?? tf;
      setSym(s);
      saveChartStripSymbol(CHART_STRIP_ID, s);
      setLoading(true);
      setErr('');
      try {
        const data = await fetchBarsForSymbol(s, vitePolygonKey, activeTf);
        setBars(data);
        if (data.length === 0) setErr('No bars returned');
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setBars([]);
      } finally {
        setLoading(false);
      }
    },
    [tf, vitePolygonKey],
  );

  useEffect(() => {
    const initial = loadChartStripSymbol(CHART_STRIP_ID) ?? defaultSymbolForStrip(CHART_STRIP_ID);
    void load(initial);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount: restore strip symbol + bars

  // ── XAI sentiment + jediAlign from DS quant :8000 ───────────────────────────
  const [xaiSentiment, setXaiSentiment] = useState<number | null>(null);
  const [jediAlign, setJediAlign] = useState<number | null>(null);
  useEffect(() => {
    const fetchOrb = () => {
      fetch('http://127.0.0.1:8000/v1/ai/activity/')
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d) return;
          const grok = d?.current?.grok_score;
          if (typeof grok === 'number') setXaiSentiment(grok * 2 - 1);
        }).catch(() => {});
      fetch('http://127.0.0.1:3030/v1/council')
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d) return;
          const js = d?.jedi_score;
          if (typeof js === 'number') setJediAlign(js / 27);
        }).catch(() => {});
    };
    fetchOrb();
    const id = setInterval(fetchOrb, 60_000);
    return () => clearInterval(id);
  }, []);

  // ── M6D shell integration — listen for TF/symbol changes from the microbar ──
  useEffect(() => {
    const onTf = (e: Event) => {
      const preset = (e as CustomEvent<TimeframePreset>).detail;
      if (preset) { setTf(preset); saveTimeframe(preset); void load(sym, preset); }
    };
    const onSym = (e: Event) => {
      const next = (e as CustomEvent<string>).detail?.trim().toUpperCase();
      if (next) void load(next);
    };
    window.addEventListener('m6d:setTf', onTf);
    window.addEventListener('m6d:setSym', onSym);
    return () => {
      window.removeEventListener('m6d:setTf', onTf);
      window.removeEventListener('m6d:setSym', onSym);
    };
  }, [load, sym]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTimeframe = useCallback(
    (next: TimeframePreset) => {
      setTf(next);
      saveTimeframe(next);
      void load(sym, next);
    },
    [load, sym],
  );

  const chartKey =
    bars.length > 0
      ? `${sym}-${tf}-${bars[0]!.time}-${bars[bars.length - 1]!.time}-${bars.length}`
      : '';

  const targetPack = useMemo(() => computePriceTargets(bars), [bars]);
  const lt: LiquidityThermalResult | null = targetPack.lt;

  /** LT levels passed as chart lines: POC + up to 3 above/below */
  const ltHeatTargets = useMemo((): HeatTarget[] => {
    if (!lt) return [];
    const out: HeatTarget[] = [{ price: lt.poc, tier: 'POC' }];
    lt.hvnsAbove.slice(0, 3).forEach((p, i) => out.push({ price: p, tier: `R${i + 1}` }));
    lt.hvnsBelow.slice(0, 3).forEach((p, i) => out.push({ price: p, tier: `S${i + 1}` }));
    return out;
  }, [lt]);

  useEffect(() => {
    try {
      localStorage.setItem(TARGET_UI_KEY, JSON.stringify(targetUi));
    } catch {
      /* ignore */
    }
  }, [targetUi]);

  const tickerQuery = tickerInput.trim().toUpperCase();
  const tickerSuggestions = (tickerQuery.length === 0
    ? TOP_STOCKS
    : TOP_STOCKS.filter((t) => t.startsWith(tickerQuery) || t.includes(tickerQuery))
  ).slice(0, 13);
  const selectTicker = useCallback(
    (raw: string) => {
      const next = raw.trim().toUpperCase();
      if (!next) return;
      setTickerInput('');
      setTickerFocus(false);
      void load(next);
    },
    [load],
  );
  const toggleSafetyDefense = useCallback(() => {
    if (!controls.safetyDefenseOn) {
      preSafetySigRef.current = {
        sigMode: controls.sigMode,
        sigRvolMin: controls.sigRvolMin,
        sigAtrExpandMin: controls.sigAtrExpandMin,
        sigBreakAtrFrac: controls.sigBreakAtrFrac,
      };
      persist({
        ...controls,
        safetyDefenseOn: true,
        sigMode: 'strict',
        sigRvolMin: Math.max(1.8, controls.sigRvolMin),
        sigAtrExpandMin: Math.max(1.25, controls.sigAtrExpandMin),
        sigBreakAtrFrac: Math.max(0.06, controls.sigBreakAtrFrac),
      });
      return;
    }
    const prev = preSafetySigRef.current;
    persist({
      ...controls,
      safetyDefenseOn: false,
      sigMode: prev?.sigMode ?? controls.sigMode,
      sigRvolMin: prev?.sigRvolMin ?? controls.sigRvolMin,
      sigAtrExpandMin: prev?.sigAtrExpandMin ?? controls.sigAtrExpandMin,
      sigBreakAtrFrac: prev?.sigBreakAtrFrac ?? controls.sigBreakAtrFrac,
    });
  }, [controls, persist]);

  const soloTip = solo.belowParticipationFloor
    ? `SOLO — ${solo.dirText} · S ${solo.strength}% (below ${SOLO_PARTICIPATION_FLOOR_PCT}% participation: no conviction / bias ignored) · raw bias ${solo.biasScore > 0 ? '+' : ''}${solo.biasScore} · RVOL ${solo.rvolRatio > 0 ? `${solo.rvolRatio.toFixed(2)}×` : '—'}`
    : `SOLO — ${solo.dirText} · bias ${solo.biasScore > 0 ? '+' : ''}${solo.biasScore} (orb ${soloOrbScore > 0 ? '+' : ''}${soloOrbScore}) · S ${solo.strength}% · C ${solo.confidence}% · RVOL ${solo.rvolRatio > 0 ? `${solo.rvolRatio.toFixed(2)}×` : '—'}`;

  const lastBar = bars.length > 0 ? bars[bars.length - 1]! : null;
  const prevBar = bars.length > 1 ? bars[bars.length - 2]! : null;
  const lastPrice = lastBar?.close ?? null;
  const priceChgPct = lastPrice && prevBar ? (lastBar!.close - prevBar.close) / prevBar.close * 100 : null;
  const fmtPrice = (p: number) => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : p < 10 ? p.toFixed(5) : p.toFixed(2);

  return (
    <div className="tv-lw-page">
      <div
        className={`tv-lw-solo-dock tv-lw-solo-dock--${soloDock.side} tv-lw-solo-dock--tier-${soloDock.tier} ${soloDock.visible ? '' : 'tv-lw-solo-dock--collapsed'}`}
        aria-label="SOLO orb and layout controls"
      >
        {soloDock.visible ? (
          <>
            <div
              className={[
                'tv-lw-solo-dock__orb',
                soloOnMove && soloOrbDirection === 'LONG' ? 'tv-lw-solo-dock__orb--move-long' : '',
                soloOnMove && soloOrbDirection === 'SHORT' ? 'tv-lw-solo-dock__orb--move-short' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={soloTip}
            >
              <SoloMasterOrb
                direction={soloOrbDirection}
                score={soloOrbScore}
                conviction={soloOrbConviction}
                strengthPct={solo.strength}
                onMoveStrengthPct={50}
                rvolRatio={solo.rvolRatio}
                density="rich"
                xaiSentiment={xaiSentiment}
                jediAlign={jediAlign}
              />
            </div>
            <div className="tv-lw-solo-dock__controls" role="toolbar" aria-label="SOLO dock">
              <div className="tv-lw-solo-dock__row">
                <button
                  type="button"
                  className={`tv-lw-solo-dock__btn ${soloDock.side === 'left' ? 'is-active' : ''}`}
                  title="Dock left (chart top-left)"
                  onClick={() => setSoloDockPatch({ side: 'left' })}
                >
                  L
                </button>
                <button
                  type="button"
                  className={`tv-lw-solo-dock__btn ${soloDock.side === 'right' ? 'is-active' : ''}`}
                  title="Dock right (chart top-right)"
                  onClick={() => setSoloDockPatch({ side: 'right' })}
                >
                  R
                </button>
              </div>
              <button
                type="button"
                className="tv-lw-solo-dock__btn tv-lw-solo-dock__btn--hs"
                title="Hide SOLO (S shows again)"
                onClick={() => setSoloDockPatch({ visible: false })}
              >
                H/S
              </button>
              <div className="tv-lw-solo-dock__row">
                <button
                  type="button"
                  className="tv-lw-solo-dock__btn"
                  title="Move up (toward header / UI)"
                  onClick={() =>
                    setSoloDockPatch((p) => ({ tier: Math.max(0, p.tier - 1) as SoloDockTier }))
                  }
                >
                  U
                </button>
                <button
                  type="button"
                  className="tv-lw-solo-dock__btn"
                  title="Move down (over chart)"
                  onClick={() =>
                    setSoloDockPatch((p) => ({ tier: Math.min(2, p.tier + 1) as SoloDockTier }))
                  }
                >
                  D
                </button>
              </div>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="tv-lw-solo-dock__btn tv-lw-solo-dock__reveal"
            title="Show SOLO orb"
            onClick={() => setSoloDockPatch({ visible: true })}
          >
            S
          </button>
        )}
      </div>
      {/* ── Indicator strip: ticker · TF · indicators ────────────────────── */}
      <div className="tv-lw-control-strip">
        <div className="tv-lw-masters-row" role="group" aria-label="Chart overlays">

          {/* Ticker input */}
          <div className="tv-lw-masters-seg tv-lw-masters-seg--sym">
            <div className="tv-lw-ticker-wrap">
              <input
                type="text"
                className="tv-lw-ticker-input"
                value={tickerInput}
                placeholder={sym}
                aria-label="Symbol"
                onFocus={() => setTickerFocus(true)}
                onClick={() => setTickerFocus(true)}
                onBlur={() => setTimeout(() => setTickerFocus(false), 120)}
                onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void selectTicker(tickerInput); } }}
              />
              {tickerFocus ? (
                <div className="tv-lw-ticker-dd" role="listbox">
                  {tickerSuggestions.map((t) => (
                    <button key={t} type="button" className="tv-lw-ticker-dd-item"
                      onMouseDown={(e) => { e.preventDefault(); void selectTicker(t); }}>
                      {t}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {/* TF buttons */}
          <div className="tv-lw-masters-seg tv-lw-masters-seg--tf">
            {TIMEFRAME_OPTIONS.map((o) => (
              <button key={o.id} type="button"
                className={tf === o.id ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
                onClick={() => setTimeframe(o.id)}>
                {o.label}
              </button>
            ))}
          </div>
          <div className="tv-lw-masters-seg tv-lw-masters-seg--ict-master" role="group" aria-label="ICT layers master">
            <button
              type="button"
              className={allIctOn ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={toggleAllIct}
              title="All ICT layers: OB · FVG · VP · LT · VWAP · SWG · SESS · ICHI · MAs"
            >
              ICT
            </button>
          </div>
          <div className="tv-lw-masters-seg tv-lw-masters-seg--ict" role="group" aria-label="ICT · heat bases">
            <button
              type="button"
              className={controls.showOrderBlocks ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => persist({ ...controls, showOrderBlocks: !controls.showOrderBlocks })}
              title="Order blocks (SMC)"
            >
              OB
            </button>
            <button
              type="button"
              className={controls.showFvg ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => persist({ ...controls, showFvg: !controls.showFvg })}
              title="FVG heat bands (horizontal)"
            >
              FVG
            </button>
            <button
              type="button"
              className={controls.showPoc ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => persist({ ...controls, showPoc: !controls.showPoc })}
              title="VP heat + VPOC line (volume-at-price)"
            >
              VP
            </button>
            <button
              type="button"
              className={controls.showLt ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => persist({ ...controls, showLt: !controls.showLt })}
              title="Liquidity Thermal — 300-bar 31-bin volume heatmap (full canvas)"
            >
              LT
            </button>
            <button
              type="button"
              className={controls.showVwap ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => persist({ ...controls, showVwap: !controls.showVwap })}
              title="Session VWAP + ±1σ bands (trend read)"
            >
              VWAP
            </button>
            <button
              type="button"
              className={controls.showSwingRays ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => persist({ ...controls, showSwingRays: !controls.showSwingRays })}
              title="Fractal swing rays"
            >
              SWG
            </button>
            <button
              type="button"
              className={controls.showSessionLevels ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => persist({ ...controls, showSessionLevels: !controls.showSessionLevels })}
              title="Session levels: OR / PDH / PDL"
            >
              SESS
            </button>
            <button
              type="button"
              className={controls.showIchimoku ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => persist({ ...controls, showIchimoku: !controls.showIchimoku })}
              title="Ichimoku cloud"
            >
              ICHI
            </button>
            <button
              type="button"
              className={controls.showMas ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => persist(setMasLayer(controls, !controls.showMas))}
              title="EMA ribbon"
            >
              MAs
            </button>
          </div>
          <div className="tv-lw-masters-seg" role="group" aria-label="Live order flow">
            <button
              type="button"
              className={showObi ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => setShowObi((v) => !v)}
              title="OBI — live bid/ask pressure + trade bubbles (Polygon WS · real-time stocks)"
            >
              OBI
            </button>
            {isCrypto && (
              <button
                type="button"
                className={showDom ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
                onClick={() => setShowDom((v) => !v)}
                title="DOM — Binance 20-level full depth heatmap + trade bubbles (free · no auth)"
              >
                DOM
              </button>
            )}
          </div>
          <div className="tv-lw-masters-seg tv-lw-masters-seg--vol" role="group" aria-label="Volatility · signals">
            <button
              type="button"
              className={controls.showBB || controls.showKC ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => {
                const next = !(controls.showBB || controls.showKC);
                persist({ ...controls, showBB: next, showKC: next });
              }}
            >
              BB·KC
            </button>
            <button
              type="button"
              className={controls.showSqueeze ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => persist({ ...controls, showSqueeze: !controls.showSqueeze })}
              title="BOOM squeeze: box lines + trend fill"
            >
              SQZ
            </button>
            <button
              type="button"
              className={controls.showCouncilArrows ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => persist({ ...controls, showCouncilArrows: !controls.showCouncilArrows })}
              title="SIG arrows: box break + RVOL + ATR (targets expansion)"
            >
              SIG
            </button>
            <button
              type="button"
              className={controls.sigMode === 'strict' ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() =>
                persist({
                  ...controls,
                  sigMode: controls.sigMode === 'strict' ? 'balanced' : 'strict',
                })
              }
              title="SIG density: BAL vs STR"
            >
              {controls.sigMode === 'strict' ? 'SIG STR' : 'SIG BAL'}
            </button>
            <button
              type="button"
              className={controls.squeezePurpleBg ? 'tv-lw-pill tv-lw-pill--purple-on' : 'tv-lw-pill tv-lw-pill--purple-off'}
              onClick={() => persist({ ...controls, squeezePurpleBg: !controls.squeezePurpleBg })}
              title="Purple squeeze tint"
            >
              PURPLE
            </button>
            <button
              type="button"
              className={
                controls.squeezePurpleBg && controls.showSqueeze && controls.showCouncilArrows && controls.showSessionLevels
                  ? 'tv-lw-pill tv-lw-pill--purple-on'
                  : 'tv-lw-pill tv-lw-pill--purple-off'
              }
              onClick={() => {
                const next = !(controls.squeezePurpleBg && controls.showSqueeze && controls.showCouncilArrows && controls.showSessionLevels);
                persist({ ...controls, squeezePurpleBg: next, showSqueeze: next, showCouncilArrows: next, showSessionLevels: next });
              }}
              title="BOOM mode: Purple + SQZ + SIG + SESS"
            >
              BOOM
            </button>
          </div>
          <div className="tv-lw-masters-seg tv-lw-masters-seg--tail" role="group" aria-label="Layout · defence">
            <button
              type="button"
              className={allIndicatorsOn ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => {
                const next = !allIndicatorsOn;
                persist({
                  ...controls,
                  showFvg: next,
                  showBB: next,
                  showKC: next,
                  showSqueeze: next,
                  showPoc: next,
                  showLt: next,
                  showVwap: next,
                  showCouncilArrows: next,
                  showIchimoku: next,
                  showMas: next,
                  squeezePurpleBg: next,
                  showOrderBlocks: next,
                  showSwingRays: next,
                  showSessionLevels: next,
                });
              }}
              title="Toggle all strip overlays (VP, LT, heat bases, BOOM, SIG levels)"
            >
              IND
            </button>
            <button
              type="button"
              className={controls.showGrid ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => persist({ ...controls, showGrid: !controls.showGrid })}
            >
              GRID
            </button>
            <button
              type="button"
              className={controls.safetyDefenseOn ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={toggleSafetyDefense}
              title="DEF: defence profile — stricter chart confirmations + softer SOLO conviction"
            >
              DEF
            </button>
            <button
              type="button"
              className={settingsOpen ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => setSettingsOpen((v) => !v)}
              title="FVG count + SIG (opacity, RVOL, ATR, BRK)"
            >
              ⚙ {settingsOpen ? '▴' : '▾'}
            </button>
          </div>
        </div>
      </div>
      {settingsOpen ? (
        <div className="tv-lw-settings-panel" role="group" aria-label="Indicator slider settings">
          <label className="tv-lw-opacity" dir="ltr" title="Max FVG heat zones drawn (most recent in list)">
            <span className="tv-lw-opacity__val">FVG ×{controls.fvgMaxDisplay}</span>
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--lo" aria-hidden>
              4
            </span>
            <input
              type="range"
              min={4}
              max={80}
              step={2}
              value={controls.fvgMaxDisplay}
              aria-label="Number of FVG zones to display"
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                persist({ ...controls, fvgMaxDisplay: Number.isFinite(v) ? v : 28 });
              }}
            />
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--hi" aria-hidden>
              80
            </span>
          </label>
          <label className="tv-lw-opacity" dir="ltr">
            <span className="tv-lw-opacity__val">SIG {controls.sigOpacity}%</span>
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--lo" aria-hidden>
              0
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={controls.sigOpacity}
              aria-label="SIG overlay opacity — 0 left transparent, 100 right full"
              onChange={(e) =>
                persist({ ...controls, sigOpacity: Number.parseInt(e.target.value, 10) || 0 })
              }
            />
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--hi" aria-hidden>
              100
            </span>
          </label>
          <label className="tv-lw-opacity" dir="ltr" title="SIG RVOL minimum">
            <span className="tv-lw-opacity__val">RV {controls.sigRvolMin.toFixed(2)}x</span>
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--lo" aria-hidden>
              1.00
            </span>
            <input
              type="range"
              min={1}
              max={2}
              step={0.05}
              value={controls.sigRvolMin}
              aria-label="SIG RVOL minimum multiplier"
              onChange={(e) =>
                persist({ ...controls, sigRvolMin: Number.parseFloat(e.target.value) || 1.65 })
              }
            />
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--hi" aria-hidden>
              2.00
            </span>
          </label>
          <label className="tv-lw-opacity" dir="ltr" title="SIG ATR expansion minimum">
            <span className="tv-lw-opacity__val">ATR {controls.sigAtrExpandMin.toFixed(2)}x</span>
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--lo" aria-hidden>
              1.00
            </span>
            <input
              type="range"
              min={1}
              max={2}
              step={0.01}
              value={controls.sigAtrExpandMin}
              aria-label="SIG ATR expansion minimum multiplier"
              onChange={(e) =>
                persist({ ...controls, sigAtrExpandMin: Number.parseFloat(e.target.value) || 1.2 })
              }
            />
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--hi" aria-hidden>
              2.00
            </span>
          </label>
          <label className="tv-lw-opacity" dir="ltr" title="SIG breakout distance as ATR fraction">
            <span className="tv-lw-opacity__val">BRK {(controls.sigBreakAtrFrac * 100).toFixed(0)}%</span>
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--lo" aria-hidden>
              1
            </span>
            <input
              type="range"
              min={0.01}
              max={0.2}
              step={0.01}
              value={controls.sigBreakAtrFrac}
              aria-label="SIG breakout ATR fraction"
              onChange={(e) =>
                persist({ ...controls, sigBreakAtrFrac: Number.parseFloat(e.target.value) || 0.03 })
              }
            />
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--hi" aria-hidden>
              20
            </span>
          </label>
        </div>
      ) : null}
      {controls.safetyDefenseOn ? (
        <div className="tv-lw-safety-chip" role="status" aria-live="polite">
          <span className="tv-lw-safety-chip__title">DEF · ARMED</span>
          <span className="tv-lw-safety-chip__meta">{safetySummary}</span>
        </div>
      ) : null}

      {err ? <p className="err">{err}</p> : null}

      <div className="chart-stage">
        {/* Price overlay — top-left of chart */}
        <div className="tv-lw-chart-overlay">
          <span className="tv-lw-overlay-sym">{sym}</span>
          {lastPrice !== null && <span className="tv-lw-overlay-price">{fmtPrice(lastPrice)}</span>}
          {priceChgPct !== null && (
            <span className={`tv-lw-overlay-chg ${priceChgPct >= 0 ? 'pos' : 'neg'}`}>
              {priceChgPct >= 0 ? '+' : ''}{priceChgPct.toFixed(2)}%
            </span>
          )}
        </div>
        {/* LT stats strip */}
        {lt ? (
          <div className="tv-lw-lt-strip">
            <span className="tv-lw-lt-strip__label">LT</span>
            <span className="tv-lw-lt-strip__buy">BUY {(lt.buyLiqPct * 100).toFixed(1)}%</span>
            <span className="tv-lw-lt-strip__sell">SELL {(lt.sellLiqPct * 100).toFixed(1)}%</span>
            <span className="tv-lw-lt-strip__poc">POC {formatTargetPrice(lt.poc)}</span>
            <span className={`tv-lw-lt-strip__imb ${lt.imbalance >= 0 ? 'pos' : 'neg'}`}>
              IMB {lt.imbalance >= 0 ? '+' : ''}{(lt.imbalance / 1e6).toFixed(1)}M
            </span>
          </div>
        ) : null}
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && bars.length > 0 && chartKey ? (
          <BoomLwChart key={chartKey} bars={bars} controls={controls} symbol={sym} heatTargets={ltHeatTargets} />
        ) : null}
      </div>

      {showObi && <ObiLivePanel snap={obiSnap} />}
      {showDom && isCrypto && <BinanceObiPanel snap={bnbSnap} sym={sym} />}

    </div>
  );
}
