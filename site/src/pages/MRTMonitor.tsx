/// <reference types="vite/client" />
/**
 * MRT — Medallion/RenTech research monitor (MaxCogViz-adjacent layout).
 * Blueprint dark · signal radar · IS/OOS table · Lightweight Charts (price + equity + trades).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Button,
  Callout,
  Card,
  Elevation,
  HTMLSelect,
  NumericInput,
  Spinner,
  Tag,
  HTMLTable,
} from '@blueprintjs/core'
import { MRTResearchChart, type MrtReplayPayload } from '../components/MRTResearchChart'

/** Dev: hit mrt-api on :3340 directly (CORS allowed). Prod: `/mrt-api` proxy or set `VITE_MRT_ORIGIN`. */
function mrtApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const env = import.meta.env
  const origin = env.VITE_MRT_ORIGIN?.replace(/\/$/, '')
  if (origin) return `${origin}${p}`
  if (env.DEV) return `http://127.0.0.1:3340${p}`
  return `/mrt-api${p}`
}

const MRT_DIMS = [
  { id: 'REV_1', label: 'REV 1', color: '#22d3ee', desc: '1-bar reversal' },
  { id: 'MOM_5v20', label: 'MOM', color: '#4ade80', desc: '5 vs 20 mean' },
  { id: 'RANGE20', label: 'RANGE', color: '#a855f7', desc: '20-bar position' },
  { id: 'TREND12', label: 'TREND', color: '#FFB74D', desc: '12-bar sign sum' },
] as const

function fmtUnix(u: unknown): string {
  const n = typeof u === 'number' ? u : Number(u)
  if (!Number.isFinite(n)) return '—'
  try {
    return new Date(n * 1000).toLocaleString()
  } catch {
    return '—'
  }
}

/** Radius 0.1..1.0 from |t-stat| */
function radFromT(t: number, R: number) {
  return R * (0.1 + 0.9 * (Math.min(6, Math.abs(t)) / 6))
}

/** 4-axis radar from IS t-stats */
function MRTRadar({ ts }: { ts: { id: string; is_t: number }[] }) {
  const N = 4
  const CX = 140
  const CY = 140
  const R = 118
  const angle = (i: number) => (i / N) * 2 * Math.PI - Math.PI / 2
  const polar = (i: number, r: number) => {
    const a = angle(i)
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) }
  }
  const byId = Object.fromEntries(ts.map(x => [x.id, x.is_t]))
  const polyPts = MRT_DIMS.map((d, i) => {
    const t = byId[d.id] ?? 0
    const p = polar(i, radFromT(t, R))
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
  }).join(' ')
  const composite = ts.reduce((s, x) => s + x.is_t, 0) / Math.max(ts.length, 1)
  const fill =
    composite > 0.5 ? 'rgba(74,222,128,0.12)' : composite < -0.5 ? 'rgba(244,63,94,0.12)' : 'rgba(255,183,77,0.08)'
  const stroke = composite > 0.5 ? '#4ade80' : composite < -0.5 ? '#f43f5e' : '#FFB74D'

  return (
    <svg width={280} height={280} style={{ display: 'block' }}>
      {[0.25, 0.5, 0.75, 1.0].map((fr, ri) => (
        <polygon
          key={ri}
          points={MRT_DIMS.map((_, i) => {
            const p = polar(i, R * fr)
            return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
          }).join(' ')}
          fill="none"
          stroke={`rgba(255,255,255,${0.03 + ri * 0.02})`}
          strokeWidth={1}
        />
      ))}
      {MRT_DIMS.map((_, i) => {
        const o = polar(i, R)
        return <line key={i} x1={CX} y1={CY} x2={o.x} y2={o.y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      })}
      <polygon points={polyPts} fill={fill} stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
      {MRT_DIMS.map((d, i) => {
        const t = byId[d.id] ?? 0
        const p = polar(i, radFromT(t, R))
        const dot = t > 0.2 ? '#4ade80' : t < -0.2 ? '#f43f5e' : '#fbbf24'
        return <circle key={d.id} cx={p.x} cy={p.y} r={4} fill={dot} />
      })}
      {MRT_DIMS.map((d, i) => {
        const o = polar(i, R + 18)
        const t = byId[d.id] ?? 0
        const anchor = o.x < CX - 10 ? 'end' : o.x > CX + 10 ? 'start' : 'middle'
        return (
          <g key={d.id}>
            <text x={o.x} y={o.y - 2} textAnchor={anchor} fontSize={9} fill={d.color} fontFamily="monospace" fontWeight={700}>
              {d.label}
            </text>
            <text x={o.x} y={o.y + 9} textAnchor={anchor} fontSize={8} fill="#94a3b8" fontFamily="monospace">
              {t > 0 ? '+' : ''}
              {t.toFixed(2)}
            </text>
          </g>
        )
      })}
      <text x={CX} y={CY} textAnchor="middle" fontSize={11} fontWeight={800} fill={stroke} fontFamily="monospace">
        Σt {composite > 0 ? '+' : ''}
        {composite.toFixed(1)}
      </text>
    </svg>
  )
}

export default function MRTMonitor() {
  const [snapshot, setSnapshot] = useState<any>(null)
  const [replay, setReplay] = useState<MrtReplayPayload | null>(null)
  const [sym, setSym] = useState('BTC')
  const [lim, setLim] = useState(2500)
  const [snapErr, setSnapErr] = useState('')
  const [replayErr, setReplayErr] = useState('')
  const [loadingSnap, setLoadingSnap] = useState(true)
  const [loadingReplay, setLoadingReplay] = useState(false)
  const [discovery, setDiscovery] = useState<any>(null)
  const [discErr, setDiscErr] = useState('')
  const [loadingDisc, setLoadingDisc] = useState(true)

  const loadDiscovery = useCallback(async () => {
    setLoadingDisc(true)
    setDiscErr('')
    try {
      const r = await fetch(mrtApiUrl('/v1/mrt/discovery'))
      if (!r.ok) {
        const t = (await r.text()).trim()
        const empty404 = r.status === 404 && (t === '' || /^not found$/i.test(t))
        if (empty404) {
          throw new Error(
            'mrt-api on :3340 is a stale binary (empty 404 on /v1/mrt/discovery). Stop all ./gort.sh, run ./gort.sh all again — it now kills old listeners first.',
          )
        }
        throw new Error(t || r.statusText)
      }
      setDiscovery(await r.json())
    } catch (e) {
      setDiscErr((e as Error).message)
      setDiscovery(null)
    } finally {
      setLoadingDisc(false)
    }
  }, [])

  const loadSnap = useCallback(async () => {
    setLoadingSnap(true)
    setSnapErr('')
    try {
      const r = await fetch(mrtApiUrl('/v1/mrt/snapshot'))
      if (!r.ok) {
        const t = await r.text()
        throw new Error(t || r.statusText)
      }
      setSnapshot(await r.json())
    } catch (e) {
      setSnapErr((e as Error).message)
      setSnapshot(null)
    } finally {
      setLoadingSnap(false)
    }
  }, [])

  const loadReplay = useCallback(async () => {
    setLoadingReplay(true)
    setReplayErr('')
    try {
      const q = new URLSearchParams({ symbol: sym, limit: String(lim) })
      const r = await fetch(`${mrtApiUrl('/v1/mrt/replay')}?${q}`)
      const text = await r.text()
      let j: any
      try {
        j = JSON.parse(text)
      } catch {
        throw new Error(text || `${r.status} ${r.statusText}`)
      }
      if (!r.ok) throw new Error(typeof j === 'string' ? j : text || r.statusText)
      if (j?.ok === false) throw new Error(j?.error || 'replay failed')
      setReplay(j as MrtReplayPayload)
    } catch (e) {
      setReplayErr((e as Error).message)
      setReplay(null)
    } finally {
      setLoadingReplay(false)
    }
  }, [sym, lim])

  useEffect(() => {
    loadSnap()
    loadDiscovery()
  }, [loadSnap, loadDiscovery])

  useEffect(() => {
    const rows = snapshot?.symbols
    if (!Array.isArray(rows) || rows.length === 0) return
    const have = rows.some((x: any) => String(x.symbol).toUpperCase() === sym.toUpperCase())
    if (!have) setSym(String(rows[0].symbol))
  }, [snapshot, sym])

  useEffect(() => {
    if (!snapshot) return
    loadReplay()
  }, [snapshot, sym, lim, loadReplay])

  const symbols: string[] = useMemo(() => {
    const rows = snapshot?.symbols
    if (!Array.isArray(rows)) return ['BTC', 'ETH']
    return rows.map((x: any) => x.symbol as string)
  }, [snapshot])

  const row = useMemo(() => {
    const rows = snapshot?.symbols
    if (!Array.isArray(rows)) return null
    return rows.find((x: any) => String(x.symbol).toUpperCase() === sym.toUpperCase()) ?? null
  }, [snapshot, sym])

  const stats = (replay as { stats?: Record<string, number> } | null)?.stats ?? null

  const discRow = useMemo(() => {
    const rows = discovery?.symbols
    if (!Array.isArray(rows)) return null
    return rows.find((x: any) => String(x.symbol).toUpperCase() === sym.toUpperCase()) ?? null
  }, [discovery, sym])

  const discMeta = useMemo(() => {
    if (!discovery || typeof discovery !== 'object' || discovery.file_missing) return null
    return {
      table: discovery.table,
      is_frac: discovery.is_frac,
      fdr_alpha: discovery.fdr_alpha,
      generated: discovery.generated_at_unix,
    }
  }, [discovery])

  const discNeedsFile = Boolean(discovery?.file_missing)
  const discPathHint = useMemo(() => {
    const tp = discovery?.tried_paths
    if (discovery?.file_missing && Array.isArray(tp) && tp.length > 0) {
      return tp.filter((x: unknown) => typeof x === 'string').join('\n')
    }
    if (typeof discovery?.discovery_path === 'string') return discovery.discovery_path
    return null
  }, [discovery])

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16, background: 'var(--bg-dark)', color: '#e2e8f0' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#FFB74D', fontFamily: 'monospace', letterSpacing: 2 }}>
            MRT LAB · SIGNAL FACTORY
          </div>
          <div style={{ fontSize: 10, color: '#64748b', letterSpacing: 1 }}>
            IS/OOS MICRO-SIGNALS · CROSS-SECTION REGIME · REPLAY VS FUTURES.DB (5M)
          </div>
        </div>
        <Link to="/maxcogviz" style={{ fontSize: 11, color: '#a855f7', textDecoration: 'none', marginTop: 4 }}>
          ← MAXCOGVIZ oracle
        </Link>
      </div>

      {snapErr && (
        <Callout intent="danger" style={{ marginBottom: 12, fontSize: 12 }}>
          Snapshot: {snapErr} — from repo root run <code>./gort.sh all</code> (builds snapshot + mrt-api :3340), or{' '}
          <code>cd MRT &amp;&amp; ./gort.sh process &amp;&amp; ./gort.sh api</code>. Use <code>GORT_MRT=0</code> only if you
          want M3D without MRT.
        </Callout>
      )}

      <Card
        elevation={Elevation.ONE}
        style={{ background: '#252a31', padding: 12, marginBottom: 14, border: '1px solid rgba(255,183,77,0.12)' }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>Symbol</span>
          <HTMLSelect
            value={sym}
            onChange={e => setSym(e.target.value)}
            disabled={loadingSnap || symbols.length === 0}
            style={{ minWidth: 120 }}
          >
            {symbols.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </HTMLSelect>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>Bars</span>
          <NumericInput
            value={lim}
            min={200}
            max={8000}
            stepSize={100}
            majorStepSize={500}
            onValueChange={v => setLim(v || 2500)}
            style={{ width: 100 }}
          />
          <Button small intent="warning" loading={loadingReplay} onClick={loadReplay} style={{ fontFamily: 'monospace' }}>
            Reload replay
          </Button>
          <Button small minimal onClick={loadSnap} loading={loadingSnap}>
            Refresh snapshot
          </Button>
          {loadingSnap && <Spinner size={16} />}
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <Card
          elevation={Elevation.ONE}
          style={{
            flex: '0 0 300px',
            background: '#0a0f1a',
            padding: 12,
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 8 }}>Signal strength (IS t)</div>
          {row?.signals ? <MRTRadar ts={row.signals} /> : <div style={{ color: '#475569', fontSize: 12 }}>No row</div>}
          <div style={{ marginTop: 12, fontSize: 10, color: '#64748b', lineHeight: 1.5 }}>
            {MRT_DIMS.map(d => (
              <div key={d.id}>
                <span style={{ color: d.color }}>{d.label}</span> — {d.desc}
              </div>
            ))}
          </div>
        </Card>

        <div style={{ flex: '1 1 520px', minWidth: 320 }}>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 6 }}>
            Market (candles) + ensemble equity (orange, left scale) · triangles = position changes
          </div>
          {replayErr && (
            <Callout intent="warning" style={{ marginBottom: 8, fontSize: 11 }}>
              {replayErr}
            </Callout>
          )}
          <MRTResearchChart replay={replay} height={420} />
        </div>
      </div>

      <Card
        elevation={Elevation.ONE}
        style={{ marginTop: 14, background: '#0a0f1a', padding: 12, border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB74D', marginBottom: 8, fontFamily: 'monospace' }}>
          Per-signal diagnostics (snapshot)
        </div>
        {row?.signals ? (
          <HTMLTable compact striped style={{ width: '100%', fontSize: 11 }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>IS t</th>
                <th>OOS t</th>
                <th>IS r</th>
                <th>OOS r</th>
                <th>n IS</th>
                <th>n OOS</th>
              </tr>
            </thead>
            <tbody>
              {row.signals.map((s: any) => (
                <tr key={s.id}>
                  <td style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{s.id}</td>
                  <td style={{ color: s.is_t > 0 ? '#4ade80' : s.is_t < 0 ? '#f43f5e' : '#94a3b8' }}>{s.is_t?.toFixed(2)}</td>
                  <td style={{ color: s.oos_t > 0 ? '#4ade80' : s.oos_t < 0 ? '#f43f5e' : '#94a3b8' }}>{s.oos_t?.toFixed(2)}</td>
                  <td>{s.is_r?.toFixed(4)}</td>
                  <td>{s.oos_r?.toFixed(4)}</td>
                  <td>{s.n_is}</td>
                  <td>{s.n_oos}</td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        ) : (
          <div style={{ color: '#475569' }}>Select symbol with snapshot data</div>
        )}

        {stats && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            {[
              ['Sharpe (ann., 5m)', stats.sharpe_annualized_5m],
              ['Net return', stats.net_return],
              ['Max DD', stats.max_drawdown],
              ['Round turns', stats.round_turns_approx],
              ['Hit rate (active)', stats.hit_rate_when_active],
              ['Bars', stats.bars],
            ].map(([k, v]) => (
              <div
                key={k as string}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: '#1c2127',
                  border: '1px solid rgba(255,255,255,0.06)',
                  minWidth: 120,
                }}
              >
                <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontSize: 14, fontFamily: 'monospace', color: '#e2e8f0' }}>
                  {typeof v !== 'number'
                    ? '—'
                    : k === 'Round turns' || k === 'Bars'
                      ? String(Math.round(v))
                      : v.toFixed(4)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        elevation={Elevation.ONE}
        style={{ marginTop: 14, background: '#0f1419', padding: 14, border: '1px solid rgba(34,211,238,0.18)' }}
      >
        <div style={{ fontSize: 12, fontWeight: 800, color: '#22d3ee', fontFamily: 'monospace', marginBottom: 10 }}>
          ENSEMBLE · PER-SIGNAL SCORES · WHAT WE TUNE
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.6, display: 'grid', gap: 10 }}>
          <p style={{ margin: 0 }}>
            <strong style={{ color: '#e2e8f0' }}>Baseline algos (snapshot)</strong> — Four micro-signals per symbol: reversal,
            short-vs-long momentum, range position, trend participation. Each series is aligned to{' '}
            <strong>1-bar forward log return</strong> on <Tag minimal>bars_5m</Tag> from <code>futures.db</code>.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: '#e2e8f0' }}>IS / OOS</strong> — Chronological split (default 75% / 25%). Per signal we store
            mean forward return × signal (IS and OOS separately), <strong>t-statistic</strong>, and sample counts. The radar and
            table above are <strong>IS t</strong>; replay risk metrics use the realized ensemble path on full history for the chart
            window.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: '#e2e8f0' }}>Ensemble weights (replay)</strong> — From snapshot, each signal weight is{' '}
            <code style={{ color: '#FFB74D' }}>clamp(is_t / 3, −1, +1)</code>. Each bar, the processor micro-signals are combined as a
            weighted sum; <strong>position</strong> is the sign of that sum (long / short / flat). Weights are not renormalized to sum
            to 1 in this v1. <strong>Not</strong> yet: regime posterior, fees, or capacity.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: '#4ade80' }}>How we improve</strong> — (1) <strong>Discovery</strong> (FDR card next): wide feature search +
            Benjamini–Hochberg FDR. (2) Promote only signals stable in walk-forward and OOS. (3) Regime-gate weights. (4) Add cost /
            turnover penalties. (5) Retire signals when OOS t flips or IC decays. Tiles under the diagnostics table (Sharpe, DD, …)
            are <strong>replay diagnostics</strong> for the current ensemble only.
          </p>
        </div>
      </Card>

      <Card
        elevation={Elevation.ONE}
        style={{ marginTop: 14, background: '#0a0f1a', padding: 12, border: '1px solid rgba(168,85,247,0.22)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#a855f7', fontFamily: 'monospace' }}>
            Signal discovery (FDR)
          </div>
          <Button small minimal loading={loadingDisc} onClick={loadDiscovery} style={{ fontFamily: 'monospace', fontSize: 11 }}>
            Refresh discovery
          </Button>
        </div>
        {discNeedsFile ? (
          <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.45, marginBottom: discMeta ? 10 : 0 }}>
            <div>
              No <code>mrt_discovery.json</code> yet — run <code>./gort.sh discover</code>, then <strong>Refresh discovery</strong>.
            </div>
            {discPathHint ? (
              <div
                style={{
                  fontSize: 10,
                  color: '#475569',
                  marginTop: 6,
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-line',
                }}
              >
                {discovery?.tried_paths?.length ? 'Searched:\n' : ''}
                {discPathHint}
              </div>
            ) : (
              <div style={{ fontSize: 10, color: '#475569', marginTop: 6 }}>
                Dev calls <code>http://127.0.0.1:3340</code> directly. If this still shows after <code>./gort.sh discover</code>, ensure{' '}
                <code>./gort.sh all</code> is running and port <strong>3340</strong> is free (no duplicate stack).
              </div>
            )}
          </div>
        ) : discErr ? (
          <Callout intent="warning" style={{ fontSize: 11 }}>
            {discErr}
            {!/gort\.sh discover/i.test(discErr) ? (
              <>
                {' '}
                <span style={{ color: '#64748b' }}>
                  Try <code>./gort.sh discover</code>, then Refresh discovery.
                </span>
              </>
            ) : null}
          </Callout>
        ) : discMeta ? (
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 10, fontFamily: 'monospace' }}>
            table={String(discMeta.table ?? '—')} · IS frac={discMeta.is_frac ?? '—'} · FDR α={discMeta.fdr_alpha ?? '—'} ·
            generated {fmtUnix(discMeta.generated)}
          </div>
        ) : null}
        {discRow && (
          <>
            <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 6 }}>
              Symbol <Tag minimal intent="warning">{discRow.symbol}</Tag> — tested {discRow.total_tested} features · passed FDR{' '}
              {discRow.passed_fdr} · bars {discRow.bars}
            </div>
            {Array.isArray(discRow.winners) && discRow.winners.length > 0 ? (
              <HTMLTable compact striped style={{ width: '100%', fontSize: 10 }}>
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>IS t</th>
                    <th>OOS t</th>
                    <th>q-value</th>
                    <th>IS r</th>
                    <th>OOS r</th>
                  </tr>
                </thead>
                <tbody>
                  {discRow.winners.slice(0, 20).map((w: any) => (
                    <tr key={w.id}>
                      <td style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{w.id}</td>
                      <td style={{ color: w.is_t > 0 ? '#4ade80' : '#f43f5e' }}>{Number(w.is_t).toFixed(2)}</td>
                      <td style={{ color: w.oos_t > 0 ? '#4ade80' : '#f43f5e' }}>{Number(w.oos_t).toFixed(2)}</td>
                      <td>{w.q_value != null ? Number(w.q_value).toExponential(2) : '—'}</td>
                      <td>{w.is_r != null ? Number(w.is_r).toFixed(4) : '—'}</td>
                      <td>{w.oos_r != null ? Number(w.oos_r).toFixed(4) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
            ) : (
              <div style={{ fontSize: 11, color: '#475569' }}>No FDR winners for this symbol.</div>
            )}
          </>
        )}
        {!discErr && discovery && !discovery.file_missing && !discRow && (
          <div style={{ fontSize: 11, color: '#475569' }}>
            No discovery row for <strong>{sym}</strong> — pick another symbol or widen the discovery universe.
          </div>
        )}
        {!discErr && !discovery && !loadingDisc && (
          <div style={{ fontSize: 11, color: '#475569' }}>No discovery payload loaded.</div>
        )}
      </Card>

      <Card
        elevation={Elevation.TWO}
        style={{
          marginTop: 14,
          padding: 14,
          background: 'linear-gradient(180deg, #0c1220 0%, #0a0f18 100%)',
          border: '1px solid rgba(255,183,77,0.28)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 800, color: '#FFB74D', fontFamily: 'monospace', marginBottom: 4 }}>
          ALPHA LOOP · AI EXPERTS · RETURNS · ENGINEERING
        </div>
        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 14, lineHeight: 1.45 }}>
          RenTech-style = many weak predictors + strict stats + ensemble + continuous replace. Use (1) expert prompts for new
          hypothesis, (2) this loop until replay shows edge, (3) hardening in code and infra.
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14,
            alignItems: 'start',
          }}
        >
          {/* —— 1. AI experts —— */}
          <div
            style={{
              background: '#111827',
              borderRadius: 8,
              padding: 12,
              border: '1px solid rgba(34,211,238,0.2)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, color: '#22d3ee', fontFamily: 'monospace', marginBottom: 8 }}>
              1. ASK AI EXPERTS (alpha / algos)
            </div>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8 }}>
              Paste into ChatGPT / Claude / Grok with your symbol + horizon + constraint “OHLCV 5m only”.
            </div>
            <ul style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.55, margin: 0, paddingLeft: 16 }}>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Decorrelation:</strong> “Given these 4 baseline signals [list], propose 8 new
                features maximally orthogonal to them and to each other; rank by plausible economic mechanism.”
              </li>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Regime:</strong> “Define 3 latent regimes from vol + trend only. For each
                regime, which signal family should dominate and why? Give a testable weighting rule.”
              </li>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Costs:</strong> “Add round-trip bps + slippage model; rewrite objective so
                discovery loses p-hacked high-turnover junk.”
              </li>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Nonlinear:</strong> “Which smooth transforms (rank, signed log, tanh-cap) of
                returns/vol improve stability vs 1-bar forward r without doubling count of free parameters?”
              </li>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Ensemble:</strong> “Replace scalar clamp(t/3) with softmax(t/τ) or ridge
                regression weights; derive τ from cross-validated prediction error.”
              </li>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Shorting / funding:</strong> “If we add perp funding and basis as features, list
                5 falsifiable predictions on when edge should flip.”
              </li>
            </ul>
          </div>

          {/* —— 2. Review → iter → opt (returns) —— */}
          <div
            style={{
              background: '#111827',
              borderRadius: 8,
              padding: 12,
              border: '1px solid rgba(74,222,128,0.22)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, color: '#4ade80', fontFamily: 'monospace', marginBottom: 8 }}>
              2. CURRENT ALGOS → RETURN (review · iter · opt)
            </div>
            <ol style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.55, margin: 0, paddingLeft: 16 }}>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Review:</strong> Confirm fresh snapshot (<code>cd MRT &amp;&amp; ./gort.sh process</code>
                ), mrt-api up, symbol has bars. Check OOS t vs IS t in the table — same sign and magnitude “sane”?
              </li>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Diagnose flat P&amp;L:</strong> Composite near 0 → weights kill signal; try symbol
                with larger |IS t|; check regime tag vs vol spike.
              </li>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Iter:</strong> Change <strong>bars limit</strong> in replay (more history vs
                recent regime). Re-run processor after DB refresh. Compare Sharpe / net return / max DD tiles.
              </li>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Opt (next code):</strong> Tune IS/OOS fraction in processor, weight mapping
                (÷3 clamp vs temperature), optional <strong>position scale</strong> on |composite| for leverage cap simulation.
              </li>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Promote:</strong> Pull top FDR features from discovery into processor trial
                branch; A/B replay vs baseline 4-pack on same window.
              </li>
            </ol>
          </div>

          {/* —— 3. Engineering OPT —— */}
          <div
            style={{
              background: '#111827',
              borderRadius: 8,
              padding: 12,
              border: '1px solid rgba(251,191,36,0.25)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, color: '#fbbf24', fontFamily: 'monospace', marginBottom: 8 }}>
              3. ENGINEERING OPT
            </div>
            <ul style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.55, margin: 0, paddingLeft: 16 }}>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Replay realism:</strong> Add fee + slippage bps in <code>replay.rs</code>; surface
                net-of-cost Sharpe on /mrt.
              </li>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Walk-forward:</strong> CLI or job: roll train/test windows; emit CSV of OOS
                metrics per window for drift alarms.
              </li>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Weight pipeline:</strong> Optional softmax/ridge layer after snapshot; version
                snapshot schema so old JSON still replays.
              </li>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Discovery → prod:</strong> Auto-flag candidates with OOS t &gt; X and stable
                sign across symbols; generate patch list for <code>mrt-processor</code>.
              </li>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Perf:</strong> Parallel symbol replay for batch reports; cache discovery JSON in
                API with mtime invalidation.
              </li>
              <li>
                <strong style={{ color: '#e2e8f0' }}>Tests:</strong> Golden-file snapshot + replay for 1 symbol (fixed seed bars) in
                CI so refactors don’t silent-break edge.
              </li>
            </ul>
          </div>
        </div>
      </Card>

      <Card
        elevation={Elevation.ONE}
        style={{ marginTop: 14, padding: 14, background: '#131820', border: '1px solid rgba(244,63,94,0.2)' }}
      >
        <div style={{ fontSize: 12, fontWeight: 800, color: '#f43f5e', fontFamily: 'monospace', marginBottom: 10 }}>
          ANOMALY SEARCH · WHAT TO HUNT · STRATEGY
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.55, display: 'grid', gap: 12 }}>
          <section>
            <div style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: 6 }}>A) Structural breaks in edge</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                <strong>IC / t-stat CUSUM</strong> — cumulative sum of demeaned per-bar information coefficient; alarm when drift
                exceeds control limits.
              </li>
              <li>
                <strong>sup-F / Chow</strong> — test for parameter shift in predictive regression (signal → forward return) at
                unknown break date.
              </li>
              <li>
                <strong>Sample split sanity</strong> — same signal on pre/post halving, major listing, regime year; if sign stable
                only in one half, flag overfit.
              </li>
            </ul>
          </section>
          <section>
            <div style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: 6 }}>B) Alpha decay & “anomaly gone”</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                <strong>OOS vs IS sign flip</strong> — auto-demote when OOS t disagrees with IS beyond noise band; require
                re-validation before re-promotion.
              </li>
              <li>
                <strong>Rolling Sharpe collapse</strong> — moving 6M Sharpe on held-out slice falls below floor while IS remains
                high → crowding or DGP change.
              </li>
              <li>
                <strong>Ask what changed</strong> — liquidity, fees, venue, contract spec, borrow, macro; map each to a testable
                hypothesis on the signal stream.
              </li>
            </ul>
          </section>
          <section>
            <div style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: 6 }}>C) Cross-section / crowding proxies</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                <strong>Factor correlation spike</strong> — pairwise or PCA loadings of signal P&amp;L vs peers; shrink ensemble
                when eigenvector concentration rises.
              </li>
              <li>
                <strong>Turnover vs capacity</strong> — Amihud or high-low range vs volume as illiquidity gate; down-weight when
                hypothetical clip &gt; %ADV.
              </li>
            </ul>
          </section>
          <section>
            <div style={{ color: '#a855f7', fontWeight: 700, marginBottom: 6 }}>Swarm / research prompts (LLM-ready)</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Walk-forward with embargo: does the IS t-weight ensemble decay after 30 / 60 / 90 sessions?</li>
              <li>HMM on vol + correlation (3–5 states); gate weights with posterior P(state), not a single regime tag.</li>
              <li>20 decorrelated micro-features under BH-FDR vs the baseline 4-pack — economic interpretation of survivors.</li>
              <li>OHLCV-only impact proxy: Amihud + realized vol; add turnover penalty to discovery score.</li>
              <li>Formal retire rule when OOS t flips: spec genetic or greedy replacement from discovery pool.</li>
            </ul>
          </section>
        </div>
      </Card>
    </div>
  )
}
