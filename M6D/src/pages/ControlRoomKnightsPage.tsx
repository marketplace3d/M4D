import MaxCogVizKnights from '../viz/ControlRoomKnights.jsx';
import { useEffect, useMemo, useState } from 'react';
import { PriceOrb, RiskOrb, ConfluenceOrb, VolumeOrb } from '../viz/MaxCogVizOrbsII';
import SocialAlphaPulse from '../viz/SocialAlphaPulse';
import { ContextPanel, StatusPanel } from '../components/TradePanelPrimitives';

/** #warriors — primary 27-panel control room (replaces former `ControlRoom27.jsx` route). */
export default function ControlRoomKnightsPage() {
  const DS = 'http://127.0.0.1:8000';
  const [activity, setActivity] = useState<any>(null);
  const [sentiment, setSentiment] = useState<any>(null);
  const [newsTop, setNewsTop] = useState('NEWS FETCH ERROR — CHECK API KEY / CORS.');
  const [uiLock, setUiLock] = useState(false);
  const [serverLock, setServerLock] = useState(false);
  const [haltLock, setHaltLock] = useState(false);
  const [lockUpdatedAt, setLockUpdatedAt] = useState<string | null>(null);
  const [lockSource, setLockSource] = useState('—');

  useEffect(() => {
    const load = () => {
      fetch(`${DS}/v1/ai/activity/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setActivity(d); }).catch(() => {});
      fetch(`${DS}/v1/ai/sentiment/`).then(r => r.ok ? r.json() : null).then(d => {
        if (d) setSentiment(d);
        const s = d?.summary?.top_signal || d?.summary?.note || '';
        if (s) setNewsTop(String(s).slice(0, 40));
      }).catch(() => {});
      fetch(`${DS}/v1/control/halt-lock/`).then(r => r.ok ? r.json() : null).then((d) => {
        if (!d) return;
        if (typeof d.ui_lock === 'boolean') setUiLock(d.ui_lock);
        if (typeof d.terminal_lock === 'boolean') setServerLock(d.terminal_lock);
        if (typeof d.halt_lock === 'boolean') setHaltLock(d.halt_lock);
        setLockUpdatedAt(typeof d.updated_at === 'string' ? d.updated_at : null);
        setLockSource(typeof d.updated_source === 'string' ? d.updated_source.toUpperCase() : '—');
      }).catch(() => {});
    };
    load();
    const id = window.setInterval(load, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const dirRaw = ((activity?.direction ?? 'neutral') as string).toLowerCase();
  const socialData = useMemo(() => ({
    direction: dirRaw === 'long' || dirRaw === 'bullish' ? 'bullish' : dirRaw === 'short' || dirRaw === 'bearish' ? 'bearish' : 'neutral',
    energy: Number(activity?.energy ?? activity?.jedi_score ?? 54),
    velocity: Math.max(0, Math.min(1, Number(activity?.velocity ?? 0.37))),
    velocityAccel: Number(activity?.velocity_accel ?? 0.2),
    confidence: Math.max(0, Math.min(1, Number(activity?.confidence ?? 0.54))),
    sentimentStrength: Math.max(0, Math.min(1, Number(activity?.sentiment_strength ?? 0.62))),
    influenceScore: Math.max(0, Math.min(1, Number(activity?.influence_score ?? 0.44))),
    noiseBlocked: Math.max(0, Number(activity?.noise_blocked ?? 14)),
    noiseTypes: ['X', 'GROK'],
    rawSignalCount: Number(activity?.raw_signal_count ?? 81),
    cleanSignalCount: Number(activity?.clean_signal_count ?? 43),
    crossVerified: true,
    lastUpdated: new Date().toLocaleTimeString(),
    symbol: 'SPY',
    alphaItems: [
      { text: newsTop, strength: 0.72, verified: true, tag: 'NEWS' },
      { text: 'USING INTERNAL MARKET CONTEXT FALLBACK.', strength: 0.58, verified: false, tag: 'MACRO' },
    ],
  }), [activity, dirRaw, newsTop]);

  const regime = String(activity?.regime ?? 'LOW_VOL');
  const loopPhase = String(activity?.loop_phase ?? 'FETCHING');
  const drawdown = Number(activity?.drawdown_pct ?? 0.89);
  const runPath = activity?.ok === false ? 'DEGRADED' : 'ACTIVE';
  const pulseDir = socialData.direction === 'bullish' ? 'LONG' : socialData.direction === 'bearish' ? 'SHORT' : 'FLAT';
  const alertHot = Number(activity?.jedi_score ?? socialData.energy ?? 0) >= 18 || String(activity?.gate_label ?? '').toUpperCase() === 'HOT';
  return (
    <div className="viz-center-page viz-center-page--control27" style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      {/* Top orb monitor strip (PULSE identity) */}
      <section
        aria-label="Pulse top context orbs"
        style={{
          flex: '0 0 auto',
          border: '1px solid #1e3a4a',
          borderRadius: 10,
          background: '#050a12',
          padding: '6px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          overflowX: 'auto',
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <PriceOrb
            direction={pulseDir}
            candles={[]}
            vwap={Number(activity?.vwap ?? 0)}
            bid={Number(activity?.bid ?? 0)}
            ask={Number(activity?.ask ?? 0)}
          />
          <ConfluenceOrb
            direction={pulseDir}
            bankAScore={Math.max(-1, Math.min(1, Number(activity?.bank_a_score ?? (socialData.energy - 50) / 50)))}
            bankBScore={Math.max(-1, Math.min(1, Number(activity?.bank_b_score ?? socialData.velocity)))}
            bankCScore={Math.max(-1, Math.min(1, Number(activity?.bank_c_score ?? socialData.influenceScore)))}
            kellyFire={socialData.confidence >= 65 && socialData.energy >= 65}
          />
          <RiskOrb
            direction={pulseDir}
            pnl={Number(activity?.paper_pnl ?? 0)}
            pnlMax={Math.max(1, Number(activity?.paper_pnl_max ?? 500))}
            drawdown={Math.max(0, Math.min(1, drawdown / 3))}
            maxDrawdown={Math.max(0, Math.min(1, Number(activity?.max_drawdown ?? drawdown / 2)))}
            positionSize={Math.max(0, Math.min(1, Number(activity?.position_size ?? 0.35)))}
          />
          <VolumeOrb
            direction={pulseDir}
            delta={Math.max(-1, Math.min(1, Number(activity?.delta ?? 0)))}
            cumDelta={Math.max(-1, Math.min(1, Number(activity?.cum_delta ?? 0)))}
            absorption={Math.max(0, Math.min(1, Number(activity?.absorption ?? socialData.influenceScore)))}
            tapeSpeed={Math.max(0.2, Math.min(1, Number(activity?.tape_speed ?? socialData.velocity)))}
          />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, color: uiLock ? '#f59e0b' : '#64748b', border: `1px solid ${uiLock ? '#f59e0b66' : '#33415566'}`, borderRadius: 8, padding: '1px 6px' }}>
            UI {uiLock ? 'ON' : 'OFF'}
          </span>
          <span style={{ fontSize: 9, color: serverLock ? '#ef4444' : '#64748b', border: `1px solid ${serverLock ? '#ef444466' : '#33415566'}`, borderRadius: 8, padding: '1px 6px' }}>
            SERVER {serverLock ? 'ON' : 'OFF'}
          </span>
          <span style={{ fontSize: 9, color: haltLock ? '#ef4444' : '#22c55e', border: `1px solid ${haltLock ? '#ef444466' : '#22c55e66'}`, borderRadius: 8, padding: '1px 6px' }}>
            HALT {haltLock ? 'ON' : 'OFF'}
          </span>
          <span style={{ fontSize: 9, color: '#64748b', border: '1px solid #33415566', borderRadius: 8, padding: '1px 6px' }}>
            SRC {lockSource}
          </span>
          <span style={{ fontSize: 9, color: '#64748b' }}>
            {(() => {
              if (!lockUpdatedAt) return 'age —';
              const ms = Date.now() - Date.parse(lockUpdatedAt);
              if (!Number.isFinite(ms) || ms < 0) return 'age —';
              return `age ${Math.floor(ms / 60000)}m`;
            })()}
          </span>
          <span
            style={{
              fontSize: 10,
              color: alertHot ? '#f59e0b' : '#22c55e',
              fontWeight: 700,
              letterSpacing: 1.2,
              textShadow: alertHot ? '0 0 10px rgba(245,158,11,0.7)' : 'none',
              animation: alertHot ? 'blink 1s ease-in-out infinite' : 'none',
            }}
          >
            {alertHot ? 'BUZZ · PRIORITY RISE' : 'MONITOR STABLE'}
          </span>
          <button
            onClick={() => {
              window.location.hash = 'trader';
            }}
            style={{
              border: '1px solid #22c55e',
              background: '#0b2414',
              color: '#22c55e',
              borderRadius: 4,
              padding: '3px 8px',
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            OPEN TRADER
          </button>
          <button
            onClick={() => {
              window.location.hash = 'star';
            }}
            style={{
              border: '1px solid #f0c030',
              background: '#2a2108',
              color: '#f0c030',
              borderRadius: 4,
              padding: '3px 8px',
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            OPEN DEATH STAR
          </button>
        </div>
      </section>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
        <section aria-label="Social and priority row" style={{ margin: '0.4rem 0 0.8rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            <section className="mission-council__social-alpha" aria-label="Social alpha pulse" style={{ margin: 0 }}>
              <div className="mission-council__social-alpha-frame">
                <SocialAlphaPulse
                  data={socialData}
                  maAligned={socialData.energy >= 50}
                  macroAligned={regime !== 'FOMC_FLAT'}
                  showSignalGates={false}
                />
              </div>
            </section>

            <StatusPanel title="SYSTEM VISIBILITY" hint="Execution + state trace">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 9, color: '#7f96aa' }}>Run Path</span><span style={{ fontSize: 10, color: runPath === 'ACTIVE' ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{runPath}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 9, color: '#7f96aa' }}>Exec Loop</span><span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 700 }}>{loopPhase}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 9, color: '#7f96aa' }}>Regime</span><span style={{ fontSize: 10, color: '#93c5fd', fontWeight: 700 }}>{regime}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 9, color: '#7f96aa' }}>Drawdown</span><span style={{ fontSize: 10, color: drawdown > 2 ? '#ef4444' : '#22c55e', fontWeight: 700 }}>{drawdown.toFixed(2)}%</span></div>
            </StatusPanel>

            <ContextPanel title="LIVE PRIORITY" hint="Immediate operator focus">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 9, color: '#7f96aa' }}>Top Signal</span><span style={{ fontSize: 10, color: '#d7e7f7', fontWeight: 700, maxWidth: 180, textAlign: 'right' }}>{newsTop.slice(0, 26)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 9, color: '#7f96aa' }}>Direction</span><span style={{ fontSize: 10, color: '#22d3ee', fontWeight: 700 }}>{socialData.direction.toUpperCase()}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 9, color: '#7f96aa' }}>Energy</span><span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>{Math.abs(socialData.energy).toFixed(0)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 9, color: '#7f96aa' }}>Confidence</span><span style={{ fontSize: 10, color: '#38bdf8', fontWeight: 700 }}>{Math.round(socialData.confidence * 100)}%</span></div>
            </ContextPanel>
          </div>
        </section>

        <MaxCogVizKnights />
      </div>
    </div>
  );
}
