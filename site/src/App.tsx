import { Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Dashboard } from './pages/Dashboard'
import { Trader } from './pages/Trader'
import { AutoTrader } from './pages/AutoTrader'
import Backtest from './pages/Backtest'
import LegendScanner from './pages/LegendScanner'
import Rank from './pages/Rank'
import Sharpe from './pages/Sharpe'
import Hedge from './pages/Hedge'
import MaxCogViz from './pages/MaxCogViz'
import AlgoWeights from './pages/AlgoWeights'
import TradeI from './pages/TradeI'
import MRTMonitor from './pages/MRTMonitor'
import CryptoBot from './pages/CryptoBot'
import Obi from './pages/Obi'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

const NAV_ITEMS = [
  { path: '/',          label: 'Dashboard' },
  { path: '/obi',       label: 'OBI'       },
  { path: '/cryptobot', label: 'CryptoBot' },
  { path: '/mrt',       label: 'RenTech'   },
  { path: '/maxcogviz', label: 'ALPHA'     },
  { path: '/weights',   label: 'Weights'   },
  { path: '/rank',      label: 'Rank'      },
  { path: '/sharpe',    label: 'Sharpe'    },
  { path: '/hedge',     label: 'Hedge'     },
  { path: '/trader',    label: 'Trader'    },
  { path: '/auto',      label: 'AutoTrader'},
  { path: '/backtest',  label: 'Backtest'  },
  { path: '/legends',   label: 'Legends'   },
  { path: '/tradei',    label: 'TradeI'    },
]

const NAV_ICON: Record<string, string> = {
  '/': '⬡',
  '/obi': '◉',
  '/trader': '⚡',
  '/auto': '⚙',
  '/backtest': '▶',
  '/legends': '★',
  '/rank': '▦',
  '/sharpe': '∿',
  '/hedge': '🛡',
  '/maxcogviz': '◈',
  '/mrt':       '◇',
  '/weights':   '⚖',
  '/tradei':    'Ι',
  '/cryptobot': '₿',
}

function TopNav() {
  return (
    <nav style={{
      height: 44,
      background: 'var(--bg-panel)',
      borderBottom: '1px solid var(--border-color)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 2,
      flexShrink: 0,
    }}>
      {/* Logo */}
      <span style={{
        fontSize: 13, fontWeight: 800, color: '#FFB74D',
        letterSpacing: 2, marginRight: 20, fontFamily: 'monospace',
      }}>
        M3D
      </span>

      {NAV_ITEMS.map(n => (
        <NavLink
          key={n.path}
          to={n.path}
          end={n.path === '/'}
          style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 12px', borderRadius: 4, textDecoration: 'none',
            fontSize: 12, fontWeight: isActive ? 600 : 400,
            color: isActive ? '#e2e8f0' : 'var(--text-muted)',
            background: isActive ? 'rgba(255,255,255,0.07)' : 'transparent',
            borderBottom: isActive ? '2px solid #FFB74D' : '2px solid transparent',
          })}
        >
          <span style={{ fontSize: 10 }}>{NAV_ICON[n.path]}</span>
          {n.label}
        </NavLink>
      ))}

      {/* Right: DS status indicator */}
      <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>
        ./gort.sh · DS :8800 · API :3300 · MRT :3340
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="app-layout">
        <TopNav />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Routes>
            <Route path="/"         element={<Dashboard />} />
            <Route path="/legacy27" element={<Navigate to="/" replace />} />
            <Route path="/rentech"  element={<MRTMonitor />} />
            <Route path="/trader"   element={<Trader />} />
            <Route path="/auto"     element={<AutoTrader />} />
            <Route path="/backtest" element={<Backtest />} />
            <Route path="/legends"  element={<LegendScanner />} />
            <Route path="/rank"     element={<Rank />} />
            <Route path="/sharpe"   element={<Sharpe />} />
            <Route path="/hedge"    element={<Hedge />} />
            <Route path="/maxcogviz" element={<MaxCogViz />} />
            <Route path="/mrt" element={<MRTMonitor />} />
            <Route path="/weights"  element={<AlgoWeights />} />
            <Route path="/tradei"   element={<TradeI />} />
            <Route path="/cryptobot" element={<CryptoBot />} />
            <Route path="/obi"       element={<Obi />} />
            <Route path="*"         element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </QueryClientProvider>
  )
}
