/**
 * StarOptimizerPage — Death Star Ray Signal Optimizer
 * Displays optimization pipeline with traffic lights, heatmaps, Kelly sizing.
 * Fetches from DS :8000/api/star-report/ or falls back to star_report.json.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import './StarOptimizerPage.css'

const DS_URL = 'http://127.0.0.1:8000/api/star-report/'

// ── types ─────────────────────────────────────────────────────────────────────
interface TrafficLight {
  name: string; desc: string; sharpe: number | null
  delta: number | null; light: string; verdict: string
}
interface HourStat {
  hour: number; sharpe: number | null; n_trades: number
  hit_rate: number | null; kelly_half: number | null; light: string
}
interface DayStat {
  day: string; sharpe: number | null; n_trades: number
  hit_rate: number | null; kelly_half: number | null; light: string
}
interface RegimeStat {
  sharpe: number | null; n_trades: number; pct_bars: number
  kelly_half: number | null; hit_rate: number | null; light: string
}
interface RvolTier {
  label: string; rvol_lo: number; rvol_hi: number
  sharpe: number | null; n_trades: number; light: string
}
interface ScalperMode {
  label: string; sharpe: number | null; n_trades: number
  kelly_half: number | null; hit_rate: number | null; light: string
}
interface HpRow {
  rvol_floor: number; min_signals: number; sharpe: number | null
  n_trades: number; kelly_half: number | null; light: string
}
interface StarItem { name: string; lit: boolean; detail: string }
interface StarData {
  stars: StarItem[]; count: number; display: string
  kelly_multiplier: number; suggestion: string
}
interface KellyData {
  full: number | null; half: number | null; win_rate: number | null
  rr: number | null; avg_win_pct: number | null; avg_loss_pct: number | null
}
interface StarReport {
  generated_at: string; horizon: string; symbols: string[]
  traffic_lights: TrafficLight[]
  hour_analysis: { by_hour: Record<number, HourStat>; best_hours: number[]; kill_hours: number[] }
  day_analysis:  { by_day:  Record<number, DayStat>;  best_days:  number[]; kill_days:  number[] }
  regime_perf:   Record<string, RegimeStat>
  rvol_tiers:    RvolTier[]
  kelly:         KellyData
  stars_current: StarData
  scalper:       { modes: ScalperMode[] }
  hyperparam_grid: HpRow[]
  summary: {
    baseline_sharpe: number | null; regime_sharpe: number | null
    hour_filtered_sharpe: number | null; day_filtered_sharpe: number | null
    best_hours: number[]; kill_hours: number[]
    best_days: number[]; kill_days: number[]
    top_hyperparam: HpRow | null
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
const LIGHT_COLOR: Record<string, string> = {
  green:  '#00c8a0',
  yellow: '#f0a030',
  red:    '#e05050',
  grey:   '#445566',
}
const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function fmt(n: number | null | undefined, dec = 3): string {
  if (n == null || isNaN(n as number)) return '—'
  return (n as number).toFixed(dec)
}

// ── traffic light dot ─────────────────────────────────────────────────────────
function TLDot({ light, size = 10 }: { light: string; size?: number }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: LIGHT_COLOR[light] ?? '#445566',
      boxShadow: `0 0 6px ${LIGHT_COLOR[light] ?? '#445566'}88`,
      flexShrink: 0,
    }} />
  )
}

// ── hour heatmap ──────────────────────────────────────────────────────────────
function HourHeatmap({ byHour, killHours }: {
  byHour: Record<number, HourStat>; killHours: number[]
}) {
  const maxS = Math.max(...Object.values(byHour).map(h => h.sharpe ?? 0))
  const minS = Math.min(...Object.values(byHour).map(h => h.sharpe ?? 0))

  function cellColor(s: number | null) {
    if (s == null) return '#1a2a3a'
    if (s >= 1.5) return '#00c8a0'
    if (s >= 0.5) return '#f0a030'
    if (s >= 0)   return '#2a4a3a'
    return '#5a1a1a'
  }

  return (
    <div className="so-heatmap-grid">
      {Array.from({ length: 24 }, (_, h) => {
        const stat = byHour[h]
        const killed = killHours.includes(h)
        return (
          <div
            key={h}
            className={`so-hour-cell${killed ? ' killed' : ''}`}
            style={{ background: cellColor(stat?.sharpe ?? null) }}
            title={`${h}:00  Sharpe ${fmt(stat?.sharpe)}  Trades ${stat?.n_trades}  ${killed ? '✗ KILLED' : ''}`}
          >
            <span className="so-hour-label">{h.toString().padStart(2, '0')}</span>
            <span className="so-hour-s">{fmt(stat?.sharpe, 1)}</span>
            {killed && <span className="so-hour-kill">✗</span>}
          </div>
        )
      })}
    </div>
  )
}

// ── day bar chart ─────────────────────────────────────────────────────────────
function DayBars({ byDay, killDays }: {
  byDay: Record<number, DayStat>; killDays: number[]
}) {
  const maxS = Math.max(...Object.values(byDay).map(d => Math.abs(d.sharpe ?? 0)), 0.01)
  return (
    <div className="so-day-bars">
      {Array.from({ length: 7 }, (_, d) => {
        const stat = byDay[d]
        const killed = killDays.includes(d)
        const s = stat?.sharpe ?? 0
        const pct = Math.min(Math.abs(s) / maxS * 100, 100)
        const col = killed ? '#5a1a1a' : (s >= 1.5 ? '#00c8a0' : s >= 0.5 ? '#f0a030' : '#e05050')
        return (
          <div key={d} className="so-day-col">
            <div className="so-day-bar-wrap">
              <div className="so-day-bar" style={{ height: `${pct}%`, background: col }} />
            </div>
            <span className="so-day-label" style={{ color: killed ? '#e05050' : '#8899aa' }}>
              {DAYS_SHORT[d]}
            </span>
            <span className="so-day-s" style={{ color: col }}>{fmt(stat?.sharpe, 1)}</span>
            {killed && <span className="so-day-kill">✗</span>}
          </div>
        )
      })}
    </div>
  )
}

// ── kelly panel ───────────────────────────────────────────────────────────────
function KellyPanel({ kelly, stars }: { kelly: KellyData; stars: StarData }) {
  const eff = ((kelly.half ?? 0) * stars.kelly_multiplier).toFixed(1)
  return (
    <div className="so-kelly-panel">
      <div className="so-kelly-header">KELLY SIZER</div>
      <div className="so-kelly-row">
        <span className="so-kelly-label">Full Kelly</span>
        <span className="so-kelly-val green">{fmt(kelly.full, 1)}%</span>
      </div>
      <div className="so-kelly-row">
        <span className="so-kelly-label">Half Kelly</span>
        <span className="so-kelly-val yellow">{fmt(kelly.half, 1)}%</span>
      </div>
      <div className="so-kelly-row">
        <span className="so-kelly-label">Win Rate</span>
        <span className="so-kelly-val">{kelly.win_rate != null ? `${(kelly.win_rate * 100).toFixed(1)}%` : '—'}</span>
      </div>
      <div className="so-kelly-row">
        <span className="so-kelly-label">R:R Ratio</span>
        <span className="so-kelly-val">{fmt(kelly.rr, 2)}</span>
      </div>
      <div className="so-kelly-divider" />
      <div className="so-stars-row">
        {stars.stars.map((s, i) => (
          <span key={i} className={`so-star-item${s.lit ? ' lit' : ''}`} title={s.detail}>
            {s.lit ? '★' : '☆'} {s.name}
          </span>
        ))}
      </div>
      <div className="so-stars-total">{stars.display}</div>
      <div className="so-stars-suggest">{stars.suggestion}</div>
      <div className="so-kelly-eff">
        Effective size: <strong>{eff}%</strong> × {stars.kelly_multiplier}x
      </div>
    </div>
  )
}

// ── activity types ────────────────────────────────────────────────────────────
interface ActivityCurrent {
  activity_score: number; tick_score: number; grok_score: number | null
  rvol_prank: number; atr_prank: number
  status: 'DEAD' | 'SLOW' | 'ALIVE' | 'HOT'
  gate: 'OPEN' | 'CLOSED'
  kelly_size_mult: number
  reason: string
}
interface ActivityQuintile {
  quintile: string; n_bars: number; activity_mean: number
  sharpe_4h: number | null; sharpe_1h: number | null; win_rate: number
}
interface HourProfile { hour: number; activity_median: number | null; n: number }
interface ActivityReport {
  current: ActivityCurrent
  thresholds: { dead: number; slow: number; alive: number }
  historical: {
    quintiles: ActivityQuintile[]
    baseline_sharpe: number | null
    sharpe_gate_q1_off: number | null
    sharpe_gate_q12_off: number | null
    improvement_q1: number
    improvement_q12: number
    pct_killed_q1: number
    pct_killed_q12: number
    optimal_threshold: number
    optimal_sharpe: number
    n_total: number
  }
  hour_profile: HourProfile[]
  grok_raw: { activity: number; status: string; rvol_proxy: number; reason: string } | null
  generated_at: string
}

const ACTIVITY_URL      = 'http://127.0.0.1:8000/v1/ai/activity/report/'
const ACTIVITY_RUN_URL  = 'http://127.0.0.1:8000/v1/ai/activity/run/'
const SENTIMENT_URL     = 'http://127.0.0.1:8000/v1/ai/sentiment/'
const PCA_URL          = 'http://127.0.0.1:8000/v1/ai/pca/'
const PCA_RUN_URL      = 'http://127.0.0.1:8000/v1/ai/pca/run/'
const ENSEMBLE_URL       = 'http://127.0.0.1:8000/v1/ai/ensemble/'
const ENSEMBLE_RUN_URL   = 'http://127.0.0.1:8000/v1/ai/ensemble/run/'
const CROSS_ASSET_URL    = 'http://127.0.0.1:8000/v1/cross/report/'
const CROSS_ASSET_RUN_URL= 'http://127.0.0.1:8000/v1/cross/run/'
const WF_URL             = 'http://127.0.0.1:8000/v1/walkforward/'
const WF_RUN_URL         = 'http://127.0.0.1:8000/v1/walkforward/run/'
const OI_URL             = 'http://127.0.0.1:8000/v1/oi/'
const FNG_URL            = 'http://127.0.0.1:8000/v1/fng/'
const LIQ_URL            = 'http://127.0.0.1:8000/v1/liq/'
const LIQ_STATUS_URL     = 'http://127.0.0.1:8000/v1/liq/status/'
const HALFLIFE_URL       = 'http://127.0.0.1:8000/v1/ic/halflife/'
const HOLDOUT_URL        = 'http://127.0.0.1:8000/v1/holdout/'
const CAPACITY_URL       = 'http://127.0.0.1:8000/v1/capacity/'
const PAPER_URL          = 'http://127.0.0.1:8000/v1/paper/status/'
const IBKR_URL           = 'http://127.0.0.1:8000/v1/ibkr/status/'
const MTF_URL            = 'http://127.0.0.1:8000/v1/mtf/BTCUSDT/'

// ── Sentiment trend types ─────────────────────────────────────────────────────
interface SentimentReading { ts: number; direction: number; pace: number; note: string }
interface SentimentTrend {
  slope: number; mean_direction: number; n_readings: number
  trend_label: 'BUILDING' | 'FADING' | 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'NO_DATA'
  latest_note: string
  readings: SentimentReading[]
}

// ── PCA types ─────────────────────────────────────────────────────────────────
interface PcaComponent {
  pc: number; var_pct: number; cum_var_pct: number
  top_signals: { signal: string; loading: number }[]
}
interface PcaSignalStat {
  signal: string; n_fired: number; fire_rate: number
  mean_ret: number | null; std_ret: number | null; sharpe: number | null
}
interface PcaReport {
  pca: {
    n_signals: number; n_bars: number
    effective_dims: { at_80pct: number; at_90pct: number; at_95pct: number; at_99pct: number }
    interpretation: string
    variance_per_component: number[]
    cumulative_variance: number[]
    components: PcaComponent[]
  }
  correlation: {
    high_corr_pairs: { a: string; b: string; corr: number; flag: string }[]
    mod_corr_pairs:  { a: string; b: string; corr: number; flag: string }[]
  }
  per_signal: PcaSignalStat[]
  survivors: string[]
  killed: string[]
}

// ── Cross-Asset types ─────────────────────────────────────────────────────────
interface CrossDim {
  score: number; interpretation?: string
  history_24h?: number[]; error?: string
  alts_used?: string[]; defi_used?: string[]
  current_corr?: number; mean_corr?: number
}
interface CrossAssetReport {
  ok: boolean; ts: number; composite: number
  regime: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL'
  weights: Record<string, number>
  dimensions: {
    btc_eth_ratio: CrossDim; alt_beta: CrossDim
    defi_momentum: CrossDim; l1_spread: CrossDim; btc_corr_break: CrossDim
  }
  symbols_loaded: string[]; n_bars: number
}

// ── Walk-Forward types ────────────────────────────────────────────────────────
interface WfSignalLC {
  status: 'ALIVE' | 'RISING' | 'PROBATION' | 'DEAD' | 'MIXED' | 'INSUFFICIENT_DATA'
  ic_mean: number | null; ic_std: number | null; ic_slope: number | null
  pct_positive: number; decay_pct: number; ic_history: number[]
  early_mean: number | null; late_mean: number | null
}
interface WfFold {
  fold: number; train_start: string; train_end: string
  test_start: string; test_end: string
  n_train_bars: number; n_test_bars: number
  is: { sharpe: number | null; n_trades: number; hit_rate: number | null }
  oos: { sharpe: number | null; n_trades: number; hit_rate: number | null; regime_bd: Record<string, {sharpe:number;n:number}> }
  is_oos_ratio: number | null; ic: number | null; sig_ic: Record<string, number | null>
  top_weights: [string, number][]
}
interface WfReport {
  ok: boolean; n_folds: number; generated_at: string; elapsed_s: number
  config: { train_days: number; test_days: number; step_days: number; embargo_days: number; threshold: number; outcome: string }
  summary: {
    oos_sharpe:   { mean: number; std: number; min: number; max: number; pct_positive: number }
    is_sharpe:    { mean: number; std: number; min: number; max: number }
    ic:           { mean: number; std: number }
    is_oos_ratio: { mean: number; std: number }
    oos_sharpe_slope: number | null
    ic_slope: number | null
  }
  regime_summary: Record<string, { mean_sharpe: number; pct_positive: number; n_folds: number }>
  rentech_gates: Record<string, boolean>
  gates_passed: string; verdict: 'ROBUST' | 'PROMISING' | 'FRAGILE' | 'OVERFIT'
  signal_lifecycle: Record<string, WfSignalLC>
  retire_candidates: string[]; probation_list: string[]; rising_list: string[]
  folds: WfFold[]
}

// ── Ensemble types ────────────────────────────────────────────────────────────
interface EnsembleBranch {
  best_threshold: number; best_sharpe: number | null; n_trades: number; win_rate: number | null
  threshold_sweep: { threshold: number; sharpe: number | null; n_trades: number; win_rate: number | null }[]
  regime_breakdown: { regime: string; sharpe: number | null; n_trades: number; top_signals: [string, number][] }[]
  equity_curve: number[]
}
interface EnsembleReport {
  equal_weight:    EnsembleBranch
  sharpe_weighted: EnsembleBranch
  improvement: { delta_sharpe: number; verdict: string; pct_change: number | null }
  regime_weights: { regime: string; signals: { signal: string; weight: number }[] }[]
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function StarOptimizerPage() {
  const [report, setReport]         = useState<StarReport | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [running, setRunning]       = useState(false)
  const [activeTab, setActiveTab]   = useState<'lights' | 'hours' | 'days' | 'scalper' | 'hyper' | 'activity' | 'pca' | 'ensemble' | 'cross' | 'wf' | 'lot' | 'health' | 'paper'>('lights')
  const [actData, setActData]       = useState<ActivityReport | null>(null)
  const [actRunning, setActRunning] = useState(false)
  const [sentTrend, setSentTrend]   = useState<SentimentTrend | null>(null)
  const [pcaData, setPcaData]       = useState<PcaReport | null>(null)
  const [ensData, setEnsData]       = useState<EnsembleReport | null>(null)
  const [pcaRunning, setPcaRunning]     = useState(false)
  const [ensRunning, setEnsRunning]     = useState(false)
  const [crossData, setCrossData]       = useState<CrossAssetReport | null>(null)
  const [crossRunning, setCrossRunning] = useState(false)
  const [wfData, setWfData]             = useState<WfReport | null>(null)
  const [wfRunning, setWfRunning]       = useState(false)
  // LOT-SIZING tab state
  const [oiData, setOiData]             = useState<any>(null)
  const [fngData, setFngData]           = useState<any>(null)
  const [liqData, setLiqData]           = useState<any>(null)
  const [liqStatus, setLiqStatus]       = useState<any>(null)
  const [mtfData, setMtfData]           = useState<any>(null)
  // SIGNAL-HEALTH tab state
  const [hlData, setHlData]             = useState<any>(null)
  const [holdoutData, setHoldoutData]   = useState<any>(null)
  const [capData, setCapData]           = useState<any>(null)
  // PAPER-LIVE tab state
  const [paperData, setPaperData]       = useState<any>(null)
  const [ibkrData, setIbkrData]         = useState<any>(null)

  const loadActivity = useCallback(async () => {
    try {
      const r = await fetch(ACTIVITY_URL, { signal: AbortSignal.timeout(6000) })
      if (r.ok) setActData(await r.json())
    } catch { /* silent */ }
    try {
      const r2 = await fetch(SENTIMENT_URL, { signal: AbortSignal.timeout(6000) })
      if (r2.ok) { const d = await r2.json(); if (d.ok) setSentTrend(d.trend) }
    } catch { /* silent */ }
  }, [])

  const loadPca = useCallback(async () => {
    try {
      const r = await fetch(PCA_URL, { signal: AbortSignal.timeout(6000) })
      if (r.ok) setPcaData(await r.json())
    } catch { /* silent */ }
  }, [])

  const loadEns = useCallback(async () => {
    try {
      const r = await fetch(ENSEMBLE_URL, { signal: AbortSignal.timeout(6000) })
      if (r.ok) setEnsData(await r.json())
    } catch { /* silent */ }
  }, [])

  const loadCross = useCallback(async () => {
    try {
      const r = await fetch(CROSS_ASSET_URL, { signal: AbortSignal.timeout(6000) })
      if (r.ok) setCrossData(await r.json())
    } catch { /* silent */ }
  }, [])

  const loadWf = useCallback(async () => {
    try {
      const r = await fetch(WF_URL, { signal: AbortSignal.timeout(6000) })
      if (r.ok) setWfData(await r.json())
    } catch { /* silent */ }
  }, [])

  const loadLot = useCallback(async () => {
    try { const r = await fetch(OI_URL,     { signal: AbortSignal.timeout(5000) }); if (r.ok) setOiData(await r.json()) } catch {}
    try { const r = await fetch(FNG_URL,    { signal: AbortSignal.timeout(5000) }); if (r.ok) setFngData(await r.json()) } catch {}
    try { const r = await fetch(LIQ_URL,    { signal: AbortSignal.timeout(5000) }); if (r.ok) setLiqData(await r.json()) } catch {}
    try { const r = await fetch(LIQ_STATUS_URL, { signal: AbortSignal.timeout(5000) }); if (r.ok) setLiqStatus(await r.json()) } catch {}
    try { const r = await fetch(MTF_URL,    { signal: AbortSignal.timeout(5000) }); if (r.ok) setMtfData(await r.json()) } catch {}
  }, [])

  const loadHealth = useCallback(async () => {
    try { const r = await fetch(HALFLIFE_URL, { signal: AbortSignal.timeout(6000) }); if (r.ok) setHlData(await r.json()) } catch {}
    try { const r = await fetch(HOLDOUT_URL,  { signal: AbortSignal.timeout(6000) }); if (r.ok) setHoldoutData(await r.json()) } catch {}
    try { const r = await fetch(CAPACITY_URL, { signal: AbortSignal.timeout(6000) }); if (r.ok) setCapData(await r.json()) } catch {}
  }, [])

  const loadPaper = useCallback(async () => {
    try { const r = await fetch(PAPER_URL, { signal: AbortSignal.timeout(6000) }); if (r.ok) setPaperData(await r.json()) } catch {}
    try { const r = await fetch(IBKR_URL,  { signal: AbortSignal.timeout(6000) }); if (r.ok) setIbkrData(await r.json()) } catch {}
  }, [])

  const triggerPca = async () => {
    setPcaRunning(true)
    try {
      await fetch(PCA_RUN_URL, { method: 'POST' })
      await new Promise(r => setTimeout(r, 10000))
      await loadPca()
    } catch { /* ignore */ }
    setPcaRunning(false)
  }

  const triggerEns = async () => {
    setEnsRunning(true)
    try {
      await fetch(ENSEMBLE_RUN_URL, { method: 'POST' })
      await new Promise(r => setTimeout(r, 10000))
      await loadEns()
    } catch { /* ignore */ }
    setEnsRunning(false)
  }

  const triggerActivity = async (noGrok = false) => {
    setActRunning(true)
    try {
      await fetch(`${ACTIVITY_RUN_URL}${noGrok ? '?no_grok=1' : ''}`, { method: 'POST' })
      await new Promise(r => setTimeout(r, 8000))
      await loadActivity()
    } catch { /* ignore */ }
    setActRunning(false)
  }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(DS_URL, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setReport(await res.json())
    } catch {
      try {
        const res2 = await fetch('/star_report.json', { signal: AbortSignal.timeout(4000) })
        if (!res2.ok) throw new Error('fallback failed')
        setReport(await res2.json())
      } catch (e2) {
        setError('Cannot reach DS API (:8000). Run: python ds_app/star_optimizer.py')
      }
    }
    setLoading(false)
  }, [])

  const triggerCross = async () => {
    setCrossRunning(true)
    try {
      const r = await fetch(CROSS_ASSET_RUN_URL, { method: 'POST' })
      if (r.ok) setCrossData(await r.json())
    } catch { /* ignore */ }
    setCrossRunning(false)
  }

  const triggerWf = async () => {
    setWfRunning(true)
    try {
      await fetch(WF_RUN_URL, { method: 'POST' })
      await new Promise(r => setTimeout(r, 65000))
      await loadWf()
    } catch { /* ignore */ }
    setWfRunning(false)
  }

  useEffect(() => { load(); loadActivity(); loadPca(); loadEns(); loadCross(); loadWf(); loadLot(); loadHealth(); loadPaper() }, [load, loadActivity, loadPca, loadEns, loadCross, loadWf, loadLot, loadHealth, loadPaper])

  const triggerRerun = async (horizon = '4h') => {
    setRunning(true)
    try {
      await fetch(`http://127.0.0.1:8000/api/star-rerun/?horizon=${horizon}`, { method: 'POST' })
      await new Promise(r => setTimeout(r, 3000))
      await load()
    } catch { setError('Rerun failed — DS server may be offline') }
    setRunning(false)
  }

  if (loading) return <div className="so-loading">Loading Star Report…</div>
  if (error)   return <div className="so-error">{error}<br /><button onClick={load}>Retry</button></div>
  if (!report) return null

  const { traffic_lights: tl, hour_analysis: ha, day_analysis: da,
          regime_perf: rp, rvol_tiers, kelly, stars_current: stars,
          scalper, hyperparam_grid: hpGrid, summary } = report

  return (
    <div className="so-page">

      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div className="so-header">
        <div className="so-title">
          <span className="so-star-icon">★</span> STAR-RAY OPTIMIZER
          <span className="so-subtitle"> / DEATH STAR KILL FILTER</span>
        </div>
        <div className="so-meta">
          {report.symbols.join(' · ')} &nbsp;·&nbsp; {report.horizon}&nbsp;horizon
          &nbsp;·&nbsp; {report.oos_rows?.toLocaleString()} OOS bars
          &nbsp;·&nbsp; {report.generated_at?.slice(0, 16)}
        </div>
        <div className="so-actions">
          <button className="so-btn" onClick={() => triggerRerun('4h')} disabled={running}>
            {running ? '⟳ Running…' : '▶ Re-Run 4h'}
          </button>
          <button className="so-btn" onClick={() => triggerRerun('1h')} disabled={running}>1h</button>
          <button className="so-btn" onClick={load}>↺ Refresh</button>
        </div>
      </div>

      {/* ── KPI strip ──────────────────────────────────────────────────────── */}
      <div className="so-kpi-strip">
        {[
          { label: 'BASELINE',    val: fmt(summary.baseline_sharpe),        col: LIGHT_COLOR['yellow'] },
          { label: 'REGIME',      val: fmt(summary.regime_sharpe),          col: LIGHT_COLOR['green']  },
          { label: '+HOUR KILL',  val: fmt(summary.hour_filtered_sharpe),   col: LIGHT_COLOR['green']  },
          { label: '+DAY KILL',   val: fmt(summary.day_filtered_sharpe),    col: LIGHT_COLOR['green']  },
          { label: 'KILL HOURS',  val: summary.kill_hours?.join(', ') ?? '—', col: '#e05050' },
          { label: 'KILL DAYS',   val: summary.kill_days?.map(d => DAYS_SHORT[d]).join(' ') ?? '—', col: '#e05050' },
          { label: 'KELLY HALF',  val: `${fmt(kelly.half, 1)}%`,           col: '#f0a030'  },
          { label: 'WIN RATE',    val: kelly.win_rate != null ? `${(kelly.win_rate*100).toFixed(1)}%` : '—', col: '#8899aa' },
        ].map(k => (
          <div className="so-kpi" key={k.label}>
            <span className="so-kpi-val" style={{ color: k.col }}>{k.val}</span>
            <span className="so-kpi-label">{k.label}</span>
          </div>
        ))}
      </div>

      {/* ── tabs ───────────────────────────────────────────────────────────── */}
      <div className="so-tabs">
        {(['lights', 'hours', 'days', 'scalper', 'hyper', 'activity', 'pca', 'ensemble', 'cross', 'wf', 'lot', 'health', 'paper'] as const).map(t => (
          <button key={t} className={`so-tab${activeTab === t ? ' active' : ''}`}
            onClick={() => setActiveTab(t)}>
            {{ lights: '🚦 PIPELINE', hours: '⏰ HOURS', days: '📅 DAYS',
               scalper: '⚡ SCALPER', hyper: '🔬 HYPERPARAMS',
               activity: `◉ ACTIVITY${actData ? ` · ${actData.current.status}` : ''}`,
               pca:      `⬡ PCA DIMS${pcaData ? ` · ${pcaData.pca.effective_dims.at_80pct}D` : ''}`,
               ensemble: `⚖ ENSEMBLE${ensData ? ` · ${fmt(ensData.sharpe_weighted.best_sharpe)}` : ''}`,
               cross:    `⬡ CROSS-ASSET${crossData ? ` · ${crossData.regime}` : ''}`,
               wf:       `↻ WALK-FWD${wfData ? ` · ${wfData.verdict}` : ''}`,
               lot:      `⚙ LOT-SIZING${fngData ? ` · F&G ${fngData.value}` : ''}`,
               health:   `🧬 SIG-HEALTH${holdoutData ? ` · ${holdoutData.verdict ?? '—'}` : ''}`,
               paper:    `📋 PAPER-LIVE${paperData ? ` · ${paperData.account?.equity ? '$'+Math.round(paperData.account.equity) : '—'}` : ''}`,
             }[t]}
          </button>
        ))}
      </div>

      {/* ── tab: traffic lights ────────────────────────────────────────────── */}
      {activeTab === 'lights' && (
        <div className="so-body">
          <div className="so-tl-col">
            <div className="so-section-title">OPTIMIZATION PIPELINE</div>
            {tl.map((step, i) => (
              <div key={i} className="so-tl-row">
                <TLDot light={step.light} size={12} />
                <div className="so-tl-info">
                  <span className="so-tl-name">{step.name}</span>
                  <span className="so-tl-desc">{step.desc}</span>
                </div>
                <div className="so-tl-nums">
                  {step.sharpe != null && (
                    <span className="so-tl-sharpe" style={{ color: LIGHT_COLOR[step.light] }}>
                      {fmt(step.sharpe)}
                    </span>
                  )}
                  {step.delta != null && (
                    <span className={`so-tl-delta ${step.delta > 0 ? 'pos' : 'neg'}`}>
                      {step.delta > 0 ? '+' : ''}{fmt(step.delta)}
                    </span>
                  )}
                </div>
                <div className={`so-tl-verdict ${step.light}`}>{step.verdict}</div>
              </div>
            ))}

            {/* regime table */}
            <div className="so-section-title" style={{ marginTop: 24 }}>REGIME PERFORMANCE</div>
            <div className="so-regime-grid">
              {Object.entries(rp).map(([reg, stat]) => (
                <div key={reg} className="so-regime-cell" style={{ borderColor: LIGHT_COLOR[stat.light] }}>
                  <div className="so-regime-name">{reg}</div>
                  <div className="so-regime-s" style={{ color: LIGHT_COLOR[stat.light] }}>
                    {fmt(stat.sharpe)}
                  </div>
                  <div className="so-regime-detail">{stat.pct_bars}% bars · {stat.n_trades.toLocaleString()} trades</div>
                  <TLDot light={stat.light} size={8} />
                </div>
              ))}
            </div>

            {/* rvol tiers */}
            <div className="so-section-title" style={{ marginTop: 24 }}>VOLUME TIER ANALYSIS</div>
            <div className="so-rvol-grid">
              {rvol_tiers.map((t, i) => (
                <div key={i} className="so-rvol-cell">
                  <TLDot light={t.light} size={8} />
                  <span className="so-rvol-label">{t.label}</span>
                  <span className="so-rvol-s" style={{ color: LIGHT_COLOR[t.light] }}>{fmt(t.sharpe)}</span>
                  <span className="so-rvol-n">{t.n_trades.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          <KellyPanel kelly={kelly} stars={stars} />
        </div>
      )}

      {/* ── tab: hours ─────────────────────────────────────────────────────── */}
      {activeTab === 'hours' && (
        <div className="so-body-full">
          <div className="so-section-title">
            HOUR-OF-DAY SHARPE (UTC)
            &nbsp;·&nbsp; Kill: {ha.kill_hours.map(h => `${h}:00`).join(', ')}
            &nbsp;·&nbsp; Best: {ha.best_hours.map(h => `${h}:00`).join(', ')}
          </div>
          <HourHeatmap byHour={ha.by_hour} killHours={ha.kill_hours} />
          <div className="so-hour-table">
            <table>
              <thead>
                <tr><th>Hour (UTC)</th><th>Sharpe</th><th>Trades</th><th>Hit%</th><th>Kelly½%</th><th>Status</th></tr>
              </thead>
              <tbody>
                {Array.from({ length: 24 }, (_, h) => {
                  const s = ha.by_hour[h]
                  const killed = ha.kill_hours.includes(h)
                  return (
                    <tr key={h} className={killed ? 'so-row-kill' : ''}>
                      <td>{h.toString().padStart(2, '0')}:00 {killed ? '✗' : ''}</td>
                      <td style={{ color: LIGHT_COLOR[s?.light ?? 'grey'] }}>{fmt(s?.sharpe)}</td>
                      <td>{s?.n_trades?.toLocaleString()}</td>
                      <td>{s?.hit_rate != null ? `${(s.hit_rate * 100).toFixed(1)}%` : '—'}</td>
                      <td>{fmt(s?.kelly_half, 1)}</td>
                      <td><TLDot light={s?.light ?? 'grey'} size={8} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── tab: days ──────────────────────────────────────────────────────── */}
      {activeTab === 'days' && (
        <div className="so-body-full">
          <div className="so-section-title">
            DAY-OF-WEEK SHARPE
            &nbsp;·&nbsp; Kill: {da.kill_days.map(d => DAYS_SHORT[d]).join(', ')}
          </div>
          <DayBars byDay={da.by_day} killDays={da.kill_days} />
          <div className="so-hour-table">
            <table>
              <thead>
                <tr><th>Day</th><th>Sharpe</th><th>Trades</th><th>Hit%</th><th>Kelly½%</th><th>Status</th></tr>
              </thead>
              <tbody>
                {Array.from({ length: 7 }, (_, d) => {
                  const s = da.by_day[d]
                  const killed = da.kill_days.includes(d)
                  return (
                    <tr key={d} className={killed ? 'so-row-kill' : ''}>
                      <td>{DAYS_SHORT[d]} {killed ? '✗ KILLED' : ''}</td>
                      <td style={{ color: LIGHT_COLOR[s?.light ?? 'grey'] }}>{fmt(s?.sharpe)}</td>
                      <td>{s?.n_trades?.toLocaleString()}</td>
                      <td>{s?.hit_rate != null ? `${(s.hit_rate * 100).toFixed(1)}%` : '—'}</td>
                      <td>{fmt(s?.kelly_half, 1)}</td>
                      <td><TLDot light={s?.light ?? 'grey'} size={8} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── tab: scalper ───────────────────────────────────────────────────── */}
      {activeTab === 'scalper' && (
        <div className="so-body-full">
          <div className="so-section-title">MASTER SCALPER — 1h Horizon, Loose Entry, Many Trades</div>
          <div className="so-scalper-grid">
            {scalper.modes.map((m, i) => (
              <div key={i} className="so-scalper-card" style={{ borderColor: LIGHT_COLOR[m.light] }}>
                <div className="so-scalper-label">{m.label}</div>
                <div className="so-scalper-s" style={{ color: LIGHT_COLOR[m.light] }}>
                  {fmt(m.sharpe)}
                </div>
                <div className="so-scalper-detail">
                  {m.n_trades.toLocaleString()} trades
                  &nbsp;·&nbsp; {m.hit_rate != null ? `${(m.hit_rate * 100).toFixed(1)}% hit` : '—'}
                  &nbsp;·&nbsp; K½ {fmt(m.kelly_half, 1)}%
                </div>
                <TLDot light={m.light} size={10} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── tab: hyperparams ───────────────────────────────────────────────── */}
      {activeTab === 'hyper' && (
        <div className="so-body-full">
          <div className="so-section-title">
            HYPERPARAM GRID — RVOL floor × Min Signals
            &nbsp;·&nbsp; sorted by OOS Sharpe
          </div>
          <div className="so-hp-top">
            {summary.top_hyperparam && (
              <div className="so-hp-best">
                OPTIMAL: RVOL≥{summary.top_hyperparam.rvol_floor} &nbsp;·&nbsp;
                MinSig={summary.top_hyperparam.min_signals} &nbsp;·&nbsp;
                <span style={{ color: LIGHT_COLOR['green'] }}>Sharpe {fmt(summary.top_hyperparam.sharpe)}</span>
                &nbsp;·&nbsp; {summary.top_hyperparam.n_trades.toLocaleString()} trades
                &nbsp;·&nbsp; Kelly½ {fmt(summary.top_hyperparam.kelly_half, 1)}%
              </div>
            )}
          </div>
          <table className="so-hp-table">
            <thead>
              <tr>
                <th>RVOL≥</th><th>MinSig</th><th>Sharpe</th>
                <th>Trades</th><th>Kelly½%</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {hpGrid.map((row, i) => (
                <tr key={i} className={i === 0 ? 'so-row-best' : ''}>
                  <td>{row.rvol_floor}</td>
                  <td>{row.min_signals}</td>
                  <td style={{ color: LIGHT_COLOR[row.light] }}>{fmt(row.sharpe)}</td>
                  <td>{row.n_trades.toLocaleString()}</td>
                  <td>{fmt(row.kelly_half, 1)}</td>
                  <td><TLDot light={row.light} size={8} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── tab: activity gate ─────────────────────────────────────────────── */}
      {activeTab === 'activity' && (
        <div className="so-body-full">
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 20 }}>

            {actData ? (() => {
              const c = actData.current
              const gateColor = { ALIVE: '#00c8a0', HOT: '#f0c030', SLOW: '#f0a030', DEAD: '#e05050' }[c.status] ?? '#8899aa'
              return (
                <div style={{ background: '#091520', border: `2px solid ${gateColor}`, borderRadius: 8,
                              padding: '20px 28px', minWidth: 220, textAlign: 'center',
                              boxShadow: `0 0 24px ${gateColor}44` }}>
                  <div style={{ fontSize: 11, color: '#556677', letterSpacing: '1.5px', marginBottom: 8 }}>MARKET ACTIVITY GATE</div>
                  <div style={{ fontSize: 48, fontWeight: 700, color: gateColor, lineHeight: 1 }}>{c.status}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: gateColor, margin: '8px 0' }}>
                    {(c.activity_score * 100).toFixed(0)}
                    <span style={{ fontSize: 13, color: '#8899aa' }}>/100</span>
                  </div>
                  <div style={{ fontSize: 13, color: c.gate === 'OPEN' ? '#00c8a0' : '#e05050',
                                fontWeight: 700, letterSpacing: 1 }}>GATE {c.gate}</div>
                  <div style={{ fontSize: 11, color: '#f0a030', marginTop: 6 }}>SIZE MULT {c.kelly_size_mult}×</div>
                  <div style={{ fontSize: 10, color: '#556677', marginTop: 10, maxWidth: 180, margin: '10px auto 0' }}>
                    {c.reason}
                  </div>
                </div>
              )
            })() : (
              <div style={{ background: '#091520', border: '1px solid #0d1f3c', borderRadius: 8,
                            padding: '20px 28px', minWidth: 220, textAlign: 'center', color: '#556677' }}>
                No activity report yet.
              </div>
            )}

            {actData && (
              <div style={{ background: '#091520', border: '1px solid #0d1f3c', borderRadius: 6, padding: 16, minWidth: 200 }}>
                <div className="so-kelly-header">SCORE BREAKDOWN</div>
                {[
                  { label: 'Activity Score', val: actData.current.activity_score.toFixed(3), col: '#c8d8e8' },
                  { label: 'Tick (RVOL+ATR)', val: actData.current.tick_score.toFixed(3), col: '#8899aa' },
                  { label: 'Grok Score', val: actData.current.grok_score != null ? actData.current.grok_score.toFixed(3) : '—', col: '#8899aa' },
                  { label: 'RVOL Percentile', val: (actData.current.rvol_prank * 100).toFixed(0) + '%', col: '#8899aa' },
                  { label: 'ATR Percentile', val: (actData.current.atr_prank * 100).toFixed(0) + '%', col: '#8899aa' },
                ].map(r => (
                  <div key={r.label} className="so-kelly-row">
                    <span className="so-kelly-label">{r.label}</span>
                    <span className="so-kelly-val" style={{ color: r.col }}>{r.val}</span>
                  </div>
                ))}
                <div style={{ fontSize: 10, color: '#445566', marginTop: 10 }}>
                  DEAD &lt;{actData.thresholds.dead} · SLOW &lt;{actData.thresholds.slow} · ALIVE+
                </div>
              </div>
            )}

            {/* sentiment trend panel */}
            <div style={{ background: '#091520', border: '1px solid #0d1f3c', borderRadius: 6, padding: 16, minWidth: 220 }}>
              <div className="so-kelly-header">X SENTIMENT TREND</div>
              {sentTrend && sentTrend.trend_label !== 'NO_DATA' ? (() => {
                const labelCol: Record<string, string> = {
                  BUILDING: '#00c8a0', BULLISH: '#00c8a0',
                  FADING: '#e05050',   BEARISH: '#e05050',
                  NEUTRAL: '#8899aa',
                }
                const col = labelCol[sentTrend.trend_label] ?? '#8899aa'
                // mini sparkline of last 6 readings
                const pts = sentTrend.readings
                const W = 180, H = 36
                const svgPath = pts.length >= 2 ? pts.map((r, i) => {
                  const x = (i / (pts.length - 1)) * W
                  const y = H / 2 - r.direction * (H / 2 - 4)
                  return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
                }).join(' ') : ''
                return (
                  <>
                    <div style={{ fontSize: 20, fontWeight: 700, color: col, marginBottom: 4 }}>
                      {sentTrend.trend_label}
                      <span style={{ fontSize: 11, color: '#556677', marginLeft: 8 }}>
                        slope {sentTrend.slope > 0 ? '+' : ''}{sentTrend.slope.toFixed(2)}
                      </span>
                    </div>
                    {svgPath && (
                      <svg width={W} height={H} style={{ display: 'block', marginBottom: 6 }}>
                        <line x1="0" y1={H/2} x2={W} y2={H/2} stroke="#1a2a3a" strokeWidth="1" />
                        <path d={svgPath} fill="none" stroke={col} strokeWidth="2" />
                        {pts.map((r, i) => {
                          const x = (i / (pts.length - 1)) * W
                          const y = H / 2 - r.direction * (H / 2 - 4)
                          return <circle key={i} cx={x} cy={y} r="3" fill={col} opacity="0.8" />
                        })}
                      </svg>
                    )}
                    <div style={{ fontSize: 10, color: '#556677' }}>
                      {sentTrend.n_readings} readings · mean {sentTrend.mean_direction > 0 ? '+' : ''}{sentTrend.mean_direction.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 10, color: '#8899aa', marginTop: 4, fontStyle: 'italic' }}>
                      "{sentTrend.latest_note}"
                    </div>
                  </>
                )
              })() : (
                <div style={{ fontSize: 10, color: '#445566', lineHeight: 2 }}>
                  No readings yet.<br />
                  Run: <code style={{ color: '#8899aa' }}>python ds_app/xaigrok_activity.py --no-historical</code>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="so-btn" onClick={() => triggerActivity(false)} disabled={actRunning}>
                {actRunning ? '⟳ Running…' : '▶ Full Run (Grok+Tick)'}
              </button>
              <button className="so-btn" onClick={() => triggerActivity(true)} disabled={actRunning}>
                ▶ Tick Only (No Grok)
              </button>
              <button className="so-btn" onClick={loadActivity}>↺ Refresh</button>
              {actData && (
                <div style={{ fontSize: 10, color: '#445566', marginTop: 4 }}>{actData.generated_at?.slice(0, 16)} UTC</div>
              )}
            </div>
          </div>

          {actData?.historical && (
            <>
              <div className="so-section-title">QUINTILE TEST — DOES ACTIVITY GATE ADD EDGE?</div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                {[
                  { label: 'BASELINE',         val: fmt(actData.historical.baseline_sharpe),         col: '#c8d8e8' },
                  { label: 'GATE Q1 OFF',       val: fmt(actData.historical.sharpe_gate_q1_off),      col: '#00c8a0' },
                  { label: 'GATE Q1+Q2 OFF',    val: fmt(actData.historical.sharpe_gate_q12_off),     col: '#00c8a0' },
                  { label: '+ΔSHARPE (Q1)',      val: `${actData.historical.improvement_q1 > 0 ? '+' : ''}${fmt(actData.historical.improvement_q1)}`, col: '#00c8a0' },
                  { label: '% KILLED',           val: `${actData.historical.pct_killed_q1}%`,          col: '#e05050' },
                  { label: 'OPT THRESHOLD',     val: actData.historical.optimal_threshold.toFixed(2), col: '#f0c030' },
                  { label: 'OPT SHARPE',        val: fmt(actData.historical.optimal_sharpe),          col: '#f0c030' },
                ].map(k => (
                  <div key={k.label} className="so-kpi" style={{ flex: 'none', padding: '6px 12px',
                    background: '#091520', border: '1px solid #0d1f3c', borderRadius: 4 }}>
                    <span className="so-kpi-val" style={{ color: k.col }}>{k.val}</span>
                    <span className="so-kpi-label">{k.label}</span>
                  </div>
                ))}
              </div>
              <table className="so-hp-table">
                <thead>
                  <tr><th>QUINTILE</th><th>N BARS</th><th>ACT%</th><th>SHARPE 4H</th><th>SHARPE 1H</th><th>WIN RATE</th><th>★</th></tr>
                </thead>
                <tbody>
                  {actData.historical.quintiles.map((q, i) => {
                    const light = (q.sharpe_4h ?? 0) >= 1.5 ? 'green' : (q.sharpe_4h ?? 0) >= 0.5 ? 'yellow' : 'red'
                    return (
                      <tr key={i} className={i === 0 ? 'so-row-kill' : i === 4 ? 'so-row-best' : ''}>
                        <td style={{ fontWeight: 700 }}>{q.quintile}</td>
                        <td>{q.n_bars.toLocaleString()}</td>
                        <td>{(q.activity_mean * 100).toFixed(0)}</td>
                        <td style={{ color: LIGHT_COLOR[light] }}>{fmt(q.sharpe_4h)}</td>
                        <td style={{ color: '#8899aa' }}>{fmt(q.sharpe_1h)}</td>
                        <td>{(q.win_rate * 100).toFixed(1)}%</td>
                        <td><TLDot light={light} size={8} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}

          {actData?.hour_profile && actData.hour_profile.length > 0 && (
            <>
              <div className="so-section-title" style={{ marginTop: 24 }}>HOUR ACTIVITY PROFILE (UTC)</div>
              <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 72, marginBottom: 6 }}>
                {actData.hour_profile.map(h => {
                  const v = h.activity_median ?? 0
                  const col = v >= 0.55 ? '#00c8a0' : v >= 0.35 ? '#f0a030' : '#5a1a1a'
                  return (
                    <div key={h.hour} style={{ flex: 1, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}
                      title={`${h.hour}:00 UTC  ${v.toFixed(2)}`}>
                      <div style={{ width: '100%', background: col, borderRadius: '2px 2px 0 0',
                                    height: `${v * 100}%`, minHeight: 2 }} />
                      <span style={{ fontSize: 8, color: '#445566', marginTop: 2 }}>{h.hour.toString().padStart(2,'0')}</span>
                    </div>
                  )
                })}
              </div>
              <div style={{ fontSize: 10, color: '#445566' }}>Green≥0.55 ALIVE · Yellow 0.35–0.55 SLOW · Red &lt;0.35 DEAD</div>
            </>
          )}

          {!actData && (
            <div style={{ color: '#556677', marginTop: 40, textAlign: 'center', lineHeight: 2 }}>
              No activity report found.<br />
              Run: <code style={{ color: '#8899aa' }}>python ds_app/xaigrok_activity.py --no-grok --no-historical</code>
            </div>
          )}
        </div>
      )}

      {/* ── tab: PCA dimensions ────────────────────────────────────────────── */}
      {activeTab === 'pca' && (
        <div className="so-body-full">
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className="so-btn" onClick={triggerPca} disabled={pcaRunning}>
              {pcaRunning ? '⟳ Running…' : '▶ Re-Run PCA'}
            </button>
            <button className="so-btn" onClick={loadPca}>↺ Refresh</button>
          </div>

          {pcaData ? (() => {
            const p = pcaData.pca
            const dimColor = p.effective_dims.at_80pct <= 6 ? '#e05050' : p.effective_dims.at_80pct <= 12 ? '#f0a030' : '#00c8a0'
            return (
              <>
                {/* effective dims banner */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                  {[
                    { label: 'TRUE DIMS @ 80%', val: String(p.effective_dims.at_80pct), col: dimColor },
                    { label: 'TRUE DIMS @ 90%', val: String(p.effective_dims.at_90pct), col: dimColor },
                    { label: 'TRUE DIMS @ 95%', val: String(p.effective_dims.at_95pct), col: '#8899aa' },
                    { label: 'OF 23 SIGNALS',   val: String(p.n_signals),               col: '#c8d8e8' },
                    { label: 'OOS BARS',        val: p.n_bars.toLocaleString(),          col: '#8899aa' },
                  ].map(k => (
                    <div key={k.label} className="so-kpi" style={{ flex: 'none', padding: '6px 14px',
                      background: '#091520', border: '1px solid #0d1f3c', borderRadius: 4 }}>
                      <span className="so-kpi-val" style={{ color: k.col }}>{k.val}</span>
                      <span className="so-kpi-label">{k.label}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: dimColor, marginBottom: 16, fontWeight: 600 }}>
                  {p.interpretation}
                </div>

                {/* variance bar */}
                <div className="so-section-title">VARIANCE EXPLAINED PER COMPONENT</div>
                <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 80, marginBottom: 16 }}>
                  {p.variance_per_component.slice(0, 23).map((v, i) => {
                    const cum = p.cumulative_variance[i]
                    const col = cum <= 80 ? '#00c8a0' : cum <= 95 ? '#f0a030' : '#445566'
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column',
                        alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}
                        title={`PC${i+1}: ${v.toFixed(1)}% var, ${cum.toFixed(1)}% cum`}>
                        <div style={{ width: '100%', background: col, borderRadius: '2px 2px 0 0',
                                      height: `${Math.min(v / p.variance_per_component[0] * 100, 100)}%`,
                                      minHeight: 2 }} />
                        <span style={{ fontSize: 8, color: '#445566', marginTop: 2 }}>{i+1}</span>
                      </div>
                    )
                  })}
                </div>
                <div style={{ fontSize: 10, color: '#445566', marginBottom: 20 }}>
                  Green = within 80% · Yellow = 80–95% · Grey = tail
                </div>

                {/* high-corr pairs — the new kill list */}
                {pcaData.correlation.high_corr_pairs.length > 0 && (
                  <>
                    <div className="so-section-title">NEW KILL LIST — HIGH-CORR SIGNAL PAIRS (&gt;0.60)</div>
                    <div style={{ fontSize: 10, color: '#e05050', marginBottom: 10 }}>
                      These signal pairs behave identically at the return level. Keep only the higher-Sharpe signal.
                    </div>
                    <table className="so-hp-table">
                      <thead><tr><th>SIGNAL A</th><th>SIGNAL B</th><th>CORR</th><th>ACTION</th></tr></thead>
                      <tbody>
                        {pcaData.correlation.high_corr_pairs.slice(0, 20).map((p2, i) => (
                          <tr key={i}>
                            <td style={{ color: '#c8d8e8' }}>{p2.a}</td>
                            <td style={{ color: '#c8d8e8' }}>{p2.b}</td>
                            <td style={{ color: Math.abs(p2.corr) > 0.90 ? '#e05050' : '#f0a030', fontWeight: 700 }}>
                              {p2.corr.toFixed(3)}
                            </td>
                            <td style={{ color: '#e05050', fontSize: 10 }}>
                              {Math.abs(p2.corr) > 0.90 ? 'KILL WEAKER' : 'REVIEW'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {/* per-signal stats */}
                <div className="so-section-title" style={{ marginTop: 24 }}>PER-SIGNAL OOS STATS (sorted by Sharpe)</div>
                <table className="so-hp-table">
                  <thead>
                    <tr><th>SIGNAL</th><th>N FIRED</th><th>FIRE%</th><th>MEAN RET%</th><th>SHARPE</th><th>★</th></tr>
                  </thead>
                  <tbody>
                    {pcaData.per_signal.map((s, i) => {
                      const light = (s.sharpe ?? 0) >= 1.5 ? 'green' : (s.sharpe ?? 0) >= 0.5 ? 'yellow' : 'red'
                      return (
                        <tr key={i}>
                          <td style={{ color: '#c8d8e8', fontWeight: 600 }}>{s.signal}</td>
                          <td>{s.n_fired.toLocaleString()}</td>
                          <td>{s.fire_rate != null ? (s.fire_rate * 100).toFixed(1) + '%' : '—'}</td>
                          <td style={{ color: (s.mean_ret ?? 0) > 0 ? '#00c8a0' : '#e05050' }}>
                            {s.mean_ret != null ? s.mean_ret.toFixed(3) : '—'}
                          </td>
                          <td style={{ color: LIGHT_COLOR[light], fontWeight: 700 }}>{fmt(s.sharpe)}</td>
                          <td><TLDot light={light} size={8} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            )
          })() : (
            <div style={{ color: '#556677', marginTop: 40, textAlign: 'center', lineHeight: 2 }}>
              No PCA report. Press ▶ Re-Run PCA or run:<br />
              <code style={{ color: '#8899aa' }}>python ds_app/pca_signals.py</code>
            </div>
          )}
        </div>
      )}

      {/* ── tab: Sharpe-weighted ensemble ─────────────────────────────────── */}
      {activeTab === 'ensemble' && (
        <div className="so-body-full">
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className="so-btn" onClick={triggerEns} disabled={ensRunning}>
              {ensRunning ? '⟳ Running…' : '▶ Re-Run Ensemble'}
            </button>
            <button className="so-btn" onClick={loadEns}>↺ Refresh</button>
          </div>

          {ensData ? (() => {
            const eq = ensData.equal_weight
            const wt = ensData.sharpe_weighted
            const imp = ensData.improvement
            const verdictCol = imp.verdict === 'WEIGHTED WINS' ? '#00c8a0' : imp.verdict === 'EQUAL WINS' ? '#e05050' : '#f0a030'
            return (
              <>
                {/* headline KPIs */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                  {[
                    { label: 'EQUAL-WEIGHT SHARPE', val: fmt(eq.best_sharpe),   col: '#f0a030' },
                    { label: 'WEIGHTED SHARPE',      val: fmt(wt.best_sharpe),   col: '#00c8a0' },
                    { label: 'DELTA SHARPE',          val: `${imp.delta_sharpe > 0 ? '+' : ''}${fmt(imp.delta_sharpe)}`, col: verdictCol },
                    { label: 'VERDICT',               val: imp.verdict,           col: verdictCol },
                    { label: 'EQ TRADES',             val: eq.n_trades.toLocaleString(), col: '#8899aa' },
                    { label: 'WT TRADES',             val: wt.n_trades.toLocaleString(), col: '#8899aa' },
                    { label: 'EQ WIN RATE',           val: eq.win_rate != null ? (eq.win_rate*100).toFixed(1)+'%' : '—', col: '#8899aa' },
                    { label: 'WT WIN RATE',           val: wt.win_rate != null ? (wt.win_rate*100).toFixed(1)+'%' : '—', col: '#00c8a0' },
                  ].map(k => (
                    <div key={k.label} className="so-kpi" style={{ flex: 'none', padding: '6px 14px',
                      background: '#091520', border: '1px solid #0d1f3c', borderRadius: 4 }}>
                      <span className="so-kpi-val" style={{ color: k.col }}>{k.val}</span>
                      <span className="so-kpi-label">{k.label}</span>
                    </div>
                  ))}
                </div>

                {/* mini equity curves side by side */}
                {eq.equity_curve.length > 0 && wt.equity_curve.length > 0 && (() => {
                  const allVals = [...eq.equity_curve, ...wt.equity_curve]
                  const minV = Math.min(...allVals)
                  const maxV = Math.max(...allVals)
                  const range = maxV - minV || 1
                  const H = 100, W = 300
                  const pathFor = (curve: number[], col: string) => {
                    const pts = curve.map((v, i) => {
                      const x = (i / (curve.length - 1)) * W
                      const y = H - ((v - minV) / range) * H
                      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
                    }).join(' ')
                    return <path key={col} d={pts} fill="none" stroke={col} strokeWidth="1.5" />
                  }
                  return (
                    <div style={{ marginBottom: 20 }}>
                      <div className="so-section-title">EQUITY CURVES (OOS)</div>
                      <svg width={W} height={H} style={{ background: '#091520', borderRadius: 4, display: 'block' }}>
                        {pathFor(eq.equity_curve, '#f0a030')}
                        {pathFor(wt.equity_curve, '#00c8a0')}
                      </svg>
                      <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 10, color: '#8899aa' }}>
                        <span style={{ color: '#f0a030' }}>── Equal-weight</span>
                        <span style={{ color: '#00c8a0' }}>── Sharpe-weighted</span>
                      </div>
                    </div>
                  )
                })()}

                {/* regime weight tables */}
                <div className="so-section-title">REGIME SIGNAL WEIGHTS (Sharpe-proportional)</div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
                  {ensData.regime_weights.map(rw => (
                    <div key={rw.regime} style={{ background: '#091520', border: '1px solid #0d1f3c',
                      borderRadius: 4, padding: 12, minWidth: 160 }}>
                      <div style={{ fontSize: 10, color: '#556677', letterSpacing: 1, marginBottom: 8 }}>{rw.regime}</div>
                      {rw.signals.map(s => (
                        <div key={s.signal} style={{ display: 'flex', justifyContent: 'space-between',
                          padding: '2px 0', borderBottom: '1px solid #0d1a28', fontSize: 10 }}>
                          <span style={{ color: '#8899aa' }}>{s.signal}</span>
                          <span style={{ color: '#00c8a0', fontWeight: 600 }}>{s.weight.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                {/* regime breakdown comparison */}
                <div className="so-section-title">REGIME BREAKDOWN COMPARISON</div>
                <table className="so-hp-table">
                  <thead>
                    <tr><th>REGIME</th><th>EQ SHARPE</th><th>EQ TRADES</th><th>WT SHARPE</th><th>WT TRADES</th><th>ΔSHARPE</th></tr>
                  </thead>
                  <tbody>
                    {eq.regime_breakdown.map((rb, i) => {
                      const wb = wt.regime_breakdown[i] || rb
                      const delta = ((wb.sharpe ?? 0) - (rb.sharpe ?? 0))
                      return (
                        <tr key={rb.regime}>
                          <td style={{ fontWeight: 600, color: '#c8d8e8' }}>{rb.regime}</td>
                          <td style={{ color: '#f0a030' }}>{fmt(rb.sharpe)}</td>
                          <td>{rb.n_trades.toLocaleString()}</td>
                          <td style={{ color: '#00c8a0', fontWeight: 700 }}>{fmt(wb.sharpe)}</td>
                          <td>{wb.n_trades.toLocaleString()}</td>
                          <td style={{ color: delta > 0 ? '#00c8a0' : '#e05050' }}>
                            {delta > 0 ? '+' : ''}{fmt(delta)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {/* threshold sweep */}
                <div className="so-section-title" style={{ marginTop: 24 }}>WEIGHTED THRESHOLD SWEEP</div>
                <table className="so-hp-table">
                  <thead><tr><th>THRESHOLD</th><th>SHARPE</th><th>TRADES</th><th>WIN%</th><th>★</th></tr></thead>
                  <tbody>
                    {wt.threshold_sweep.map((row, i) => {
                      const light = (row.sharpe ?? 0) >= 1.5 ? 'green' : (row.sharpe ?? 0) >= 0.5 ? 'yellow' : 'red'
                      const best  = row.threshold === wt.best_threshold
                      return (
                        <tr key={i} className={best ? 'so-row-best' : ''}>
                          <td>{row.threshold}</td>
                          <td style={{ color: LIGHT_COLOR[light], fontWeight: best ? 700 : 400 }}>{fmt(row.sharpe)}</td>
                          <td>{row.n_trades.toLocaleString()}</td>
                          <td>{row.win_rate != null ? (row.win_rate*100).toFixed(1)+'%' : '—'}</td>
                          <td><TLDot light={light} size={8} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            )
          })() : (
            <div style={{ color: '#556677', marginTop: 40, textAlign: 'center', lineHeight: 2 }}>
              No ensemble report. Press ▶ Re-Run Ensemble or run:<br />
              <code style={{ color: '#8899aa' }}>python ds_app/sharpe_ensemble.py</code>
            </div>
          )}
        </div>
      )}

      {/* ── tab: cross-asset spreads ─────────────────────────────────────── */}
      {activeTab === 'cross' && (
        <div className="so-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: '#c8d8e8', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 2 }}>
              CROSS-ASSET SPREADS
            </h3>
            <button className="so-run-btn" onClick={triggerCross} disabled={crossRunning}>
              {crossRunning ? '⟳ Running…' : '▶ Refresh'}
            </button>
            {crossData && (
              <span style={{ color: '#556677', fontSize: 11 }}>
                {new Date(crossData.ts * 1000).toLocaleTimeString()} · {crossData.n_bars} bars
              </span>
            )}
          </div>

          {crossData ? (() => {
            const c = crossData
            const regCol = c.regime === 'RISK_ON' ? '#22c55e' : c.regime === 'RISK_OFF' ? '#ef4444' : '#f59e0b'
            const compW = Math.abs(c.composite) * 180
            const dimDefs: { key: keyof typeof c.dimensions; label: string; desc: string }[] = [
              { key: 'btc_eth_ratio',  label: 'BTC/ETH RATIO',   desc: 'BTC dominance vs ETH — negative = alt season' },
              { key: 'alt_beta',       label: 'ALT BETA',         desc: 'SOL/AVAX/LINK/ARB vs BTC — positive = risk appetite' },
              { key: 'defi_momentum',  label: 'DEFI MOMENTUM',    desc: 'UNI/LINK/ARB/OP vs ETH — DeFi protocol premium' },
              { key: 'l1_spread',      label: 'L1 SPREAD',        desc: 'SOL vs ETH — high beta L1 competition' },
              { key: 'btc_corr_break', label: 'CORR COHESION',    desc: 'BTC×alt-basket rolling corr — positive = signals reliable' },
            ]
            return (
              <div>
                {/* Composite regime dial */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 24, padding: '12px 16px', background: '#070d14', borderRadius: 6, border: `1px solid ${regCol}33` }}>
                  <div style={{ textAlign: 'center', minWidth: 100 }}>
                    <div style={{ fontSize: 28, fontWeight: 900, fontFamily: 'Barlow Condensed, sans-serif', color: regCol }}>
                      {c.composite > 0 ? '+' : ''}{c.composite.toFixed(3)}
                    </div>
                    <div style={{ fontSize: 9, letterSpacing: 3, color: regCol, fontWeight: 700 }}>{c.regime}</div>
                  </div>
                  <div style={{ flex: 1, position: 'relative', height: 20 }}>
                    <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#1e3a4a' }} />
                    <div style={{
                      position: 'absolute',
                      left: c.composite >= 0 ? '50%' : `calc(50% - ${compW}px)`,
                      width: compW, top: 4, height: 12,
                      background: regCol + 'aa', borderRadius: 2,
                    }} />
                    <div style={{ position: 'absolute', left: 0, top: 16, fontSize: 8, color: '#334455' }}>RISK OFF</div>
                    <div style={{ position: 'absolute', right: 0, top: 16, fontSize: 8, color: '#334455' }}>RISK ON</div>
                  </div>
                  <div style={{ fontSize: 10, color: '#556677', minWidth: 80, textAlign: 'right' }}>
                    {c.symbols_loaded.length} symbols · {c.n_bars} bars
                  </div>
                </div>

                {/* 5 dimension rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {dimDefs.map(({ key, label, desc }) => {
                    const d = c.dimensions[key]
                    if (!d) return null
                    const s = d.score
                    const col = s > 0.2 ? '#22c55e' : s < -0.2 ? '#ef4444' : '#f59e0b'
                    const barW = Math.abs(s) * 120
                    const hist = d.history_24h ?? []
                    const hMin = Math.min(...hist), hMax = Math.max(...hist)
                    const hRange = hMax - hMin || 0.001
                    const zeroY = 24 - ((0 - hMin) / hRange) * 22
                    return (
                      <div key={key} style={{ background: '#070d14', borderRadius: 6, padding: '10px 14px', border: '1px solid #0d1f2e' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                          <div style={{ minWidth: 130, fontSize: 10, fontWeight: 700, letterSpacing: 2, color: '#8899aa', fontFamily: 'Barlow Condensed, sans-serif' }}>{label}</div>
                          <div style={{ position: 'relative', width: 240, height: 14 }}>
                            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#1e3a4a' }} />
                            <div style={{
                              position: 'absolute',
                              left: s >= 0 ? '50%' : `calc(50% - ${barW}px)`,
                              width: barW, top: 2, height: 10,
                              background: col + '99', borderRadius: 2,
                            }} />
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: col, fontFamily: 'Barlow Condensed, sans-serif', minWidth: 52, textAlign: 'right' }}>
                            {s > 0 ? '+' : ''}{s.toFixed(3)}
                          </div>
                          <div style={{ fontSize: 9, color: '#445566', flex: 1 }}>{d.error ?? desc}</div>
                          {d.current_corr != null && (
                            <div style={{ fontSize: 9, color: '#556677' }}>corr={d.current_corr.toFixed(3)}</div>
                          )}
                        </div>
                        {hist.length > 4 && (
                          <svg width="100%" height="28" style={{ display: 'block' }}>
                            {hist.slice(0, -1).map((v, i) => {
                              const x = (i / (hist.length - 1)) * 100
                              const y = 24 - ((v - hMin) / hRange) * 22
                              const x2 = ((i + 1) / (hist.length - 1)) * 100
                              const y2 = 24 - ((hist[i + 1] - hMin) / hRange) * 22
                              return <line key={i} x1={`${x}%`} y1={y} x2={`${x2}%`} y2={y2} stroke={col} strokeWidth="1" opacity="0.5" />
                            })}
                            <line x1="0" y1={zeroY} x2="100%" y2={zeroY} stroke="#1e3a4a" strokeWidth="0.5" strokeDasharray="2,2" />
                          </svg>
                        )}
                        {d.interpretation && <div style={{ fontSize: 9, color: '#334455', marginTop: 2 }}>{d.interpretation}</div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })() : (
            <div style={{ color: '#556677', marginTop: 40, textAlign: 'center', lineHeight: 2 }}>
              No cross-asset report. Press ▶ Refresh or run:<br />
              <code style={{ color: '#8899aa' }}>python ds_app/cross_asset.py</code>
            </div>
          )}
        </div>
      )}

      {/* ── tab: walk-forward validation ────────────────────────────────── */}
      {activeTab === 'wf' && (
        <div className="so-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: '#c8d8e8', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 2 }}>
              WALK-FORWARD · MEDALLION PROTOCOL
            </h3>
            <button className="so-run-btn" onClick={triggerWf} disabled={wfRunning}>
              {wfRunning ? '⟳ Running (~60s)…' : '▶ Re-Run'}
            </button>
            {wfData && (
              <span style={{ color: '#556677', fontSize: 11 }}>
                {wfData.n_folds} folds · {wfData.elapsed_s}s · {wfData.generated_at}
              </span>
            )}
          </div>

          {wfData ? (() => {
            const w = wfData
            const vcol = w.verdict === 'ROBUST' ? '#22c55e' : w.verdict === 'PROMISING' ? '#f59e0b' : w.verdict === 'FRAGILE' ? '#f97316' : '#ef4444'
            const sm = w.summary

            // Fold sparkline data
            const foldSharpes = w.folds.map(f => f.oos.sharpe ?? 0)
            const fsMin = Math.min(...foldSharpes), fsMax = Math.max(...foldSharpes)
            const fsRange = fsMax - fsMin || 0.001

            return (
              <div>
                {/* Verdict + gates row */}
                <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
                  {/* Verdict dial */}
                  <div style={{ background: '#070d14', border: `1px solid ${vcol}44`, borderRadius: 6, padding: '12px 20px', textAlign: 'center', minWidth: 120 }}>
                    <div style={{ fontSize: 26, fontWeight: 900, fontFamily: 'Barlow Condensed, sans-serif', color: vcol }}>{w.verdict}</div>
                    <div style={{ fontSize: 9, color: '#556677', letterSpacing: 2 }}>{w.gates_passed} GATES</div>
                  </div>
                  {/* KPIs */}
                  {[
                    { label: 'OOS SHARPE', val: sm.oos_sharpe?.mean != null ? `${sm.oos_sharpe.mean > 0 ? '+' : ''}${sm.oos_sharpe.mean.toFixed(2)}` : '—', col: (sm.oos_sharpe?.mean ?? 0) > 0 ? '#22c55e' : '#ef4444' },
                    { label: 'OOS STD',    val: sm.oos_sharpe?.std?.toFixed(2) ?? '—',   col: '#8899aa' },
                    { label: 'IS/OOS',     val: sm.is_oos_ratio?.mean?.toFixed(2) ?? '—', col: (sm.is_oos_ratio?.mean ?? 0) > 0.5 ? '#22c55e' : '#ef4444' },
                    { label: 'IC MEAN',    val: sm.ic?.mean?.toFixed(4) ?? '—',           col: (sm.ic?.mean ?? 0) > 0 ? '#22c55e' : '#ef4444' },
                    { label: 'OOS SLOPE',  val: sm.oos_sharpe_slope != null ? (sm.oos_sharpe_slope > 0 ? '+' : '') + sm.oos_sharpe_slope.toFixed(3) : '—',
                                           col: (sm.oos_sharpe_slope ?? 0) >= 0 ? '#22c55e' : '#ef4444' },
                    { label: 'IC SLOPE',   val: sm.ic_slope != null ? (sm.ic_slope > 0 ? '+' : '') + sm.ic_slope.toFixed(6) : '—',
                                           col: (sm.ic_slope ?? 0) >= 0 ? '#22c55e' : '#ef4444' },
                    { label: '% OOS POS',  val: sm.oos_sharpe?.pct_positive != null ? `${(sm.oos_sharpe.pct_positive * 100).toFixed(0)}%` : '—',
                                           col: (sm.oos_sharpe?.pct_positive ?? 0) > 0.6 ? '#22c55e' : '#f59e0b' },
                  ].map(({ label, val, col }) => (
                    <div key={label} style={{ background: '#070d14', border: '1px solid #0d1f2e', borderRadius: 6, padding: '10px 14px', textAlign: 'center', minWidth: 80 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: col, fontFamily: 'Barlow Condensed, sans-serif' }}>{val}</div>
                      <div style={{ fontSize: 8, color: '#445566', letterSpacing: 1, marginTop: 2 }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* RenTech gates */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                  {Object.entries(w.rentech_gates).map(([gate, pass]) => (
                    <div key={gate} style={{
                      padding: '4px 10px', borderRadius: 4, fontSize: 9, letterSpacing: 1, fontWeight: 700,
                      background: pass ? '#052010' : '#1a0a0a',
                      border: `1px solid ${pass ? '#22c55e44' : '#ef444444'}`,
                      color: pass ? '#22c55e' : '#ef4444',
                      fontFamily: 'Barlow Condensed, sans-serif',
                    }}>
                      {pass ? '✓' : '✗'} {gate.replace(/_/g, ' ').toUpperCase()}
                    </div>
                  ))}
                </div>

                {/* Regime consistency */}
                {Object.keys(w.regime_summary).length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 9, letterSpacing: 2, color: '#445566', marginBottom: 8 }}>REGIME CONSISTENCY</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {Object.entries(w.regime_summary).map(([rg, rs]) => {
                        const col = rs.pct_positive > 0.6 ? '#22c55e' : rs.pct_positive > 0.4 ? '#f59e0b' : '#ef4444'
                        return (
                          <div key={rg} style={{ background: '#070d14', border: `1px solid ${col}33`, borderRadius: 5, padding: '8px 12px', minWidth: 100 }}>
                            <div style={{ fontSize: 10, color: col, fontWeight: 700, fontFamily: 'Barlow Condensed, sans-serif' }}>{rg}</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: col }}>{rs.mean_sharpe > 0 ? '+' : ''}{rs.mean_sharpe.toFixed(2)}</div>
                            <div style={{ fontSize: 8, color: '#334455' }}>{(rs.pct_positive * 100).toFixed(0)}% pos · {rs.n_folds} folds</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* OOS Sharpe sparkline + fold bars */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 9, letterSpacing: 2, color: '#445566', marginBottom: 8 }}>OOS SHARPE PER FOLD · {w.n_folds} FOLDS (ROLLING 30D TEST)</div>
                  <svg width="100%" height="60" style={{ display: 'block' }}>
                    {w.folds.map((f, i) => {
                      const s = f.oos.sharpe ?? 0
                      const barH = Math.abs(s) / fsRange * 40
                      const x = (i / w.folds.length) * 100
                      const w2 = 0.85 / w.folds.length * 100
                      const y = s >= 0 ? 40 - barH : 40
                      const col = s > 0 ? '#22c55e' : '#ef4444'
                      return (
                        <rect key={i} x={`${x}%`} y={y} width={`${w2}%`} height={Math.max(1, barH)} fill={col} opacity="0.7" rx="1">
                          <title>{f.test_start} OOS={s > 0 ? '+' : ''}{s.toFixed(2)}</title>
                        </rect>
                      )
                    })}
                    <line x1="0" y1="40" x2="100%" y2="40" stroke="#1e3a4a" strokeWidth="1" />
                    {/* Trend line */}
                    {(() => {
                      const pts = foldSharpes.map((s, i) => ({
                        x: (i / (foldSharpes.length - 1)) * 100,
                        y: 40 - ((s - fsMin) / fsRange) * 40,
                      }))
                      const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x}% ${p.y}`).join(' ')
                      return <path d={path} fill="none" stroke="#f59e0b" strokeWidth="1" opacity="0.5" />
                    })()}
                  </svg>
                </div>

                {/* Fold table */}
                <div style={{ fontSize: 9, letterSpacing: 2, color: '#445566', marginBottom: 8 }}>FOLD DETAIL</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                    <thead>
                      <tr style={{ color: '#445566' }}>
                        {['#','TEST WINDOW','IS SH','OOS SH','IS/OOS','IC','N TRADES','HIT RATE','TOP SIGNAL'].map(h => (
                          <th key={h} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid #0d1f2e', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {w.folds.map(f => {
                        const oos = f.oos.sharpe ?? 0
                        const col = oos > 0 ? '#22c55e' : '#ef4444'
                        const topSig = f.top_weights[0]?.[0] ?? '—'
                        return (
                          <tr key={f.fold} style={{ borderBottom: '1px solid #060c12' }}>
                            <td style={{ padding: '3px 8px', color: '#334455' }}>{f.fold}</td>
                            <td style={{ padding: '3px 8px', color: '#556677', whiteSpace: 'nowrap' }}>{f.test_start}</td>
                            <td style={{ padding: '3px 8px', color: '#8899aa' }}>{f.is.sharpe != null ? (f.is.sharpe > 0 ? '+' : '') + f.is.sharpe.toFixed(1) : '—'}</td>
                            <td style={{ padding: '3px 8px', color: col, fontWeight: 700 }}>{f.oos.sharpe != null ? (oos > 0 ? '+' : '') + oos.toFixed(1) : '—'}</td>
                            <td style={{ padding: '3px 8px', color: (f.is_oos_ratio ?? 0) > 0.5 ? '#22c55e' : '#ef4444' }}>{f.is_oos_ratio?.toFixed(2) ?? '—'}</td>
                            <td style={{ padding: '3px 8px', color: '#556677' }}>{f.ic?.toFixed(4) ?? '—'}</td>
                            <td style={{ padding: '3px 8px', color: '#556677' }}>{f.oos.n_trades}</td>
                            <td style={{ padding: '3px 8px', color: '#556677' }}>{f.oos.hit_rate != null ? `${(f.oos.hit_rate * 100).toFixed(0)}%` : '—'}</td>
                            <td style={{ padding: '3px 8px', color: '#8899aa', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 1 }}>{topSig}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ── DEATH STAR signal lifecycle ── */}
                {w.signal_lifecycle && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ fontSize: 9, letterSpacing: 2, color: '#445566', marginBottom: 10 }}>
                      SIGNAL LIFECYCLE · IC DECAY ANALYSIS · {w.retire_candidates.length} RETIRE · {w.probation_list.length} PROBATION · {w.rising_list.length} RISING
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {Object.entries(w.signal_lifecycle)
                        .filter(([, v]) => v.ic_mean !== null)
                        .sort((a, b) => (b[1].ic_mean ?? 0) - (a[1].ic_mean ?? 0))
                        .map(([sig, lc]) => {
                          const statusCol = {
                            ALIVE:    '#22c55e', RISING: '#34d399',
                            MIXED:    '#f59e0b',
                            PROBATION:'#f97316', DEAD:   '#ef4444',
                            INSUFFICIENT_DATA: '#334455',
                          }[lc.status] ?? '#556677'
                          const hist = lc.ic_history ?? []
                          const hMin = Math.min(...hist, 0), hMax = Math.max(...hist, 0)
                          const hRange = hMax - hMin || 0.001
                          const slopeDir = (lc.ic_slope ?? 0) > 0 ? '↑' : '↓'
                          return (
                            <div key={sig} style={{
                              background: '#070d14',
                              border: `1px solid ${statusCol}33`,
                              borderRadius: 5, padding: '7px 10px',
                              minWidth: 110, flex: '0 0 auto',
                            }}>
                              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: statusCol, fontFamily: 'Barlow Condensed, sans-serif' }}>
                                {sig}
                              </div>
                              <div style={{ fontSize: 8, color: statusCol, marginTop: 1 }}>
                                {lc.status} {lc.status !== 'INSUFFICIENT_DATA' ? slopeDir : ''}
                              </div>
                              <div style={{ fontSize: 9, color: '#556677', marginTop: 1 }}>
                                IC {lc.ic_mean != null ? (lc.ic_mean > 0 ? '+' : '') + lc.ic_mean.toFixed(4) : '—'}
                              </div>
                              {hist.length > 3 && (
                                <svg width="90" height="18" style={{ display: 'block', marginTop: 3 }}>
                                  {hist.slice(0, -1).map((v, i) => {
                                    const x1 = (i / (hist.length - 1)) * 90
                                    const y1 = 15 - ((v - hMin) / hRange) * 13
                                    const x2 = ((i + 1) / (hist.length - 1)) * 90
                                    const y2 = 15 - ((hist[i + 1] - hMin) / hRange) * 13
                                    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={statusCol} strokeWidth="1" opacity="0.6" />
                                  })}
                                  <line x1={0} y1={15 - ((0 - hMin) / hRange) * 13} x2={90} y2={15 - ((0 - hMin) / hRange) * 13}
                                    stroke="#1e3a4a" strokeWidth="0.5" strokeDasharray="2,2" />
                                </svg>
                              )}
                            </div>
                          )
                        })}
                    </div>
                    {w.retire_candidates.length > 0 && (
                      <div style={{ marginTop: 10, padding: '8px 12px', background: '#140404', border: '1px solid #ef444433', borderRadius: 5, fontSize: 9, color: '#ef4444' }}>
                        ⚠ RETIRE CANDIDATES: {w.retire_candidates.join(' · ')} — negative IC across majority of folds. Consider removing from ensemble or weight = 0.
                      </div>
                    )}
                    {w.rising_list.length > 0 && (
                      <div style={{ marginTop: 8, padding: '8px 12px', background: '#021008', border: '1px solid #22c55e33', borderRadius: 5, fontSize: 9, color: '#22c55e' }}>
                        ↑ RISING SIGNALS: {w.rising_list.join(' · ')} — IC trending up. Consider promoting weight allocation.
                      </div>
                    )}
                  </div>
                )}

                {/* Config */}
                <div style={{ marginTop: 16, fontSize: 9, color: '#334455' }}>
                  Config: train={w.config.train_days}d · test={w.config.test_days}d · step={w.config.step_days}d · embargo={w.config.embargo_days}d · threshold={w.config.threshold} · outcome={w.config.outcome}
                </div>
              </div>
            )
          })() : (
            <div style={{ color: '#556677', marginTop: 40, textAlign: 'center', lineHeight: 2 }}>
              No walk-forward report. Press ▶ Re-Run (~60s) or run:<br />
              <code style={{ color: '#8899aa' }}>python ds_app/walkforward.py</code>
            </div>
          )}
        </div>
      )}

      {/* ── tab: lot-sizing stack ──────────────────────────────────────────── */}
      {activeTab === 'lot' && (
        <div className="so-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: '#c8d8e8', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 2 }}>
              LOT-SIZING STACK · 7 LIVE MULTIPLIERS
            </h3>
            <button className="so-run-btn" onClick={loadLot}>↻ Refresh</button>
          </div>
          <div style={{ fontSize: 10, color: '#445566', marginBottom: 16, fontFamily: 'monospace' }}>
            eff_lot = halo × mtf × cross_asset × capacity × oi × fear_greed × liquidations
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            {/* Fear & Greed */}
            {fngData && (() => {
              const col = fngData.value <= 24 ? '#22c55e' : fngData.value <= 44 ? '#86efac' : fngData.value <= 55 ? '#8899aa' : fngData.value <= 74 ? '#fb923c' : '#ef4444'
              return (
                <div style={{ background: '#070d14', border: `1px solid ${col}44`, borderRadius: 8, padding: '14px 20px', minWidth: 160 }}>
                  <div style={{ fontSize: 9, color: '#445566', letterSpacing: 2, marginBottom: 6 }}>FEAR & GREED</div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: col, fontFamily: 'Barlow Condensed, sans-serif', lineHeight: 1 }}>{fngData.value}</div>
                  <div style={{ fontSize: 11, color: col, marginTop: 4 }}>{String(fngData.label ?? '').replace('_', ' ')}</div>
                  <div style={{ fontSize: 10, color: '#8899aa', marginTop: 6 }}>mult: <b style={{ color: col }}>{fngData.mult}×</b></div>
                  <div style={{ fontSize: 9, color: '#556677', marginTop: 4 }}>{fngData.trend}</div>
                </div>
              )
            })()}

            {/* OI Signal */}
            {oiData?.signals && (() => {
              const sigs: any[] = Object.values(oiData.signals)
              return (
                <div style={{ background: '#070d14', border: '1px solid #22d3ee33', borderRadius: 8, padding: '14px 20px', minWidth: 220 }}>
                  <div style={{ fontSize: 9, color: '#445566', letterSpacing: 2, marginBottom: 8 }}>OPEN INTEREST SIGNALS</div>
                  {sigs.map((s: any) => {
                    const col = s.signal === 'TREND_CONFIRM' ? '#22c55e' : s.signal === 'EXHAUSTION' ? '#fb923c' : s.signal === 'CAPITULATION' ? '#ef4444' : '#8899aa'
                    return (
                      <div key={s.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 10, color: '#8899aa', fontFamily: 'monospace', width: 70 }}>{String(s.symbol).replace('USDT','')}</span>
                        <span style={{ fontSize: 9, color: col }}>{s.signal}</span>
                        <span style={{ fontSize: 10, color: col, fontWeight: 700, marginLeft: 8 }}>{s.mult?.toFixed(2)}×</span>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {/* Liquidations */}
            {liqData && (() => {
              const top = (liqData.top_symbols as any[] | undefined)?.slice(0, 6) ?? []
              return (
                <div style={{ background: '#070d14', border: '1px solid #a855f733', borderRadius: 8, padding: '14px 20px', minWidth: 240 }}>
                  <div style={{ fontSize: 9, color: '#445566', letterSpacing: 2, marginBottom: 6 }}>LIQUIDATIONS · {liqData.window_min}m</div>
                  <div style={{ fontSize: 10, color: '#556677', marginBottom: 8 }}>
                    Events: <b style={{ color: '#c8d8e8' }}>{liqData.total_events ?? '—'}</b>
                    {liqStatus && <span style={{ marginLeft: 10, color: liqStatus.running ? '#22c55e' : '#ef4444' }}>
                      ● {liqStatus.running ? 'DAEMON LIVE' : 'DAEMON OFF'}</span>}
                  </div>
                  {top.map((s: any) => {
                    const ratio = s.bullish_ratio ?? 0.5
                    const col = ratio > 0.65 ? '#22c55e' : ratio < 0.35 ? '#ef4444' : '#8899aa'
                    return (
                      <div key={s.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontSize: 10, color: '#8899aa', fontFamily: 'monospace', width: 70 }}>{String(s.symbol).replace('USDT','')}</span>
                        <span style={{ fontSize: 9, color: '#22c55e' }}>▲${((s.buy_usd as number)/1000).toFixed(0)}k</span>
                        <span style={{ fontSize: 9, color: '#ef4444' }}>▼${((s.sell_usd as number)/1000).toFixed(0)}k</span>
                        <div style={{ width: 50, height: 4, background: '#0d1f2e', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ width: `${ratio*100}%`, height: '100%', background: col }} />
                        </div>
                      </div>
                    )
                  })}
                  {!liqStatus?.running && <div style={{ marginTop: 8, fontSize: 9, color: '#ef4444' }}>python ds_app/liquidations.py daemon</div>}
                </div>
              )
            })()}

            {/* MTF */}
            {mtfData && (() => {
              const col = mtfData.result === 'AGREE' ? '#22c55e' : mtfData.result === 'OPPOSE' ? '#ef4444' : '#8899aa'
              return (
                <div style={{ background: '#070d14', border: `1px solid ${col}44`, borderRadius: 8, padding: '14px 20px', minWidth: 140 }}>
                  <div style={{ fontSize: 9, color: '#445566', letterSpacing: 2, marginBottom: 6 }}>MTF CONFIRM (BTC)</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: col, fontFamily: 'Barlow Condensed, sans-serif' }}>{mtfData.result}</div>
                  <div style={{ fontSize: 10, color: '#8899aa', marginTop: 6 }}>mult: <b style={{ color: col }}>{mtfData.mult?.toFixed(2)}×</b></div>
                </div>
              )
            })()}
          </div>

          {/* Waterfall stack diagram */}
          <div style={{ background: '#070d14', border: '1px solid #0d1f3c', borderRadius: 8, padding: '16px 20px' }}>
            <div style={{ fontSize: 9, color: '#445566', letterSpacing: 2, marginBottom: 12 }}>CUMULATIVE LOT MULTIPLIER WATERFALL</div>
            {(() => {
              const layers = [
                { label: 'HALO ENTRY',   val: 0.60, note: 'split 60% first fill', col: '#22d3ee' },
                { label: 'MTF',          val: mtfData?.mult ?? 1.0, note: mtfData?.result ?? '—', col: mtfData?.result === 'AGREE' ? '#22c55e' : '#8899aa' },
                { label: 'CROSS-ASSET',  val: crossData ? (crossData.regime === 'RISK_ON' ? 1.20 : crossData.regime === 'RISK_OFF' ? 0.70 : 1.0) : 1.0, note: crossData?.regime ?? '—', col: crossData?.regime === 'RISK_ON' ? '#22c55e' : crossData?.regime === 'RISK_OFF' ? '#ef4444' : '#8899aa' },
                { label: 'CAPACITY',     val: 1.0,  note: 'per symbol', col: '#8899aa' },
                { label: 'OI SIGNAL',    val: (oiData?.signals as any)?.BTCUSDT?.mult ?? 1.0, note: (oiData?.signals as any)?.BTCUSDT?.signal ?? '—', col: '#f59e0b' },
                { label: 'FEAR & GREED', val: fngData?.mult ?? 1.0, note: `${String(fngData?.label ?? '—').replace('_',' ')} (${fngData?.value ?? '—'})`, col: (fngData?.value ?? 50) <= 24 ? '#22c55e' : (fngData?.value ?? 50) >= 75 ? '#ef4444' : '#8899aa' },
                { label: 'LIQUIDATIONS', val: 1.0, note: liqStatus?.running ? 'DAEMON LIVE' : 'no daemon', col: '#a855f7' },
              ]
              let cum = 1.0
              return layers.map(r => {
                cum = Math.round(cum * r.val * 1000) / 1000
                const barW = Math.min(cum * 50, 100)
                return (
                  <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                    <div style={{ width: 120, fontSize: 9, color: '#445566', letterSpacing: 1 }}>{r.label}</div>
                    <div style={{ width: 40, fontSize: 12, fontWeight: 700, color: r.col, fontFamily: 'Barlow Condensed, sans-serif', textAlign: 'right' }}>{r.val.toFixed(2)}×</div>
                    <div style={{ flex: 1, height: 4, background: '#0d1f2e', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${barW}%`, height: '100%', background: r.col, opacity: 0.7 }} />
                    </div>
                    <div style={{ width: 42, fontSize: 11, fontWeight: 700, color: cum >= 0.5 ? '#22c55e' : '#ef4444', fontFamily: 'Barlow Condensed, sans-serif' }}>={cum.toFixed(3)}</div>
                    <div style={{ fontSize: 8, color: '#334455', minWidth: 80 }}>{r.note}</div>
                  </div>
                )
              })
            })()}
          </div>
        </div>
      )}

      {/* ── tab: signal health ─────────────────────────────────────────────── */}
      {activeTab === 'health' && (
        <div className="so-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: '#c8d8e8', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 2 }}>
              SIGNAL HEALTH · IC HALF-LIFE · HOLDOUT · CAPACITY
            </h3>
            <button className="so-run-btn" onClick={loadHealth}>↻ Refresh</button>
          </div>

          {holdoutData && (() => {
            const vcol = holdoutData.verdict === 'VALID' ? '#22c55e' : holdoutData.verdict === 'MARGINAL' ? '#f59e0b' : '#ef4444'
            return (
              <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{ background: '#070d14', border: `1px solid ${vcol}44`, borderRadius: 8, padding: '14px 20px' }}>
                  <div style={{ fontSize: 9, color: '#445566', letterSpacing: 2, marginBottom: 6 }}>RE-ENTRY HOLDOUT VALIDATION</div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: vcol, fontFamily: 'Barlow Condensed, sans-serif' }}>{holdoutData.verdict}</div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 16 }}>
                    {[
                      { l: 'RE-ENTRY SHARPE', v: holdoutData.reentry_sharpe?.toFixed(2) ?? '—', c: (holdoutData.reentry_sharpe ?? 0) >= 10 ? '#22c55e' : '#ef4444' },
                      { l: 'RE-ENTRY N',      v: holdoutData.reentry_trades ?? '—', c: '#8899aa' },
                      { l: 'ALL SHARPE',      v: holdoutData.sharpe?.toFixed(2) ?? '—', c: (holdoutData.sharpe ?? 0) > 0 ? '#22c55e' : '#ef4444' },
                      { l: 'HOLDOUT BARS',    v: (holdoutData.holdout_bars as number)?.toLocaleString() ?? '—', c: '#8899aa' },
                    ].map(k => (
                      <div key={k.l} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: k.c, fontFamily: 'Barlow Condensed, sans-serif' }}>{k.v}</div>
                        <div style={{ fontSize: 8, color: '#445566', letterSpacing: 1 }}>{k.l}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 9, color: '#556677', marginTop: 8 }}>{holdoutData.note}</div>
                </div>
              </div>
            )
          })()}

          {hlData?.signals && (
            <div style={{ background: '#070d14', border: '1px solid #0d1f3c', borderRadius: 8, padding: '14px 20px', marginBottom: 16 }}>
              <div style={{ fontSize: 9, color: '#445566', letterSpacing: 2, marginBottom: 10 }}>IC HALF-LIFE PER SIGNAL</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                {Object.entries(hlData.signals as Record<string, any>).map(([sig, d]: [string, any]) => {
                  const alertCol = d.alert === 'RETIRE' ? '#ef4444' : d.alert === 'IMMINENT' ? '#f97316' : d.alert === 'SHORT' ? '#f59e0b' : d.alert === 'REGIME_SPECIALIST' ? '#a855f7' : '#22c55e'
                  return (
                    <div key={sig} style={{ background: '#050b12', border: `1px solid ${alertCol}22`, borderRadius: 5, padding: '8px 10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#c8d8e8', fontFamily: 'monospace' }}>{sig}</span>
                        <span style={{ fontSize: 8, color: alertCol }}>{d.alert}</span>
                      </div>
                      <div style={{ fontSize: 9, color: '#8899aa', marginTop: 4 }}>
                        IC₀={d.ic_initial?.toFixed(4) ?? '—'} · HL={d.half_life_days != null ? `${(d.half_life_days as number).toFixed(1)}d` : '—'}
                      </div>
                      {d.regime_note && <div style={{ fontSize: 8, color: '#a855f7', marginTop: 2 }}>{d.regime_note}</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {capData?.symbols && (
            <div style={{ background: '#070d14', border: '1px solid #0d1f3c', borderRadius: 8, padding: '14px 20px' }}>
              <div style={{ fontSize: 9, color: '#445566', letterSpacing: 2, marginBottom: 10 }}>CAPACITY MODEL · 1% PARTICIPATION</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(capData.symbols as any[]).map((s: any) => {
                  const col = s.tier === 'DEEP' ? '#22c55e' : s.tier === 'NORMAL' ? '#f59e0b' : s.tier === 'THIN' ? '#fb923c' : '#ef4444'
                  return (
                    <div key={s.symbol} style={{ background: '#050b12', border: `1px solid ${col}33`, borderRadius: 5, padding: '6px 10px', minWidth: 100 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#c8d8e8', fontFamily: 'monospace' }}>{String(s.symbol).replace('USDT','')}</div>
                      <div style={{ fontSize: 8, color: col, fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700 }}>{s.tier}</div>
                      <div style={{ fontSize: 9, color: '#8899aa' }}>${((s.max_lot_usd as number)/1000).toFixed(0)}k max</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {!hlData && !holdoutData && !capData && (
            <div style={{ color: '#556677', textAlign: 'center', marginTop: 40 }}>
              No data — run: POST /v1/ic/halflife/run/ · /v1/holdout/run/ · /v1/capacity/run/
            </div>
          )}
        </div>
      )}

      {/* ── tab: paper live ────────────────────────────────────────────────── */}
      {activeTab === 'paper' && (
        <div className="so-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: '#c8d8e8', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 2 }}>
              PAPER TRADING · ALPACA + IBKR LIVE STATUS
            </h3>
            <button className="so-run-btn" onClick={loadPaper}>↻ Refresh</button>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
            {/* Alpaca */}
            <div style={{ flex: 1, minWidth: 320 }}>
              <div style={{ fontSize: 9, color: '#445566', letterSpacing: 2, marginBottom: 8 }}>ALPACA PAPER</div>
              {paperData ? (
                <>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                    {[
                      { l: 'EQUITY', v: paperData.account?.equity != null ? `$${Number(paperData.account.equity).toLocaleString()}` : '—', c: '#22c55e' },
                      { l: 'CASH',   v: paperData.account?.cash   != null ? `$${Number(paperData.account.cash).toLocaleString()}`   : '—', c: '#8899aa' },
                      { l: 'P&L',    v: paperData.account?.unrealized_pl != null ? `$${Number(paperData.account.unrealized_pl).toFixed(0)}` : '—',
                                     c: Number(paperData.account?.unrealized_pl) >= 0 ? '#22c55e' : '#ef4444' },
                    ].map(k => (
                      <div key={k.l} style={{ background: '#070d14', border: '1px solid #0d1f3c', borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: k.c, fontFamily: 'Barlow Condensed, sans-serif' }}>{k.v}</div>
                        <div style={{ fontSize: 8, color: '#445566', letterSpacing: 1 }}>{k.l}</div>
                      </div>
                    ))}
                  </div>
                  {(paperData.positions as any[])?.length > 0 && (
                    <div style={{ background: '#070d14', border: '1px solid #0d1f3c', borderRadius: 6, padding: '10px 14px', marginBottom: 10 }}>
                      <div style={{ fontSize: 9, color: '#445566', letterSpacing: 1, marginBottom: 6 }}>OPEN POSITIONS</div>
                      {(paperData.positions as any[]).map((p: any) => (
                        <div key={p.symbol} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 10, color: '#c8d8e8', fontFamily: 'monospace' }}>{p.symbol}</span>
                          <span style={{ fontSize: 10, color: p.side === 'long' ? '#22c55e' : '#ef4444' }}>{String(p.side).toUpperCase()} {p.qty}</span>
                          <span style={{ fontSize: 10, color: Number(p.unrealized_pl) >= 0 ? '#22c55e' : '#ef4444' }}>
                            {Number(p.unrealized_pl) >= 0 ? '+' : ''}{Number(p.unrealized_pl).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(paperData.recent_trades as any[])?.length > 0 && (
                    <div style={{ background: '#070d14', border: '1px solid #0d1f3c', borderRadius: 6, padding: '10px 14px' }}>
                      <div style={{ fontSize: 9, color: '#445566', letterSpacing: 1, marginBottom: 6 }}>RECENT TRADES</div>
                      {(paperData.recent_trades as any[]).slice(0, 8).map((t: any, i: number) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 9, color: '#8899aa' }}>
                          <span style={{ fontFamily: 'monospace', width: 60 }}>{t.symbol}</span>
                          <span style={{ color: t.type === 'ENTRY' ? '#22c55e' : '#fb923c', width: 50 }}>{t.type}</span>
                          <span style={{ width: 40 }}>{t.side}</span>
                          <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 200 }}>{String(t.note ?? '').slice(0, 50)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {!(paperData.positions as any[])?.length && !(paperData.recent_trades as any[])?.length && (
                    <div style={{ color: '#556677', fontSize: 10 }}>No positions. Set ALPACA_KEY + ALPACA_SECRET env vars.</div>
                  )}
                </>
              ) : (
                <div style={{ color: '#556677', fontSize: 10 }}>No data — set ALPACA_KEY + ALPACA_SECRET then POST /v1/paper/run/</div>
              )}
            </div>

            {/* IBKR */}
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 9, color: '#445566', letterSpacing: 2, marginBottom: 8 }}>IBKR PAPER</div>
              {ibkrData ? (
                <>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                    {[
                      { l: 'EQUITY', v: ibkrData.account?.NetLiquidation != null ? `$${Number(ibkrData.account.NetLiquidation).toLocaleString()}` : '—', c: '#22c55e' },
                      { l: 'CASH',   v: ibkrData.account?.TotalCashValue  != null ? `$${Number(ibkrData.account.TotalCashValue).toLocaleString()}`  : '—', c: '#8899aa' },
                      { l: 'STATUS', v: ibkrData.connected ? 'CONNECTED' : 'OFFLINE', c: ibkrData.connected ? '#22c55e' : '#ef4444' },
                    ].map(k => (
                      <div key={k.l} style={{ background: '#070d14', border: '1px solid #0d1f3c', borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: k.c, fontFamily: 'Barlow Condensed, sans-serif' }}>{k.v}</div>
                        <div style={{ fontSize: 8, color: '#445566', letterSpacing: 1 }}>{k.l}</div>
                      </div>
                    ))}
                  </div>
                  {(ibkrData.positions as any[])?.length > 0 && (
                    <div style={{ background: '#070d14', border: '1px solid #0d1f3c', borderRadius: 6, padding: '10px 14px' }}>
                      <div style={{ fontSize: 9, color: '#445566', letterSpacing: 1, marginBottom: 6 }}>OPEN POSITIONS</div>
                      {(ibkrData.positions as any[]).map((p: any, i: number) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 9 }}>
                          <span style={{ color: '#c8d8e8', fontFamily: 'monospace' }}>{p.symbol}</span>
                          <span style={{ color: p.side === 'LONG' ? '#22c55e' : '#ef4444' }}>{p.side} {p.qty}</span>
                          <span style={{ color: '#8899aa' }}>@ {Number(p.entry_price).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {!ibkrData.connected && (
                    <div style={{ marginTop: 8, fontSize: 9, color: '#ef4444' }}>
                      TWS → Paper → API → port 7497 → add 127.0.0.1
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: '#556677', fontSize: 10 }}>No data — connect TWS Paper port 7497</div>
              )}
            </div>
          </div>

          {/* Live signal state summary */}
          <div style={{ background: '#070d14', border: '1px solid #0d1f3c', borderRadius: 8, padding: '14px 20px' }}>
            <div style={{ fontSize: 9, color: '#445566', letterSpacing: 2, marginBottom: 10 }}>LIVE MULTIPLIER STATE</div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 10 }}>
              <div style={{ color: '#8899aa' }}>F&G: <b style={{ color: (fngData?.value ?? 50) <= 44 ? '#22c55e' : (fngData?.value ?? 50) >= 56 ? '#ef4444' : '#8899aa' }}>
                {String(fngData?.label ?? '—').replace('_',' ')} ({fngData?.value ?? '—'}) = {fngData?.mult ?? '—'}×</b></div>
              <div style={{ color: '#8899aa' }}>Cross-Asset: <b style={{ color: crossData?.regime === 'RISK_ON' ? '#22c55e' : crossData?.regime === 'RISK_OFF' ? '#ef4444' : '#8899aa' }}>
                {crossData?.regime ?? '—'}</b></div>
              <div style={{ color: '#8899aa' }}>MTF: <b style={{ color: mtfData?.result === 'AGREE' ? '#22c55e' : '#8899aa' }}>{mtfData?.result ?? '—'} = {mtfData?.mult?.toFixed(2) ?? '—'}×</b></div>
              <div style={{ color: '#8899aa' }}>Liq daemon: <b style={{ color: liqStatus?.running ? '#22c55e' : '#ef4444' }}>{liqStatus?.running ? 'LIVE' : 'OFF'}</b></div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
