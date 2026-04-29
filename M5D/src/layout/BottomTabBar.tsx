import type { PageId, Theme } from '../types'

const TABS: { id: PageId; icon: string; label: string }[] = [
  { id: 'market',    icon: '◈', label: 'MKT'   },
  { id: 'pulse',     icon: '◉', label: 'PULSE' },
  { id: 'trade',     icon: '⚔', label: 'TRADE' },
  { id: 'ict-smc',   icon: '⟁', label: 'ICT-SMC' },
  { id: 'obi',       icon: '◉', label: 'OBI'   },
  { id: 'trade-lab', icon: '◍', label: 'TLAB'  },
  { id: 'starray',   icon: '✶', label: 'OPT'   },
  { id: 'perf',      icon: '◍', label: 'PERFORMANCE'  },
  { id: 'alphaseek', icon: '⟡', label: 'SEEK'  },
  { id: 'medallion', icon: '✦', label: 'MED'   },
]

const ICON_COLOUR: Record<PageId, string> = {
  market: 'var(--goldB)',
  'market-audit': 'var(--gold)',
  pulse: 'var(--tealB)',
  trade: 'var(--redB)',
  'ict-smc': '#22d3ee',
  starray: 'var(--purpleB)',
  perf: 'var(--greenB)',
  alphaseek: 'var(--accent)',
  medallion: '#c084fc',
  obi: '#f43f5e',
  'trade-lab': '#38bdf8',
  'backtest-lab': '#38bdf8',
  'btc': '#f7931a',
}

const ICON_NAVY_BLUE: Record<PageId, string> = {
  market: '#7ec4ff',
  'market-audit': '#5ea7f8',
  pulse: '#80d5ff',
  trade: '#4a9fff',
  'ict-smc': '#6cc8ff',
  starray: '#70b7ff',
  perf: '#86cfff',
  alphaseek: '#5fb0ff',
  medallion: '#7abfff',
  obi: '#66b4ff',
  'trade-lab': '#82d5ff',
  'backtest-lab': '#8ad8ff',
  'btc': '#f7931a',
}

interface Props {
  page: PageId
  onPageChange: (p: PageId) => void
  jedi: number | null
  activity: string | null
  theme: Theme
  onRailToggle: () => void
  railOpen: boolean
}

export default function BottomTabBar({ page, onPageChange, jedi, activity, theme, onRailToggle, railOpen }: Props) {
  const jediColor = jedi === null ? 'var(--text3)' : Math.abs(jedi) >= 18 ? 'var(--greenB)' : jedi > 0 ? 'var(--goldB)' : jedi < 0 ? 'var(--redB)' : 'var(--text3)'
  const actColor  = activity === 'HOT' ? 'var(--greenB)' : activity === 'ALIVE' ? 'var(--green)' : activity === 'SLOW' ? 'var(--goldB)' : 'var(--redB)'
  const isNavyTheme = theme.startsWith('navy-')

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
      height: 56,
      background: 'var(--nav-bg)',
      borderTop: '1px solid var(--border)',
      display: 'flex', alignItems: 'stretch',
      fontFamily: 'var(--font-mono)',
      overflowX: 'auto',
    }}>
      {TABS.map(t => {
        const active = page === t.id
        const iconColor = active ? 'var(--accent)' : (isNavyTheme ? ICON_NAVY_BLUE[t.id] : ICON_COLOUR[t.id])
        return (
          <button
            key={t.id}
            onClick={() => onPageChange(t.id)}
            style={{
              minWidth: 44, flex: 1,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 2, padding: 0, border: 'none', cursor: 'pointer',
              background: active ? 'rgba(58,143,255,0.12)' : 'transparent',
              borderTop: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
            }}
          >
            <span style={{ fontSize: 12, color: iconColor, fontWeight: 700, textShadow: `0 0 8px ${iconColor}66` }}>{t.icon}</span>
            <span style={{ fontSize: 6, color: active ? 'var(--text)' : 'var(--text3)', letterSpacing: '0.04em', fontWeight: active ? 700 : 400 }}>{t.label}</span>
          </button>
        )
      })}

      {/* Rail FAB */}
      <button
        onClick={onRailToggle}
        style={{
          minWidth: 52,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 2, border: 'none', cursor: 'pointer',
          background: railOpen ? 'rgba(58,143,255,0.15)' : 'var(--bg3)',
          borderLeft: '1px solid var(--border)',
          borderTop: `2px solid ${railOpen ? 'var(--accent)' : 'transparent'}`,
          padding: 0,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 800, color: jediColor, lineHeight: 1 }}>
          {jedi !== null ? (jedi > 0 ? `+${Math.round(jedi)}` : Math.round(jedi)) : '—'}
        </span>
        <span style={{ fontSize: 6, color: actColor }}>{activity ?? 'ALGO'}</span>
      </button>
    </div>
  )
}
