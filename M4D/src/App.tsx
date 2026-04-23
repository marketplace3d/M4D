import { useEffect, useState } from 'react'
import './m4d.css'

// ── All M4D pages ─────────────────────────────────────────────────────────────
import MissionHub         from './pages/MissionHub'
import MissionCouncil     from './pages/MissionCouncil'
import ControlRoomKnightsPage from './pages/ControlRoomKnightsPage'
import TvLwChartsPage     from './pages/TvLwChartsPage'
import FxChartsPage       from './pages/FxChartsPage'
import IctChartsPage      from './pages/IctChartsPage'
import IctPageOld         from './pages/IctPageOld'
import BtcChartsPage      from './pages/BtcChartsPage'
import VizXYFlowPage      from './pages/VizXYFlowPage'
import FullSystemVizPage  from './pages/FullSystemVizPage'
import LaunchPadPage      from './pages/LaunchPadPage'
import FootplatePage      from './pages/FootplatePage'
import BoomExplore        from './pages/BoomExplore'
import TvLwChartsLivePage from './pages/TvLwChartsLivePage'
import AlgoDataTablePage  from './pages/AlgoDataTablePage'
import FlowMapsStudioPage from './pages/FlowMapsStudioPage'
import TestLabPage        from './pages/TestLabPage'
import TradeSafetyPage    from './pages/TradeSafetyPage'
import CoDevMapPage            from './pages/CoDevMapPage'
import SystemArchitecturePage  from './pages/SystemArchitecturePage'
import OraclePlanPage          from './pages/OraclePlanPage'
import MMBrainPage             from './pages/MMBrainPage'
import ObiPage                 from './pages/ObiPage'
import StarOptimizerPage       from './pages/StarOptimizerPage'
import TraderPage              from './pages/TraderPage'
import SurgePulseTradePage     from './pages/SurgePulseTradePage'
import GhostPage               from './pages/GhostPage'
import PulsePage               from './pages/PulsePage'
import AlphaSeekPage           from './pages/AlphaSeekPage'

// ── M4D support ───────────────────────────────────────────────────────────────
import { WarriorMobileSyncProvider } from './WarriorMobileSyncContext'
import ServiceOpsDash   from './components/ServiceOpsDash'
import { useServiceHealth } from './hooks/useServiceHealth'

// ── Types ─────────────────────────────────────────────────────────────────────

type PageId =
  | 'hub' | 'council' | 'tradebot' | 'pulse' | 'alphaseek' | 'ghost' | 'warriors' | 'obi' | 'spx' | 'fx' | 'ict' | 'ict-old'
  | 'crypto' | 'warrior' | 'missionviz' | 'launchpad' | 'footplate'
  | 'boom' | 'trader' | 'chartslive' | 'algos' | 'flowmaps'
  | 'testlab' | 'tradesafe' | 'codev' | 'sysarch' | 'oracle' | 'mmbrain'
  | 'star'

type ModeId = 'm4d' | 'algo'
type Regime = 'BULL' | 'BEAR' | 'NEUTRAL'

// ── Nav config ────────────────────────────────────────────────────────────────
// Icons: picked for maximum cognitive legibility at 11–13px

const M4D_TABS: { id: PageId; label: string; icon: string; color?: string }[] = [
  { id: 'council',    label: 'MARKET',   icon: '⚔',  color: '#38bdf8' },
  { id: 'tradebot',   label: 'TRADE',    icon: '🔥'                   },
  { id: 'pulse',      label: 'PULSE',    icon: '◉'                    },
  { id: 'alphaseek',  label: 'ALPHASEEK', icon: '⟡', color: '#22c55e' },
  { id: 'star',       label: 'STAR',     icon: '★',  color: '#f0c030' },
  { id: 'ghost',      label: 'GHOST',    icon: '👻',  color: '#a78bfa' },
  { id: 'trader',     label: 'TRADER',   icon: '◎',  color: '#22c55e' },
  { id: 'warriors',   label: 'ENERGY',   icon: '◉'                    },
  { id: 'obi',        label: 'OBI',      icon: '◉',  color: '#a78bfa' },
  { id: 'spx',        label: 'SPX',      icon: '▲'                    },
  { id: 'fx',         label: 'FX',       icon: '€',  color: '#38bdf8' },
  { id: 'ict',        label: 'ICT',      icon: '◈',  color: '#a78bfa' },
  { id: 'crypto',     label: 'BTC',      icon: '₿',  color: '#f59e0b' },
  { id: 'warrior',    label: 'COUNCIL',  icon: '⬡'                    },
  { id: 'boom',       label: 'BOOM',     icon: '✦'                    },
]

const RAIL_ITEMS: { id: PageId; icon: string; label: string }[] = [
  { id: 'hub',        icon: '⌂',  label: 'HOME'       },
  { id: 'council',    icon: '⚔',  label: 'MARKET'     },
  { id: 'tradebot',   icon: '🔥', label: 'TRADE'      },
  { id: 'pulse',      icon: '◉',  label: 'PULSE'      },
  { id: 'alphaseek',  icon: '⟡',  label: 'ALPHASEEK'  },
  { id: 'star',       icon: '★',  label: 'STAR'       },
  { id: 'ghost',      icon: '👻',  label: 'GHOST' },
  { id: 'trader',     icon: '◎',  label: 'TRADER 4K'  },
  { id: 'warriors',   icon: '◉',  label: 'ENERGY'     },
  { id: 'obi',        icon: '◉',  label: 'OBI CO-TRADER' },
  { id: 'spx',        icon: '▲',  label: 'SPX CHART'  },
  { id: 'fx',         icon: '€',  label: 'FX CHARTS'  },
  { id: 'ict',        icon: '◈',  label: 'ICT CHARTS' },
  { id: 'crypto',     icon: '₿',  label: 'BTC CRYPTO' },
  { id: 'missionviz', icon: '🛡', label: 'CONTROL'    },
  { id: 'launchpad',  icon: '⚡', label: 'OPT PAD'    },
  { id: 'footplate',  icon: '⚙',  label: 'ENGINE'     },
  { id: 'algos',      icon: '⊞',  label: 'ALGO TABLE' },
  { id: 'flowmaps',   icon: '⊹',  label: 'FLOW MAPS'  },
  { id: 'chartslive', icon: '⟳',  label: 'LIVE WS'    },
  { id: 'tradesafe',  icon: '⛨',  label: 'RISK GATE'  },
  { id: 'testlab',    icon: '⚗',  label: 'TEST LAB'   },
  { id: 'codev',      icon: '⊛',  label: 'CO-DEV MAP'  },
  { id: 'sysarch',   icon: '⬡',  label: 'SYS ARCH'   },
  { id: 'oracle',    icon: '◎',  label: 'ORACLE PLAN' },
  { id: 'mmbrain',   icon: '⟁',  label: 'MM BRAIN'    },
  { id: 'warrior',    icon: '⬡',  label: 'COUNCIL VIZ'},
  { id: 'boom',       icon: '✦',  label: 'BOOM SCAN'  },
]

// Use real M4D presets for chart pages

// M3D page hash → URL at :5500
const M3D_HASHES: Record<string, string> = {
  dashboard: '', cryptobot: 'btc', rentech: 'mrt',
  alpha: 'maxcogviz', weights: 'weights', rank: 'rank',
  sharpe: 'sharpe', hedge: 'hedge', trader: 'trader',
  auto: 'auto', backtest: 'backtest', legends: 'legends', tradei: 'tradei',
}


// ── Hash helpers ──────────────────────────────────────────────────────────────

const HASH_MAP: Record<string, PageId> = {
  hub: 'hub', market: 'council', council: 'council',
  ghost: 'ghost', g: 'ghost',
  'surge-spec': 'ghost', claude: 'ghost',
  pulse: 'pulse', warriors: 'warriors', energy: 'warriors', w: 'warriors',
  alphaseek: 'alphaseek', alpha: 'alphaseek',
  obi: 'obi',
  spx: 'spx', charts: 'spx', c: 'spx',
  fx: 'fx',
  ict: 'ict',
  'ict-old': 'ict-old',
  btc: 'crypto', crypto: 'crypto',
  warrior: 'warrior',
  control: 'missionviz', mission: 'missionviz', missionviz: 'missionviz',
  launchpad: 'launchpad', opt: 'launchpad', pad: 'launchpad',
  footplate: 'footplate', engine: 'footplate',
  boom: 'boom',
  trader: 'trader', tr: 'trader',
  trade: 'tradebot', t: 'tradebot', tradebot: 'tradebot',
  star: 'star', starray: 'star', 'star-ray': 'star',
  chartslive: 'chartslive', clive: 'chartslive',
  algos: 'algos',
  flowmaps: 'flowmaps', maps: 'flowmaps',
  testlab: 'testlab', test: 'testlab', lab: 'testlab',
  tradesafe: 'tradesafe',
}

function readHash(): PageId {
  const h = window.location.hash.replace('#', '').toLowerCase()
  return HASH_MAP[h] ?? 'hub'
}

// ── Orb ───────────────────────────────────────────────────────────────────────

function Orb({ score, regime }: { score: number; regime: Regime }) {
  const cls = regime === 'BULL' ? 'orb-bull' : regime === 'BEAR' ? 'orb-bear' : 'orb-neutral'
  return (
    <div className="orb-wrap">
      <div className={`orb ${cls}`}>
        <span className="orb-score">{score > 0 ? `+${score}` : score}</span>
      </div>
    </div>
  )
}

// ── Right panel section ───────────────────────────────────────────────────────

function RSection({ title, children, open: defaultOpen = true }: { title: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="m6d-right-section">
      <div className="m6d-right-head" onClick={() => setOpen(v => !v)}>
        <span>{title}</span><span>{open ? '▲' : '▼'}</span>
      </div>
      {open && <div className="m6d-right-body">{children}</div>}
    </div>
  )
}

const LIVE_HINT = 'LIVE SURFACES ONLY · use Trader/Market/Pulse panels for action context';
const SYSTEM_MAP_PATH = '/Volumes/AI/AI-4D/M4D/AGENT/SYSTEM-MAP.svg';
const SYSTEM_SPEC_PATH = '/Volumes/AI/AI-4D/M4D/AGENT/SYSTEM-SPEC.md';
const IOPT_MASTER_PATH = '/Volumes/AI/AI-4D/M4D/AGENT/I-OPT-OOO/I-OPT-OOO-MASTER.MD';

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [page,       setPage]       = useState<PageId>(readHash)
  const [mode,       setMode]       = useState<ModeId>('m4d')
  const [railOpen,   setRailOpen]   = useState(false)
  const [rightOpen,  setRightOpen]  = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [algoPage] = useState('dashboard')
  const regime: Regime = 'BULL'
  const jedi = 12
  const { services } = useServiceHealth(10_000)

  const go = (p: PageId) => {
    setPage(p)
    setMobileOpen(false)
    const entry = Object.entries(HASH_MAP).find(([, v]) => v === p)?.[0]
    if (entry) window.location.hash = entry
  }

  useEffect(() => {
    const onHash = () => setPage(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Page title
  useEffect(() => {
    const titles: Partial<Record<PageId, string>> = {
      hub:'M4D — HOME', council:'M4D — MARKET', tradebot:'M4D — TRADE', pulse:'M4D — PULSE', alphaseek:'M4D — ALPHASEEK', ghost:'M4D — GHOST', warriors:'M4D — ENERGY',
      obi:'M4D — OBI', spx:'M4D — SPX', fx:'M4D — FX', ict:'M4D — ICT', 'ict-old':'M4D — ICT·OLD',
      crypto:'M4D — BTC', warrior:'M4D — COUNCIL', missionviz:'M4D — CONTROL',
      launchpad:'M4D — OPT', footplate:'M4D — ENGINE', boom:'M4D — BOOM',
      trader:'M4D — TRADER', chartslive:'M4D — LIVE WS', algos:'M4D — ALGOS',
      flowmaps:'M4D — MAPS', testlab:'M4D — LAB', tradesafe:'M4D — RISK',
      codev:'M4D — CO-DEV', sysarch:'M4D — SYS', oracle:'M4D — ORACLE',
      mmbrain:'M4D — MM', star:'M4D — STAR',
    }
    document.title = titles[page] ?? 'M4D'
  }, [page])

  // Page renderer
  const renderPage = () => {
    if (mode === 'algo') {
      const hash = M3D_HASHES[algoPage] ?? ''
      const src = `http://127.0.0.1:5500/${hash ? `#${hash}` : ''}`
      return (
        <iframe
          key={src}
          src={src}
          style={{ flex: 1, border: 'none', width: '100%', height: '100%', display: 'block' }}
          title="M3D Algo"
        />
      )
    }
    switch (page) {
      case 'hub':        return <MissionHub onCouncil={() => go('council')} onLaunchPad={() => go('launchpad')} onFootplate={() => go('footplate')} onWarriors={() => go('warriors')} onTradeBot={() => go('tradebot')} onBoom={() => go('boom')} onSpx={() => go('spx')} onFx={() => go('fx')} onCrypto={() => go('crypto')} onWarrior={() => go('warrior')} onMissionViz={() => go('missionviz')} />
      case 'council':    return <MissionCouncil onOpenWarriors={() => go('warriors')} />
      case 'pulse':      return <PulsePage />
      case 'alphaseek':  return <AlphaSeekPage />
      case 'ghost':      return <GhostPage />
      case 'warriors':   return <ControlRoomKnightsPage />
      case 'obi':        return <ObiPage />
      case 'spx':        return <TvLwChartsPage />
      case 'fx':         return <FxChartsPage />
      case 'ict':        return <IctChartsPage />
      case 'ict-old':    return <IctPageOld />
      case 'crypto':     return <BtcChartsPage />
      case 'warrior':    return <VizXYFlowPage />
      case 'missionviz': return <FullSystemVizPage />
      case 'launchpad':  return <LaunchPadPage />
      case 'footplate':  return <FootplatePage />
      case 'boom':       return <BoomExplore />
      case 'trader':     return <TraderPage />
      case 'tradebot':   return <SurgePulseTradePage />
      case 'chartslive': return <TvLwChartsLivePage />
      case 'algos':      return <AlgoDataTablePage />
      case 'flowmaps':   return <FlowMapsStudioPage />
      case 'testlab':    return <TestLabPage />
      case 'tradesafe':  return <TradeSafetyPage />
      case 'codev':      return <CoDevMapPage />
      case 'sysarch':    return <SystemArchitecturePage />
      case 'oracle':     return <OraclePlanPage />
      case 'mmbrain':    return <MMBrainPage />
      case 'star':       return <StarOptimizerPage />
      default:           return <MissionHub onCouncil={() => go('council')} onLaunchPad={() => go('launchpad')} onFootplate={() => go('footplate')} onWarriors={() => go('warriors')} onTradeBot={() => go('tradebot')} onBoom={() => go('boom')} onSpx={() => go('spx')} onFx={() => go('fx')} onCrypto={() => go('crypto')} onWarrior={() => go('warrior')} onMissionViz={() => go('missionviz')} />
    }
  }

  return (
    <WarriorMobileSyncProvider>
    <div className="m6d-root bp5-dark">

      {/* ── Topbar ──────────────────────────────────────────────────────── */}
      <div className="m6d-topbar">
        <button className="m6d-burger" onClick={() => setRailOpen(v => !v)} title="Context panels">☰</button>
        <div className="m6d-logo">M4D</div>

        {/* Primary M4D tabs — desktop */}
        <nav className="m6d-primary-nav">
          {M4D_TABS.map(t => (
            <button
              key={t.id}
              className={`m6d-tab${page === t.id ? ' active' : ''}`}
              style={{ color: page === t.id ? (t.color ?? 'var(--blue)') : undefined }}
              onClick={() => go(t.id)}
            >
              <span className="tab-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>

        <div className="m6d-spacer" />

        {/* Service health (M4D's own component) */}
        <div style={{ display:'flex', alignItems:'center', height:'100%', padding:'0 8px', borderLeft:'1px solid var(--border)' }}>
          <ServiceOpsDash services={services} />
        </div>

        {/* Mode badge */}
        <div className="m6d-mode">
          <button className={`m6d-mode-btn${mode === 'm4d' ? ' m4d-active' : ''}`} onClick={() => setMode('m4d')}>M4D</button>
          <button className={`m6d-mode-btn${mode === 'algo' ? ' m3d-active' : ''}`} onClick={() => setMode('algo')}>ALGO</button>
        </div>

        <div className="m6d-status"><span className="dot" /><span>LIVE :5555</span></div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="m6d-body">

        {/* Left Rail — icon strip → expand with context orbs */}
        <div className={`m6d-rail${railOpen ? ' open' : ''}`} style={{ position:'relative' }}>
          {/* Collapse/expand handle */}
          <button
            className="m6d-panel-handle m6d-panel-handle--left"
            onClick={() => setRailOpen(v => !v)}
            title={railOpen ? 'Collapse' : 'Expand'}
          >
            <span>{railOpen ? '◀' : '▶'}</span>
            <span>{railOpen ? '◀' : '▶'}</span>
          </button>

          {RAIL_ITEMS.map(r => (
            <button
              key={r.id}
              className={`m6d-rail-btn${page === r.id ? ' active' : ''}`}
              title={r.label}
              onClick={() => go(r.id)}
            >
              <span className="rail-icon">{r.icon}</span>
              <span className="rail-label">{r.label}</span>
            </button>
          ))}

          <div className="m6d-orb-panel">
            <div className="m6d-orb-card">
              <div className="m6d-orb-card-title">Regime Orb</div>
              <Orb score={jedi} regime={regime} />
              {[
                { label:'Regime', val: regime, color:'var(--green)' },
                { label:'JEDI',   val:`+${jedi}`, color:'var(--gold)'  },
                { label:'Long',   val:'18',  color:'var(--green)' },
                { label:'Short',  val:'6',   color:'var(--red)'   },
              ].map(r => (
                <div key={r.label} className="ctx-row">
                  <span className="ctx-label">{r.label}</span>
                  <span className="ctx-val" style={{ color: r.color }}>{r.val}</span>
                </div>
              ))}
            </div>

            <div className="m6d-orb-card">
              <div className="m6d-orb-card-title">Market Context</div>
              {[
                { label:'Source', val:'#trader live panels' },
                { label:'Policy', val:'NO MOCK CONTEXT' },
                { label:'Action', val:'use TRADER page' },
                { label:'Gate', val:'service + risk checks' },
              ].map(r => (
                <div key={r.label} className="ctx-row">
                  <span className="ctx-label">{r.label}</span>
                  <span className="ctx-val">{r.val}</span>
                </div>
              ))}
            </div>

            <div className="m6d-orb-card">
              <div className="m6d-orb-card-title">MaxCogViz Status</div>
              {[
                { label:'AI Mode',    val:'Co-Trader', color:'var(--purple)' },
                { label:'Conviction', val:'LIVE@TRADER', color:'var(--gold)'   },
                { label:'Risk Gate',  val:'LIVE@TRADER', color:'var(--green)'  },
                { label:'Kelly',      val:'LIVE@TRADER', color:'var(--blue)'   },
              ].map(r => (
                <div key={r.label} className="ctx-row">
                  <span className="ctx-label">{r.label}</span>
                  <span className="ctx-val" style={{ color: r.color }}>{r.val}</span>
                </div>
              ))}
            </div>

            <div className="m6d-orb-card">
              <div className="m6d-orb-card-title">Services</div>
              {services.map((s: { label?: string; name?: string; ok?: boolean; healthy?: boolean }) => (
                <div key={s.label ?? s.name} className="ctx-row">
                  <span className="ctx-label" style={{ fontSize: 9 }}>{s.label ?? s.name}</span>
                  <span style={{ fontSize: 9, color: (s.ok ?? s.healthy) ? 'var(--green)' : 'var(--red)' }}>
                    {(s.ok ?? s.healthy) ? '●' : '○'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center — full M4D page content */}
        <div className="m6d-center">
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {renderPage()}
          </div>
        </div>

        {/* Right panel */}
        <div className={`m6d-right${rightOpen ? '' : ' closed'}`} style={{ position:'relative' }}>
          {/* Collapse/expand handle */}
          <button
            className="m6d-panel-handle m6d-panel-handle--right"
            onClick={() => setRightOpen(v => !v)}
            title={rightOpen ? 'Collapse' : 'Expand'}
          >
            <span>{rightOpen ? '▶' : '◀'}</span>
            <span>{rightOpen ? '▶' : '◀'}</span>
          </button>
          <RSection title="⊞  Live Ops Context">
            <div style={{ padding:'4px 2px', color:'var(--muted)', fontSize:10, lineHeight:1.5 }}>
              {LIVE_HINT}
            </div>
          </RSection>

          <RSection title="◉  Service State">
            {services.map((s: { label?: string; name?: string; ok?: boolean; healthy?: boolean }) => (
              <div key={s.label ?? s.name} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'3px 2px', borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                <span style={{ fontSize:10, color:'var(--muted)' }}>{s.label ?? s.name}</span>
                <span style={{ fontSize:10, color:(s.ok ?? s.healthy) ? 'var(--green)' : 'var(--red)' }}>{(s.ok ?? s.healthy) ? 'LIVE' : 'DOWN'}</span>
              </div>
            ))}
          </RSection>

          <RSection title="◈  Prediction" open={false}>
            {[
              { label:'Mode',       val: mode.toUpperCase(), color:'var(--blue)' },
              { label:'Page',       val: page.toUpperCase(), color:'var(--green)'  },
              { label:'Policy',     val:'LIVE ONLY',         color:'var(--gold)'   },
              { label:'Risk Gate',  val:'TRADER PANEL',      color:'var(--green)'  },
            ].map(r => (
              <div key={r.label} className="ctx-row" style={{ padding:'4px 0' }}>
                <span className="ctx-label">{r.label}</span>
                <span style={{ fontSize:10, fontWeight:600, color: r.color }}>{r.val}</span>
              </div>
            ))}
          </RSection>

          <RSection title="⊹  News Feed" open={false}>
            <div style={{ padding:'4px 2px', color:'var(--muted)', fontSize:10, lineHeight:1.6 }}>
              Wire /news endpoint → replace this section
            </div>
          </RSection>
          <RSection title="◎  IOPT Surface">
            {[
              { label: 'TRADER (actions + receipts)', pageId: 'trader' as PageId },
              { label: 'SYS ARCH (layer visibility)', pageId: 'sysarch' as PageId },
              { label: 'CO-DEV MAP (gaps/roadmap)', pageId: 'codev' as PageId },
            ].map((item) => (
              <button
                key={item.label}
                onClick={() => go(item.pageId)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  marginBottom: 6,
                  background: page === item.pageId ? 'var(--blue-dim)' : 'transparent',
                  border: '1px solid var(--border)',
                  color: page === item.pageId ? 'var(--blue)' : 'var(--muted)',
                  borderRadius: 4,
                  padding: '5px 7px',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                {item.label}
              </button>
            ))}
            <div style={{ paddingTop: 4, borderTop: '1px solid var(--border)' }}>
              {[
                { label: 'COPY SYSTEM MAP', value: SYSTEM_MAP_PATH },
                { label: 'COPY SYSTEM SPEC', value: SYSTEM_SPEC_PATH },
                { label: 'COPY IOPT MASTER', value: IOPT_MASTER_PATH },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => navigator.clipboard?.writeText(item.value)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    marginTop: 6,
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    color: 'var(--muted)',
                    borderRadius: 4,
                    padding: '4px 7px',
                    fontSize: 10,
                    cursor: 'pointer',
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </RSection>
        </div>
      </div>

      {/* ── Bottom council algo strip ────────────────────────────────────── */}
      <div className="m6d-bottom">
        <span style={{ fontSize:9, color:'var(--muted)', marginRight:4, textTransform:'uppercase', letterSpacing:1, flexShrink:0 }}>
          LIVE
        </span>

        {services.map((s: { label?: string; name?: string; ok?: boolean; healthy?: boolean }) => (
          <div key={s.label ?? s.name} className={`m6d-algo-chip ${(s.ok ?? s.healthy) ? 'long' : 'short'}`}>
            {(s.label ?? s.name)?.toUpperCase().slice(0, 6)}
            {(s.ok ?? s.healthy) ? '↑' : '↓'}
          </div>
        ))}

        <div className="m6d-spacer" />
        <span className="jedi-score">JEDI {jedi > 0 ? `+${jedi}` : jedi}</span>
        <span className={`regime-badge ${regime}`}>{regime === 'BULL' ? '↑' : regime === 'BEAR' ? '↓' : '→'} {regime}</span>
      </div>

      {/* ── Mobile drawer ───────────────────────────────────────────────── */}
      {mobileOpen && (
        <>
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:40 }} onClick={() => setMobileOpen(false)} />
          <div style={{ position:'fixed', top:0, left:0, bottom:0, width:260, background:'var(--bg-strip)', borderRight:'1px solid var(--border)', zIndex:50, display:'flex', flexDirection:'column', overflow:'auto' }}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ color:'var(--blue)', fontWeight:700, letterSpacing:2 }}>M4D PAGES</span>
              <button style={{ background:'none', border:'none', color:'var(--muted)', fontSize:18, cursor:'pointer' }} onClick={() => setMobileOpen(false)}>×</button>
            </div>
            {RAIL_ITEMS.map(r => (
              <button key={r.id} onClick={() => { go(r.id); setMobileOpen(false) }}
                style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 16px', background:page === r.id ? 'var(--blue-dim)' : 'none', border:'none', borderBottom:'1px solid var(--border)', color: page === r.id ? 'var(--blue)' : 'var(--muted)', cursor:'pointer', fontSize:12, fontFamily:'inherit', textAlign:'left' }}>
                <span style={{ fontSize:14, width:20, textAlign:'center' }}>{r.icon}</span>
                {r.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
    </WarriorMobileSyncProvider>
  )
}
