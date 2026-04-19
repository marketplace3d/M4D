/**
 * ICT TRADER (OLD) — dual-chart page. Preserved for HTF+LTF split.
 * Chart A (top, HTF) + Chart B (bottom, LTF). Shared symbol.
 * Route: #ict-old · Nav: ICT·OLD
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { Bar } from '$indicators/boom3d-tech';
import { SYMBOLS, fetchBarsForSymbol, type ChartSymbol } from '@pwa/lib/fetchBars';
import {
  TIMEFRAME_OPTIONS,
  type TimeframePreset,
} from '@pwa/lib/chartTimeframes';
import { defaultControls, type ChartControls } from '@pwa/lib/chartControls';
import BoomLwChart from '../components/BoomLwChart';
import './TvLwChartsPage.css';

const KEY_A = 'm4d-ict-a-controls';
const KEY_B = 'm4d-ict-b-controls';
const TF_KEY_A = 'm4d-ict-tf-a';
const TF_KEY_B = 'm4d-ict-tf-b';

const ICT_DEFAULTS: Partial<ChartControls> = {
  showOrderBlocks:   true,
  showFvg:           true,
  showPoc:           true,
  showVwap:          false,  // driven by showVwap prop — never triggers remount
  showSwingRays:     true,
  showSessionLevels: false,
  showBB:            false,
  showKC:            false,
  showIchimoku:      false,
  showMas:           false,
  showSar:           false,
  showDarvas:        false,
  showCouncilArrows: false,
  showVoteDots:      false,
  squeezeLinesGreen: false,
  squeezePurpleBg:   false,
  showGrid:          true,
  masterOn:          false,
  sigOpacity:        100,
};

function loadCtrl(key: string): ChartControls {
  try {
    const raw = typeof window !== 'undefined' && localStorage.getItem(key);
    return { ...defaultControls, ...ICT_DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...defaultControls, ...ICT_DEFAULTS };
  }
}
function saveCtrl(key: string, c: ChartControls) {
  try { localStorage.setItem(key, JSON.stringify(c)); } catch { /* */ }
}

function loadTf(key: string, fallback: TimeframePreset): TimeframePreset {
  try {
    const raw = typeof window !== 'undefined' && localStorage.getItem(key);
    if (raw === '1d1m' || raw === '5d5m' || raw === '1m15m' || raw === '1y1d') return raw as TimeframePreset;
  } catch { /* */ }
  return fallback;
}

const tfBtnStyle = (active: boolean) => ({
  fontSize: 9, padding: '1px 6px', border: 'none', borderRadius: 3, cursor: 'pointer',
  background: active ? '#1f6feb' : '#161b22',
  color:      active ? '#e6edf3' : '#8b949e',
});

const expandBtnStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: 13, padding: '0 6px', height: 18, border: '1px solid #30363d',
  borderRadius: 4, background: '#161b22', color: '#8b949e', cursor: 'pointer',
  display: 'flex', alignItems: 'center', lineHeight: 1,
};

export default function IctPageOld() {
  const polyKey = (import.meta.env.VITE_POLYGON_IO_KEY || import.meta.env.VITE_POLYGON_API_KEY) as string | undefined;

  const [sym,      setSym]      = useState<ChartSymbol>('EURUSD');
  const [expandA,  setExpandA]  = useState(false);
  const [showVwap, setShowVwap] = useState(true);

  // Chart A (top, HTF)
  const [barsA, setBarsA] = useState<Bar[]>([]);
  const [loadA, setLoadA] = useState(true);
  const [errA,  setErrA]  = useState('');
  const [tfA,   setTfA]   = useState<TimeframePreset>(() => loadTf(TF_KEY_A, '5d5m'));
  const [ctrlA, setCtrlA] = useState<ChartControls>(() => loadCtrl(KEY_A));

  // Chart B (bottom, LTF)
  const [barsB, setBarsB] = useState<Bar[]>([]);
  const [loadB, setLoadB] = useState(true);
  const [errB,  setErrB]  = useState('');
  const [tfB,   setTfB]   = useState<TimeframePreset>(() => loadTf(TF_KEY_B, '1d1m'));
  const [ctrlB, setCtrlB] = useState<ChartControls>(() => loadCtrl(KEY_B));

  const fetchA = useCallback(async (s: ChartSymbol, tf: TimeframePreset) => {
    setLoadA(true); setErrA('');
    try {
      const d = await fetchBarsForSymbol(s, polyKey, tf);
      setBarsA(d);
      if (!d.length) setErrA('No bars — A');
    } catch (e) {
      setErrA(e instanceof Error ? e.message : String(e)); setBarsA([]);
    } finally { setLoadA(false); }
  }, [polyKey]);

  const fetchB = useCallback(async (s: ChartSymbol, tf: TimeframePreset) => {
    setLoadB(true); setErrB('');
    try {
      const d = await fetchBarsForSymbol(s, polyKey, tf);
      setBarsB(d);
      if (!d.length) setErrB('No bars — B');
    } catch (e) {
      setErrB(e instanceof Error ? e.message : String(e)); setBarsB([]);
    } finally { setLoadB(false); }
  }, [polyKey]);

  useEffect(() => {
    void fetchA('EURUSD', tfA);
    void fetchB('EURUSD', tfB);
  }, []); // eslint-disable-line

  const changeSym = useCallback((s: ChartSymbol) => {
    setSym(s);
    void fetchA(s, tfA);
    void fetchB(s, tfB);
  }, [fetchA, fetchB, tfA, tfB]);

  const changeTfA = useCallback((tf: TimeframePreset) => {
    setTfA(tf);
    try { localStorage.setItem(TF_KEY_A, tf); } catch { /* */ }
    void fetchA(sym, tf);
  }, [fetchA, sym]);

  const changeTfB = useCallback((tf: TimeframePreset) => {
    setTfB(tf);
    try { localStorage.setItem(TF_KEY_B, tf); } catch { /* */ }
    void fetchB(sym, tf);
  }, [fetchB, sym]);

  const persistA = useCallback((next: ChartControls) => { setCtrlA(next); saveCtrl(KEY_A, next); }, []);
  const persistB = useCallback((next: ChartControls) => { setCtrlB(next); saveCtrl(KEY_B, next); }, []);

  const toggleBoth = useCallback((key: keyof ChartControls) => {
    const next = !ctrlA[key];
    persistA({ ...ctrlA, [key]: next });
    persistB({ ...ctrlB, [key]: next });
  }, [ctrlA, ctrlB, persistA, persistB]);

  // expandA included so the chart remounts on toggle — picks up persisted zoom cleanly
  const keyA = barsA.length
    ? `ict-a-${sym}-${tfA}-${expandA ? 'x' : 's'}-${barsA[0]!.time}-${barsA[barsA.length - 1]!.time}-${barsA.length}`
    : '';
  const keyB = barsB.length
    ? `ict-b-${sym}-${tfB}-${barsB[0]!.time}-${barsB[barsB.length - 1]!.time}-${barsB.length}`
    : '';

  const pill = (on: boolean) => `tv-lw-pill${on ? ' tv-lw-pill--on' : ''}`;

  return (
    <div className="tv-lw-page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Shared control strip ─────────────────────────────────── */}
      <div className="tv-lw-control-strip" style={{ flexShrink: 0 }}>
        <div className="tv-lw-group" role="toolbar" aria-label="Symbol">
          {SYMBOLS.map((s) => (
            <button key={s.id} type="button"
              className={sym === s.id ? 'active' : undefined}
              onClick={() => changeSym(s.id)}>
              {s.label}
            </button>
          ))}
        </div>

        <div className="tv-lw-masters-row" role="group" aria-label="ICT layers">
          <div className="tv-lw-masters-seg tv-lw-masters-seg--ict">
            <button type="button" className={pill(ctrlA.showOrderBlocks)} onClick={() => toggleBoth('showOrderBlocks')} title="Order blocks">OB</button>
            <button type="button" className={pill(ctrlA.showFvg)}         onClick={() => toggleBoth('showFvg')} title="FVG heat zones">FVG</button>
            <button type="button" className={pill(ctrlA.showPoc)}         onClick={() => toggleBoth('showPoc')} title="VP heat + VPOC">VP</button>
            <button type="button" className={pill(showVwap)}              onClick={() => setShowVwap((v) => !v)} title="Session VWAP">VWAP</button>
            <button type="button" className={pill(ctrlA.showSwingRays)}   onClick={() => toggleBoth('showSwingRays')} title="Swing rays">SWG</button>
          </div>
          <div className="tv-lw-masters-seg tv-lw-masters-seg--tail">
            <button type="button" className={pill(ctrlA.showGrid)}        onClick={() => toggleBoth('showGrid')}>GRID</button>
          </div>
        </div>

        <button type="button" className="tv-lw-reload"
          onClick={() => { void fetchA(sym, tfA); void fetchB(sym, tfB); }} title="Reload both">↻</button>
      </div>

      {(errA || errB) && (
        <p style={{ color: '#f23645', fontSize: 10, padding: '2px 8px', flexShrink: 0, margin: 0 }}>
          {errA || errB}
        </p>
      )}

      {/* ── Chart A (top) ────────────────────────────────────────── */}
      <div style={{ flex: expandA ? 1 : 6, display: 'flex', flexDirection: 'column', minHeight: 0, borderBottom: expandA ? 'none' : '2px solid #21262d' }}>

        {/* HTF row — expand button lives here, away from ⏩ */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderBottom: '1px solid #161b22', flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: '#484f58', marginRight: 4, letterSpacing: '0.06em' }}>HTF</span>
          {TIMEFRAME_OPTIONS.map((o) => (
            <button key={o.id} type="button" style={tfBtnStyle(tfA === o.id)} onClick={() => changeTfA(o.id)}>
              {o.label}
            </button>
          ))}
          <button
            type="button"
            style={expandBtnStyle}
            title={expandA ? 'Restore split view' : 'Expand top chart full height'}
            onClick={() => setExpandA((v) => !v)}
          >
            {expandA ? '↑' : '↓'}
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {loadA && <p style={{ color: '#8b949e', fontSize: 11, padding: 12, margin: 0 }}>Loading…</p>}
          {!loadA && keyA && (
            <BoomLwChart key={keyA} bars={barsA} controls={ctrlA} compactUi storageKey="ict-a" showVwap={showVwap} />
          )}
        </div>
      </div>

      {/* ── Chart B (bottom) ─────────────────────────────────────── */}
      {!expandA && (
        <div style={{ flex: 4, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderBottom: '1px solid #161b22', flexShrink: 0 }}>
            <span style={{ fontSize: 9, color: '#484f58', marginRight: 4, letterSpacing: '0.06em' }}>LTF</span>
            {TIMEFRAME_OPTIONS.map((o) => (
              <button key={o.id} type="button" style={tfBtnStyle(tfB === o.id)} onClick={() => changeTfB(o.id)}>
                {o.label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {loadB && <p style={{ color: '#8b949e', fontSize: 11, padding: 12, margin: 0 }}>Loading…</p>}
            {!loadB && keyB && (
              <BoomLwChart key={keyB} bars={barsB} controls={ctrlB} compactUi storageKey="ict-b" showVwap={showVwap} />
            )}
          </div>
        </div>
      )}

      <p style={{ flexShrink: 0, fontSize: 9, color: '#484f58', padding: '2px 8px', borderTop: '1px solid #161b22', margin: 0 }}>
        ICT·OLD · {sym} · A:{tfA.toUpperCase()} B:{tfB.toUpperCase()} · OB·FVG·VP·VWAP·SWG
      </p>
    </div>
  );
}
