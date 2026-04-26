import { useState, useEffect, useCallback } from 'react'
import './theme.scss'
import type { Theme, PageId } from './types'
import type { TextScale } from './layout/TopBar'
import { useCouncil, useCrossAsset, useActivity, usePaperStatus } from './api/client'
import { useBreakpoint } from './hooks/useBreakpoint'
import TopBar from './layout/TopBar'
import LeftNav from './layout/LeftNav'
import RightRail from './layout/RightRail'
import BottomTabBar from './layout/BottomTabBar'
import SurfacingPanel from './components/SurfacingPanel'
import MarketPage from './pages/MarketPage'
import PulsePage from './pages/PulsePage'
import TradePage from './pages/TradePage'
import StarRayPage from './pages/StarRayPage'
import PerfPage from './pages/PerfPage'
import AlphaSeekPage from './pages/AlphaSeekPage'
import MedallionPage from './pages/MedallionPage'
import ObiPage from './pages/ObiPage'
import BacktestLabPage from './pages/BacktestLabPage'

export default function App() {
  const [theme, setTheme]           = useState<Theme>('navy-subtle')
  const VALID_PAGES: PageId[] = ['market','pulse','trade','starray','perf','alphaseek','medallion','obi','backtest-lab']
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
    const s = parseFloat(localStorage.getItem('m5d.textScale') ?? '1')
    return ([0.85, 1.0, 1.2, 1.5] as TextScale[]).includes(s as TextScale) ? s as TextScale : 1.0
  })
  const [leftCollapsed, setLeftCollapsed] = useState(() => window.innerWidth < 1200)
  /** Right “algo status” rail: open on desktop by default; mobile forces closed. */
  const [rightOpen, setRightOpen]         = useState(() => typeof window !== 'undefined' && window.innerWidth >= 768)

  const bp = useBreakpoint()

  useEffect(() => {
    if (bp === 'mobile') { setLeftCollapsed(true); setRightOpen(false) }
    if (bp === 'tablet') { setLeftCollapsed(true) }
  }, [bp])

  const council    = useCouncil()
  const crossAsset = useCrossAsset()
  const activity   = useActivity()
  const paper      = usePaperStatus()

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
      case 'market':    return <MarketPage council={council} crossAsset={crossAsset} activity={activity} />
      case 'pulse':     return <PulsePage paper={paper} />
      case 'trade':     return <TradePage council={council} />
      case 'starray':   return <StarRayPage />
      case 'perf':      return <PerfPage />
      case 'alphaseek': return <AlphaSeekPage onPageChange={navigate} />
      case 'medallion': return <MedallionPage onPageChange={navigate} />
      case 'obi':           return <ObiPage />
      case 'backtest-lab':  return <BacktestLabPage />
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
          className={`m5d-main${page === 'obi' ? ' m5d-main--fill' : ''}`}
          style={{ paddingBottom: isMobile ? 64 : undefined }}
        >
          {renderPage()}
        </main>

        {isMobile ? (
          <>
            {rightOpen && <div className="m5d-rail-backdrop" onClick={() => setRightOpen(false)} />}
            <div className={`m5d-rail-drawer ${rightOpen ? 'open' : ''}`}>
              <RightRail council={council} crossAsset={crossAsset} activity={activity} />
            </div>
          </>
        ) : (
          <RightRail
            council={council}
            crossAsset={crossAsset}
            activity={activity}
            open={rightOpen}
            onOpenChange={setRightOpen}
          />
        )}
      </div>

      {isMobile && (
        <BottomTabBar
          page={page}
          onPageChange={navigate}
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
