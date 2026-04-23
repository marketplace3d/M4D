import { useEffect, useMemo, useState } from 'react';
import type { Bar } from '$indicators/boom3d-tech';
import { defaultControlsAllOff, type ChartControls } from '@pwa/lib/chartControls';
import BoomLwChart from '../components/BoomLwChart';
import { XSentinelOrb, CouncilOrb, JediMasterOrb } from '../viz/MaxCogVizOrbs.jsx';
import { ConfluenceOrb, PriceOrb, RiskOrb, TVWebhookOrb, VolumeOrb } from '../viz/MaxCogVizOrbsII';
import '/src/pages/TradeBotPage.css';

type MarketKey = 'SPX' | 'NDX' | 'DOW';

const MARKET_TICKERS: Record<MarketKey, { label: string; polygon: string }> = {
  SPX: { label: 'SPX (SPY)', polygon: 'SPY' },
  NDX: { label: 'NDX (QQQ)', polygon: 'QQQ' },
  DOW: { label: 'DOW (DIA)', polygon: 'DIA' },
};

const ALL_PANELS = Array.from({ length: 27 }, (_, i) => ({ id: `P${i + 1}` }));

async function fetchTickerBars(polygonTicker: string): Promise<Bar[]> {
  const to = new Date();
  const from = new Date(to.getTime() - 5 * 24 * 60 * 60 * 1000);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  const path = `/v2/aggs/ticker/${encodeURIComponent(polygonTicker)}/range/5/minute/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=50000`;
  const url = `/api/polygon${path}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Polygon ${r.status}`);
  const j = (await r.json()) as {
    results?: { t: number; o: number; h: number; l: number; c: number; v?: number }[];
  };
  return (j.results ?? []).map((row) => ({
    time: Math.floor(row.t / 1000),
    open: row.o,
    high: row.h,
    low: row.l,
    close: row.c,
    volume: row.v ?? 0,
  }));
}

export default function TradeBotPage() {
  const [market, setMarket] = useState<MarketKey>('SPX');
  const [tslaBars, setTslaBars] = useState<Bar[]>([]);
  const [marketBars, setMarketBars] = useState<Bar[]>([]);
  const [err, setErr] = useState('');
  const [pulse, setPulse] = useState(0);

  const chartControls: ChartControls = useMemo(
    () => ({ ...defaultControlsAllOff, showGrid: true, squeezePurpleBg: true, squeezePurpleOpacity: 18 }),
    []
  );

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [tsla, mkt] = await Promise.all([
          fetchTickerBars('TSLA'),
          fetchTickerBars(MARKET_TICKERS[market].polygon),
        ]);
        if (!alive) return;
        setTslaBars(tsla);
        setMarketBars(mkt);
        setErr('');
      } catch (e) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const iv = window.setInterval(() => {
      setPulse((p) => p + 1);
      void load();
    }, 15000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, [market]);

  const direction = useMemo(() => {
    const first = tslaBars[0]?.close ?? 0;
    const last = tslaBars[tslaBars.length - 1]?.close ?? 0;
    if (!first || !last) return 'FLAT';
    if (last > first * 1.002) return 'LONG';
    if (last < first * 0.998) return 'SHORT';
    return 'FLAT';
  }, [tslaBars]);

  const score = useMemo(() => {
    const first = tslaBars[0]?.close ?? 0;
    const last = tslaBars[tslaBars.length - 1]?.close ?? 0;
    if (!first || !last) return 0;
    const pct = ((last - first) / first) * 100;
    return Math.max(-27, Math.min(27, Math.round(pct * 8)));
  }, [tslaBars]);

  const conviction = Math.max(0, Math.min(100, Math.round((Math.abs(score) / 27) * 100)));

  const priceCandles = useMemo(
    () =>
      tslaBars.slice(-7).map((b) => ({
        o: b.open,
        h: b.high,
        l: b.low,
        c: b.close,
      })),
    [tslaBars]
  );

  const votes = useMemo(() => {
    const v: Record<string, number> = {};
    for (let i = 0; i < 27; i++) {
      const c = tslaBars[Math.max(0, tslaBars.length - 1 - i)]?.close ?? 0;
      const p = tslaBars[Math.max(0, tslaBars.length - 2 - i)]?.close ?? c;
      v[`P${i + 1}`] = c > p ? 1 : c < p ? -1 : 0;
    }
    return v;
  }, [tslaBars]);

  const strengths = useMemo(() => {
    const s: Record<string, number> = {};
    for (let i = 0; i < 27; i++) {
      const c = tslaBars[Math.max(0, tslaBars.length - 1 - i)]?.close ?? 0;
      const p = tslaBars[Math.max(0, tslaBars.length - 2 - i)]?.close ?? c;
      const ratio = p !== 0 ? Math.abs((c - p) / p) : 0;
      s[`P${i + 1}`] = Math.max(0.15, Math.min(0.95, ratio * 120));
    }
    return s;
  }, [tslaBars]);

  return (
    <div className="trade-fire-page">
      <section className="trade-fire-shell">
        <main className="trade-fire-main">
          <div className="trade-fire-charts">
            <article className="trade-fire-card">
              <div className="trade-fire-card__title">TVLW · TSLA</div>
              <div className="trade-fire-chart">
                {tslaBars.length > 0 ? <BoomLwChart bars={tslaBars} controls={chartControls} compactUi /> : <p>Loading TSLA...</p>}
              </div>
            </article>
            <article className="trade-fire-card">
              <div className="trade-fire-card__row">
                <div className="trade-fire-card__title">TVLW · MARKET</div>
                <div className="trade-fire-tabs">
                  {(Object.keys(MARKET_TICKERS) as MarketKey[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setMarket(k)}
                      className={market === k ? 'is-active' : ''}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div className="trade-fire-chart">
                {marketBars.length > 0 ? <BoomLwChart bars={marketBars} controls={chartControls} compactUi /> : <p>Loading market...</p>}
              </div>
            </article>
          </div>
          {err ? <p className="trade-fire-err">{err}</p> : null}
        </main>

        <aside className="trade-fire-orbs">
          <div className="trade-fire-orb-row trade-fire-orb-row--core">
            <XSentinelOrb
              data={{
                energy: Math.round((Math.abs(score) / 27) * 100),
                direction: direction === 'LONG' ? 'bullish' : direction === 'SHORT' ? 'bearish' : 'neutral',
                velocity: Math.min(1, Math.abs(score) / 18),
                confidence: conviction / 100,
                sentiment: conviction / 100,
                influence: 0.72,
                noiseBlocked: 2,
              }}
              direction={direction}
            />
            <CouncilOrb
              score={score}
              direction={direction}
              votes={votes}
              strengths={strengths}
              bankANet={Math.round(score * 0.4)}
              bankBNet={Math.round(score * 0.35)}
              bankCNet={Math.round(score * 0.25)}
              conviction={conviction}
              allPanels={ALL_PANELS as any}
            />
            <JediMasterOrb score={score} direction={direction} conviction={conviction} />
          </div>

          <div className="trade-fire-indicators">
            <span className="trade-fire-indicator">DIR {direction}</span>
            <span className="trade-fire-indicator">SCORE {score > 0 ? `+${score}` : score}</span>
            <span className="trade-fire-indicator">CONVICTION {conviction}%</span>
            <span className="trade-fire-indicator">PULSE {pulse}</span>
            <span className="trade-fire-indicator">MARKET {market}</span>
          </div>

          <div className="trade-fire-orb-row trade-fire-orb-row--new">
            <PriceOrb
              candles={priceCandles}
              vwap={tslaBars[tslaBars.length - 1]?.close ?? 0}
              bid={(tslaBars[tslaBars.length - 1]?.close ?? 0) - 0.05}
              ask={(tslaBars[tslaBars.length - 1]?.close ?? 0) + 0.05}
              direction={direction}
            />
            <RiskOrb
              pnl={Math.round(score * 18)}
              pnlMax={700}
              drawdown={Math.max(0, (50 - conviction) / 100)}
              maxDrawdown={0.42}
              positionSize={Math.min(1, conviction / 100)}
              direction={direction}
            />
            <ConfluenceOrb
              bankAScore={Math.round(score * 0.4) / 9}
              bankBScore={Math.round(score * 0.35) / 9}
              bankCScore={Math.round(score * 0.25) / 9}
              kellyFire={conviction > 60}
              direction={direction}
            />
            <VolumeOrb
              delta={Math.max(-1, Math.min(1, score / 27))}
              cumDelta={Math.max(-1, Math.min(1, score / 20))}
              absorption={Math.min(1, conviction / 100)}
              tapeSpeed={0.55 + (pulse % 5) * 0.08}
              direction={direction}
            />
            <TVWebhookOrb
              connected
              lastFiredMs={(pulse % 35) * 1000}
              latencyMs={45 + (pulse % 8) * 18}
              action={direction === 'LONG' ? 'BUY' : direction === 'SHORT' ? 'SELL' : 'IDLE'}
              fireCount={pulse}
            />
          </div>
        </aside>
      </section>
    </div>
  );
}
