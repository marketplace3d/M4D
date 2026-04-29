import { useEffect, useRef, useState } from 'react'
import type { ObPressure, SteamPhase } from '../hooks/useObPressureStream'

const HIST_LEN = 40
const PHASE_COLOR: Record<SteamPhase, string> = {
  ACCUMULATION: '#00bfff',
  COMPRESSION:  '#ff6a00',
  POP:          '#ffffff',
}
const PHASE_LABEL: Record<SteamPhase, string> = {
  ACCUMULATION: 'GAS · BUILDING',
  COMPRESSION:  'FIRE · COMPRESS',
  POP:          'STEAM BREAK',
}

// ── Audio ─────────────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null
function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}
function playTone(freq: number, type: OscillatorType, dur: number, vol: number, when?: number) {
  try {
    const c = getAudioCtx()
    const t = when ?? c.currentTime
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.connect(g); g.connect(c.destination)
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.start(t); osc.stop(t + dur + 0.01)
  } catch {}
}
function playExhaustionAlarm() {
  try {
    const c = getAudioCtx(); const t = c.currentTime
    ;[880, 660, 440, 330].forEach((f, i) => playTone(f, 'sawtooth', 0.15, 0.12, t + i * 0.12))
    playTone(80, 'square', 0.5, 0.08, t)
  } catch {}
}
function playPhaseChange(phase: SteamPhase) {
  if (phase === 'POP') { playExhaustionAlarm(); return }
  try {
    const c = getAudioCtx(); const t = c.currentTime
    const freq = phase === 'COMPRESSION' ? 440 : 330
    playTone(freq, 'sine', 0.08, 0.07, t)
    playTone(freq * 1.5, 'sine', 0.06, 0.05, t + 0.1)
  } catch {}
}
function playPressureClick(pressure: number) {
  try {
    const c = getAudioCtx()
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.04), c.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.25))
    const src = c.createBufferSource()
    const g = c.createGain()
    src.buffer = buf; src.connect(g); g.connect(c.destination)
    g.gain.value = Math.min(0.28, Math.abs(pressure) * 0.12)
    src.start()
  } catch {}
}

// ── Flame particles ────────────────────────────────────────────────────────────

interface Flame { x: number; y: number; vx: number; vy: number; life: number; decay: number; size: number; phase: SteamPhase }

function spawnFlames(flames: Flame[], width: number, pressure: number, phase: SteamPhase) {
  if (phase === 'ACCUMULATION') return
  const n = Math.ceil(Math.abs(pressure) * 2)
  for (let i = 0; i < n; i++) {
    flames.push({
      x: Math.random() * width,
      y: 60,
      vx: (Math.random() - 0.5) * 1.5,
      vy: -(1.5 + Math.random() * 2.5),
      life: 1,
      decay: 0.025 + Math.random() * 0.03,
      size: 3 + Math.random() * (phase === 'POP' ? 8 : 4),
      phase,
    })
  }
}

function drawFlames(ctx: CanvasRenderingContext2D, flames: Flame[]) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  for (let i = flames.length - 1; i >= 0; i--) {
    const f = flames[i]!
    f.x += f.vx; f.y += f.vy; f.vy *= 0.97; f.life -= f.decay
    if (f.life <= 0) { flames.splice(i, 1); continue }
    const a = Math.max(0, f.life)
    const color = f.phase === 'POP'
      ? `rgba(255,255,255,${(a * 0.7).toFixed(2)})`
      : f.phase === 'COMPRESSION'
        ? `rgba(255,${Math.floor(100 + 60 * (1 - f.life))},0,${(a * 0.6).toFixed(2)})`
        : `rgba(0,180,255,${(a * 0.4).toFixed(2)})`
    ctx.beginPath()
    ctx.arc(f.x, f.y, f.size * a, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  }
}

// ── Arc gauge ─────────────────────────────────────────────────────────────────

function drawGauge(ctx: CanvasRenderingContext2D, pressure: number, phase: SteamPhase) {
  const W = 200, H = 200, cx = W / 2, cy = H / 2 + 16, R = 76
  const startA = Math.PI * 0.75, endA = Math.PI * 2.25
  const fraction = Math.min(1, Math.abs(pressure))
  const fillA = startA + (endA - startA) * fraction
  const color = PHASE_COLOR[phase]
  ctx.clearRect(0, 0, W, H)
  // Track
  ctx.beginPath(); ctx.arc(cx, cy, R, startA, endA)
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.stroke()
  // Threshold markers
  ;[0.28, 0.50, 0.78].forEach((t, i) => {
    const a = startA + (endA - startA) * t
    const mx = cx + R * Math.cos(a), my = cy + R * Math.sin(a)
    ctx.beginPath(); ctx.arc(mx, my, 3, 0, Math.PI * 2)
    ctx.fillStyle = ['#00bfff', '#ff6a00', '#ff2244'][i]!
    ctx.fill()
  })
  if (fraction > 0) {
    // Glow
    ctx.beginPath(); ctx.arc(cx, cy, R, startA, fillA)
    ctx.strokeStyle = color; ctx.lineWidth = 16; ctx.lineCap = 'round'
    ctx.globalAlpha = 0.14; ctx.stroke(); ctx.globalAlpha = 1
    // Fill
    ctx.beginPath(); ctx.arc(cx, cy, R, startA, fillA)
    ctx.strokeStyle = color; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.stroke()
    // Tip dot
    const tx = cx + R * Math.cos(fillA), ty = cy + R * Math.sin(fillA)
    ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI * 2)
    ctx.fillStyle = color; ctx.fill()
  }
}

// ── Log types ─────────────────────────────────────────────────────────────────

type LogEntry = { type: 'entry' | 'exit' | 'warn' | 'info'; msg: string; ts: string }
const LOG_C = { entry: '#00ff88', exit: '#ff2244', warn: '#ffaa00', info: 'rgba(180,200,220,0.55)' }

// ── Component ─────────────────────────────────────────────────────────────────

export default function SteamGovernorHud({
  obPressure,
  onClose,
  muted = false,
}: {
  obPressure: ObPressure
  onClose?: () => void
  muted?: boolean
}) {
  const gaugeRef  = useRef<HTMLCanvasElement>(null)
  const flameRef  = useRef<HTMLCanvasElement>(null)
  const histRef   = useRef<number[]>(Array(HIST_LEN).fill(0))
  const flamesRef = useRef<Flame[]>([])
  const prevPhase = useRef<SteamPhase>('ACCUMULATION')
  const prevExhausted = useRef(false)
  const tickRef   = useRef(0)
  const [log, setLog] = useState<LogEntry[]>([])
  const [alarmed, setAlarmed] = useState(false)

  function addLog(type: LogEntry['type'], msg: string) {
    const now = new Date()
    const ts = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`
    setLog(prev => [{ type, msg, ts }, ...prev].slice(0, 40))
  }

  useEffect(() => {
    const { pressure, delta, deltaD, phase, exhausted } = obPressure
    tickRef.current++
    const hist = histRef.current
    hist.push(pressure); hist.shift()

    // Phase change events
    if (phase !== prevPhase.current) {
      if (!muted) playPhaseChange(phase)
      addLog('info', `Phase: ${prevPhase.current} → ${phase}`)
      prevPhase.current = phase
    }
    // Exhaustion onset
    if (exhausted && !prevExhausted.current) {
      if (!muted) playExhaustionAlarm()
      addLog('exit', `CLIMAX EXHAUSTION · p=${pressure.toFixed(3)} · ΔΔ=${deltaD.toFixed(3)}`)
      setAlarmed(true)
    }
    if (!exhausted && prevExhausted.current) {
      setAlarmed(false)
      if (delta > 0.008 && Math.abs(pressure) > 0.28) {
        addLog('entry', `Re-entry armed · ΔΔ flip + pressure building`)
      }
    }
    prevExhausted.current = exhausted

    // Click sound on higher-pressure ticks
    if (!muted && tickRef.current % 4 === 0 && Math.abs(pressure) > 0.25) playPressureClick(pressure)

    // Draw gauge
    const gCanvas = gaugeRef.current
    if (gCanvas) drawGauge(gCanvas.getContext('2d')!, pressure, phase)

    // Flames
    const fCanvas = flameRef.current
    if (fCanvas) {
      spawnFlames(flamesRef.current, fCanvas.width, pressure, phase)
      drawFlames(fCanvas.getContext('2d')!, flamesRef.current)
    }
  }, [obPressure, muted])

  const { pressure, delta, deltaD, phase, exhausted, confidence } = obPressure
  const color = PHASE_COLOR[phase]
  const pct = Math.round(Math.abs(pressure) * 100)
  const dFrac  = Math.min(1, Math.abs(delta)  / 0.3)
  const ddFrac = Math.min(1, Math.abs(deltaD) / 0.2)

  return (
    <div style={{
      width: 300,
      background: 'rgba(5,10,16,0.97)',
      border: `1px solid ${alarmed ? 'rgba(255,34,68,0.6)' : 'rgba(255,255,255,0.08)'}`,
      borderTop: `1px solid ${color}`,
      borderRadius: 6,
      fontFamily: 'monospace',
      userSelect: 'none',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      transition: 'border-color 0.3s',
    }}>
      <style>{`
        @keyframes steamAlarmPulse{0%{border-color:rgba(255,34,68,0.25)}100%{border-color:rgba(255,34,68,0.9)}}
        @keyframes steamPhaseFlash{0%{background:rgba(255,255,255,0.12)}100%{background:transparent}}
        @keyframes steamBlink{from{opacity:1}to{opacity:0.15}}
        .steam-alarm-blink{animation:steamBlink 0.4s infinite alternate}
      `}</style>

      {/* Alarm banner */}
      {alarmed && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
          background: 'rgba(255,34,68,0.10)',
          borderBottom: '1px solid rgba(255,34,68,0.4)',
          animation: 'steamAlarmPulse 0.5s infinite alternate',
        }}>
          <div className="steam-alarm-blink" style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff2244', flexShrink: 0 }} />
          <span style={{ fontSize: 9, letterSpacing: 2, color: '#ff2244', fontWeight: 700 }}>
            CLIMAX EXHAUSTION · EXIT
          </span>
          {onClose && <span style={{ marginLeft: 'auto', fontSize: 9, color: '#ff2244', cursor: 'pointer' }} onClick={onClose}>✕</span>}
        </div>
      )}

      {/* Header */}
      {!alarmed && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '6px 10px 4px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <span style={{ fontSize: 8, letterSpacing: 3, color: 'rgba(255,255,255,0.25)', flex: 1 }}>McPhee STEAM GOVERNOR</span>
          {onClose && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: '0 2px' }} onClick={onClose}>✕</span>}
        </div>
      )}

      {/* Gauge area */}
      <div style={{ position: 'relative', height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Flame particles — behind gauge */}
        <canvas ref={flameRef} width={300} height={60} style={{ position: 'absolute', bottom: 0, left: 0, opacity: 0.55, pointerEvents: 'none' }} />
        <canvas ref={gaugeRef} width={200} height={200} />
        {/* Gauge center overlay */}
        <div style={{ position: 'absolute', textAlign: 'center', pointerEvents: 'none' }}>
          <div style={{
            fontSize: 38, fontWeight: 700, lineHeight: 1,
            color, textShadow: `0 0 32px ${color}`,
            transition: 'color 0.3s, text-shadow 0.3s',
          }}>
            {(Math.abs(pressure) * 100).toFixed(0)}
          </div>
          <div style={{ fontSize: 8, letterSpacing: 3, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>OB VELOCITY</div>
          <div style={{
            fontSize: 11, letterSpacing: 3, marginTop: 4, fontWeight: exhausted ? 700 : 400,
            color, transition: 'color 0.3s',
            textShadow: exhausted ? `0 0 12px ${color}` : 'none',
          }}>
            {exhausted ? '◉ CLIMAX' : PHASE_LABEL[phase]}
          </div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>
            Δ {delta >= 0 ? '+' : ''}{delta.toFixed(3)} · ΔΔ {deltaD >= 0 ? '+' : ''}{deltaD.toFixed(3)}
          </div>
        </div>
      </div>

      {/* Pressure bar */}
      <div style={{ padding: '4px 10px 2px' }}>
        <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            background: color,
            boxShadow: phase !== 'ACCUMULATION' ? `0 0 ${phase === 'POP' ? 10 : 5}px ${color}` : 'none',
            borderRadius: 2,
            transition: 'width 0.2s ease, background 0.4s ease',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, fontSize: 7, color: 'rgba(255,255,255,0.25)' }}>
          <span>{pressure >= 0 ? 'BUY' : 'SELL'} FLOW</span>
          <span>CONF {Math.round(confidence * 100)}%</span>
          <span>{pct}%</span>
        </div>
      </div>

      {/* Delta strip */}
      <div style={{ padding: '3px 10px 0' }}>
        <div style={{ height: 24, background: 'rgba(255,255,255,0.05)', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: delta >= 0 ? '50%' : `${50 - dFrac * 46}%`,
            width: `${dFrac * 46}%`,
            background: delta >= 0 ? 'rgba(0,200,100,0.45)' : 'rgba(255,80,80,0.45)',
            transition: 'width 0.15s, left 0.15s',
            borderRadius: 2,
          }} />
          <span style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', fontSize: 8, letterSpacing: 2, color: 'rgba(255,255,255,0.3)' }}>DELTA</span>
          <span style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: delta >= 0 ? '#4ade80' : '#f43f5e' }}>
            {delta >= 0 ? '+' : ''}{delta.toFixed(3)}
          </span>
          {/* Center divider */}
          <div style={{ position: 'absolute', left: '50%', top: 3, bottom: 3, width: 1, background: 'rgba(255,255,255,0.1)' }} />
        </div>
      </div>

      {/* Delta-Delta strip */}
      <div style={{ padding: '3px 10px 4px' }}>
        <div style={{ height: 20, background: 'rgba(255,255,255,0.05)', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: deltaD >= 0 ? '50%' : `${50 - ddFrac * 46}%`,
            width: `${ddFrac * 46}%`,
            background: exhausted
              ? 'rgba(255,34,68,0.65)'
              : deltaD < 0 ? 'rgba(255,140,0,0.45)' : 'rgba(100,180,255,0.35)',
            transition: 'width 0.15s, left 0.15s, background 0.3s',
            borderRadius: 2,
          }} />
          <span style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', fontSize: 8, letterSpacing: 2, color: 'rgba(255,255,255,0.3)' }}>ΔΔ</span>
          <span style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: exhausted ? '#ff2244' : 'rgba(255,255,255,0.7)' }}>
            {deltaD >= 0 ? '+' : ''}{deltaD.toFixed(3)}
          </span>
          <div style={{ position: 'absolute', left: '50%', top: 3, bottom: 3, width: 1, background: 'rgba(255,255,255,0.1)' }} />
        </div>
      </div>

      {/* Histogram */}
      <div style={{ padding: '0 10px 4px' }}>
        <div style={{ height: 44, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
          {histRef.current.map((p, i) => {
            const h = Math.max(2, (Math.abs(p)) * 42)
            const frac = Math.abs(p)
            const r = Math.floor(frac * 255), b = Math.floor((1 - frac) * 255)
            const bg = phase === 'POP'
              ? `rgba(255,255,255,${(0.3 + frac * 0.6).toFixed(2)})`
              : `rgba(${r},${Math.floor(80 * (1 - frac))},${b},0.75)`
            return <div key={i} style={{ flex: 1, height: h, background: bg, borderRadius: '2px 2px 0 0', minHeight: 2 }} />
          })}
        </div>
      </div>

      {/* Signal log */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', maxHeight: 90, overflowY: 'auto', padding: '3px 10px 4px' }}>
        {log.slice(0, 6).map((e, i) => (
          <div key={i} style={{
            fontSize: 9, padding: '2px 5px', marginBottom: 2, borderRadius: 2,
            borderLeft: `2px solid ${LOG_C[e.type]}`,
            background: 'rgba(255,255,255,0.02)',
            color: LOG_C[e.type],
          }}>
            {e.ts} {e.msg}
          </div>
        ))}
      </div>
    </div>
  )
}
