import React, { useState, useCallback } from 'react'
import {
  Card,
  Elevation,
  Checkbox,
  Slider,
  Switch,
  Button,
  Callout,
  FormGroup,
  NumericInput,
  HTMLTable,
  Tag,
  Intent,
  Divider,
  H5,
  H6,
} from '@blueprintjs/core'
import { ALGO_META, BANK_A_IDS, BANK_B_IDS, BANK_C_IDS } from '../types'
import type { TradeMode, Position, TradeHistoryEntry } from '../types'

// ─── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_POSITIONS: Position[] = [
  {
    id: '1',
    symbol: 'AAPL',
    direction: 'LONG',
    size: 50,
    entry_price: 188.5,
    current_price: 192.3,
    pnl: 190,
    pnl_pct: 2.02,
    opened_at: new Date(Date.now() - 3600000).toISOString(),
    algo_ids: ['NS', 'CI', 'CC'],
  },
  {
    id: '2',
    symbol: 'TSLA',
    direction: 'SHORT',
    size: 20,
    entry_price: 250.0,
    current_price: 243.8,
    pnl: 124,
    pnl_pct: 2.48,
    opened_at: new Date(Date.now() - 7200000).toISOString(),
    algo_ids: ['BQ', 'MS', 'VT'],
  },
]

const MOCK_HISTORY: TradeHistoryEntry[] = [
  {
    id: 'h1', symbol: 'NVDA', direction: 'LONG',  size: 30,
    entry_price: 620, exit_price: 648, pnl: 840, pnl_pct: 4.52,
    opened_at: '2026-04-01T09:30:00Z', closed_at: '2026-04-01T14:22:00Z',
    status: 'CLOSED', mode: 'PAPER',
  },
  {
    id: 'h2', symbol: 'AMZN', direction: 'LONG',  size: 25,
    entry_price: 185, exit_price: 182, pnl: -75, pnl_pct: -1.62,
    opened_at: '2026-04-01T11:00:00Z', closed_at: '2026-04-01T15:00:00Z',
    status: 'CLOSED', mode: 'PAPER',
  },
  {
    id: 'h3', symbol: 'SPY',  direction: 'SHORT', size: 100,
    entry_price: 520, exit_price: 514, pnl: 600, pnl_pct: 1.15,
    opened_at: '2026-04-02T10:00:00Z', closed_at: '2026-04-02T11:30:00Z',
    status: 'CLOSED', mode: 'PAPER',
  },
  {
    id: 'h4', symbol: 'MSFT', direction: 'LONG',  size: 40,
    entry_price: 412, exit_price: 428, pnl: 640, pnl_pct: 3.88,
    opened_at: '2026-04-02T14:00:00Z', closed_at: '2026-04-03T09:45:00Z',
    status: 'CLOSED', mode: 'PAPER',
  },
]

// ─── Algo Selector Group ───────────────────────────────────────────────────────

interface AlgoGroupProps {
  label: string
  color: string
  ids: readonly string[]
  enabled: Set<string>
  onToggle: (id: string) => void
}

const AlgoGroup: React.FC<AlgoGroupProps> = ({ label, color, ids, enabled, onToggle }) => {
  const allChecked = ids.every(id => enabled.has(id))
  const someChecked = ids.some(id => enabled.has(id))

  const handleBankToggle = () => {
    if (allChecked) {
      ids.forEach(id => enabled.has(id) && onToggle(id))
    } else {
      ids.forEach(id => !enabled.has(id) && onToggle(id))
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Checkbox
          checked={allChecked}
          indeterminate={someChecked && !allChecked}
          onChange={handleBankToggle}
          style={{ margin: 0 }}
        />
        <span style={{ fontWeight: 700, fontSize: 11, color, letterSpacing: '0.08em' }}>
          {label}
        </span>
      </div>
      <div style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {ids.map(id => {
          const meta = ALGO_META.find(a => a.id === id)
          return (
            <Checkbox
              key={id}
              checked={enabled.has(id)}
              onChange={() => onToggle(id)}
              labelElement={
                <span style={{ fontSize: 12 }}>
                  <span style={{ fontWeight: 700, color: meta?.color, fontFamily: 'monospace', marginRight: 6 }}>
                    {id}
                  </span>
                  <span style={{ color: '#8f99a8' }}>{meta?.sub}</span>
                </span>
              }
            />
          )
        })}
      </div>
    </div>
  )
}

// ─── Log Entry ────────────────────────────────────────────────────────────────

const LogEntry: React.FC<{ time: string; message: string; type?: 'info' | 'buy' | 'sell' | 'warn' }> = ({
  time, message, type = 'info'
}) => {
  const color = type === 'buy' ? '#4ade80' : type === 'sell' ? '#f43f5e' : type === 'warn' ? '#FFB74D' : '#8f99a8'
  return (
    <div style={{
      display: 'flex', gap: 10, padding: '4px 0',
      fontSize: 11, fontFamily: 'monospace', borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      <span style={{ color: '#5f6b7a', flexShrink: 0 }}>{time}</span>
      <span style={{ color }}>{message}</span>
    </div>
  )
}

// ─── AutoTrader Page ──────────────────────────────────────────────────────────

export const AutoTrader: React.FC = () => {
  const [mode, setMode] = useState<TradeMode>('PAPER')
  const [minVotes, setMinVotes] = useState(14)
  const [riskPct, setRiskPct] = useState(1.0)
  const [enabledAlgos, setEnabledAlgos] = useState<Set<string>>(
    new Set([...BANK_A_IDS, ...BANK_B_IDS, ...BANK_C_IDS])
  )
  const [running, setRunning] = useState(false)

  const toggleAlgo = useCallback((id: string) => {
    setEnabledAlgos(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const totalPnl = MOCK_POSITIONS.reduce((s, p) => s + p.pnl, 0)
  const histPnl = MOCK_HISTORY.reduce((s, t) => s + t.pnl, 0)

  const logLines = [
    { time: '09:31:04', message: '[PAPER] AAPL: LONG signal (NS+CI+CC = 3 votes > threshold 2)', type: 'buy' as const },
    { time: '09:31:05', message: '[PAPER] Order placed: BUY 50 AAPL @ $188.50', type: 'buy' as const },
    { time: '10:45:22', message: '[PAPER] TSLA: SHORT signal (BQ+MS+VT = 3 votes > threshold 2)', type: 'sell' as const },
    { time: '10:45:23', message: '[PAPER] Order placed: SELL 20 TSLA @ $250.00', type: 'sell' as const },
    { time: '11:00:00', message: 'Council update: JEDI=+18 BULL regime confirmed', type: 'info' as const },
    { time: '12:30:00', message: 'Risk check: total exposure $15,840 / limit $50,000 (31.7%)', type: 'info' as const },
    { time: '13:00:00', message: 'WS feed heartbeat OK — 27 algo votes received', type: 'info' as const },
    { time: '14:22:00', message: '[PAPER] AAPL: EXIT signal — closed LONG @ $192.30 (+$190 / +2.02%)', type: 'buy' as const },
  ]

  return (
    <div style={{ display: 'flex', gap: 12, height: '100%', minHeight: 0 }}>
      {/* LEFT: Config panel */}
      <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>

        {/* Mode toggle */}
        <Card elevation={Elevation.TWO}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <H5 style={{ margin: 0 }}>Auto Trader</H5>
            <Tag
              intent={mode === 'LIVE' ? Intent.DANGER : Intent.WARNING}
              large
              style={{ fontWeight: 700 }}
            >
              {mode}
            </Tag>
          </div>

          <FormGroup label="Mode" helperText="Paper mode simulates trades. Live sends real orders.">
            <Switch
              checked={mode === 'LIVE'}
              onChange={e => setMode(e.currentTarget.checked ? 'LIVE' : 'PAPER')}
              label={mode === 'LIVE' ? 'LIVE TRADING' : 'PAPER TRADING'}
              large
              innerLabelChecked="LIVE"
              innerLabel="PAPER"
            />
          </FormGroup>

          {mode === 'LIVE' && (
            <Callout intent={Intent.DANGER} icon="warning-sign" style={{ marginTop: 8 }}>
              <strong>LIVE MODE ACTIVE</strong>
              <p style={{ margin: '4px 0 0', fontSize: 12 }}>
                Real orders will be submitted. Ensure risk limits are set correctly.
              </p>
            </Callout>
          )}
        </Card>

        {/* Risk settings */}
        <Card elevation={Elevation.TWO}>
          <H6 style={{ margin: '0 0 12px' }}>Risk Settings</H6>

          <FormGroup
            label={`Min Votes Threshold: ${minVotes}`}
            helperText="Minimum aligned votes required to open a position (out of 27)"
          >
            <Slider
              min={1}
              max={27}
              stepSize={1}
              labelStepSize={6}
              value={minVotes}
              onChange={setMinVotes}
              showTrackFill
              intent={Intent.WARNING}
            />
          </FormGroup>

          <FormGroup label="Risk per Trade (%)" helperText="% of account to risk per trade">
            <NumericInput
              fill
              value={riskPct}
              onValueChange={v => setRiskPct(v)}
              min={0.1}
              max={10}
              stepSize={0.1}
              majorStepSize={1}
              rightElement={<Tag minimal>%</Tag>}
            />
          </FormGroup>
        </Card>

        {/* Algo selection */}
        <Card elevation={Elevation.TWO} style={{ flex: 1, overflow: 'auto' }}>
          <H6 style={{ margin: '0 0 12px' }}>Active Algos ({enabledAlgos.size}/27)</H6>

          <AlgoGroup
            label="BOOM — Bank A (Entry)"
            color="#22d3ee"
            ids={BANK_A_IDS}
            enabled={enabledAlgos}
            onToggle={toggleAlgo}
          />
          <Divider />
          <AlgoGroup
            label="STRAT — Bank B (Structure)"
            color="#818cf8"
            ids={BANK_B_IDS}
            enabled={enabledAlgos}
            onToggle={toggleAlgo}
          />
          <Divider />
          <AlgoGroup
            label="LEGEND — Bank C (Swing)"
            color="#4ade80"
            ids={BANK_C_IDS}
            enabled={enabledAlgos}
            onToggle={toggleAlgo}
          />
        </Card>

        {/* Start/Stop button */}
        <Button
          fill
          large
          intent={running ? Intent.DANGER : Intent.SUCCESS}
          onClick={() => setRunning(r => !r)}
          icon={running ? 'stop' : 'play'}
          style={{ fontWeight: 700 }}
        >
          {running ? 'STOP AUTO TRADER' : 'START AUTO TRADER'}
        </Button>
      </div>

      {/* RIGHT: Positions + Log */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>

        {/* Active Positions */}
        <Card elevation={Elevation.TWO} style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <H6 style={{ margin: 0 }}>Active Positions</H6>
            <div style={{ fontFamily: 'monospace', fontSize: 13 }}>
              Open P&L:{' '}
              <span className={totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'} style={{ fontWeight: 700 }}>
                {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
              </span>
            </div>
          </div>
          <HTMLTable compact style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Dir</th>
                <th>Size</th>
                <th>Entry</th>
                <th>Current</th>
                <th>P&L</th>
                <th>P&L%</th>
                <th>Algos</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_POSITIONS.map(p => (
                <tr key={p.id}>
                  <td><strong style={{ fontFamily: 'monospace' }}>{p.symbol}</strong></td>
                  <td>
                    <Tag
                      intent={p.direction === 'LONG' ? Intent.SUCCESS : Intent.DANGER}
                      minimal
                      style={{ fontSize: 10 }}
                    >
                      {p.direction}
                    </Tag>
                  </td>
                  <td className="mono">{p.size}</td>
                  <td className="mono">${p.entry_price.toFixed(2)}</td>
                  <td className="mono">${p.current_price.toFixed(2)}</td>
                  <td className={`mono ${p.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                    {p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}
                  </td>
                  <td className={`mono ${p.pnl_pct >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                    {p.pnl_pct >= 0 ? '+' : ''}{p.pnl_pct.toFixed(2)}%
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      {p.algo_ids.map(id => (
                        <Tag key={id} minimal style={{ fontSize: 9, fontFamily: 'monospace' }}>{id}</Tag>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        </Card>

        {/* Trade History */}
        <Card elevation={Elevation.TWO} style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <H6 style={{ margin: 0 }}>Trade History</H6>
            <div style={{ fontFamily: 'monospace', fontSize: 13 }}>
              Realized:{' '}
              <span className={histPnl >= 0 ? 'pnl-positive' : 'pnl-negative'} style={{ fontWeight: 700 }}>
                {histPnl >= 0 ? '+' : ''}${histPnl.toFixed(2)}
              </span>
            </div>
          </div>
          <HTMLTable compact style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Dir</th>
                <th>Size</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>P&L</th>
                <th>P&L%</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_HISTORY.map(t => (
                <tr key={t.id}>
                  <td><strong style={{ fontFamily: 'monospace' }}>{t.symbol}</strong></td>
                  <td>
                    <Tag
                      intent={t.direction === 'LONG' ? Intent.SUCCESS : Intent.DANGER}
                      minimal
                      style={{ fontSize: 10 }}
                    >
                      {t.direction}
                    </Tag>
                  </td>
                  <td className="mono">{t.size}</td>
                  <td className="mono">${t.entry_price.toFixed(2)}</td>
                  <td className="mono">${t.exit_price.toFixed(2)}</td>
                  <td className={`mono ${t.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                    {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                  </td>
                  <td className={`mono ${t.pnl_pct >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                    {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%
                  </td>
                  <td>
                    <Tag minimal style={{ fontSize: 9 }}>{t.mode}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        </Card>

        {/* Live log */}
        <Card elevation={Elevation.TWO} style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <H6 style={{ margin: '0 0 8px', flexShrink: 0 }}>Live Event Log</H6>
          <div className="trade-log" style={{ flex: 1 }}>
            {[...logLines].reverse().map((l, i) => (
              <LogEntry key={i} time={l.time} message={l.message} type={l.type} />
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
