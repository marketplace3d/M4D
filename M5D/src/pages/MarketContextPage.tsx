import { useEffect, useMemo, useRef, useState } from 'react'
import { useBreakpoint } from '../hooks/useBreakpoint'
import type { ActivityReport, CouncilSnapshot, GateReport } from '../types'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'tv-market-summary': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { direction?: 'horizontal' | 'vertical' },
        HTMLElement
      >
    }
  }
}

function TvWidget({
  scriptSrc,
  config,
  minHeight = 260,
}: {
  scriptSrc: string
  config: Record<string, unknown>
  minHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const configJson = useMemo(() => JSON.stringify(config), [config])

  useEffect(() => {
    const host = ref.current
    if (!host) return
    host.innerHTML = ''

    const wrap = document.createElement('div')
    wrap.className = 'tradingview-widget-container'
    wrap.style.height = '100%'

    const widget = document.createElement('div')
    widget.className = 'tradingview-widget-container__widget'
    widget.style.height = '100%'
    wrap.appendChild(widget)

    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.src = scriptSrc
    script.async = true
    script.innerHTML = configJson
    wrap.appendChild(script)

    host.appendChild(wrap)
    return () => {
      host.innerHTML = ''
    }
  }, [scriptSrc, configJson])

  return <div ref={ref} style={{ minHeight, height: '100%', width: '100%' }} />
}

function TvMarketSummaryBar() {
  const hostRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const id = 'tv-market-summary-module-m5d'
    const src = 'https://widgets.tradingview-widget.com/w/en/tv-market-summary.js'
    const existing = document.getElementById(id) as HTMLScriptElement | null
    const apply = () => {
      if (!hostRef.current) return
      hostRef.current.setAttribute('direction', 'horizontal')
      hostRef.current.setAttribute('color-theme', 'dark')
      hostRef.current.setAttribute('is-transparent', 'false')
      hostRef.current.setAttribute('background-color', '#131722')
      hostRef.current.style.display = 'block'
      hostRef.current.style.minHeight = '146px'
      hostRef.current.style.background = '#131722'
      hostRef.current.style.colorScheme = 'dark'
    }
    if (existing?.dataset.ready === '1') {
      apply()
      return
    }
    const script = existing ?? document.createElement('script')
    script.id = id
    script.type = 'module'
    script.src = src
    script.async = true
    script.onload = () => {
      script.dataset.ready = '1'
      apply()
    }
    if (!existing) document.head.appendChild(script)
  }, [])
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 3, background: '#131722', overflow: 'hidden', minHeight: 146, colorScheme: 'dark' }}>
      <tv-market-summary
        ref={hostRef}
        direction="horizontal"
        color-theme="dark"
        is-transparent="false"
        background-color="#131722"
      />
    </div>
  )
}

interface Props {
  council: CouncilSnapshot | null
  activity: ActivityReport | null
  gateReport: GateReport | null
}

export default function MarketContextPage({ council, activity, gateReport }: Props) {
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const isTablet = bp === 'tablet'
  const now = new Date().toLocaleTimeString()
  const jedi = Math.round(council?.jedi_score ?? 0)
  const direction = jedi > 0 ? 'BULLISH' : jedi < 0 ? 'BEARISH' : 'FLAT'
  const conf = Math.min(99, Math.max(20, 40 + Math.abs(jedi)))
  const energy = Math.min(100, Math.max(10, Math.round((activity?.activity_score ?? 0.5) * 100)))
  const velocity = Math.min(100, Math.max(5, Math.round((activity?.tick_score ?? 0.45) * 100)))
  const rawSignals = council?.algos?.length ? 100 + council.algos.length : 127
  const cleanSignals = Math.max(10, Math.round(rawSignals * (conf / 100) * 0.6))
  const bankA = (council?.algos ?? []).filter(a => a.tier === 'BOOM')
  const bankB = (council?.algos ?? []).filter(a => a.tier === 'STRAT')
  const bankC = (council?.algos ?? []).filter(a => a.tier === 'LEGEND')
  const countVotes = (arr: typeof bankA) => ({
    long: arr.filter(a => a.vote === 1).length,
    short: arr.filter(a => a.vote === -1).length,
    flat: arr.filter(a => a.vote === 0).length,
  })
  const aVotes = countVotes(bankA)
  const bVotes = countVotes(bankB)
  const cVotes = countVotes(bankC)
  const gateOn = gateReport?.gates?.filter(g => g.enabled).length ?? 0
  const [bankView, setBankView] = useState<'ALL' | 'A' | 'B' | 'C'>('ALL')
  const viewAlgos = bankView === 'A'
    ? bankA
    : bankView === 'B'
      ? bankB
      : bankView === 'C'
        ? bankC
        : [...bankA, ...bankB, ...bankC]
  const fallbackByBank: Record<'ALL' | 'A' | 'B' | 'C', string[]> = {
    ALL: ['NS', 'CI', 'BQ', 'CC', 'WH', 'SA', 'HK', 'GO', 'EF', '8E', 'VT', 'MS', 'DP', 'WS', 'RV', 'HL', 'AI', 'VK', 'SE', 'IC', 'WN', 'CA', 'TF', 'RT', 'MM', 'OR', 'DV'],
    A: ['NS', 'CI', 'BQ', 'CC', 'WH', 'SA', 'HK', 'GO', 'EF'],
    B: ['8E', 'VT', 'MS', 'DP', 'WS', 'RV', 'HL', 'AI', 'VK'],
    C: ['SE', 'IC', 'WN', 'CA', 'TF', 'RT', 'MM', 'OR', 'DV'],
  }
  const visibleAlgos = viewAlgos.length
    ? viewAlgos
    : fallbackByBank[bankView].map((id) => ({ id, vote: 0 as const, tier: bankView === 'A' ? 'BOOM' : bankView === 'B' ? 'STRAT' : bankView === 'C' ? 'LEGEND' : 'MIX', name: id, score: 0, win_rate: 0 }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 18 }}>
      <div
        style={{
          padding: '6px 10px',
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 3,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontFamily: 'var(--font-mono)',
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.14em' }}>
            ① MARKET
          </span>
          <span style={{ fontSize: 9, color: 'var(--text3)', marginLeft: 12 }}>
            CLEAN CONTEXT · RESPONSIVE WIDGET SURFACE
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className="m5d-badge green">LIVE: TV WIDGETS</span>
          <span className="m5d-badge blue">NATIVE: M5D</span>
          <span className="m5d-badge gray">RESPONSIVE</span>
        </div>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg1)', overflow: 'hidden' }}>
        <TvWidget
          scriptSrc="https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js"
          minHeight={54}
          config={{
            symbols: [
              { proName: 'FOREXCOM:SPXUSD', title: 'S&P 500' },
              { proName: 'FOREXCOM:NSXUSD', title: 'US 100' },
              { proName: 'FX:EURUSD', title: 'EURUSD' },
              { proName: 'BITSTAMP:BTCUSD', title: 'BTCUSD' },
              { proName: 'BITSTAMP:ETHUSD', title: 'ETHUSD' },
              { proName: 'TVC:GOLD', title: 'GOLD' },
            ],
            colorTheme: 'dark',
            isTransparent: true,
            showSymbolLogo: true,
            displayMode: 'adaptive',
            locale: 'en',
          }}
        />
      </div>

      <TvMarketSummaryBar />

      <div
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        }}
      >
        <div style={{ border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg1)', overflow: 'hidden', minHeight: 340 }}>
          <TvWidget
            scriptSrc="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
            minHeight={340}
            config={{
              autosize: true,
              symbol: 'CAPITALCOM:US500',
              interval: '15',
              timezone: 'Etc/UTC',
              theme: 'dark',
              style: '1',
              details: false,
              hotlist: true,
              hide_side_toolbar: true,
              hide_top_toolbar: false,
              hide_legend: false,
              hide_volume: true,
              locale: 'en',
              allow_symbol_change: true,
              save_image: true,
              calendar: false,
              backgroundColor: 'rgba(0, 0, 0, 1)',
              gridColor: 'rgba(0, 0, 0, 0.02)',
              watchlist: [],
              withdateranges: false,
              compareSymbols: [
                { symbol: 'BITSTAMP:BTCUSD', position: 'SameScale' },
                { symbol: 'PEPPERSTONE:NAS100', position: 'SameScale' },
                { symbol: 'OANDA:EURUSD', position: 'SameScale' },
                { symbol: 'OANDA:XAGUSD', position: 'SameScale' },
                { symbol: 'FOREXCOM:XAUUSD', position: 'SameScale' },
              ],
              studies: [],
              support_host: 'https://www.tradingview.com',
            }}
          />
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg1)', overflow: 'hidden', minHeight: 340 }}>
          <TvWidget
            scriptSrc="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
            minHeight={340}
            config={{
              autosize: true,
              symbol: 'PEPPERSTONE:NAS100',
              interval: '15',
              timezone: 'Etc/UTC',
              theme: 'dark',
              style: '1',
              details: false,
              hotlist: true,
              hide_side_toolbar: true,
              hide_top_toolbar: false,
              hide_legend: false,
              hide_volume: true,
              locale: 'en',
              allow_symbol_change: true,
              save_image: true,
              calendar: false,
              backgroundColor: 'rgba(0, 0, 0, 1)',
              gridColor: 'rgba(0, 0, 0, 0.02)',
              watchlist: [],
              withdateranges: false,
              compareSymbols: [
                { symbol: 'BITSTAMP:BTCUSD', position: 'SameScale' },
                { symbol: 'PEPPERSTONE:NAS100', position: 'SameScale' },
                { symbol: 'OANDA:EURUSD', position: 'SameScale' },
                { symbol: 'OANDA:XAGUSD', position: 'SameScale' },
                { symbol: 'FOREXCOM:XAUUSD', position: 'SameScale' },
              ],
              studies: [],
              support_host: 'https://www.tradingview.com',
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: isMobile ? '1fr' : isTablet ? '1fr' : 'repeat(3, minmax(0, 1fr))',
        }}
      >
        <div style={{ border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg1)', overflow: 'hidden', minHeight: 360, display: 'flex' }}>
          <TvWidget
            scriptSrc="https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js"
            minHeight={360}
            config={{
              colorTheme: 'dark',
              exchanges: ['NASDAQ', 'NYSE'],
              dataSource: 'SPX500',
              grouping: 'sector',
              blockSize: 'market_cap_basic',
              blockColor: 'change',
              locale: 'en',
              isTransparent: true,
              hasTopBar: false,
              isDataSetEnabled: false,
              width: '100%',
              height: '100%',
            }}
          />
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg1)', overflow: 'hidden', minHeight: 360, display: 'flex' }}>
          <TvWidget
            scriptSrc="https://s3.tradingview.com/external-embedding/embed-widget-timeline.js"
            minHeight={360}
            config={{
              displayMode: 'regular',
              feedMode: 'all_symbols',
              colorTheme: 'dark',
              isTransparent: false,
              locale: 'en',
              width: '100%',
              height: '100%',
            }}
          />
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg1)', overflow: 'hidden', minHeight: 360, display: 'flex' }}>
          <TvWidget
            scriptSrc="https://s3.tradingview.com/external-embedding/embed-widget-etf-heatmap.js"
            minHeight={360}
            config={{
              dataSource: 'AllUSEtf',
              blockSize: 'volume',
              blockColor: 'change',
              grouping: 'asset_class',
              colorTheme: 'dark',
              backgroundColor: 'rgba(0,0,0,1)',
              isTransparent: false,
              locale: 'en',
              symbolUrl: '',
              hasTopBar: false,
              isDataSetEnabled: false,
              isZoomEnabled: true,
              hasSymbolTooltip: true,
              isMonoSize: false,
              width: '100%',
              height: '100%',
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: isMobile ? '1fr' : isTablet ? '1fr' : 'repeat(3, minmax(0, 1fr))',
        }}
      >
        <div style={{ border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg1)', padding: '8px 10px', minHeight: 360 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em' }}>SOCIAL ALPHA PULSE</div>
            <span className="m5d-badge blue">X/GROK INTELLIGENCE</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,minmax(0,1fr))', gap: 6 }}>
            {[
              { k: 'DIR', v: direction, c: direction === 'BULLISH' ? 'var(--greenB)' : direction === 'BEARISH' ? 'var(--redB)' : 'var(--text2)' },
              { k: 'ENERGY', v: `${energy}`, c: 'var(--goldB)' },
              { k: 'VELOCITY', v: `${velocity}%`, c: 'var(--accent)' },
              { k: 'CONF', v: `${conf}%`, c: 'var(--greenB)' },
              { k: 'RAW', v: `${rawSignals}`, c: 'var(--text)' },
              { k: 'CLEAN', v: `${cleanSignals}`, c: 'var(--tealB)' },
            ].map(x => (
              <div key={x.k} style={{ border: '1px solid var(--border)', borderRadius: 2, padding: '4px 6px', background: 'var(--bg2)' }}>
                <div style={{ fontSize: 7, color: 'var(--text3)' }}>{x.k}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: x.c }}>{x.v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 8, color: 'var(--text2)', lineHeight: 1.6 }}>
            <div>NEWS: Three medical shops sealed during special drive</div>
            <div>MACRO: Snow deadline risk ahead of April 27</div>
            <div>FLOW: Tehran-Washington standoff updates</div>
            <div>TECH: Ozempic/Mounjaro lookism trend</div>
            <div>CATALYST: Prediction market restrictions</div>
            <div>RISK: Oil spike capital flow rotations</div>
          </div>
          <div style={{ marginTop: 6, fontSize: 8, color: 'var(--text3)' }}>M4D SOCIAL ALPHA PULSE · X/GROK · {now}</div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg1)', overflow: 'hidden', minHeight: 360, display: 'flex' }}>
          <TvWidget
            scriptSrc="https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js"
            minHeight={360}
            config={{
              colorTheme: 'dark',
              dateRange: '12M',
              showChart: true,
              locale: 'en',
              largeChartUrl: '',
              isTransparent: false,
              showSymbolLogo: true,
              showFloatingTooltip: false,
              width: '100%',
              height: '100%',
              tabs: [
                {
                  title: 'Indices',
                  symbols: [
                    { s: 'FOREXCOM:SPXUSD', d: 'S&P 500' },
                    { s: 'FOREXCOM:NSXUSD', d: 'US 100' },
                    { s: 'FOREXCOM:DJI', d: 'Dow 30' },
                  ],
                },
                {
                  title: 'Forex',
                  symbols: [
                    { s: 'FX:EURUSD', d: 'EURUSD' },
                    { s: 'FX:GBPUSD', d: 'GBPUSD' },
                    { s: 'FX:USDJPY', d: 'USDJPY' },
                  ],
                },
              ],
            }}
          />
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg1)', overflow: 'hidden', minHeight: 360, display: 'flex' }}>
          <TvWidget
            scriptSrc="https://s3.tradingview.com/external-embedding/embed-widget-events.js"
            minHeight={360}
            config={{
              colorTheme: 'dark',
              isTransparent: false,
              locale: 'en',
              countryFilter: 'us',
              importanceFilter: '0,1',
              width: '100%',
              height: '100%',
            }}
          />
        </div>
      </div>

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 3,
          background: 'var(--bg1)',
          padding: '8px 10px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em' }}>PULSE · ON MARKET</div>
          <span className="m5d-badge green">{gateOn}/10 GATES</span>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
          {(['ALL', 'A', 'B', 'C'] as const).map(k => (
            <button
              key={k}
              onClick={() => setBankView(k)}
              style={{
                padding: '3px 8px',
                borderRadius: 2,
                border: `1px solid ${bankView === k ? 'var(--accent)' : 'var(--border)'}`,
                background: bankView === k ? 'rgba(58,143,255,0.14)' : 'var(--bg3)',
                color: bankView === k ? 'var(--accent)' : 'var(--text2)',
                fontFamily: 'var(--font-mono)',
                fontSize: 8,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {k === 'ALL' ? 'ALL' : `BANK ${k}`}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 6, marginBottom: 8 }}>
          {[
            { title: 'BANK A', v: aVotes, sig: bankA.length, c: 'var(--accent)' },
            { title: 'BANK B', v: bVotes, sig: bankB.length, c: 'var(--goldB)' },
            { title: 'BANK C', v: cVotes, sig: bankC.length, c: 'var(--purpleB)' },
          ].map(row => (
            <div key={row.title} style={{ border: '1px solid var(--border)', borderRadius: 3, padding: '5px 6px', background: 'var(--bg2)' }}>
              <div style={{ fontSize: 8, color: row.c, fontWeight: 700 }}>{row.title}</div>
              <div style={{ display: 'flex', gap: 6, fontSize: 8, marginTop: 3 }}>
                <span style={{ color: 'var(--greenB)' }}>{row.v.long}L</span>
                <span style={{ color: 'var(--redB)' }}>{row.v.short}S</span>
                <span style={{ color: 'var(--text3)' }}>{row.v.flat}F</span>
                <span style={{ color: 'var(--text2)' }}>{row.sig}</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg2)', padding: '5px 6px' }}>
          <div style={{ display: 'flex', gap: 4, minWidth: 680 }}>
            {visibleAlgos.map((a) => {
              const voteColor = a.vote === 1 ? 'var(--greenB)' : a.vote === -1 ? 'var(--redB)' : 'var(--text3)'
              const voteBg = a.vote === 1 ? 'rgba(29,255,122,0.12)' : a.vote === -1 ? 'rgba(255,74,90,0.12)' : 'var(--bg3)'
              return (
                <div
                  key={a.id}
                  title={`${a.name} · ${a.tier} · score ${a.score.toFixed(2)}`}
                  style={{
                    minWidth: 86,
                    border: `1px solid ${a.vote === 1 ? 'var(--green)' : a.vote === -1 ? 'var(--red)' : 'var(--border)'}`,
                    borderRadius: 2,
                    background: voteBg,
                    padding: '4px 5px',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, marginBottom: 2 }}>
                    <span style={{ color: 'var(--text2)' }}>{a.id}</span>
                    <span style={{ color: voteColor, fontWeight: 700 }}>{a.vote === 1 ? '▲' : a.vote === -1 ? '▼' : '■'}</span>
                  </div>
                  <div style={{ fontSize: 7, color: 'var(--text3)' }}>{a.tier}</div>
                  <div style={{ fontSize: 8, color: voteColor, fontWeight: 700 }}>{Math.round(a.win_rate * 100)}%</div>
                </div>
              )
            })}
          </div>
          {!viewAlgos.length && (
            <div style={{ marginTop: 6, fontSize: 7, color: 'var(--goldB)' }}>
              COUNCIL FEED OFFLINE — showing fallback roster.
            </div>
          )}
        </div>

        <div style={{ marginTop: 8, fontSize: 8, color: 'var(--text3)' }}>
          PULSE MOBILE grid synced with `#pulse` · FULL-PAGE PULSE
        </div>
      </div>
    </div>
  )
}
