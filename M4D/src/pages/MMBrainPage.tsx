/**
 * MMBrainPage — Market Maker Model prediction panel.
 * Combines OracleSnapshot + MM phase engine + XAI context injection slot.
 */
import { useState, useEffect, useCallback } from 'react';
import type { Bar } from '$indicators/boom3d-tech';
import { fetchBarsForSymbol } from '@pwa/lib/fetchBars';
import { buildOracleSnapshot } from '@pwa/lib/oracleSnapshot';
import { computeMMBrain, type MMPrediction, type MMPhase } from '@pwa/lib/mmBrain';
import { loadTimeframe } from '@pwa/lib/chartTimeframes';

const C = {
  bg: '#03050a', bg1: '#070c14', bg2: '#0d1520', border: '#0f2035',
  jedi: '#f59e0b', boom: '#22d3ee', strat: '#818cf8', legend: '#4ade80',
  ict: '#a78bfa', liq: '#f43f5e', exec: '#fb923c', risk: '#fbbf24',
  text: '#94a3b8', textHi: '#e2e8f0', muted: '#1e3a50', gold: '#fde68a',
  manip: '#ec4899', disp: '#22d3ee', accum: '#818cf8', dist: '#f97316',
};

const PHASE_COLOR: Record<MMPhase, string> = {
  ACCUMULATION: C.strat,
  MANIPULATION: C.manip,
  DISPLACEMENT: C.boom,
  DISTRIBUTION: C.dist,
};

const PHASE_ICON: Record<MMPhase, string> = {
  ACCUMULATION: '⬡',
  MANIPULATION: '⚡',
  DISPLACEMENT: '▲',
  DISTRIBUTION: '◎',
};

const PHASE_DESC: Record<MMPhase, string> = {
  ACCUMULATION: 'MM building inventory — do NOT trade the range',
  MANIPULATION: 'STOP RAID — retail caught offside — MM reversing',
  DISPLACEMENT: 'MM in control — ride the move, target next liquidity',
  DISTRIBUTION: 'MM near target — reduce exposure, watch reversal',
};

const DEFAULT_ASSETS = ['EURUSD', 'XAUUSD', 'BTC', 'ES', 'NQ', 'GBPUSD'];
const REFRESH_MS = 30_000;

interface AssetResult {
  asset: string;
  bars: Bar[];
  prediction: MMPrediction;
  ts: number;
}

function ConfBar({ val, color }: { val: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: `${color}22`, borderRadius: 2 }}>
        <div style={{ width: `${val * 100}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 9, color, width: 28, textAlign: 'right' }}>{(val * 100).toFixed(0)}%</span>
    </div>
  );
}

function BiasArrow({ bias }: { bias: number }) {
  const pct = Math.abs(bias);
  const color = bias > 0.15 ? C.boom : bias < -0.15 ? C.liq : C.text;
  const arrow = bias > 0.15 ? '▲' : bias < -0.15 ? '▼' : '━';
  return (
    <span style={{ color, fontWeight: 900, fontSize: 14 }}>
      {arrow} {(pct * 100).toFixed(0)}%
    </span>
  );
}

function LevelPill({ kind, dir }: { kind: string; dir: string }) {
  const col = kind.includes('EQ') ? C.risk
    : kind.includes('OB') ? C.boom
    : kind.includes('FVG') ? C.ict
    : kind.includes('PDH') || kind.includes('PDL') ? C.strat
    : kind.includes('POC') ? C.gold
    : C.text;
  return (
    <span style={{
      fontSize: 8, padding: '1px 5px', borderRadius: 3,
      background: `${col}18`, color: col, border: `1px solid ${col}33`,
    }}>
      {dir === 'above' ? '↑' : dir === 'below' ? '↓' : '·'} {kind}
    </span>
  );
}

function AssetCard({ result, selected, onClick }: {
  result: AssetResult; selected: boolean; onClick: () => void;
}) {
  const p = result.prediction;
  const pc = PHASE_COLOR[p.phase];
  return (
    <div onClick={onClick} style={{
      cursor: 'pointer',
      background: selected ? `${pc}12` : C.bg1,
      border: `1px solid ${selected ? pc : C.border}`,
      borderLeft: `3px solid ${pc}`,
      borderRadius: 8, padding: '10px 12px',
      transition: 'border-color 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 900, color: C.textHi }}>{result.asset}</span>
        <span style={{ fontSize: 10, color: pc }}>
          {PHASE_ICON[p.phase]} {p.phase}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: p.direction === 'BULL' ? C.legend : p.direction === 'BEAR' ? C.liq : C.text }}>
          {p.direction}
        </span>
      </div>
      <ConfBar val={p.phaseConfidence} color={pc} />
      {p.nextStop && (
        <div style={{ marginTop: 6, fontSize: 9, color: C.text }}>
          Next stop: <span style={{ color: C.gold }}>{p.nextStop.toFixed(4)}</span>
          <span style={{ color: C.muted }}> ({p.nextStopKind}, {p.nextStopDist.toFixed(1)}× ATR)</span>
        </div>
      )}
    </div>
  );
}

export default function MMBrainPage() {
  const [results, setResults] = useState<AssetResult[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [xaiContext, setXaiContext] = useState('');
  const [showXai, setShowXai] = useState(false);
  const [customAsset, setCustomAsset] = useState('');
  const [assets, setAssets] = useState(DEFAULT_ASSETS);
  const tf = loadTimeframe();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    const out: AssetResult[] = [];
    for (const asset of assets) {
      try {
        const bars = await fetchBarsForSymbol(asset, tf);
        if (bars.length < 30) continue;
        const snapshot = buildOracleSnapshot(bars, asset, tf);
        const prediction = computeMMBrain(bars, snapshot, xaiContext || undefined);
        out.push({ asset, bars, prediction, ts: Date.now() });
      } catch { /* skip failed asset */ }
    }
    setResults(out);
    if (out.length && !selected) setSelected(out[0]!.asset);
    setLoading(false);
  }, [assets, tf, xaiContext]);

  useEffect(() => {
    void fetchAll();
    const iv = setInterval(() => { void fetchAll(); }, REFRESH_MS);
    return () => clearInterval(iv);
  }, [fetchAll]);

  const active = results.find(r => r.asset === selected);
  const p = active?.prediction;

  const addAsset = () => {
    const sym = customAsset.trim().toUpperCase();
    if (sym && !assets.includes(sym)) {
      setAssets(prev => [...prev, sym]);
      setCustomAsset('');
    }
  };

  return (
    <div style={{
      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      background: C.bg, minHeight: '100vh', color: C.textHi,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 20px', borderBottom: `1px solid ${C.border}`,
        background: C.bg1, flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 15, fontWeight: 900, letterSpacing: 2, color: C.jedi }}>MM BRAIN</span>
        <span style={{ fontSize: 9, color: C.text }}>MARKET MAKER MODEL · ICT 4-PHASE · NEXT STOP PREDICTION</span>
        {loading && <span style={{ fontSize: 9, color: C.muted }}>↻ loading…</span>}
        {error && <span style={{ fontSize: 9, color: C.liq }}>{error}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={customAsset}
            onChange={e => setCustomAsset(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addAsset()}
            placeholder="+ ASSET"
            style={{
              background: C.bg2, border: `1px solid ${C.border}`, color: C.textHi,
              borderRadius: 4, padding: '3px 8px', fontSize: 9,
              fontFamily: 'inherit', width: 80,
            }}
          />
          <button onClick={addAsset} style={{
            background: C.bg2, border: `1px solid ${C.jedi}`, color: C.jedi,
            borderRadius: 4, padding: '3px 8px', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit',
          }}>ADD</button>
          <button onClick={() => setShowXai(v => !v)} style={{
            background: showXai ? `${C.strat}22` : C.bg2,
            border: `1px solid ${showXai ? C.strat : C.border}`,
            color: showXai ? C.strat : C.text,
            borderRadius: 4, padding: '3px 8px', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit',
          }}>XAI CONTEXT</button>
          <button onClick={() => void fetchAll()} style={{
            background: C.bg2, border: `1px solid ${C.boom}`, color: C.boom,
            borderRadius: 4, padding: '3px 8px', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit',
          }}>↻ REFRESH</button>
        </div>
      </div>

      {/* XAI context slot */}
      {showXai && (
        <div style={{
          padding: '12px 20px', background: `${C.strat}08`,
          borderBottom: `1px solid ${C.strat}33`,
        }}>
          <div style={{ fontSize: 9, color: C.strat, marginBottom: 6, letterSpacing: 2 }}>
            XAI / GROK MM EXTRACTION — paste market maker narrative from Grok or other source
          </div>
          <textarea
            value={xaiContext}
            onChange={e => setXaiContext(e.target.value)}
            placeholder="Paste Grok/XAI MM analysis here — e.g. 'MM accumulating below 1.0820, likely targeting 1.0890 EQH. Asia session stop sweep of 1.0798 expected before London push...'"
            style={{
              width: '100%', minHeight: 80, background: C.bg1,
              border: `1px solid ${C.strat}44`, color: C.textHi,
              borderRadius: 4, padding: '8px 12px', fontSize: 10,
              fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Asset list */}
        <div style={{
          width: 240, flexShrink: 0,
          borderRight: `1px solid ${C.border}`,
          padding: '12px 10px', overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {results.length === 0 && !loading && (
            <div style={{ fontSize: 10, color: C.muted, textAlign: 'center', marginTop: 40 }}>
              No data — check Polygon key
            </div>
          )}
          {results.map(r => (
            <AssetCard
              key={r.asset}
              result={r}
              selected={selected === r.asset}
              onClick={() => setSelected(r.asset)}
            />
          ))}
        </div>

        {/* Detail panel */}
        {p && active ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            <div style={{ maxWidth: 860 }}>
              {/* Phase header */}
              <div style={{
                background: `${PHASE_COLOR[p.phase]}0e`,
                border: `1px solid ${PHASE_COLOR[p.phase]}44`,
                borderRadius: 10, padding: '16px 20px', marginBottom: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
                  <span style={{ fontSize: 24, color: PHASE_COLOR[p.phase] }}>
                    {PHASE_ICON[p.phase]}
                  </span>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: PHASE_COLOR[p.phase], letterSpacing: 1 }}>
                      {p.phase}
                    </div>
                    <div style={{ fontSize: 10, color: C.text }}>{PHASE_DESC[p.phase]}</div>
                  </div>
                  <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: C.textHi }}>{active.asset}</div>
                    <div style={{ fontSize: 9, color: C.muted }}>
                      {new Date(active.ts).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
                <ConfBar val={p.phaseConfidence} color={PHASE_COLOR[p.phase]} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                {/* Bias + direction */}
                <div style={{
                  background: C.bg1, border: `1px solid ${C.border}`,
                  borderRadius: 8, padding: '14px 16px',
                }}>
                  <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 8 }}>BIAS</div>
                  <BiasArrow bias={p.bias} />
                  <div style={{ fontSize: 9, color: C.text, marginTop: 6 }}>
                    Liquidity: {(p.nextStop && active.bars.length
                      ? `${(active.prediction.targetEvidence[0] ?? '')}`
                      : 'computing…'
                    )}
                  </div>
                </div>

                {/* Next MM stop */}
                <div style={{
                  background: `${C.gold}08`, border: `1px solid ${C.gold}33`,
                  borderRadius: 8, padding: '14px 16px',
                }}>
                  <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 8 }}>NEXT MM STOP</div>
                  {p.nextStop ? (
                    <>
                      <div style={{ fontSize: 18, fontWeight: 900, color: C.gold }}>
                        {p.nextStop.toFixed(4)}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <LevelPill kind={p.nextStopKind} dir={p.direction === 'BULL' ? 'above' : 'below'} />
                        <span style={{ fontSize: 9, color: C.muted }}>{p.nextStopDist.toFixed(1)}× ATR</span>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: C.muted }}>No clear target</div>
                  )}
                  {p.alternateStop && (
                    <div style={{ fontSize: 9, color: C.muted, marginTop: 8 }}>
                      Alt (MM fake first): {p.alternateStop.toFixed(4)}
                    </div>
                  )}
                </div>
              </div>

              {/* Evidence chains */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                {[
                  { title: 'MANIPULATION', items: p.manipulationEvidence, color: C.manip },
                  { title: 'DISPLACEMENT', items: p.displacementEvidence, color: C.boom },
                  { title: 'TARGET', items: p.targetEvidence, color: C.gold },
                ].map(({ title, items, color }) => (
                  <div key={title} style={{
                    background: C.bg1, border: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${color}`, borderRadius: 8, padding: '12px 14px',
                  }}>
                    <div style={{ fontSize: 8, color, letterSpacing: 2, marginBottom: 8 }}>{title}</div>
                    {items.length ? items.map((e, i) => (
                      <div key={i} style={{ fontSize: 9, color: C.text, marginBottom: 4, lineHeight: 1.5 }}>· {e}</div>
                    )) : (
                      <div style={{ fontSize: 9, color: C.muted }}>No signal</div>
                    )}
                  </div>
                ))}
              </div>

              {/* Nearest levels */}
              <div style={{
                background: C.bg1, border: `1px solid ${C.border}`,
                borderRadius: 8, padding: '14px 16px', marginBottom: 16,
              }}>
                <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 10 }}>
                  LEVEL STACK — proximity ranked
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(active.prediction.targetEvidence.length
                    ? buildOracleSnapshot(active.bars, active.asset, tf).levels.slice(0, 12)
                    : []
                  ).map((l, i) => (
                    <div key={i} style={{
                      background: C.bg2, border: `1px solid ${C.border}`,
                      borderRadius: 4, padding: '4px 8px', fontSize: 9,
                    }}>
                      <LevelPill kind={l.kind} dir={l.dir} />
                      <span style={{ color: C.textHi, marginLeft: 4 }}>{l.price.toFixed(4)}</span>
                      <span style={{ color: C.muted, marginLeft: 4 }}>{l.proxPct.toFixed(2)}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Narrative */}
              <div style={{
                background: C.bg1, border: `1px solid ${C.border}`,
                borderRadius: 8, padding: '14px 16px',
              }}>
                <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 10 }}>
                  MM NARRATIVE — ORACLE CONTEXT
                </div>
                <pre style={{
                  fontSize: 10, color: C.text, lineHeight: 1.7,
                  whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit',
                }}>
                  {p.narrative}
                </pre>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 11 }}>
            {loading ? 'Computing MM model…' : 'Select an asset'}
          </div>
        )}
      </div>
    </div>
  );
}
