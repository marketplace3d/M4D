import type { Theme } from '../types'

const THEMES: { id: Theme; label: string; dot: string }[] = [
  { id: 'navy-subtle',  label: 'NAVY',   dot: '#3a8fff' },
  { id: 'navy-vibrant', label: 'VIVID',  dot: '#4affaa' },
  { id: 'navy-glow',    label: 'GLOW',   dot: '#1dff7a' },
  { id: 'hc-dark',      label: 'HC',     dot: '#ffffff' },
  { id: 'colour',       label: 'COLOUR', dot: '#f59e0b' },
]

export type TextScale = 0.85 | 1.0 | 1.2 | 1.5

const TEXT_SCALES: { val: TextScale; label: string }[] = [
  { val: 0.85, label: 'xs' },
  { val: 1.0,  label: 'sm' },
  { val: 1.2,  label: 'md' },
  { val: 1.5,  label: 'lg' },
]

interface Props {
  theme:         Theme
  onThemeChange: (t: Theme) => void
  textScale:     TextScale
  onScaleChange: (s: TextScale) => void
  services:      { api: boolean; ds: boolean; paper: boolean }
  jedi:          number | null
  regime:        string | null
  activity:      string | null
  isMobile?:     boolean
  onMenuToggle?: () => void
}

export default function TopBar({ theme, onThemeChange, textScale, onScaleChange, services, jedi, regime, activity, isMobile, onMenuToggle }: Props) {
  const mono = "var(--font-mono)"
  const actColor  = activity === 'HOT' ? 'var(--greenB)' : activity === 'ALIVE' ? 'var(--green)' : activity === 'SLOW' ? 'var(--goldB)' : 'var(--redB)'
  const regColor  = regime === 'TRENDING' ? 'var(--greenB)' : regime === 'BREAKOUT' ? 'var(--accent)' : regime === 'RISK-OFF' ? 'var(--redB)' : 'var(--text2)'
  const jediColor = jedi === null ? 'var(--text3)' : jedi > 12 ? 'var(--greenB)' : jedi > 0 ? 'var(--gold)' : jedi < -12 ? 'var(--redB)' : 'var(--text2)'

  return (
    <div style={{
      height: 'var(--topbar-h)',
      background: 'var(--topbar-bg)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 10,
      flexShrink: 0,
      fontFamily: mono,
    }}>
      {isMobile && onMenuToggle && (
        <button onClick={onMenuToggle} style={{ padding: '4px 6px', fontSize: 14, background: 'transparent', border: 'none', color: 'var(--text2)', cursor: 'pointer', lineHeight: 1 }}>☰</button>
      )}

      <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--goldB)', letterSpacing: 3 }}>M5D</span>
      {!isMobile && <span style={{ fontSize: 7, color: 'var(--text3)', letterSpacing: 2 }}>CO-TRADER</span>}

      <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

      {/* Live intel strip */}
      <div className="topbar-intel" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 9 }}>
        <span style={{ color: 'var(--text3)' }}>JEDI</span>
        <span style={{ color: jediColor, fontWeight: 700, minWidth: 36 }}>
          {jedi !== null ? (jedi > 0 ? `+${jedi.toFixed(0)}` : jedi.toFixed(0)) : '—'}
        </span>
        <span style={{ color: 'var(--border2)' }}>|</span>
        <span style={{ color: 'var(--text3)' }}>REGIME</span>
        <span style={{ color: regColor, fontWeight: 700, minWidth: 72 }}>{regime ?? '—'}</span>
        <span style={{ color: 'var(--border2)' }}>|</span>
        <span style={{ color: 'var(--text3)' }}>MKT</span>
        <span style={{ color: actColor, fontWeight: 700 }}>{activity ?? '—'}</span>
      </div>

      <div style={{ flex: 1 }} />

      {/* Service health */}
      <div className="topbar-services" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 8 }}>
        {[
          { label: ':3030', ok: services.api },
          { label: ':8000', ok: services.ds },
          { label: 'PAPER', ok: services.paper },
        ].map(s => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 3, color: s.ok ? 'var(--greenB)' : 'var(--redB)' }}>
            <span className={`status-dot ${s.ok ? 'live' : 'dead'}`} />
            {s.label}
          </span>
        ))}
      </div>

      <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

      {/* Compact text scale selector */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 7, color: 'var(--text3)' }}>Aa</span>
        <select
          value={textScale}
          onChange={e => onScaleChange(Number(e.target.value) as TextScale)}
          style={{
            height: 22, padding: '0 6px', fontSize: 8, fontFamily: mono,
            background: 'var(--bg3)', color: 'var(--text2)',
            border: '1px solid var(--border)', borderRadius: 2,
          }}
        >
          {TEXT_SCALES.map(ts => (
            <option key={ts.val} value={ts.val}>{ts.label.toUpperCase()}</option>
          ))}
        </select>
      </div>

      <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

      {/* Compact theme selector */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: THEMES.find(t => t.id === theme)?.dot ?? '#3a8fff', display: 'inline-block' }} />
        <select
          value={theme}
          onChange={e => onThemeChange(e.target.value as Theme)}
          style={{
            height: 22, padding: '0 6px', fontSize: 8, fontFamily: mono, letterSpacing: '0.06em',
            background: 'var(--bg3)', color: 'var(--text2)',
            border: '1px solid var(--border)', borderRadius: 2,
          }}
        >
          {THEMES.map(t => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
