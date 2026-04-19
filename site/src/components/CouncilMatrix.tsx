import React from 'react'
import { Tooltip } from '@blueprintjs/core'
import { ALGO_META, BANK_A_IDS, BANK_B_IDS, BANK_C_IDS } from '../types'
import type { AlgoVote } from '../types'

interface CouncilMatrixProps {
  algos: AlgoVote[]
}

const BANK_LABELS = [
  { ids: BANK_A_IDS, label: 'BOOM', sub: 'Bank A · Entry Precision', color: '#22d3ee' },
  { ids: BANK_B_IDS, label: 'STRAT', sub: 'Bank B · Structure', color: '#818cf8' },
  { ids: BANK_C_IDS, label: 'LEGEND', sub: 'Bank C · Swing', color: '#4ade80' },
]

function voteToClass(vote: number): string {
  if (vote > 0) return 'vote-long'
  if (vote < 0) return 'vote-short'
  return 'vote-flat'
}

function voteColor(vote: number): string {
  if (vote > 0) return '#4ade80'
  if (vote < 0) return '#f43f5e'
  return 'rgba(255,255,255,0.15)'
}

function votePct(vote: number): number {
  // bar shows 100% long, 50% flat, 0% short
  if (vote > 0) return 100
  if (vote < 0) return 0
  return 50
}

interface AlgoCellProps {
  id: string
  vote: AlgoVote | undefined
}

const AlgoCell: React.FC<AlgoCellProps> = ({ id, vote }) => {
  const meta = ALGO_META.find(a => a.id === id)
  const v = vote?.vote ?? 0
  const score = vote?.score ?? 0

  const tooltipContent = (
    <div style={{ maxWidth: 200, fontSize: 12 }}>
      <div style={{ fontWeight: 700, color: meta?.color }}>{meta?.name ?? id}</div>
      <div style={{ color: '#8f99a8', fontSize: 11 }}>{meta?.sub}</div>
      <div style={{ marginTop: 4 }}>
        Vote: <strong style={{ color: voteColor(v) }}>{v > 0 ? '+1' : v < 0 ? '-1' : '0'}</strong>
        &nbsp;|&nbsp; Score: <strong>{score.toFixed(2)}</strong>
      </div>
    </div>
  )

  return (
    <Tooltip content={tooltipContent} placement="top" minimal>
      <div className={`algo-cell ${voteToClass(v)}`}>
        <div className="algo-cell-id" style={{ color: meta?.color ?? '#fff' }}>
          {id}
        </div>
        <div className="algo-cell-name">{meta?.sub ?? ''}</div>
        <div className="algo-vote-bar">
          <div
            className="algo-vote-fill"
            style={{
              width: `${votePct(v)}%`,
              background: voteColor(v),
            }}
          />
        </div>
      </div>
    </Tooltip>
  )
}

export const CouncilMatrix: React.FC<CouncilMatrixProps> = ({ algos }) => {
  const voteMap = React.useMemo(() => {
    const m: Record<string, AlgoVote> = {}
    algos.forEach(a => { m[a.id] = a })
    return m
  }, [algos])

  // Compute bank net votes
  const bankStats = BANK_LABELS.map(bank => {
    let long = 0, short = 0
    bank.ids.forEach(id => {
      const v = voteMap[id]?.vote ?? 0
      if (v > 0) long++
      else if (v < 0) short++
    })
    return { long, short, flat: bank.ids.length - long - short }
  })

  return (
    <div className="council-matrix">
      {BANK_LABELS.map((bank, bi) => (
        <div key={bank.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
          {/* Bank header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '2px 4px',
            }}
          >
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, color: bank.color, letterSpacing: '0.08em' }}>
                {bank.label}
              </span>
              <span style={{ fontSize: 9, color: '#8f99a8', marginLeft: 6 }}>{bank.sub}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, fontSize: 10, fontFamily: 'monospace' }}>
              <span style={{ color: '#4ade80' }}>↑{bankStats[bi].long}</span>
              <span style={{ color: '#8f99a8' }}>–{bankStats[bi].flat}</span>
              <span style={{ color: '#f43f5e' }}>↓{bankStats[bi].short}</span>
            </div>
          </div>

          {/* Algo cells row */}
          <div className="council-bank-row">
            {bank.ids.map(id => (
              <AlgoCell key={id} id={id} vote={voteMap[id]} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
