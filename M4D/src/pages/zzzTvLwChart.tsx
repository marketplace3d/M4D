/**
 * ICT TRADER — dual-chart page.
 * Chart A (top, HTF) + Chart B (bottom, LTF). Shared symbol.
 * All ICT layers ON: OB, FVG, POC, VWAP, S/R zones, swing.
 */
import { useCallback, useEffect, useState } from 'react';
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

const ICT_DEFAULTS: Partial<ChartControls> = {
  showOrderBlocks:   true,
  showFvg:           true,
  showPoc:           true,
  showVwap:          false,  // managed live via showVwap prop — never triggers remount
  showSwingRays:     true,   // enables S/R zone channels too
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

const TF_KEY_A = 'm4d-ict-tf-a';
const TF_KEY_B = 'm4d-ict-tf-b';

export default function IctPage() {
  const polyKey = (import.meta.env.VITE_POLYGON_IO_KEY || import.meta.env.VITE_POLYGON_API_KEY) as string | undefined;

  const [sym, setSym]         = useState<ChartSymbol>('EURUSD');
  const [expandA, setExpandA] = useState(false);
  const [showVwap, setShowVwap] = useState(true);  // live — no remount

  // Chart A (top, HTF)
  const [barsA, setBarsA]     = useState<Bar[]>([]);
  const [loadA, setLoadA]     = useState(true);
  const [errA,  setErrA]      = useState('');
  const [tfA,   setTfA]       = useState<TimeframePreset>(() => loadTf(TF_KEY_A, '5d5m'));
  const [ctrlA, setCtrlA]     = useState<ChartControls>(() => loadCtrl(KEY_A));

  // Chart B (bottom, LTF)
  const [barsB, setBarsB]     = useState<Bar[]>([]);
  const [loadB, setLoadB]     = useState(true);
  const [errB,  setErrB]      = useState('');
  const [tfB,   setTfB]       = useState<TimeframePreset>(() => loadTf(TF_KEY_B, '1d1m'));
  const [ctrlB, setCtrlB]     = useState<ChartControls>(() => loadCtrl(KEY_B));

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

  // Initial load
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

  // Sync controls: when user toggles shared ICT pills, apply to BOTH charts
  const toggleBoth = useCallback((key: keyof ChartControls) => {
    const next = !ctrlA[key];
    const a = { ...ctrlA, [key]: next };
    const b = { ...ctrlB, [key]: next };
    persistA(a); persistB(b);
  }, [ctrlA, ctrlB, persistA, persistB]);

  const keyA = barsA.length ? `ict-a-${sym}-${tfA}-${barsA[0]!.time}-${barsA[barsA.length-1]!.time}-${barsA.length}` : '';
  const keyB = barsB.length ? `ict-b-${sym}-${tfB}-${barsB[0]!.time}-${barsB[barsB.length-1]!.time}-${barsB.length}` : '';

  const pill = (on: boolean) => `tv-lw-pill${on ? ' tv-lw-pill--on' : ''}`;

  const miniTfRow = (active: TimeframePreset, onChange: (tf: TimeframePreset) => void, label: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderBottom: '1px solid #161b22', flexShrink: 0 }}>
      <span style={{ fontSize: 9, color: '#484f58', marginRight: 4, letterSpacing: '0.06em' }}>{label}</span>
      {TIMEFRAME_OPTIONS.map((o) => (
        <button key={o.id} type="button"
          style={{
            fontSize: 9, padding: '1px 6px', border: 'none', borderRadius: 3, cursor: 'pointer',
            background: active === o.id ? '#1f6feb' : '#161b22',
            color: active === o.id ? '#e6edf3' : '#8b949e',
          }}
          onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="tv-lw-page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Shared control strip ────────────────────────────────── */}
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

        {/* ICT layer toggles — synced across both charts */}
        <div className="tv-lw-masters" role="group" aria-label="ICT layers">
          <button type="button" className={pill(ctrlA.showOrderBlocks)} onClick={() => toggleBoth('showOrderBlocks')}>OB</button>
          <button type="button" className={pill(ctrlA.showFvg)}         onClick={() => toggleBoth('showFvg')}>FVG</button>
          <button type="button" className={pill(ctrlA.showPoc)}         onClick={() => toggleBoth('showPoc')}>POC</button>
          {/* VWAP — live toggle: adds/removes series without rebuilding the chart */}
          <button type="button" className={pill(showVwap)}              onClick={() => setShowVwap((v) => !v)}>VWAP</button>
          <button type="button" className={pill(ctrlA.showSwingRays)}   onClick={() => toggleBoth('showSwingRays')}>SR</button>
          <button type="button" className={pill(ctrlA.showGrid)}        onClick={() => toggleBoth('showGrid')}>GRID</button>
        </div>

        <button type="button" className="tv-lw-reload"
          onClick={() => { void fetchA(sym, tfA); void fetchB(sym, tfB); }} title="Reload both">↻</button>
      </div>

      {(errA || errB) && (
        <p style={{ color: '#f23645', fontSize: 10, padding: '2px 8px', flexShrink: 0, margin: 0 }}>
          {errA || errB}
        </p>
      )}

      {/* ── Chart A (top) ───────────────────────────────────────── */}
      <div style={{ flex: expandA ? 1 : 6, display: 'flex', flexDirection: 'column', minHeight: 0, borderBottom: expandA ? 'none' : '2px solid #21262d', position: 'relative' }}>
        {miniTfRow(tfA, changeTfA, 'HTF')}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {loadA && <p style={{ color: '#8b949e', fontSize: 11, padding: 12, margin: 0 }}>Loading A…</p>}
          {!loadA && keyA && <BoomLwChart key={keyA} bars={barsA} controls={ctrlA} compactUi storageKey="ict-a" showVwap={showVwap} />}
        </div>
        {/* Expand / restore button — bottom-right of Chart A */}
        <button
          type="button"
          title={expandA ? 'Restore split' : 'Expand top chart'}
          onClick={() => setExpandA((v) => !v)}
          style={{
            position: 'absolute', bottom: 32, right: 68, zIndex: 50,
            width: 28, height: 28, border: '1px solid #30363d', borderRadius: 6,
            background: '#21262d', color: '#8b949e', cursor: 'pointer',
            fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {expandA ? '↕' : '↑'}
        </button>
      </div>

      {/* ── Chart B (bottom) ────────────────────────────────────── */}
      {!expandA && (
        <div style={{ flex: 4, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {miniTfRow(tfB, changeTfB, 'LTF')}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {loadB && <p style={{ color: '#8b949e', fontSize: 11, padding: 12, margin: 0 }}>Loading B…</p>}
            {!loadB && keyB && <BoomLwChart key={keyB} bars={barsB} controls={ctrlB} compactUi storageKey="ict-b" showVwap={showVwap} />}
          </div>
        </div>
      )}

      <p style={{ flexShrink: 0, fontSize: 9, color: '#484f58', padding: '2px 8px', borderTop: '1px solid #161b22', margin: 0 }}>
        ICT · {sym} · A:{tfA.toUpperCase()} B:{tfB.toUpperCase()} · OB+FVG+POC+VWAP+SR
      </p>
    </div>
  );
}
