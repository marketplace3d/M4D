import { useState, useEffect, useCallback } from 'react'
import './theme.scss'
import type { Theme, PageId } from './types'
import type { TextScale } from './layout/TopBar'
import { useCouncil, useCrossAsset, useActivity, usePaperStatus, useGateReport } from './api/client'
import { useBreakpoint } from './hooks/useBreakpoint'
import TopBar from './layout/TopBar'
import LeftNav from './layout/LeftNav'
import RightRail from './layout/RightRail'
import BottomTabBar from './layout/BottomTabBar'
import SurfacingPanel from './components/SurfacingPanel'
import MarketPage from './pages/MarketPage'
import MarketContextPage from './pages/MarketContextPage'
import PulsePage from './pages/PulsePage'
import TradePage from './pages/TradePage'
import IctSmcPage from './pages/IctSmcPage'
import StarRayPage from './pages/StarRayPage'
import PerfPage from './pages/PerfPage'
import AlphaSeekPage from './pages/AlphaSeekPage'
import MedallionPage from './pages/MedallionPage'
import ObiPage from './pages/ObiPage'
import BacktestLabPage from './pages/BacktestLabPage'
import TradeLabPage from './pages/TradeLabPage'
import BtcPage from './pages/BtcPage'

function defaultTextScaleForViewport(): TextScale {
  const w = window.innerWidth
  const h = window.innerHeight
  // 1080/laptop screens: default compact.
  if (h <= 1100 || w <= 1600) return 0.85
  // 4K and ultra-wide: keep standard baseline.
  return 1.0
}

export default function App() {
  const [theme, setTheme]           = useState<Theme>('navy-subtle')
  const VALID_PAGES: PageId[] = ['market','market-audit','pulse','trade','ict-smc','starray','perf','alphaseek','medallion','obi','trade-lab','backtest-lab','btc']
  const [page, setPage] = useState<PageId>(() => {
    const hash = window.location.hash.slice(1) as PageId
    if (VALID_PAGES.includes(hash)) return hash
    const stored = localStorage.getItem('m5d.page') as PageId | null
    return stored && VALID_PAGES.includes(stored) ? stored : 'market'
  })
  const navigate = useCallback((next: PageId) => {
    setPage(next)
    window.location.hash = next
    localStorage.setItem('m5d.page', next)
  }, [])
  const [textScale, setTextScale]   = useState<TextScale>(() => {
    const raw = localStorage.getItem('m5d.textScale')
    const s = parseFloat(raw ?? String(defaultTextScaleForViewport()))
    return ([0.85, 1.0, 1.2, 1.5] as TextScale[]).includes(s as TextScale) ? s as TextScale : 1.0
  })
  const [leftCollapsed, setLeftCollapsed] = useState(() => window.innerWidth < 1200)
  /** Right “algo status” rail: default closed; user can expand on demand. */
  const [rightOpen, setRightOpen]         = useState(false)

  const bp = useBreakpoint()

  useEffect(() => {
    if (bp === 'mobile') { setLeftCollapsed(true); setRightOpen(false) }
    if (bp === 'tablet') { setLeftCollapsed(true) }
  }, [bp])

  const council    = useCouncil()
  const crossAsset = useCrossAsset()
  const activity   = useActivity()
  const paper      = usePaperStatus()
  const gateReport = useGateReport()

  const services = {
    api:   council !== null,
    ds:    crossAsset !== null,
    paper: paper?.ok ?? false,
  }

  const jedi    = council?.jedi_score ?? null
  const regime  = council?.regime ?? null
  const actGate = activity?.gate_status ?? null
  const equity  = paper?.account?.equity ?? null
  const pnl     = paper?.account?.unrealized_pl ?? null

  const isMobile = bp === 'mobile'

  function renderPage() {
    switch (page) {
      case 'market':       return <MarketContextPage council={council} activity={activity} gateReport={gateReport} />
      case 'market-audit': return <MarketPage council={council} crossAsset={crossAsset} activity={activity} />
      case 'pulse':     return <PulsePage paper={paper} gateReport={gateReport} activity={activity} crossAsset={crossAsset} />
      case 'trade':     return <TradePage council={council} activity={activity} />
      case 'ict-smc':   return <IctSmcPage council={council} activity={activity} crossAsset={crossAsset} gateReport={gateReport} />
      case 'starray':   return <StarRayPage />
      case 'perf':      return <PerfPage />
      case 'alphaseek': return <AlphaSeekPage onPageChange={navigate} />
      case 'medallion': return <MedallionPage onPageChange={navigate} />
      case 'obi':           return <ObiPage />
      case 'trade-lab':     return <TradeLabPage />
      case 'backtest-lab':  return <BacktestLabPage />
      case 'btc':           return <BtcPage />
      default:              return null
    }
  }

  return (
    <div className={`m5d-root theme-${theme}`}>
      <TopBar
        theme={theme}
        onThemeChange={setTheme}
        textScale={textScale}
        onScaleChange={s => { setTextScale(s); localStorage.setItem('m5d.textScale', String(s)) }}
        services={services}
        jedi={jedi}
        regime={regime}
        activity={actGate}
        isMobile={isMobile}
        onMenuToggle={() => setLeftCollapsed(c => !c)}
      />

      <div className="m5d-body" style={{ zoom: textScale }}>
        {!isMobile && (
          <LeftNav
            page={page}
            onPageChange={navigate}
            theme={theme}
            gates={7}
            equity={equity}
            pnl={pnl}
            running={false}
            collapsed={leftCollapsed}
            onCollapse={setLeftCollapsed}
            jedi={jedi}
            regime={regime}
            activity={actGate}
          />
        )}

        <main
          className={`m5d-main${page === 'obi' || page === 'btc' ? ' m5d-main--fill' : ''}`}
          style={{ paddingBottom: isMobile ? 64 : undefined }}
        >
          {renderPage()}
        </main>

        {isMobile ? (
          <>
            {rightOpen && <div className="m5d-rail-backdrop" onClick={() => setRightOpen(false)} />}
            <div className={`m5d-rail-drawer ${rightOpen ? 'open' : ''}`}>
              <RightRail council={council} crossAsset={crossAsset} activity={activity} gateReport={gateReport} />
            </div>
          </>
        ) : (
          <RightRail
            council={council}
            crossAsset={crossAsset}
            activity={activity}
            gateReport={gateReport}
            open={rightOpen}
            onOpenChange={setRightOpen}
          />
        )}
      </div>

      {isMobile && (
        <BottomTabBar
          page={page}
          onPageChange={navigate}
          theme={theme}
          jedi={jedi}
          activity={actGate}
          onRailToggle={() => setRightOpen(o => !o)}
          railOpen={rightOpen}
        />
      )}

      <SurfacingPanel council={council} crossAsset={crossAsset} activity={activity} />
    </div>
  )
}
