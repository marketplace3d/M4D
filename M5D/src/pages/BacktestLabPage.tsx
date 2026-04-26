import { useState, useEffect, useRef, useMemo } from 'react'
import { usePoll } from '../api/client'

const DS = '/ds'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WaterfallRow {
  layer: string; label: string
  mean_oos_sharpe: number | null; std_sharpe: number | null
  pct_pos_folds: number | null; mean_n_per_fold: number | null
  mean_win_rate: number | null; thin_stats_warn: boolean
}

interface FoldLayer {
  sharpe: number | null; n: number; win_rate: number | null
}

interface FoldDetail {
  fold: number; oos_start: string; oos_end: string
  train_start: string; train_end: string
  is_sharpe: number | null; is_oos_ratio: number | null
  layers: Record<string, FoldLayer>
}

interface KZOverlap {
  total_bars: number; ict_kz_bars: number; hour_kills_bars: number
  kz_blocked_by_hk: number; kz_pass_through_pct: number; note: string
}

interface RenTechGates {
  gates: Record<string, boolean>; passed: string; verdict: string
  ict_sharpe_slope_over_folds: number | null
}

interface WFReport {
  ok: boolean; generated_at: string; elapsed_s: number
  data_range: { from: string; to: string; days: number; rows: number; symbols: string[] }
  config: { train_days: number; test_days: number; step_days: number; embargo_days: number; entry_threshold: number; n_signals: number; outcome: string }
  n_folds: number
  waterfall: WaterfallRow[]
  fold_summary: Record<string, { mean_oos_sharpe: number | null; std_sharpe: number | null; pct_pos_folds: number; mean_n_per_fold: number }>
  ict_ic: Record<string, number | null>
  signal_fire_rates: Record<string, number>
  killzone_overlap: KZOverlap
  correlation_audit: Record<string, Record<string, number | null>>
  rentech_gates: RenTechGates
  devils_advocate: string[]
  folds: FoldDetail[]
}

interface Progress {
  running: boolean; phase: string; fold?: number; total_folds?: number
  elapsed_s?: number; pct?: number; started_at?: string
}

// ── Color map per layer ────────────────────────────────────────────────────────

const LAYER_COLORS: Record<string, string> = {
  'L0_base':           '#4a9eff',
  'L1_+bias':          '#38b4ff',
  'L2_+kz':            '#00d4b0',
  'L3_+t1_level':      '#ff5c5c',
  'L4_+ob_fvg':        '#ff8c42',
  'L5_ict_standalone': '#ffd700',
  'HOUR_KILLS_only':   '#8b7cf8',
  'HK_+ict_kz':        '#00ff88',
  'bias_strong_only':  '#b39ddb',
  // Station-hold layers
  'L6a_cis_exit':      '#ff6ec7',
  'L6b_station_tp':    '#40e0ff',
  'L6c_station_cis':   '#ffe066',
}

const LAYER_SHORT: Record<string, string> = {
  'L0_base':           'L0 BASE',
  'L1_+bias':          'L1 +BIAS',
  'L2_+kz':            'L2 +KZ',
  'L3_+t1_level':      'L3 +T1',
  'L4_+ob_fvg':        'L4 +OB/FVG',
  'L5_ict_standalone': 'L5 SOLO',
  'HOUR_KILLS_only':   'CTL HK',
  'HK_+ict_kz':        'HK+KZ ★',
  'bias_strong_only':  'CTL BIAS',
  'L6a_cis_exit':      'L6a CIS',
  'L6b_station_tp':    'L6b STATION',
  'L6c_station_cis':   'L6c MM TRAIN ★',
}

const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"

// Inject pulse-bar keyframe once
if (typeof document !== 'undefined' && !document.getElementById('_lab_kf')) {
  const s = document.createElement('style')
  s.id = '_lab_kf'
  s.textContent = '@keyframes pulse-bar{0%,100%{opacity:1}50%{opacity:0.35}}'
  document.head.appendChild(s)
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 80 }}>
      <div style={{ fontSize: 9, color: 'var(--text3)', letterSpacing: '0.1em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: color ?? 'var(--text)', fontFamily: MONO, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 8, color: 'var(--text3)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function SectionHeader({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: 6 }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--text3)' }}>{label}</span>
      {right && <div style={{ marginLeft: 'auto' }}>{right}</div>}
    </div>
  )
}

// ── Data Timeline SVG ─────────────────────────────────────────────────────────

function DataTimeline({ report }: { report: WFReport }) {
  const { from, to, symbols } = report.data_range
  const t0 = new Date(from).getTime()
  const t1 = new Date(to).getTime()
  const span = t1 - t0

  const W = 900, ROW = 20, PAD_L = 36, PAD_R = 12, PAD_T = 22, GAP = 3
  const H = PAD_T + symbols.length * (ROW + GAP) + 20

  const toX = (t: number) => PAD_L + ((t - t0) / span) * (W - PAD_L - PAD_R)

  // Mark train/test fold tick positions (every ~15 day step)
  const stepMs = report.config.step_days * 86400 * 1000
  const ticks: number[] = []
  for (let t = t0; t <= t1; t += stepMs * 2) ticks.push(t)

  const yearTicks: { t: number; label: string }[] = []
  for (let y = 2023; y <= 2027; y++) {
    const t = new Date(`${y}-01-01`).getTime()
    if (t >= t0 && t <= t1) yearTicks.push({ t, label: String(y) })
  }

  const FUTURES = new Set(['ES', 'NQ', 'RTY', 'CL', 'GC', 'SI', 'ZB', 'ZN', '6E'])

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {/* Year tick lines */}
      {yearTicks.map(({ t, label }) => (
        <g key={t}>
          <line x1={toX(t)} y1={PAD_T - 4} x2={toX(t)} y2={H - 14} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
          <text x={toX(t)} y={H - 4} fontSize={7} fill="#6b7e9e" textAnchor="middle" fontFamily={MONO}>{label}</text>
        </g>
      ))}

      {/* Data bars per symbol */}
      {symbols.map((sym, i) => {
        const y = PAD_T + i * (ROW + GAP)
        const isFut = FUTURES.has(sym)
        const isES  = sym === 'ES'
        const fill  = isES ? '#00ff88' : isFut ? '#4a9eff' : '#8b7cf8'
        const opacity = isFut ? 1 : 0.55
        return (
          <g key={sym}>
            <rect x={toX(t0)} y={y} width={toX(t1) - toX(t0)} height={ROW - 4}
              fill={fill} opacity={opacity} rx={2}
              style={{ filter: isES ? 'drop-shadow(0 0 4px #00ff8888)' : undefined }}
            />
            <text x={PAD_L - 4} y={y + ROW / 2 - 1} fontSize={8} fill={isES ? '#00ff88' : fill}
              fontWeight={isES ? 700 : 400} textAnchor="end" fontFamily={MONO} dominantBaseline="middle">
              {sym}
            </text>
          </g>
        )
      })}

      {/* Walk-forward window illustration */}
      {(() => {
        const trainMs = report.config.train_days * 86400 * 1000
        const testMs  = report.config.test_days  * 86400 * 1000
        const sampleStart = t0 + trainMs * 1.5
        const x0 = toX(sampleStart), x1 = toX(sampleStart + trainMs)
        const x2 = toX(sampleStart + trainMs + testMs)
        const yTop = PAD_T - 2, yH = symbols.length * (ROW + GAP) - GAP + 4
        return (
          <g opacity={0.35}>
            <rect x={x0} y={yTop} width={x1 - x0} height={yH} fill="#4a9eff" rx={1} />
            <rect x={x1} y={yTop} width={x2 - x1} height={yH} fill="#00ff88" rx={1} />
            <text x={(x0 + x1) / 2} y={PAD_T - 10} fontSize={7} fill="#4a9eff" textAnchor="middle" fontFamily={MONO}>TRAIN</text>
            <text x={(x1 + x2) / 2} y={PAD_T - 10} fontSize={7} fill="#00ff88" textAnchor="middle" fontFamily={MONO}>TEST</text>
          </g>
        )
      })()}

      {/* Data range labels */}
      <text x={toX(t0)} y={H - 4} fontSize={7} fill="#6b7e9e" fontFamily={MONO}>{from}</text>
      <text x={toX(t1)} y={H - 4} fontSize={7} fill="#6b7e9e" textAnchor="end" fontFamily={MONO}>{to}</text>
    </svg>
  )
}

// ── Waterfall Chart ────────────────────────────────────────────────────────────

function WaterfallChart({ waterfall }: { waterfall: WaterfallRow[] }) {
  const maxSharpe = Math.max(...waterfall.map(r => Math.abs(r.mean_oos_sharpe ?? 0)), 1)
  const scale = maxSharpe > 0 ? 1 / maxSharpe : 1

  const W = 900, PAD_L = 160, PAD_R = 280, ROW_H = 40, GAP = 4
  const H = waterfall.length * (ROW_H + GAP) + 8
  const BAR_MAX = W - PAD_L - PAD_R

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {waterfall.map((row, i) => {
        const y = i * (ROW_H + GAP)
        const sh = row.mean_oos_sharpe ?? 0
        const std = row.std_sharpe ?? 0
        const barW = Math.max(2, Math.abs(sh) * scale * BAR_MAX)
        const isNeg = sh < 0
        const color = LAYER_COLORS[row.layer] ?? '#4a9eff'
        const isWinner = row.layer === 'L6c_station_cis' || row.layer === 'HK_+ict_kz'
        const label = LAYER_SHORT[row.layer] ?? row.layer

        // Error bar (±1 std)
        const errW = Math.min(std * scale * BAR_MAX * 0.5, BAR_MAX)

        return (
          <g key={row.layer}>
            {/* Row bg */}
            {isWinner && <rect x={0} y={y} width={W} height={ROW_H} fill="rgba(0,255,136,0.04)" rx={2} />}

            {/* Label */}
            <text x={PAD_L - 8} y={y + ROW_H / 2 + 1} fontSize={9} fill={color}
              fontWeight={isWinner ? 700 : 500} textAnchor="end" fontFamily={MONO} dominantBaseline="middle">
              {label}
            </text>

            {/* Bar */}
            <rect
              x={isNeg ? PAD_L - barW : PAD_L}
              y={y + 6}
              width={barW}
              height={ROW_H - 12}
              fill={color}
              opacity={isWinner ? 1 : 0.75}
              rx={2}
              style={{ filter: isWinner ? `drop-shadow(0 0 6px ${color}88)` : undefined }}
            />

            {/* Error bar */}
            {errW > 0 && (
              <line
                x1={PAD_L + (isNeg ? -barW - errW : barW - errW)}
                x2={PAD_L + (isNeg ? -barW + errW : barW + errW)}
                y1={y + ROW_H / 2}
                y2={y + ROW_H / 2}
                stroke={color}
                strokeWidth={2}
                opacity={0.4}
              />
            )}

            {/* Sharpe value */}
            <text
              x={PAD_L + (isNeg ? -barW - 4 : barW + 4)}
              y={y + ROW_H / 2 + 1}
              fontSize={11}
              fill={color}
              fontWeight={700}
              fontFamily={MONO}
              textAnchor={isNeg ? 'end' : 'start'}
              dominantBaseline="middle"
            >
              {sh >= 0 ? '+' : ''}{sh.toFixed(2)}
            </text>

            {/* Stats: std, %+folds, N, WR */}
            <text x={PAD_L + BAR_MAX + 8} y={y + 13} fontSize={8} fill="var(--text3)" fontFamily={MONO}>
              {`±${std.toFixed(1)}  ${((row.pct_pos_folds ?? 0) * 100).toFixed(0)}%+  N=${(row.mean_n_per_fold ?? 0).toFixed(0)}`}
            </text>
            <text x={PAD_L + BAR_MAX + 8} y={y + 25} fontSize={8} fill="var(--text3)" fontFamily={MONO}>
              {`WR=${((row.mean_win_rate ?? 0) * 100).toFixed(1)}%${row.thin_stats_warn ? '  ⚠THIN' : ''}`}
            </text>

            {/* Zero line */}
            <line x1={PAD_L} y1={y + 2} x2={PAD_L} y2={y + ROW_H - 2} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
          </g>
        )
      })}

      {/* Axis zero line */}
      <line x1={PAD_L} y1={0} x2={PAD_L} y2={H} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
    </svg>
  )
}

// ── Fold Scatter ──────────────────────────────────────────────────────────────

function FoldScatter({ folds, layers }: { folds: FoldDetail[]; layers: string[] }) {
  const W = 580, H = 220, PAD = { l: 42, r: 16, t: 14, b: 28 }
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b

  const sharpes = folds.flatMap(f => layers.map(l => f.layers[l]?.sharpe ?? null).filter(v => v !== null)) as number[]
  const yMin = Math.min(-5, ...sharpes)
  const yMax = Math.max(5, ...sharpes)
  const yRange = yMax - yMin

  const xOf = (i: number) => PAD.l + (i / Math.max(1, folds.length - 1)) * plotW
  const yOf = (v: number) => PAD.t + (1 - (v - yMin) / yRange) * plotH

  const COLORS: Record<string, string> = {
    'L0_base':           '#4a9eff88',
    'HK_+ict_kz':        '#00ff8888',
    'L2_+kz':            '#00d4b088',
    'L6c_station_cis':   '#ffe066',
    'L6b_station_tp':    '#40e0ff88',
    'L6a_cis_exit':      '#ff6ec788',
  }

  const yZero = yOf(0)

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {/* Zero line */}
      <line x1={PAD.l} y1={yZero} x2={W - PAD.r} y2={yZero} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="4,3" />

      {/* Y grid */}
      {[-20, -10, 0, 10, 20, 30].filter(v => v >= yMin && v <= yMax).map(v => (
        <g key={v}>
          <line x1={PAD.l} y1={yOf(v)} x2={W - PAD.r} y2={yOf(v)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
          <text x={PAD.l - 4} y={yOf(v)} fontSize={7} fill="#6b7e9e" textAnchor="end" fontFamily={MONO} dominantBaseline="middle">{v}</text>
        </g>
      ))}

      {/* Fold scatter per layer */}
      {layers.map(layer => {
        const color = COLORS[layer as keyof typeof COLORS] ?? '#ffffff44'
        const isWinner = layer === 'L6c_station_cis' || layer === 'HK_+ict_kz'
        const points = folds.map((f, i) => {
          const sh = f.layers[layer]?.sharpe
          if (sh == null) return null
          return { x: xOf(i), y: yOf(Math.max(yMin, Math.min(yMax, sh))), sh }
        })

        // Line for winner
        if (isWinner) {
          const validPts = points.filter(Boolean) as { x: number; y: number; sh: number }[]
          return (
            <g key={layer}>
              {validPts.length > 1 && (
                <polyline
                  points={validPts.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none" stroke={color} strokeWidth={1.5} opacity={0.5}
                />
              )}
              {validPts.map((p, j) => (
                <circle key={j} cx={p.x} cy={p.y} r={3} fill={color}
                  style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
              ))}
            </g>
          )
        }

        return (
          <g key={layer}>
            {points.map((p, j) => p ? (
              <circle key={j} cx={p.x} cy={p.y} r={2.5} fill={color} />
            ) : null)}
          </g>
        )
      })}

      {/* Legend */}
      {layers.map((layer, i) => {
        const color = COLORS[layer as keyof typeof COLORS] ?? '#ffffff44'
        return (
          <g key={layer} transform={`translate(${PAD.l + i * 130}, ${H - 8})`}>
            <circle cx={4} cy={0} r={3} fill={color} />
            <text x={10} y={1} fontSize={7} fill={color} fontFamily={MONO} dominantBaseline="middle">
              {LAYER_SHORT[layer] ?? layer}
            </text>
          </g>
        )
      })}

      {/* Axes */}
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
      <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />

      {/* X axis fold labels */}
      {[0, 10, 20, 30, 40].filter(i => i < folds.length).map(i => (
        <text key={i} x={xOf(i)} y={H - PAD.b + 10} fontSize={7} fill="#6b7e9e" textAnchor="middle" fontFamily={MONO}>
          {folds[i]?.oos_start?.slice(0, 7) ?? i}
        </text>
      ))}
    </svg>
  )
}

// ── Signal IC Bars ─────────────────────────────────────────────────────────────

function SignalICBars({ ict_ic, signal_fire_rates }: { ict_ic: Record<string, number | null>; signal_fire_rates: Record<string, number> }) {
  const entries = Object.entries(ict_ic).filter(([, v]) => v !== null) as [string, number][]
  const maxAbs = Math.max(...entries.map(([, v]) => Math.abs(v)), 0.01)

  const SHORT: Record<string, string> = {
    'v_ict_bias':     'BIAS',
    'v_ict_kz':       'KZ ★',
    'v_ict_ob':       'OB',
    'v_ict_fvg':      'FVG',
    'ict_t1_level':   'T1 LVL',
    'v_ict_gate':     'GATE',
    'ict_bias_strong':'BIAS STR',
  }

  return (
    <div style={{ fontFamily: MONO }}>
      {entries.map(([key, val]) => {
        const pct = val / maxAbs
        const color = val > 0 ? '#00d4b0' : '#ff5c5c'
        const fireKey = key.replace('ict_', 'v_ict_').replace('v_v_', 'v_')
        const fire = signal_fire_rates[key] ?? signal_fire_rates[fireKey] ?? null

        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            <div style={{ width: 60, fontSize: 8, color: key === 'v_ict_kz' ? '#00ff88' : 'var(--text3)', textAlign: 'right', flexShrink: 0 }}>
              {SHORT[key] ?? key}
            </div>
            <div style={{ flex: 1, height: 14, background: 'rgba(255,255,255,0.05)', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
              <div style={{
                position: 'absolute',
                left: pct >= 0 ? '50%' : `calc(50% + ${pct * 50}%)`,
                width: `${Math.abs(pct) * 50}%`,
                top: 0, bottom: 0,
                background: color, opacity: 0.8, borderRadius: 1,
              }} />
              <div style={{ position: 'absolute', top: 0, left: '50%', bottom: 0, width: 1, background: 'rgba(255,255,255,0.2)' }} />
            </div>
            <div style={{ width: 50, fontSize: 8, color, textAlign: 'right', flexShrink: 0 }}>
              {val >= 0 ? '+' : ''}{(val * 1000).toFixed(1)}‱
            </div>
            {fire !== null && (
              <div style={{ width: 34, fontSize: 7, color: 'var(--text3)', textAlign: 'right', flexShrink: 0 }}>
                {(fire * 100).toFixed(0)}%F
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Correlation Heatmap ───────────────────────────────────────────────────────

function CorrHeatmap({ audit }: { audit: Record<string, Record<string, number | null>> }) {
  const ictKeys  = Object.keys(audit)
  const existKeys = Object.keys(Object.values(audit)[0] ?? {})
  if (!ictKeys.length || !existKeys.length) return null

  const SHORT_ICT: Record<string, string> = {
    'v_ict_bias': 'BIAS', 'v_ict_kz': 'KZ', 'v_ict_ob': 'OB',
    'v_ict_fvg': 'FVG', 'v_ict_gate': 'GATE',
  }

  const cellColor = (v: number | null) => {
    if (v == null) return 'rgba(255,255,255,0.03)'
    const abs = Math.min(Math.abs(v), 0.4)
    const t = abs / 0.4
    if (v > 0) return `rgba(74,158,255,${0.15 + t * 0.6})`
    return `rgba(255,92,92,${0.15 + t * 0.6})`
  }

  const COL_W = 68, ROW_H = 22, PAD_L = 50

  return (
    <div style={{ fontFamily: MONO, overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 0 }}>
        <div style={{ width: PAD_L }} />
        {existKeys.map(k => (
          <div key={k} style={{ width: COL_W, fontSize: 7, color: 'var(--text3)', textAlign: 'center', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {k.toUpperCase()}
          </div>
        ))}
      </div>
      {ictKeys.map(ict => (
        <div key={ict} style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 2 }}>
          <div style={{ width: PAD_L, fontSize: 7, color: ict === 'v_ict_kz' ? '#00ff88' : 'var(--text3)', textAlign: 'right', paddingRight: 8, flexShrink: 0 }}>
            {SHORT_ICT[ict] ?? ict}
          </div>
          {existKeys.map(ex => {
            const v = audit[ict]?.[ex] ?? null
            return (
              <div key={ex} style={{
                width: COL_W, height: ROW_H,
                background: cellColor(v),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, color: 'var(--text)',
                borderRadius: 2, margin: '0 1px',
              }}>
                {v !== null ? (v >= 0 ? '+' : '') + v.toFixed(2) : '—'}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── RenTech Gate Block ────────────────────────────────────────────────────────

function RenTechGateBlock({ gates }: { gates: RenTechGates }) {
  const NAMES: Record<string, string> = {
    'oos_sharpe_positive': 'OOS SH+',
    'oos_stability_ok':    'STABILITY',
    'is_oos_ratio_ok':     'IS/OOS',
    'regime_consistent':   'REGIME',
    'not_decaying':        'NO DECAY',
  }
  const verdictColor = { ROBUST: '#00ff88', PROMISING: '#ffd700', FRAGILE: '#ff8c42', OVERFIT: '#ff5c5c' }[gates.verdict] ?? '#6b7e9e'

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {Object.entries(gates.gates).map(([key, pass]) => (
          <div key={key} style={{
            padding: '5px 10px', borderRadius: 4,
            background: pass ? 'rgba(0,255,136,0.1)' : 'rgba(255,92,92,0.1)',
            border: `1px solid ${pass ? '#00ff88' : '#ff5c5c'}44`,
            fontSize: 8, fontFamily: MONO,
            color: pass ? '#00ff88' : '#ff5c5c',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <span style={{ fontSize: 10 }}>{pass ? '✓' : '✗'}</span>
            {NAMES[key] ?? key}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 22, fontWeight: 700, fontFamily: MONO, color: verdictColor,
          textShadow: `0 0 12px ${verdictColor}88` }}>
          {gates.verdict}
        </span>
        <span style={{ fontSize: 13, color: verdictColor, fontFamily: MONO }}>{gates.passed}</span>
        {gates.ict_sharpe_slope_over_folds !== null && (
          <span style={{ fontSize: 9, color: 'var(--text3)', marginLeft: 8, fontFamily: MONO }}>
            slope {gates.ict_sharpe_slope_over_folds >= 0 ? '+' : ''}{gates.ict_sharpe_slope_over_folds.toFixed(4)}/fold
          </span>
        )}
      </div>
    </div>
  )
}

// ── Progress Bar ──────────────────────────────────────────────────────────────

function ProgressBar({ progress, running }: { progress: Progress | null; running: boolean }) {
  const active = running || (progress?.running ?? false)
  if (!active) return null
  const pct = progress?.pct ?? 0
  const phases: Record<string, string> = {
    'computing_ict_signals': 'Computing ICT signals (OB/FVG loops)…',
    'walkforward_folds':     `Walk-forward folds: ${progress?.fold ?? 0}/${progress?.total_folds ?? '?'}`,
    'aggregating':           'Aggregating results…',
    'done':                  'Complete',
  }
  const label = progress?.running
    ? (phases[progress.phase] ?? progress.phase)
    : 'Starting — launching ict_walkforward.py (OB/FVG loops ~5 min)…'

  return (
    <div style={{
      background: 'rgba(0,255,136,0.06)',
      border: '1px solid rgba(0,255,136,0.2)',
      borderRadius: 6, padding: '10px 14px', marginBottom: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 9, fontFamily: MONO, color: '#00ff88' }}>{label}</span>
        <span style={{ fontSize: 9, fontFamily: MONO, color: 'var(--text3)' }}>
          {progress?.running ? `${pct.toFixed(1)}%  ·  ${(progress.elapsed_s ?? 0).toFixed(0)}s elapsed` : '…'}
        </span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          width: progress?.running ? `${pct}%` : '100%', height: '100%',
          background: 'linear-gradient(90deg, #00d4b0, #00ff88)',
          borderRadius: 2,
          transition: progress?.running ? 'width 0.8s ease' : 'none',
          animation: !progress?.running ? 'pulse-bar 1.4s ease-in-out infinite' : 'none',
        }} />
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BacktestLabPage() {
  const report   = usePoll<WFReport>(`${DS}/v1/ict-walkforward/`, 60_000)
  const [running, setRunning] = useState(false)
  const [progPoll, setProgPoll] = useState(true)   // always poll at startup to detect in-flight runs
  const progress = usePoll<Progress>(`${DS}/v1/ict-walkforward/progress/`, progPoll ? 2_000 : 30_000)

  // Sync running state from server progress — auto-detect in-flight runs on page load
  useEffect(() => {
    if (!progress) return
    if (progress.running) {
      setRunning(true)
      setProgPoll(true)
    } else if (!progress.running && running) {
      // Completed — reload report
      setRunning(false)
      setProgPoll(false)
    }
  }, [progress?.running])   // only trigger on actual running-state change, not every poll

  const handleRun = async () => {
    setRunning(true)         // immediate UI feedback
    setProgPoll(true)
    try {
      await fetch(`${DS}/v1/ict-walkforward/run/`, { method: 'POST' })
    } catch {}
  }

  const foldScatterLayers = ['L0_base', 'HK_+ict_kz', 'L6b_station_tp', 'L6c_station_cis']

  const topWinner = useMemo(() => {
    if (!report?.waterfall) return null
    return [...report.waterfall].sort((a, b) => (b.mean_oos_sharpe ?? -99) - (a.mean_oos_sharpe ?? -99))[0]
  }, [report])

  const s = (n: number | null | undefined, dp = 2) =>
    n != null ? (n >= 0 ? '+' : '') + n.toFixed(dp) : '—'

  return (
    <div style={{
      width: '100%',
      background: 'var(--bg)',
      fontFamily: MONO,
      padding: '12px 16px 32px',
      boxSizing: 'border-box',
    }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', color: 'var(--text)' }}>BACKTEST LAB</div>
          <div style={{ fontSize: 8, color: 'var(--text3)', letterSpacing: '0.1em', marginTop: 2 }}>
            ICT SIGNAL STACK · WALK-FORWARD VALIDATION · ES1 FUTURES
          </div>
        </div>

        {report && (
          <>
            <div style={{ width: 1, height: 32, background: 'var(--border)' }} />
            <Stat label="ROWS" value={(report.data_range.rows / 1e6).toFixed(2) + 'M'} />
            <Stat label="SYMBOLS" value={String(report.data_range.symbols.length)} />
            <Stat label="FOLDS" value={String(report.n_folds)} sub={`${report.config.train_days}d/T ${report.config.test_days}d/O`} />
            <Stat label="DATA RANGE" value={report.data_range.from.slice(0,7)} sub={`→ ${report.data_range.to.slice(0,7)}`} />
            {topWinner && (
              <>
                <div style={{ width: 1, height: 32, background: 'var(--border)' }} />
                <Stat label="WINNER" value={s(topWinner.mean_oos_sharpe)} color="#00ff88"
                  sub={LAYER_SHORT[topWinner.layer] ?? topWinner.layer} />
              </>
            )}
            <div style={{ width: 1, height: 32, background: 'var(--border)' }} />
            <Stat label="GENERATED" value={report.generated_at.slice(0, 10)} sub={`${report.elapsed_s}s`} />
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {running && (
            <span style={{ fontSize: 9, color: '#00ff88', animation: 'pulse 1.5s infinite' }}>
              ● RUNNING
            </span>
          )}
          <button
            onClick={handleRun}
            disabled={running}
            style={{
              padding: '7px 16px',
              background: running ? 'rgba(255,255,255,0.05)' : 'rgba(0,255,136,0.12)',
              border: `1px solid ${running ? 'rgba(255,255,255,0.1)' : 'rgba(0,255,136,0.4)'}`,
              borderRadius: 4, cursor: running ? 'not-allowed' : 'pointer',
              fontSize: 9, fontFamily: MONO, fontWeight: 700,
              color: running ? 'var(--text3)' : '#00ff88',
              letterSpacing: '0.1em',
            }}
          >
            {running ? 'RUNNING…' : '▶ RUN BACKTEST'}
          </button>
        </div>
      </div>

      {/* ── Progress ───────────────────────────────────────────────────────── */}
      {(running || progress?.running) && <ProgressBar progress={progress} running={running} />}

      {!report && !running && (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 8, padding: 32,
          textAlign: 'center', color: 'var(--text3)', fontSize: 10,
        }}>
          No backtest report yet.
          <div style={{ marginTop: 8, fontSize: 9 }}>
            Click <span style={{ color: '#00ff88' }}>▶ RUN BACKTEST</span> to start (~5 min — OB/FVG loops over 3M bars)
          </div>
          <div style={{ marginTop: 6, fontSize: 8 }}>
            Symbols: ES · NQ · CL · GC · ZB · ZN · RTY · SI · 6E + BTC
          </div>
        </div>
      )}

      {report && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr', maxWidth: '100%' }}>

          {/* ── Row 1: Data Timeline + RenTech gates ──────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 12, alignItems: 'start' }}>

            {/* Data Timeline */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 16px' }}>
              <SectionHeader label={`DATA COVERAGE  ·  ${report.data_range.rows.toLocaleString()} BARS  ·  ${report.data_range.days.toFixed(0)} DAYS`} />
              <DataTimeline report={report} />
              <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 7, color: '#00ff88' }}>■ ES (focus)</span>
                <span style={{ fontSize: 7, color: '#4a9eff' }}>■ Futures</span>
                <span style={{ fontSize: 7, color: '#8b7cf888' }}>■ Crypto (excluded from results)</span>
                <span style={{ fontSize: 7, color: '#4a9eff44' }}>■ TRAIN window</span>
                <span style={{ fontSize: 7, color: '#00ff8844' }}>■ TEST window</span>
              </div>
            </div>

            {/* RenTech + Config */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 16px' }}>
                <SectionHeader label="RENTECH 5-GATE (L4 FULL ICT)" />
                <RenTechGateBlock gates={report.rentech_gates} />
              </div>

              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 16px' }}>
                <SectionHeader label="FOLD CONFIG" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    ['TRAIN', `${report.config.train_days}d`],
                    ['TEST', `${report.config.test_days}d`],
                    ['STEP', `${report.config.step_days}d`],
                    ['EMBARGO', `${report.config.embargo_days}d`],
                    ['ENTRY θ', report.config.entry_threshold.toFixed(2)],
                    ['SIGNALS', report.config.n_signals + '+ICT'],
                    ['N FOLDS', String(report.n_folds)],
                    ['OUTCOME', '4H PCT'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ color: 'var(--text3)' }}>{k}</span>
                      <span style={{ color: 'var(--text)', fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Row 2: Waterfall (full width) ─────────────────────────────── */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, padding: '14px 18px' }}>
            <SectionHeader
              label="SIGNAL STACK WATERFALL — JEDI → ENSEMBLE → ICT LAYERS → CONTROLS"
              right={
                <span style={{ fontSize: 7, color: 'var(--text3)' }}>
                  OOS Sharpe · ±Std · %+Folds · N/fold · Win Rate
                </span>
              }
            />
            <WaterfallChart waterfall={report.waterfall} />

            {/* Delta annotations */}
            <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
              {report.waterfall.slice(0, -3).map((row, i, arr) => {
                if (i === 0) return null
                const delta = (row.mean_oos_sharpe ?? 0) - (arr[i - 1].mean_oos_sharpe ?? 0)
                const color = delta >= 0 ? '#00d4b0' : '#ff5c5c'
                return (
                  <span key={row.layer} style={{ fontSize: 7, color, fontFamily: MONO }}>
                    {LAYER_SHORT[row.layer]}: {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
                  </span>
                )
              })}
            </div>
          </div>

          {/* ── Row 3: Fold scatter + Signal IC ───────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', gap: 12 }}>

            {/* Fold Scatter */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 16px' }}>
              <SectionHeader label="FOLD-BY-FOLD OOS SHARPE" right={
                <div style={{ display: 'flex', gap: 8 }}>
                  {foldScatterLayers.map(l => (
                    <span key={l} style={{ fontSize: 7, color: LAYER_COLORS[l], fontFamily: MONO }}>■ {LAYER_SHORT[l]}</span>
                  ))}
                </div>
              } />
              {report.folds.length > 0 ? (
                <FoldScatter folds={report.folds} layers={foldScatterLayers} />
              ) : (
                <div style={{ color: 'var(--text3)', fontSize: 9, textAlign: 'center', padding: 20 }}>No fold detail available</div>
              )}
            </div>

            {/* Signal IC */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 16px' }}>
              <SectionHeader label="ICT SIGNAL IC (OOS 30%) · FIRE RATES" />
              <SignalICBars ict_ic={report.ict_ic} signal_fire_rates={report.signal_fire_rates} />

              {/* Fire rates summary bar */}
              <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
                <div style={{ fontSize: 8, color: 'var(--text3)', marginBottom: 6, letterSpacing: '0.08em' }}>FIRE RATES</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                  {Object.entries(report.signal_fire_rates).map(([k, v]) => {
                    const SHORT: Record<string, string> = {
                      v_ict_bias_bull: 'BIAS BULL', v_ict_bias_bear: 'BIAS BEAR',
                      v_ict_bias_neutral: 'NEUTRAL', v_ict_kz: 'KZ',
                      v_ict_ob: 'OB', v_ict_fvg: 'FVG',
                      ict_t1_level: 'T1', ict_bias_strong: 'BIAS STR', v_ict_gate: 'GATE',
                    }
                    return (
                      <div key={k} style={{ fontSize: 7, display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span style={{ color: 'var(--text3)' }}>{SHORT[k] ?? k}</span>
                        <span style={{ color: 'var(--text)', fontWeight: 600 }}>{(v * 100).toFixed(1)}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── Row 4: Correlation heatmap + KZ overlap + Devils ─────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>

            {/* Correlation heatmap */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 16px' }}>
              <SectionHeader label="ICT × EXISTING SIGNAL CORRELATION (SPEARMAN)" />
              <CorrHeatmap audit={report.correlation_audit} />
              <div style={{ marginTop: 8, fontSize: 7, color: 'var(--text3)' }}>
                Low values = ICT signals are orthogonal to existing ensemble → additive alpha
              </div>
            </div>

            {/* KZ Overlap */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 16px' }}>
              <SectionHeader label="KZ / HOUR_KILLS OVERLAP" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  ['TOTAL BARS', (report.killzone_overlap.total_bars / 1e6).toFixed(2) + 'M', 'var(--text)'],
                  ['ICT KZ BARS', (report.killzone_overlap.ict_kz_bars / 1e3).toFixed(0) + 'K', '#00d4b0'],
                  ['HOUR KILLS BARS', (report.killzone_overlap.hour_kills_bars / 1e3).toFixed(0) + 'K', '#8b7cf8'],
                  ['KZ BLOCKED BY HK', (report.killzone_overlap.kz_blocked_by_hk * 100).toFixed(1) + '%',
                    report.killzone_overlap.kz_blocked_by_hk < 0.4 ? '#00ff88' : '#ffd700'],
                  ['KZ PASS-THROUGH', (report.killzone_overlap.kz_pass_through_pct * 100).toFixed(1) + '%', '#00ff88'],
                ].map(([k, v, c]) => (
                  <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: 'var(--text3)' }}>{k}</span>
                    <span style={{ color: c as string, fontWeight: 700, fontFamily: MONO }}>{v}</span>
                  </div>
                ))}
                <div style={{
                  marginTop: 6, padding: '6px 8px', borderRadius: 4,
                  background: report.killzone_overlap.kz_blocked_by_hk < 0.4 ? 'rgba(0,255,136,0.08)' : 'rgba(255,213,0,0.08)',
                  border: `1px solid ${report.killzone_overlap.kz_blocked_by_hk < 0.4 ? 'rgba(0,255,136,0.3)' : 'rgba(255,213,0,0.3)'}`,
                  fontSize: 8,
                  color: report.killzone_overlap.kz_blocked_by_hk < 0.4 ? '#00ff88' : '#ffd700',
                }}>
                  {report.killzone_overlap.note}
                </div>
              </div>
            </div>

            {/* Devil's Advocate */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 16px' }}>
              <SectionHeader label="DEVIL'S ADVOCATE" />
              {report.devils_advocate.length === 0 ? (
                <div style={{ fontSize: 8, color: '#00ff88', padding: '8px 0' }}>
                  ✓ No major issues — ICT signals appear additive and non-redundant
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {report.devils_advocate.map((d, i) => {
                    const isHigh = d.startsWith('HIGH')
                    const isThin = d.startsWith('THIN')
                    const color = isHigh ? '#ff5c5c' : isThin ? '#ffd700' : '#ff8c42'
                    return (
                      <div key={i} style={{
                        fontSize: 8, color, padding: '5px 8px',
                        background: `${color}0e`, borderLeft: `2px solid ${color}55`,
                        borderRadius: '0 3px 3px 0', lineHeight: 1.5,
                      }}>
                        {d}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* NEXT ACTIONS */}
              <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
                <div style={{ fontSize: 7, color: 'var(--text3)', letterSpacing: '0.08em', marginBottom: 6 }}>NEXT: KELLY MULTIPLIER PATH</div>
                {[
                  ['HK+KZ', 'Add v_ict_kz to gate_search.py'],
                  ['KELLY', 'ICT bias_strong → 1.2× size'],
                  ['T1', 'T1 levels as TP targets (not gate)'],
                  ['OB/FVG', 'Test OB/FVG standalone (no T1)'],
                ].map(([tag, text]) => (
                  <div key={tag} style={{ display: 'flex', gap: 6, fontSize: 7, marginBottom: 4 }}>
                    <span style={{ color: '#00d4b0', flexShrink: 0 }}>{tag}</span>
                    <span style={{ color: 'var(--text3)' }}>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Row 5: IS/OOS ratio per fold table (compact) ─────────────── */}
          {report.folds.length > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 16px' }}>
              <SectionHeader label={`FOLD DETAIL — ${report.n_folds} FOLDS · 90d TRAIN / 30d TEST / 15d STEP`} />
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `80px 80px repeat(${Math.min(report.waterfall.length, 9)}, 70px) 60px`, gap: 0, minWidth: 800 }}>
                  {/* Header */}
                  {['OOS START', 'IS SH', ...report.waterfall.map(r => LAYER_SHORT[r.layer] ?? r.layer.slice(0,8)), 'IS/OOS'].map((h, j) => (
                    <div key={j} style={{
                      fontSize: 7, color: 'var(--text3)', padding: '3px 6px',
                      borderBottom: '1px solid rgba(255,255,255,0.08)',
                      textAlign: j > 1 ? 'center' : 'left', whiteSpace: 'nowrap', overflow: 'hidden',
                    }}>{h}</div>
                  ))}
                  {/* Rows — show last 20 folds to keep compact */}
                  {report.folds.slice(-20).map((fold) => {
                    const l0 = fold.layers['L0_base']?.sharpe ?? null
                    return [
                      <div key={`d${fold.fold}`} style={{ fontSize: 7, color: 'var(--text3)', padding: '2px 6px' }}>{fold.oos_start}</div>,
                      <div key={`is${fold.fold}`} style={{ fontSize: 7, color: fold.is_sharpe != null && fold.is_sharpe > 0 ? 'var(--text)' : '#ff5c5c', padding: '2px 6px' }}>
                        {fold.is_sharpe != null ? fold.is_sharpe.toFixed(1) : '—'}
                      </div>,
                      ...report.waterfall.map(row => {
                        const sh = fold.layers[row.layer]?.sharpe ?? null
                        const isWin = row.layer === 'L6c_station_cis' || row.layer === 'HK_+ict_kz'
                        const winColor = row.layer === 'L6c_station_cis' ? '#ffe066' : '#00ff88'
                        const color = sh == null ? 'var(--text3)' : sh > 0 ? (isWin ? winColor : '#00d4b0') : '#ff5c5c'
                        return (
                          <div key={`${fold.fold}_${row.layer}`} style={{
                            fontSize: 7, padding: '2px 4px', textAlign: 'center',
                            color, background: isWin && sh != null && sh > 0 ? `rgba(${row.layer === 'L6c_station_cis' ? '255,224,102' : '0,255,136'},0.04)` : 'transparent',
                          }}>
                            {sh != null ? (sh >= 0 ? '+' : '') + sh.toFixed(1) : '—'}
                          </div>
                        )
                      }),
                      <div key={`io${fold.fold}`} style={{
                        fontSize: 7, padding: '2px 6px', textAlign: 'center',
                        color: fold.is_oos_ratio != null && fold.is_oos_ratio > 0.4 ? '#00d4b0' : '#ffd700',
                      }}>
                        {fold.is_oos_ratio != null ? fold.is_oos_ratio.toFixed(2) : '—'}
                      </div>
                    ]
                  })}
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
