import React, { useEffect, useRef } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type Time,
  type SeriesMarker,
} from 'lightweight-charts'

export type MrtReplayTrade = { time: number; side: string; price: number }

export type MrtReplayPayload = {
  ok?: boolean
  bars: { time: number; open: number; high: number; low: number; close: number }[]
  equity: { time: number; value: number }[]
  trades: MrtReplayTrade[]
}

const CHART_OPTS = {
  layout: {
    background: { type: ColorType.Solid, color: '#1c2127' },
    textColor: '#8f99a8',
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: 11,
  },
  grid: {
    vertLines: { color: 'rgba(255,255,255,0.04)' },
    horzLines: { color: 'rgba(255,255,255,0.04)' },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: 'rgba(255,183,77,0.5)', labelBackgroundColor: '#252a31' },
    horzLine: { color: 'rgba(255,183,77,0.5)', labelBackgroundColor: '#252a31' },
  },
  rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)', textColor: '#8f99a8' },
  leftPriceScale: {
    visible: true,
    borderColor: 'rgba(255,183,77,0.35)',
    textColor: '#FFB74D',
    scaleMargins: { top: 0.08, bottom: 0.08 },
  },
  timeScale: {
    borderColor: 'rgba(255,255,255,0.1)',
    textColor: '#8f99a8',
    timeVisible: true,
    secondsVisible: false,
  },
}

const CANDLE_OPTS = {
  upColor: '#4ade80',
  downColor: '#f43f5e',
  borderUpColor: '#4ade80',
  borderDownColor: '#f43f5e',
  wickUpColor: '#4ade80',
  wickDownColor: '#f43f5e',
}

function tradeMarkers(trades: MrtReplayTrade[]): SeriesMarker<Time>[] {
  const out: SeriesMarker<Time>[] = []
  for (const t of trades) {
    if (t.side === 'long') {
      out.push({
        time: t.time as Time,
        position: 'belowBar',
        color: '#4ade80',
        shape: 'arrowUp',
        text: 'L',
        size: 1,
      })
    } else if (t.side === 'short') {
      out.push({
        time: t.time as Time,
        position: 'aboveBar',
        color: '#f43f5e',
        shape: 'arrowDown',
        text: 'S',
        size: 1,
      })
    } else {
      out.push({
        time: t.time as Time,
        position: 'aboveBar',
        color: '#94a3b8',
        shape: 'circle',
        text: '—',
        size: 1,
      })
    }
  }
  return out.sort((a, b) => (a.time as number) - (b.time as number))
}

type Props = { replay: MrtReplayPayload | null; height?: number }

export const MRTResearchChart: React.FC<Props> = ({ replay, height = 440 }) => {
  const wrapRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const eqRef = useRef<ISeriesApi<'Line'> | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return

    const chart = createChart(el, {
      ...CHART_OPTS,
      width: el.clientWidth,
      height,
    })
    chartRef.current = chart

    const candles = chart.addCandlestickSeries(CANDLE_OPTS)
    candleRef.current = candles

    const eq = chart.addLineSeries({
      priceScaleId: 'left',
      color: '#FFB74D',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    })
    eqRef.current = eq

    const ro = new ResizeObserver(entries => {
      const r = entries[0]
      if (r && chartRef.current) {
        chartRef.current.applyOptions({
          width: r.contentRect.width,
          height,
        })
        chartRef.current.timeScale().fitContent()
      }
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      eqRef.current = null
    }
  }, [height])

  useEffect(() => {
    const candles = candleRef.current
    const eq = eqRef.current
    const chart = chartRef.current
    if (!replay || !candles || !eq || !chart) return

    const cdata: CandlestickData[] = replay.bars.map(b => ({
      time: b.time as Time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }))
    candles.setData(cdata)

    const edata: LineData[] = replay.equity
      .filter(e => Number.isFinite(e.value))
      .map(e => ({ time: e.time as Time, value: e.value }))
    eq.setData(edata)

    candles.setMarkers(tradeMarkers(replay.trades ?? []))
    chart.timeScale().fitContent()
  }, [replay])

  return (
    <div
      ref={wrapRef}
      style={{
        width: '100%',
        height,
        borderRadius: 6,
        border: '1px solid rgba(255,183,77,0.12)',
        overflow: 'hidden',
      }}
    />
  )
}
