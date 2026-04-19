import React from 'react'
import { Tooltip } from '@blueprintjs/core'
import { ALGO_META } from '../types'
import type { AssetVotes } from '../types'

interface AlgoSignalBarProps {
  votes: AssetVotes
  symbol?: string
}

function voteLabel(v: number | undefined): string {
  if (v === 1) return '+1'
  if (v === -1) return '-1'
  return '0'
}

function voteClass(v: number | undefined): string {
  if (v === 1) return 'vote-long'
  if (v === -1) return 'vote-short'
  return 'vote-flat'
}

export const AlgoSignalBar: React.FC<AlgoSignalBarProps> = ({ votes, symbol }) => {
  return (
    <div className="signal-bar">
      {symbol && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#8f99a8',
            letterSpacing: '0.08em',
            alignSelf: 'center',
            marginRight: 8,
            fontFamily: 'monospace',
          }}
        >
          SIGNALS
        </div>
      )}
      {ALGO_META.map(meta => {
        const v = votes[meta.id]
        return (
          <Tooltip
            key={meta.id}
            content={
              <div style={{ fontSize: 11 }}>
                <div style={{ fontWeight: 700, color: meta.color }}>{meta.name}</div>
                <div style={{ color: '#8f99a8' }}>{meta.sub}</div>
                <div style={{ marginTop: 2 }}>
                  Vote: <strong>{voteLabel(v)}</strong>
                </div>
              </div>
            }
            placement="top"
            minimal
          >
            <div className={`signal-chip ${voteClass(v)}`}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: meta.color,
                  flexShrink: 0,
                  display: 'inline-block',
                }}
              />
              {meta.id}
              <span style={{ fontWeight: 400, opacity: 0.8 }}>{voteLabel(v)}</span>
            </div>
          </Tooltip>
        )
      })}
    </div>
  )
}
