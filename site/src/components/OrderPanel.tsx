import React, { useState } from 'react'
import {
  Button,
  FormGroup,
  InputGroup,
  NumericInput,
  Callout,
  Tag,
  Divider,
  Intent,
} from '@blueprintjs/core'

interface OrderPanelProps {
  symbol: string
  currentPrice?: number
}

type Side = 'BUY' | 'SELL'
type OrderType = 'MARKET' | 'LIMIT' | 'STOP'

export const OrderPanel: React.FC<OrderPanelProps> = ({ symbol, currentPrice = 0 }) => {
  const [side, setSide] = useState<Side>('BUY')
  const [orderType, setOrderType] = useState<OrderType>('MARKET')
  const [price, setPrice] = useState<number>(currentPrice)
  const [size, setSize] = useState<number>(100)
  const [stopLoss, setStopLoss] = useState<number>(0)
  const [takeProfit, setTakeProfit] = useState<number>(0)
  const [submitted, setSubmitted] = useState(false)

  const estimatedValue = size * (orderType === 'MARKET' ? currentPrice : price)
  const riskAmt = stopLoss > 0 ? Math.abs(size * ((orderType === 'MARKET' ? currentPrice : price) - stopLoss)) : 0
  const rewardAmt = takeProfit > 0 ? Math.abs(size * (takeProfit - (orderType === 'MARKET' ? currentPrice : price))) : 0
  const rrRatio = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(2) : '—'

  const handleSubmit = () => {
    setSubmitted(true)
    setTimeout(() => setSubmitted(false), 2000)
  }

  return (
    <div className="order-panel">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>Order</div>
        <Tag minimal style={{ fontFamily: 'monospace' }}>
          {symbol}
        </Tag>
      </div>

      {/* Price display */}
      <div
        style={{
          background: 'rgba(255,255,255,0.05)',
          borderRadius: 6,
          padding: '8px 12px',
          fontFamily: 'monospace',
          fontSize: 18,
          fontWeight: 700,
          color: '#fff',
          textAlign: 'center',
        }}
      >
        ${currentPrice.toFixed(2)}
      </div>

      {/* Side toggle */}
      <div className="order-side-toggle">
        <button
          className={`buy${side === 'BUY' ? ' active' : ''}`}
          onClick={() => setSide('BUY')}
        >
          BUY / LONG
        </button>
        <button
          className={`sell${side === 'SELL' ? ' active' : ''}`}
          onClick={() => setSide('SELL')}
        >
          SELL / SHORT
        </button>
      </div>

      {/* Order type */}
      <div className="tf-btn-group">
        {(['MARKET', 'LIMIT', 'STOP'] as OrderType[]).map(t => (
          <button
            key={t}
            className={`tf-btn${orderType === t ? ' active' : ''}`}
            onClick={() => setOrderType(t)}
            style={{ flex: 1 }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Price input (not for MARKET) */}
      {orderType !== 'MARKET' && (
        <FormGroup label="Price" labelInfo="(USD)" style={{ marginBottom: 0 }}>
          <NumericInput
            fill
            value={price}
            onValueChange={setPrice}
            min={0}
            stepSize={0.01}
            majorStepSize={1}
            placeholder="0.00"
            leftIcon="dollar"
          />
        </FormGroup>
      )}

      {/* Size */}
      <FormGroup label="Quantity" style={{ marginBottom: 0 }}>
        <NumericInput
          fill
          value={size}
          onValueChange={setSize}
          min={1}
          stepSize={1}
          majorStepSize={10}
          placeholder="0"
        />
      </FormGroup>

      <Divider />

      {/* Stop Loss / Take Profit */}
      <FormGroup label="Stop Loss" labelInfo="(optional)" style={{ marginBottom: 0 }}>
        <NumericInput
          fill
          value={stopLoss || ''}
          onValueChange={v => setStopLoss(v)}
          min={0}
          stepSize={0.01}
          placeholder="0.00"
          leftIcon="cross"
          intent={stopLoss > 0 ? Intent.DANGER : Intent.NONE}
        />
      </FormGroup>

      <FormGroup label="Take Profit" labelInfo="(optional)" style={{ marginBottom: 0 }}>
        <NumericInput
          fill
          value={takeProfit || ''}
          onValueChange={v => setTakeProfit(v)}
          min={0}
          stepSize={0.01}
          placeholder="0.00"
          leftIcon="tick"
          intent={takeProfit > 0 ? Intent.SUCCESS : Intent.NONE}
        />
      </FormGroup>

      {/* Order summary */}
      <div
        style={{
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 6,
          padding: '10px 12px',
          fontSize: 11,
          fontFamily: 'monospace',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#8f99a8' }}>Est. Value</span>
          <span style={{ color: '#fff' }}>${estimatedValue.toFixed(2)}</span>
        </div>
        {riskAmt > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#8f99a8' }}>Risk</span>
            <span style={{ color: '#f43f5e' }}>${riskAmt.toFixed(2)}</span>
          </div>
        )}
        {rewardAmt > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#8f99a8' }}>Reward</span>
            <span style={{ color: '#4ade80' }}>${rewardAmt.toFixed(2)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#8f99a8' }}>R:R</span>
          <span style={{ color: '#FFB74D' }}>1:{rrRatio}</span>
        </div>
      </div>

      {/* Submit button */}
      <Button
        fill
        large
        intent={side === 'BUY' ? Intent.SUCCESS : Intent.DANGER}
        onClick={handleSubmit}
        loading={submitted}
        style={{ fontWeight: 700, letterSpacing: '0.05em' }}
      >
        {submitted ? 'ORDER PLACED' : `${side} ${size} ${symbol}`}
      </Button>

      {submitted && (
        <Callout intent={Intent.SUCCESS} icon="tick-circle">
          Order submitted (paper mode)
        </Callout>
      )}
    </div>
  )
}
