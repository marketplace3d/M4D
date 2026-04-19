import React, { useEffect, useRef } from 'react'
import type { Regime } from '../types'

interface PulseHeroProps {
  score: number
  regime: Regime
  totalLong?: number
  totalShort?: number
}

function getOrbColor(score: number): string {
  if (score > 30) return '#4ade80'
  if (score < -30) return '#f43f5e'
  return '#FFB74D'
}

function getGlowClass(score: number): string {
  if (score > 30) return 'orb-glow-green'
  if (score < -30) return 'orb-glow-red'
  return 'orb-glow-amber'
}

function getRegimeLabel(regime: Regime, score: number): string {
  if (regime === 'BULL' || score > 30) return 'BULL'
  if (regime === 'BEAR' || score < -30) return 'BEAR'
  return 'NEUTRAL'
}

// Map jedi_score (-100..+100) to a visual radius (50..80)
function scoreToRadius(score: number): number {
  const clamped = Math.max(-100, Math.min(100, score))
  return 50 + Math.abs(clamped) * 0.3
}

export const PulseHero: React.FC<PulseHeroProps> = ({
  score,
  regime,
  totalLong = 0,
  totalShort = 0,
}) => {
  const prevScore = useRef(score)
  const flashRef = useRef<SVGCircleElement | null>(null)

  useEffect(() => {
    if (flashRef.current && prevScore.current !== score) {
      flashRef.current.classList.remove('signal-flash-anim')
      // Force reflow
      void (flashRef.current as unknown as HTMLElement).offsetWidth
      flashRef.current.classList.add('signal-flash-anim')
    }
    prevScore.current = score
  }, [score])

  const color = getOrbColor(score)
  const glowClass = getGlowClass(score)
  const radius = scoreToRadius(score)
  const regimeLabel = getRegimeLabel(regime, score)
  const absScore = Math.abs(score)
  const pct = (absScore / 100) * 100

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '16px',
        gap: '12px',
      }}
    >
      <div className="section-title">JEDI MASTER</div>

      {/* SVG Orb */}
      <div className={glowClass} style={{ position: 'relative', width: 200, height: 200 }}>
        <svg
          width="200"
          height="200"
          viewBox="0 0 200 200"
          style={{ overflow: 'visible' }}
        >
          {/* Outer rotating ring */}
          <circle
            cx="100"
            cy="100"
            r="92"
            fill="none"
            stroke={color}
            strokeWidth="1"
            strokeDasharray="8 6"
            opacity="0.4"
            style={{
              transformOrigin: '100px 100px',
              animation: 'orb-rotate 12s linear infinite',
            }}
          />

          {/* Middle ring */}
          <circle
            cx="100"
            cy="100"
            r="80"
            fill="none"
            stroke={color}
            strokeWidth="0.5"
            opacity="0.25"
          />

          {/* Progress arc (score indicator) */}
          <circle
            cx="100"
            cy="100"
            r="80"
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * (2 * Math.PI * 80)} ${2 * Math.PI * 80}`}
            strokeDashoffset="0"
            opacity="0.7"
            style={{
              transform: 'rotate(-90deg)',
              transformOrigin: '100px 100px',
              transition: 'stroke-dasharray 1s ease',
            }}
          />

          {/* Core glow bg */}
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill={color}
            opacity="0.08"
          />

          {/* Flash ring (on signal) */}
          <circle
            ref={flashRef}
            cx="100"
            cy="100"
            r={radius + 4}
            fill="none"
            stroke={color}
            strokeWidth="2"
            opacity="0"
            style={{ transition: 'opacity 0.3s' }}
          />

          {/* Core circle */}
          <circle
            cx="100"
            cy="100"
            r={radius * 0.7}
            fill={color}
            opacity="0.15"
          />
          <circle
            cx="100"
            cy="100"
            r={radius * 0.45}
            fill={color}
            opacity="0.3"
          />

          {/* Score text */}
          <text
            x="100"
            y="94"
            textAnchor="middle"
            fontSize="28"
            fontWeight="700"
            fill="#ffffff"
            fontFamily="monospace"
          >
            {score > 0 ? `+${score}` : score}
          </text>

          {/* JEDI label */}
          <text
            x="100"
            y="114"
            textAnchor="middle"
            fontSize="10"
            fontWeight="600"
            fill={color}
            letterSpacing="2"
            fontFamily="monospace"
          >
            JEDI SCORE
          </text>

          {/* Regime label */}
          <text
            x="100"
            y="132"
            textAnchor="middle"
            fontSize="12"
            fontWeight="700"
            fill={color}
            letterSpacing="3"
            fontFamily="monospace"
          >
            {regimeLabel}
          </text>

          {/* Inner orbit dots */}
          {[0, 60, 120, 180, 240, 300].map((deg, i) => {
            const rad = (deg * Math.PI) / 180
            const dotR = 86
            const x = 100 + dotR * Math.cos(rad)
            const y = 100 + dotR * Math.sin(rad)
            return (
              <circle key={i} cx={x} cy={y} r="2" fill={color} opacity="0.5" />
            )
          })}
        </svg>
      </div>

      {/* Stats below orb */}
      <div
        style={{
          display: 'flex',
          gap: '24px',
          fontSize: '12px',
          fontFamily: 'monospace',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#4ade80', fontWeight: 700 }}>{totalLong}</div>
          <div style={{ color: '#8f99a8', fontSize: '10px' }}>LONG</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#FFB74D', fontWeight: 700 }}>{27 - totalLong - totalShort}</div>
          <div style={{ color: '#8f99a8', fontSize: '10px' }}>FLAT</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#f43f5e', fontWeight: 700 }}>{totalShort}</div>
          <div style={{ color: '#8f99a8', fontSize: '10px' }}>SHORT</div>
        </div>
      </div>

      {/* Score bar */}
      <div style={{ width: '100%', maxWidth: 160 }}>
        <div
          style={{
            height: 6,
            background: 'rgba(255,255,255,0.08)',
            borderRadius: 3,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Center marker */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: 1,
              background: 'rgba(255,255,255,0.3)',
            }}
          />
          {/* Fill */}
          <div
            style={{
              position: 'absolute',
              left: score >= 0 ? '50%' : `${50 + (score / 100) * 50}%`,
              width: `${(Math.abs(score) / 100) * 50}%`,
              top: 0,
              bottom: 0,
              background: color,
              borderRadius: 3,
              transition: 'all 0.6s ease',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '9px',
            color: '#8f99a8',
            marginTop: 3,
            fontFamily: 'monospace',
          }}
        >
          <span>-100</span>
          <span>0</span>
          <span>+100</span>
        </div>
      </div>
    </div>
  )
}
