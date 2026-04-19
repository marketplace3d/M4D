/**
 * SHARPE — System analytics + Ollama AI advice (Qwen / Gemma4).
 * Tracks algo performance over time, surfaces top performers,
 * and gives an AI-generated tactical brief on page load.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Card, Elevation, Button, HTMLSelect, Spinner, Tag, Intent,
  Callout, ProgressBar,
} from '@blueprintjs/core'
import { useCouncil, useAlgoDay } from '../api/client'

// ── AI model list: local Ollama + xAI Grok (YODA) ────────────────────────────
const OLLAMA_MODELS = ['qwen2.5:14b', 'qwen2.5-coder:14b', 'gemma4:latest']
const GROK_MODELS   = ['grok-4.20-reasoning', 'grok-3', 'grok-3-mini']
const AI_MODELS     = [...OLLAMA_MODELS, ...GROK_MODELS]
const isGrok = (m: string) => m.startsWith('grok-')

// ── History stored in localStorage ────────────────────────────────────────────
const PERF_KEY = 'm3d.sharpe.snapshots'

interface Snapshot {
  ts: string
  jedi: number
  regime: string
  long_algos: number
  short_algos: number
  top_assets: string[]
}

// ── EMA helper (used for YODA trend MA) ──────────────────────────────────────
function ema(values: number[], period: number): number[] {
  if (values.length === 0) return []
  const k = 2 / (period + 1)
  const result: number[] = []
  let prev = values[0]
  for (const v of values) {
    prev = v * k + prev * (1 - k)
    result.push(prev)
  }
  return result
}

// ── Safety-bracket a sentiment contribution ───────────────────────────────────
// Mirrors backend logic: 25-45% weight, reduced when JEDI is very strong
function bracketSentiment(raw: number, jedi: number): number {
  const absJ = Math.abs(jedi)
  const cap = absJ > 15 ? 0.10 : absJ > 10 ? 0.20 : 0.35
  return Math.max(-cap, Math.min(cap, raw * cap))
}

function loadSnapshots(): Snapshot[] {
  try { return JSON.parse(localStorage.getItem(PERF_KEY) ?? '[]') } catch { return [] }
}
function appendSnapshot(s: Snapshot) {
  try {
    const hist = loadSnapshots()
    hist.unshift(s)
    localStorage.setItem(PERF_KEY, JSON.stringify(hist.slice(0, 90)))
  } catch {}
}

// ── Sparkline (inline SVG) ────────────────────────────────────────────────────
function Spark({ values, color = '#4ade80', height = 32 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const W = 120
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={W} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  )
}

// ── AI Advice card ────────────────────────────────────────────────────────────
function AIAdvice({ jedi, regime, longAlgos, shortAlgos, asset, onSentiment }: {
  jedi: number; regime: string; longAlgos: number; shortAlgos: number; asset: string
  onSentiment?: (score: number | null) => void
}) {
  const [advice, setAdvice] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [model, setModel] = useState(AI_MODELS[0])
  const [ok, setOk] = useState(true)

  const fetchAdvice = useCallback(async () => {
    setLoading(true); setError(''); setAdvice('')
    try {
      const qs = new URLSearchParams({
        asset, jedi: String(jedi), regime,
        long_algos: String(longAlgos), short_algos: String(shortAlgos),
        model,
      })
      const res = await fetch(`/ds/v1/ai/advice/?${qs}`)
      const data = await res.json()
      setOk(data.ok)
      if (data.ok) {
        setAdvice(data.advice)
        onSentiment?.(data.sentiment_score ?? null)
      } else {
        setError(data.error ?? (isGrok(model) ? 'xAI API not reachable' : 'Ollama not reachable'))
        onSentiment?.(null)
      }
    } catch (e) { setError((e as Error).message); setOk(false); onSentiment?.(null) }
    finally { setLoading(false) }
  }, [asset, jedi, regime, longAlgos, shortAlgos, model]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch on first render
  useEffect(() => { fetchAdvice() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const grok = isGrok(model)

  return (
    <Card elevation={Elevation.TWO} style={{
      background: '#0a0f1a',
      border: `1px solid ${grok ? 'rgba(168,85,247,0.3)' : 'rgba(255,183,77,0.2)'}`,
      padding: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, color: grok ? '#a855f7' : '#FFB74D' }}>
            {grok ? '🌌 YODA TACTICAL BRIEF' : '⚡ AI TACTICAL BRIEF'}
          </span>
          <span style={{ fontSize: 10, color: '#475569', marginLeft: 8 }}>
            {grok ? 'powered by xAI Grok · sentiment-scored' : 'powered by local Ollama'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <HTMLSelect
            value={model}
            onChange={e => setModel(e.target.value)}
            style={{ fontSize: 10, padding: '2px 4px', background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}
          >
            <optgroup label="Local Ollama">
              {OLLAMA_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </optgroup>
            <optgroup label="xAI Grok (YODA)">
              {GROK_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </optgroup>
          </HTMLSelect>
          <Button icon="refresh" onClick={fetchAdvice} loading={loading} style={{ fontSize: 10 }}>
            Refresh
          </Button>
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', padding: '8px 0' }}>
          <Spinner size={14} />
          <span style={{ fontSize: 11 }}>Asking {model}…</span>
        </div>
      )}

      {!ok && error && (
        <Callout intent="warning" style={{ fontSize: 11 }}>
          {error}
          {!grok && <> — start Ollama with <code>ollama serve</code></>}
        </Callout>
      )}

      {advice && (
        <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
          {advice}
        </div>
      )}
    </Card>
  )
}

// ── Regime badge ──────────────────────────────────────────────────────────────
function RegimeBadge({ regime }: { regime: string }) {
  const col = regime === 'BULL' ? '#4ade80' : regime === 'BEAR' ? '#f87171' : '#FFB74D'
  return (
    <Tag style={{ background: col + '22', color: col, border: `1px solid ${col}44`, fontWeight: 700 }}>
      {regime}
    </Tag>
  )
}

// ── YODA Sentiment panel ──────────────────────────────────────────────────────
function YodaSentimentPanel({ raw, jedi, jediHistory }: {
  raw: number | null; jedi: number; jediHistory: number[]
}) {
  // Bracket breach: YODA sentiment strongly conflicts with quant JEDI signal
  // e.g. JEDI = +14 (very bullish quant) but Grok says -0.7 (extreme fear)
  const bracketBreach = raw !== null && Math.abs(jedi) > 10 && Math.abs(raw) > 0.5
    && Math.sign(raw) !== Math.sign(jedi)
  // Trend MA: EMA(10) of JEDI history → normalised to [-1, 1]
  const jediEma = jediHistory.length >= 2 ? ema(jediHistory, 10) : []
  const latestEma = jediEma.length > 0 ? jediEma[jediEma.length - 1] : null
  const trendNorm = latestEma !== null ? latestEma / 27 : null  // [-1,1]

  // Blend: 65% quant (JEDI norm) + 35% Grok sentiment (safety-bracketed)
  const jediNorm = jedi / 27
  let blended: number | null = null
  let sentContrib: number | null = null
  if (raw !== null) {
    sentContrib = bracketSentiment(raw, jedi)
    blended = jediNorm * 0.65 + sentContrib
  } else if (trendNorm !== null) {
    // Fallback: blend JEDI + trend MA
    blended = jediNorm * 0.75 + trendNorm * 0.25
  }

  const col = (v: number) => v > 0.15 ? '#4ade80' : v < -0.15 ? '#f87171' : '#FFB74D'
  const label = (v: number) => v > 0.3 ? 'BULL' : v > 0.1 ? 'LEAN LONG' : v < -0.3 ? 'BEAR' : v < -0.1 ? 'LEAN SHORT' : 'NEUTRAL'

  return (
    <Card elevation={Elevation.TWO} className={bracketBreach ? 'bracket-breach' : ''} style={{
      background: '#0a0f1a',
      border: `1px solid ${bracketBreach ? 'rgba(255,23,68,0.4)' : 'rgba(168,85,247,0.25)'}`,
      padding: 16, marginBottom: 16, position: 'relative', overflow: 'hidden',
    }}>
      {/* Red mist overlay when bracket is breached */}
      {bracketBreach && <div className="red-mist-overlay" />}

      {bracketBreach && (
        <div style={{
          marginBottom: 10, padding: '8px 12px', borderRadius: 6,
          background: 'rgba(255,23,68,0.15)', border: '1px solid rgba(255,23,68,0.5)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>🚨</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#ff1744', letterSpacing: 1 }}>
              BRACKET BREACH — YODA OVERRIDE SUPPRESSED
            </div>
            <div style={{ fontSize: 10, color: '#f87171', marginTop: 2 }}>
              YODA sentiment ({raw !== null ? (raw > 0 ? '+' : '') + (raw * 100).toFixed(0) : '?'}%) conflicts with
              strong JEDI ({jedi > 0 ? '+' : ''}{jedi}). Sentiment capped at {Math.abs(jedi) > 15 ? '10' : '20'}% weight.
              Stand by — quant signal governs.
            </div>
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 700, color: bracketBreach ? '#ff1744' : '#a855f7', marginBottom: 10 }}>
        {bracketBreach ? '⚠ SENTIMENT CONFLICT DETECTED' : '🌌 YODA SENTIMENT BLEND'}
        <span style={{ fontSize: 9, color: '#475569', marginLeft: 8, fontWeight: 400 }}>
          Quant 65% · Sentiment 25-45% (safety-bracketed)
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>

        {/* Quant JEDI */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            Quant (JEDI)
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace',
            color: col(jediNorm) }}>
            {jediNorm > 0 ? '+' : ''}{(jediNorm * 100).toFixed(0)}%
          </div>
          <div style={{ fontSize: 9, color: '#334155' }}>weight 65%</div>
        </div>

        {/* Grok raw sentiment */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            YODA Raw
          </div>
          {raw !== null ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: col(raw) }}>
                {raw > 0 ? '+' : ''}{(raw * 100).toFixed(0)}%
              </div>
              <div style={{ fontSize: 9, color: '#334155' }}>
                bracketed → {sentContrib !== null ? `${(sentContrib * 100).toFixed(0)}%` : '—'}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11, color: '#334155', marginTop: 6 }}>—<br/>run Grok</div>
          )}
        </div>

        {/* Trend EMA */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            Trend MA(10)
          </div>
          {trendNorm !== null ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: col(trendNorm) }}>
                {trendNorm > 0 ? '+' : ''}{(trendNorm * 100).toFixed(0)}%
              </div>
              <Spark values={jediEma} color={trendNorm >= 0 ? '#a855f7' : '#f87171'} height={24} />
            </>
          ) : (
            <div style={{ fontSize: 11, color: '#334155', marginTop: 6 }}>need 10+ snapshots</div>
          )}
        </div>

        {/* Blended signal */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            Blended Signal
          </div>
          {blended !== null ? (
            <>
              <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'monospace', color: col(blended) }}>
                {blended > 0 ? '+' : ''}{(blended * 100).toFixed(0)}%
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: col(blended) }}>{label(blended)}</div>
              {Math.abs(jedi) > 10 && (
                <div style={{ fontSize: 9, color: '#f97316', marginTop: 2 }}>
                  ⚠ JEDI {Math.abs(jedi) > 15 ? 'dominant' : 'strong'} — sentiment capped
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 11, color: '#334155', marginTop: 6 }}>no data</div>
          )}
        </div>
      </div>

      {/* Signal strength bar */}
      {blended !== null && (
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
            {/* Centre mark */}
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#334155' }} />
            <div style={{
              position: 'absolute',
              height: '100%',
              borderRadius: 3,
              background: col(blended),
              left: blended >= 0 ? '50%' : `${(0.5 + blended / 2) * 100}%`,
              width: `${Math.abs(blended) * 50}%`,
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#334155', marginTop: 2 }}>
            <span>-100% BEAR</span><span>NEUTRAL</span><span>BULL +100%</span>
          </div>
        </div>
      )}
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Sharpe() {
  const { data: council } = useCouncil()
  const { data: algoDay } = useAlgoDay()

  const [snapshots] = useState<Snapshot[]>(loadSnapshots)
  const [focusAsset, setFocusAsset] = useState('BTC')
  const [yodaSentiment, setYodaSentiment] = useState<number | null>(null)

  const jedi    = council?.jedi_score ?? 0
  const regime  = council?.regime ?? 'NEUTRAL'
  const longAlg = council?.total_long ?? 0
  const shortAlg = council?.total_short ?? 0
  const algos   = council?.algos ?? []

  // Save snapshot on load (once per session via ref approach)
  useEffect(() => {
    if (!council) return
    const top = algoDay?.assets
      ?.sort((a, b) => (b.jedi_score ?? 0) - (a.jedi_score ?? 0))
      ?.slice(0, 5)
      ?.map(a => a.symbol) ?? []
    appendSnapshot({
      ts: new Date().toISOString(),
      jedi,
      regime,
      long_algos: longAlg,
      short_algos: shortAlg,
      top_assets: top,
    })
  }, [council]) // eslint-disable-line react-hooks/exhaustive-deps

  const jediHistory   = snapshots.map(s => s.jedi).reverse()
  const longHistory   = snapshots.map(s => s.long_algos).reverse()
  const shortHistory  = snapshots.map(s => s.short_algos).reverse()

  // Sort algos by strength
  const sortedAlgos = [...algos].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const topLong  = sortedAlgos.filter(a => a.vote === 1).slice(0, 9)
  const topShort = sortedAlgos.filter(a => a.vote === -1).slice(0, 9)

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16, background: 'var(--bg-dark)', color: '#e2e8f0' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#FFB74D' }}>📊 SHARPE — System Analytics</div>
          <div style={{ fontSize: 10, color: '#475569' }}>
            Performance tracking · AI advice · Council health · Regime history
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <RegimeBadge regime={regime} />
          <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700,
            color: jedi > 8 ? '#4ade80' : jedi < -8 ? '#f87171' : '#FFB74D' }}>
            JEDI {jedi > 0 ? '+' : ''}{jedi}
          </div>
        </div>
      </div>

      {/* AI Advice */}
      <div style={{ marginBottom: 16 }}>
        <AIAdvice
          jedi={jedi} regime={regime}
          longAlgos={longAlg} shortAlgos={shortAlg}
          asset={focusAsset}
          onSentiment={setYodaSentiment}
        />
      </div>

      {/* YODA Sentiment Blend */}
      <YodaSentimentPanel raw={yodaSentiment} jedi={jedi} jediHistory={jediHistory} />

      {/* 3-col stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>

        {/* JEDI trend */}
        <Card elevation={Elevation.ONE} style={{ background: '#0f172a', padding: 12 }}>
          <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            JEDI Score Trend
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'monospace',
            color: jedi > 8 ? '#4ade80' : jedi < -8 ? '#f87171' : '#FFB74D' }}>
            {jedi > 0 ? '+' : ''}{jedi}
          </div>
          <Spark values={jediHistory} color={jedi >= 0 ? '#4ade80' : '#f87171'} />
          <div style={{ fontSize: 9, color: '#334155', marginTop: 4 }}>{snapshots.length} snapshots stored</div>
        </Card>

        {/* Long vs Short */}
        <Card elevation={Elevation.ONE} style={{ background: '#0f172a', padding: 12 }}>
          <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Council Alignment
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#4ade80', fontFamily: 'monospace' }}>{longAlg}</div>
              <div style={{ fontSize: 9, color: '#475569' }}>LONG</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#f87171', fontFamily: 'monospace' }}>{shortAlg}</div>
              <div style={{ fontSize: 9, color: '#475569' }}>SHORT</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#64748b', fontFamily: 'monospace' }}>{27 - longAlg - shortAlg}</div>
              <div style={{ fontSize: 9, color: '#475569' }}>FLAT</div>
            </div>
          </div>
          <ProgressBar
            value={longAlg / 27}
            intent={longAlg > shortAlg ? Intent.SUCCESS : Intent.DANGER}
            animate={false}
          />
          <Spark values={longHistory} color="#4ade80" />
        </Card>

        {/* Regime history */}
        <Card elevation={Elevation.ONE} style={{ background: '#0f172a', padding: 12 }}>
          <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Regime History (last {Math.min(snapshots.length, 20)})
          </div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {snapshots.slice(0, 20).reverse().map((s, i) => {
              const col = s.regime === 'BULL' ? '#4ade80' : s.regime === 'BEAR' ? '#f87171' : '#FFB74D'
              return (
                <div key={i} title={`${s.ts.slice(0, 16)} JEDI:${s.jedi}`} style={{
                  width: 8, height: 32, borderRadius: 2,
                  background: col + '88',
                  border: `1px solid ${col}44`,
                }} />
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {(['BULL', 'NEUTRAL', 'BEAR'] as const).map(r => {
              const col = r === 'BULL' ? '#4ade80' : r === 'BEAR' ? '#f87171' : '#FFB74D'
              const cnt = snapshots.filter(s => s.regime === r).length
              return (
                <div key={r} style={{ fontSize: 9, color: col }}>
                  {r}: {cnt}
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* Top performers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <Card elevation={Elevation.ONE} style={{ background: '#0f172a', padding: 12 }}>
          <div style={{ fontSize: 10, color: '#4ade80', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            ▲ Top Long Signals
          </div>
          {topLong.length === 0
            ? <div style={{ color: '#334155', fontSize: 11 }}>No long signals</div>
            : topLong.map(a => (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#4ade80', width: 36, fontSize: 11 }}>
                  {a.id}
                </span>
                <div style={{ flex: 1, height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(a.score ?? 0) * 100}%`, background: '#4ade80' }} />
                </div>
                <span style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>
                  {((a.score ?? 0) * 100).toFixed(0)}%
                </span>
              </div>
            ))
          }
        </Card>

        <Card elevation={Elevation.ONE} style={{ background: '#0f172a', padding: 12 }}>
          <div style={{ fontSize: 10, color: '#f87171', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            ▼ Top Short / Bearish Signals
          </div>
          {topShort.length === 0
            ? <div style={{ color: '#334155', fontSize: 11 }}>No short signals — {27 - longAlg - shortAlg} flat</div>
            : topShort.map(a => (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#f87171', width: 36, fontSize: 11 }}>
                  {a.id}
                </span>
                <div style={{ flex: 1, height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(a.score ?? 0) * 100}%`, background: '#f87171' }} />
                </div>
                <span style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>
                  {((a.score ?? 0) * 100).toFixed(0)}%
                </span>
              </div>
            ))
          }
        </Card>
      </div>

      {/* Top assets today */}
      {algoDay?.assets && (
        <Card elevation={Elevation.ONE} style={{ background: '#0f172a', padding: 12 }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Asset Leaderboard — JEDI score today
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[...algoDay.assets]
              .sort((a, b) => (b.jedi_score ?? 0) - (a.jedi_score ?? 0))
              .slice(0, 20)
              .map(a => {
                const score = a.jedi_score ?? 0
                const col = score > 5 ? '#4ade80' : score < -5 ? '#f87171' : '#94a3b8'
                return (
                  <button
                    key={a.symbol}
                    onClick={() => setFocusAsset(a.symbol)}
                    style={{
                      background: focusAsset === a.symbol ? '#1e293b' : 'transparent',
                      border: `1px solid ${col}44`,
                      borderRadius: 6, padding: '6px 10px', cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11, color: '#e2e8f0' }}>
                      {a.symbol}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: col }}>
                      {score > 0 ? '+' : ''}{score}
                    </div>
                  </button>
                )
              })}
          </div>
        </Card>
      )}
    </div>
  )
}
