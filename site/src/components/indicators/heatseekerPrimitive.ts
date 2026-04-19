/**
 * HeatSeeker Glow Primitive — gas/fire glow halos at target price levels.
 * Actual dashed lines are drawn via series.createPriceLine() (reliable).
 * This primitive adds the gas-fire radial glow on top.
 *
 * targetHeat palette:
 *   FIRE (score >75) — fire orange/red  #ff6b00 / #ff3a00
 *   GAS  (score >50) — plasma blue-white #00d4ff / #7b2ff7
 *   CALM (score ≤50) — cool steel blue  #60a5fa
 */
import type {
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer as IPrimitivePaneRenderer,
} from 'lightweight-charts'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type { HeatState, TargetHeat } from './heatseekerMath'

// ── Color palette per heat level ──────────────────────────────────────────────

function heatColors(heat: TargetHeat, dir: string): { lo: string; hi: string; shadow: string } {
  if (heat === 'FIRE') {
    return {
      lo:     dir === 'BULL' ? '#22c55e' : '#e11d48',
      hi:     '#ff6b00',
      shadow: dir === 'BULL' ? 'rgba(255,107,0,0.85)' : 'rgba(255,60,0,0.85)',
    }
  }
  if (heat === 'GAS') {
    return {
      lo:     dir === 'BULL' ? '#4ade80' : '#f43f5e',
      hi:     '#00d4ff',
      shadow: 'rgba(0,212,255,0.7)',
    }
  }
  // CALM
  return {
    lo:     '#60a5fa',
    hi:     '#93c5fd',
    shadow: 'rgba(96,165,250,0.5)',
  }
}

interface GlowLevel {
  price: number
  colors: { lo: string; hi: string; shadow: string }
  intensity: number
  height: number
}

function drawGlow(
  ctx: CanvasRenderingContext2D,
  series: ISeriesApi<'Candlestick'>,
  w: number,
  level: GlowLevel,
): void {
  // priceToCoordinate → CSS pixel (media) coords → matches useMediaCoordinateSpace
  const y = series.priceToCoordinate(level.price)
  if (y === null || !isFinite(y)) return

  const { lo, hi, shadow } = level.colors
  const h = level.height

  // Gradient band: lo edge → hi center → lo edge (fire/gas glow)
  const grad = ctx.createLinearGradient(0, y - h, 0, y + h)
  grad.addColorStop(0,    lo + '00')
  grad.addColorStop(0.3,  lo + '66')
  grad.addColorStop(0.5,  hi + 'cc')
  grad.addColorStop(0.7,  lo + '66')
  grad.addColorStop(1,    lo + '00')

  ctx.save()
  ctx.globalAlpha = level.intensity
  ctx.shadowColor = shadow
  ctx.shadowBlur  = 18
  ctx.fillStyle   = grad
  ctx.fillRect(0, y - h, w, h * 2)

  // Bright core line
  ctx.shadowBlur  = 10
  ctx.strokeStyle = hi
  ctx.lineWidth   = 1.5
  ctx.globalAlpha = level.intensity * 0.95
  ctx.beginPath()
  ctx.moveTo(0, y)
  ctx.lineTo(w, y)
  ctx.stroke()

  ctx.restore()
}

export function createHeatSeekerPrimitive(state: HeatState): ISeriesPrimitive {
  let chart: IChartApiBase | null = null
  let series: ISeriesApi<'Candlestick'> | null = null
  let onRange: (() => void) | null = null

  const heat = state.targetHeat
  const dir  = state.direction

  const tc = heatColors(heat, dir)
  const stopColors = { lo: '#f97316', hi: '#fb923c', shadow: 'rgba(249,115,22,0.8)' }
  const entryColors = { lo: '#475569', hi: '#64748b', shadow: 'rgba(71,85,105,0.4)' }

  // Intensity by heat level
  const baseIntensity = heat === 'FIRE' ? 0.85 : heat === 'GAS' ? 0.65 : 0.40

  const levels: GlowLevel[] = [
    { price: state.tgt2,  colors: tc,          intensity: baseIntensity * 0.55, height: 5 },
    { price: state.tgt1,  colors: tc,          intensity: baseIntensity,        height: 8 },
    { price: state.entry, colors: entryColors, intensity: 0.25,                 height: 3 },
    { price: state.stop,  colors: stopColors,  intensity: baseIntensity * 0.9,  height: 7 },
  ]

  const paneView = {
    zOrder: () => 'top' as const,
    renderer: (): IPrimitivePaneRenderer => ({
      drawBackground: () => {},
      draw: (target: CanvasRenderingTarget2D) => {
        if (!series) return
        // Use MEDIA coordinate space — priceToCoordinate() returns CSS pixels
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          for (const lv of levels) {
            try { drawGlow(ctx, series!, mediaSize.width, lv) } catch { /* skip bad level */ }
          }
        })
      },
    }),
  }

  return {
    attached: (param) => {
      chart  = param.chart
      series = param.series as ISeriesApi<'Candlestick'>
      onRange = () => param.requestUpdate()
      chart.timeScale().subscribeVisibleLogicalRangeChange(onRange)
      queueMicrotask(() => param.requestUpdate())
    },
    detached: () => {
      if (chart && onRange) chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange)
      chart = null; series = null; onRange = null
    },
    paneViews: () => [paneView],
  }
}
