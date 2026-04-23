import { useCallback, useEffect, useState } from 'react';
import type { Bar } from '$indicators/boom3d-tech';
import {
  SYMBOLS,
  fetchBarsForSymbol,
  type ChartSymbol,
} from '@pwa/lib/fetchBars';
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
  setSigLayers,
  type ChartControls,
} from '@pwa/lib/chartControls';
import BoomLwChart from '../components/BoomLwChart';
import { useAlgoWS } from '../hooks/useAlgoWS';
import './TvLwChartsPage.css';

export default function TvLwChartsLivePage() {
  const vitePolygonKey =
    (import.meta.env.VITE_POLYGON_IO_KEY || import.meta.env.VITE_POLYGON_API_KEY) as
      | string
      | undefined;

  const [bars, setBars] = useState<Bar[]>([]);
  const [sym, setSym] = useState<ChartSymbol>('EURUSD');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [controls, setControls] = useState<ChartControls>(() => loadControls());
  const [tf, setTf] = useState<TimeframePreset>(() => loadTimeframe());
  const sigOn =
    controls.showFvg &&
    controls.showOrderBlocks &&
    controls.showSwingRays &&
    controls.showSessionLevels;

  const persist = useCallback((next: ChartControls) => {
    setControls(next);
    saveControls(next);
  }, []);

  const load = useCallback(
    async (s: ChartSymbol, preset?: TimeframePreset) => {
      const activeTf = preset ?? tf;
      setSym(s);
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
    void load('EURUSD');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initial symbol load only

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
  const { wsUrl, status: wsStatus, error: wsError, lastPayload } = useAlgoWS({
    symbol: sym,
    timeframe: tf,
    enabled: true,
  });

  useEffect(() => {
    if (!lastPayload || lastPayload.type !== 'bar') return;
    const incoming = lastPayload.bar;
    setBars((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = next[next.length - 1]!;
      if (incoming.time === last.time) {
        next[next.length - 1] = incoming;
        return next;
      }
      if (incoming.time > last.time) {
        next.push(incoming);
        return next;
      }
      return prev;
    });
  }, [lastPayload]);

  return (
    <div className="tv-lw-page">
      <header className="tv-lw-head">
        <div className="tv-lw-brand">
          <span className="tv-lw-k mission-top-k">MISSION CHARTS LIVE</span>
          <div className="tv-lw-head-meta-line">
            <span className="tv-lw-sub-inline">STREAM</span>
            SYMBOL {sym} · TF {tf.toUpperCase()} · WS {wsUrl ? wsStatus.toUpperCase() : 'DISABLED'} · REST FALLBACK
          </div>
        </div>
        <div className="tv-lw-hintline">
          <a href="#pulse">PULSE</a> · <a href="#warrior">COUNCIL</a> · <a href="#boom">BOOM</a>
        </div>
      </header>

      <div className="tv-lw-control-strip">
        <div className="tv-lw-toolbar" role="group" aria-label="Symbol and timeframe">
          <div className="tv-lw-toolbar__primary">
            <div className="tv-lw-group" role="toolbar" aria-label="Instruments">
              {SYMBOLS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={sym === s.id ? 'active' : undefined}
                  onClick={() => void load(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="tv-lw-time-row" role="toolbar" aria-label="Timeframe">
              {TIMEFRAME_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={tf === o.id ? 'active' : undefined}
                  onClick={() => setTimeframe(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="tv-lw-toolbar__actions">
            <button type="button" className="tv-lw-reload" onClick={() => void load(sym)} title="Reload bars">
              ↻
            </button>
          </div>
        </div>
        <div className="tv-lw-masters" role="group" aria-label="Chart overlays">
          <button
            type="button"
            className={sigOn ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
            onClick={() => persist(setSigLayers(controls, !sigOn))}
          >
            LVL // {sigOn ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className={controls.showBB ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
            onClick={() => persist({ ...controls, showBB: !controls.showBB })}
          >
            BB // {controls.showBB ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className={controls.showIchimoku ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
            onClick={() => persist({ ...controls, showIchimoku: !controls.showIchimoku })}
          >
            ICHI // {controls.showIchimoku ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className={controls.showMas ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
            onClick={() => persist(setMasLayer(controls, !controls.showMas))}
          >
            MAs // {controls.showMas ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className={controls.squeezePurpleBg ? 'tv-lw-pill tv-lw-pill--purple-on' : 'tv-lw-pill tv-lw-pill--purple-off'}
            onClick={() => persist({ ...controls, squeezePurpleBg: !controls.squeezePurpleBg })}
          >
            PURPLE // {controls.squeezePurpleBg ? 'ON' : 'OFF'}
          </button>
          <label className="tv-lw-opacity tv-lw-opacity--purple" dir="ltr">
            <span className="tv-lw-opacity__val tv-lw-opacity__val--purple">
              {controls.squeezePurpleOpacity}%
            </span>
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--lo" aria-hidden>
              0
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={2}
              value={controls.squeezePurpleOpacity}
              aria-label="Purple squeeze opacity — 0 left transparent, 100 right full"
              onChange={(e) =>
                persist({
                  ...controls,
                  squeezePurpleOpacity: Number.parseInt(e.target.value, 10) || 0,
                })
              }
            />
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--hi" aria-hidden>
              100
            </span>
          </label>
          <label className="tv-lw-opacity" dir="ltr">
            <span className="tv-lw-opacity__val">{controls.sigOpacity}%</span>
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
          <button
            type="button"
            className="tv-lw-pill tv-lw-pill--ghost"
            onClick={() => persist({ ...controls, masterOn: !controls.masterOn })}
          >
            {controls.masterOn ? 'IND ON' : 'IND OFF'}
          </button>
          <button
            type="button"
            className={controls.showGrid ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
            onClick={() => persist({ ...controls, showGrid: !controls.showGrid })}
          >
            GRID // {controls.showGrid ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {err ? <p className="err">{err}</p> : null}
      {wsError ? <p className="err">{wsError}</p> : null}

      <div className="chart-stage">
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && bars.length > 0 && chartKey ? (
          <BoomLwChart key={chartKey} bars={bars} controls={controls} />
        ) : null}
      </div>

      <p className="tv-lw-foot">
        <code>#pulse</code> PULSE · <code>#warrior</code> COUNCIL · <code>#boom</code> BOOM
      </p>
    </div>
  );
}
