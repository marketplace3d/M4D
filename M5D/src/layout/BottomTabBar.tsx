import type { PageId } from '../types'

const TABS: { id: PageId; icon: string; label: string }[] = [
  { id: 'market',    icon: '①', label: 'MKT'  },
  { id: 'pulse',     icon: '②', label: 'PULSE' },
  { id: 'trade',     icon: '③', label: 'TRADE' },
  { id: 'starray',   icon: '④', label: 'STAR'  },
  { id: 'perf',      icon: '⑤', label: 'PERF'  },
  { id: 'alphaseek', icon: '⟡', label: 'SEEK'  },
  { id: 'medallion', icon: '✦', label: 'MED'   },
  { id: 'obi',       icon: '◉', label: 'OBI'   },
]

interface Props {
  page: PageId
  onPageChange: (p: PageId) => void
  jedi: number | null
  activity: string | null
  onRailToggle: () => void
  railOpen: boolean
}

export default function BottomTabBar({ page, onPageChange, jedi, activity, onRailToggle, railOpen }: Props) {
  const jediColor = jedi === null ? 'var(--text3)' : Math.abs(jedi) >= 18 ? 'var(--greenB)' : jedi > 0 ? 'var(--goldB)' : jedi < 0 ? 'var(--redB)' : 'var(--text3)'
  const actColor  = activity === 'HOT' ? 'var(--greenB)' : activity === 'ALIVE' ? 'var(--green)' : activity === 'SLOW' ? 'var(--goldB)' : 'var(--redB)'

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
            <span style={{ fontSize: 12, color: active ? 'var(--accent)' : 'var(--text3)', fontWeight: 700 }}>{t.icon}</span>
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
