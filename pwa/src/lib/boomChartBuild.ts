import {
  computeBoom3dTech,
  type Bar,
} from '$indicators/boom3d-tech';
import type { ChartControls } from './chartControls';
import { councilVoteSeries } from './councilVote';
import { detectFvgZones } from './fvgZones';
import { sessionLevelsByBar } from './sessionLevels';
import { createFvgHeatZonesPrimitive, fvgHeatFills } from './fvgHeatPrimitive';
import { detectOrderBlocks } from './orderBlocks';
import { createSigIntelPrimitive } from './sigIntelPrimitive';
import { createSqueezeBoxFillPrimitive } from './squeezeBoxFillPrimitive';
import { createSqueezeBandsSeriesPrimitive } from './squeezePanePrimitive';
import { detectSwingRays } from './swingLevels';
import { computeIchimoku } from './ichimoku';
import { createIchimokuCloudPrimitive } from './ichimokuCloudPrimitive';
import { createEmaRibbonPrimitive } from './emaRibbonPrimitive';
import { createVolumeProfileHeatPrimitive } from './volumeProfileHeatPrimitive';
import { createLiquidityThermalPrimitive } from './liquidityThermalPrimitive';
import { createLiquidityThermalTimeBinsPrimitive } from './liquidityThermalTimeBinsPrimitive';
import { createLiquidityThermalEveryIntervalPrimitive } from './liquidityThermalEveryIntervalPrimitive';
import { detectEqualLevels } from './equalLevels';
import { detectBreakerBlocks } from './breakerBlocks';
import { computeLiquidityThermal } from './liquidityThermal';
import { buildOracleSnapshot } from './oracleSnapshot';
import { computeMMBrain } from './mmBrain';
import { computeMtfLevels } from './mtfLevels';
import { computeCoTraderSignal } from './coTraderSignal';
import { createCoTraderPrimitive } from './coTraderPrimitive';
import type { AutoscaleInfo, LogicalRange } from 'lightweight-charts';

type UT = import('lightweight-charts').UTCTimestamp;

/** Session-anchored cumulative VWAP (typical price × volume), one series from first bar. */
function vwapPerBar(bars: Bar[]): number[] {
  const out: number[] = [];
  let cumPV = 0;
  let cumV = 0;
  for (const b of bars) {
    const tp = (b.high + b.low + b.close) / 3;
    const v = Math.max(0, b.volume ?? 0);
    cumPV += tp * v;
    cumV += v;
    out.push(cumV > 0 ? cumPV / cumV : b.close);
  }
  return out;
}

function linregSlope(values: number[], endIdx: number, length: number): number | null {
  if (length <= 1 || endIdx - length + 1 < 0) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < length; i++) {
    const x = i + 1;
    const y = values[endIdx - length + 1 + i] ?? 0;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const n = length;
  const den = n * sumXX - sumX * sumX;
  if (den === 0) return null;
  return (n * sumXY - sumX * sumY) / den;
}

export type MountBoomChartOpts = {
  /**
   * When false, skip `scrollToRealTime()` after build so the caller can restore
   * `setVisibleLogicalRange` (e.g. indicator toggles with same bars).
   * @default true
   */
  snapToLatest?: boolean;
  /** Applied after build when `snapToLatest` is false (same bars, preserve zoom/pan). */
  initialLogicalRange?: LogicalRange | null;
  /** Compact labels/axes for small chart tiles. */
  compactUi?: boolean;
  /**
   * Symbol name (e.g. 'EURUSD', 'XAUUSD'). When provided with `showMmBrain`,
   * the chart fetches daily bars to compute PWH/PWL/PMH/PML MTF ICT levels.
   */
  symbol?: string;
  /** Polygon.io API key — required for MTF daily bar fetch on non-BTC symbols. */
  polygonKey?: string;
  /** Liquidity thermal visual tuning (LT2/LT3). */
  ltViz?: {
    actionGlowGain?: number;
    showActionBubbles?: boolean;
    bubbleThreshold?: number;
    obPressure?: number;
    obConfidence?: number;
    lt2PriceBins?: number;
    lt2TimeBins?: number;
    lt2OpacityGain?: number;
    lt3MiniArrowGain?: number;
    lt3MainArrowGain?: number;
  };
};

export async function mountBoomChart(
  el: HTMLElement,
  bars: Bar[],
  controls: ChartControls,
  opts?: MountBoomChartOpts,
): Promise<{ chart: import('lightweight-charts').IChartApi; ro: ResizeObserver }> {
  const snapToLatest = opts?.snapToLatest !== false;
  const initialLogicalRange = opts?.initialLogicalRange;
  const compactUi = opts?.compactUi === true;
  const symbol = opts?.symbol;
  const polygonKey = opts?.polygonKey;
  const ltViz = opts?.ltViz;
  const lwc = await import('lightweight-charts');
  const {
    createChart,
    CandlestickSeries,
    LineSeries,
    ColorType,
    createSeriesMarkers,
  } = lwc;

  const boom = computeBoom3dTech(bars);
  const mockSent = Math.min(
    1,
    Math.max(0, parseFloat(import.meta.env.VITE_MOCK_SENTIMENT ?? '0.72')),
  );
  const votes = councilVoteSeries(bars, boom, { mockSentiment: mockSent });
  const fvgZones = detectFvgZones(bars, 160);
  const sessMap = sessionLevelsByBar(bars, 30);
  const last = bars[bars.length - 1]!;
  const sess = sessMap.get(last.time);

  const size = () => {
    const w = Math.max(1, el.clientWidth);
    let h = el.clientHeight;
    if (h < 160) {
      h = Math.max(280, Math.min(Math.floor(window.innerHeight * 0.82), window.innerHeight - 180));
    }
    return { w, h: Math.max(200, h) };
  };
  const { w, h } = size();

  const gOn = controls.showGrid;
  const chart = createChart(el, {
    width: w,
    height: h,
    layout: {
      background: { type: ColorType.Solid, color: '#000000' },
      textColor: '#c9d1d9',
      // Reduce axis/scale label text size by ~33% for denser side scale.
      fontSize: compactUi ? 7 : 8,
    },
    grid: {
      vertLines: { color: '#21262d', visible: gOn },
      horzLines: { color: '#21262d', visible: gOn },
    },
    /** ~3% top+bottom (half of prior 6%) — keeps candles using more vertical space; lines don’t drive scale. */
    rightPriceScale: {
      borderColor: '#30363d',
      scaleMargins: { top: 0.03, bottom: 0.03 },
      minimumWidth: compactUi ? 46 : 56,
    },
    timeScale: {
      borderColor: '#30363d',
      timeVisible: true,
      secondsVisible: false,
      minimumHeight: compactUi ? 18 : 24,
      /** Empty space to the right of the last bar (bar units) — keeps action clear of the price scale. */
      rightOffset: 10,
      /** false: wheel zoom keeps the last bar reachable; true fought zoom and hid the “end”. */
      fixRightEdge: false,
      /**
       * false: resize reflows the time scale like TradingView; true + many overlays caused
       * odd vertical rescale / “flat” candles after pan–zoom.
       */
      lockVisibleTimeRangeOnResize: false,
    },
    /** Wheel = zoom time scale; drag / touch = pan (scroll history left). */
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
  });

  const candle = chart.addSeries(CandlestickSeries, {
    upColor: '#7dd3fc',
    downColor: '#ff1744',
    borderVisible: false,
    wickUpColor: '#7dd3fc',
    wickDownColor: '#ff1744',
  });

  candle.setData(
    bars.map((b) => ({
      time: b.time as UT,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    })),
  );

  /** Time scale must be laid out before squeeze bands (timeToCoordinate). */
  chart.timeScale().fitContent();

  const c = controls;
  const sigAlphaScale = Math.max(0, Math.min(1, c.sigOpacity / 100));
  /** Session / PDH/OR lines stay visible even when SIG overlay opacity is 0. */
  const levelAlphaScale = Math.max(0.44, sigAlphaScale);
  const rgbaScaled = (
    r: number,
    g: number,
    b: number,
    alpha: number,
  ) => `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha * sigAlphaScale))})`;
  const rgbaLevel = (r: number, g: number, b: number, alpha: number) =>
    `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha * levelAlphaScale))})`;

  /** Not gated by masterOn — otherwise "Candles only" / Indicators OFF hides the no-trade tint. */
  if (c.squeezePurpleBg) {
    /** BB/KC squeeze OR COVWMA squeeze-box — `squeezeOn` alone is often 0 bars on 1m windows. */
    const squeezeMask = boom.map((b) => b.squeezeOn || b.squeezeActive);
    const purpleAlpha = Math.max(0, Math.min(1, (c.squeezePurpleOpacity ?? 22) / 100));
    candle.attachPrimitive(
      createSqueezeBandsSeriesPrimitive(
        bars.map((b) => b.time),
        squeezeMask,
        `rgba(136, 46, 224, ${purpleAlpha.toFixed(3)})`,
      ),
    );
  }

  /** Ichimoku Senkou cloud — light fill + Senkou A/B outline lines; independent of masterOn. */
  if (c.showIchimoku) {
    const { senkouA, senkouB } = computeIchimoku(bars);
    candle.attachPrimitive(createIchimokuCloudPrimitive(bars, senkouA, senkouB));
  }

  /** BOOM squeeze channel: box lines + trend fill (aqua above / red below / purple inside). */
  if (c.showSqueeze) {
    candle.attachPrimitive(createSqueezeBoxFillPrimitive(bars, boom));
  }

  /** FVG horizontal heat bands (not gated by masterOn). */
  const fvgCap = Math.max(4, Math.min(80, Math.round(Number(c.fvgMaxDisplay) || 28)));
  const fvgHeatZones = fvgZones.slice(-fvgCap);
  if (c.showFvg && fvgHeatZones.length) {
    candle.attachPrimitive(
      createFvgHeatZonesPrimitive(fvgHeatZones, fvgHeatFills(fvgHeatZones, sigAlphaScale)),
    );
  }

  // Volume-at-price heat map + VPOC line — gated by showPoc.
  if (c.showPoc && bars.length >= 40) {
    candle.attachPrimitive(
      createVolumeProfileHeatPrimitive(bars, {
        lookbackBars: 220,
        binCount: 28,
        alphaScale: 0.55,
        showVpoc: true,
      }),
    );
  }

  // Liquidity Thermal heatmap — independent control via showLt
  if ((c as { showLt?: boolean }).showLt && bars.length >= 40) {
    candle.attachPrimitive(
      createLiquidityThermalPrimitive(bars, { period: 300, panelWidth: 52 }),
    );
  }

  // Liquidity Thermal LT2 — time-binned walls (start/stop by time bucket)
  if ((c as { showLt2?: boolean }).showLt2 && bars.length >= 40) {
    candle.attachPrimitive(
      createLiquidityThermalTimeBinsPrimitive(bars, {
        period: 300,
        priceBins: ltViz?.lt2PriceBins ?? 31,
        timeBins: ltViz?.lt2TimeBins ?? 12,
        wallThreshold: 0,
        actionGlowGain: ltViz?.actionGlowGain ?? 1,
        showActionBubbles: ltViz?.showActionBubbles ?? false,
        bubbleThreshold: ltViz?.bubbleThreshold ?? 1,
        obPressure: ltViz?.obPressure ?? 0,
        obConfidence: ltViz?.obConfidence ?? 0,
        opacityGain: ltViz?.lt2OpacityGain ?? 1,
      }),
    );
  }

  // Liquidity Thermal LT3 — dense every-interval computation
  if ((c as { showLt3?: boolean }).showLt3 && bars.length >= 40) {
    candle.attachPrimitive(
      createLiquidityThermalEveryIntervalPrimitive(bars, {
        period: 220,
        priceBins: 31,
        intervalStep: 1,
        actionGlowGain: ltViz?.actionGlowGain ?? 1,
        showActionBubbles: ltViz?.showActionBubbles ?? false,
        bubbleThreshold: ltViz?.bubbleThreshold ?? 1,
        obPressure: ltViz?.obPressure ?? 0,
        obConfidence: ltViz?.obConfidence ?? 0,
        miniArrowGain: ltViz?.lt3MiniArrowGain ?? 1,
        mainArrowGain: ltViz?.lt3MainArrowGain ?? 1,
      }),
    );
  }

  // ── Session killzone backgrounds — London Open + NY Open ─────────────────
  if ((c as { showKillzones?: boolean }).showKillzones && bars.length >= 2) {
    candle.attachPrimitive({
      attached({ chart: _c, series: _s }) {},
      detached() {},
      paneViews: () => [{
        zOrder: () => 'bottom' as const,
        renderer: () => ({
          draw: () => {},
          drawBackground: (target: import('fancy-canvas').CanvasRenderingTarget2D) => {
            const ts = chart.timeScale();
            target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
              for (const b of bars) {
                const d = new Date((b.time as number) * 1000);
                const h = d.getUTCHours();
                // London Open: 08-10 UTC — teal
                // NY Open: 14-16 UTC — amber
                const isLon = h >= 8 && h < 10;
                const isNy  = h >= 14 && h < 16;
                if (!isLon && !isNy) continue;
                const x = ts.timeToCoordinate(b.time as import('lightweight-charts').Time);
                if (x === null) continue;
                const barW = Math.max(1, ts.options().barSpacing ?? 6);
                ctx.fillStyle = isLon
                  ? 'rgba(34, 211, 238, 0.045)'   // cyan — London
                  : 'rgba(251, 191, 36, 0.045)';  // amber — NY
                ctx.fillRect(x - barW / 2, 0, barW, mediaSize.height);
              }
            });
          },
        }),
      }],
    } as import('lightweight-charts').ISeriesPrimitive);
  }

  // ── Equal Highs / Equal Lows — ICT liquidity pool markers ────────────────
  if ((c as { showEqualLevels?: boolean }).showEqualLevels && bars.length >= 30) {
    const eqLevels = detectEqualLevels(bars, { pivot: 3, tolAtrMult: 0.25, max: 8 });
    const lastT = bars[bars.length - 1]!.time as UT;
    for (const eq of eqLevels) {
      if (eq.swept) continue;
      // EQH = amber dashes (buy stops above) | EQL = violet dashes (sell stops below)
      const col = eq.kind === 'EQH'
        ? `rgba(251, 191, 36, ${eq.strength >= 3 ? 0.85 : 0.55})`   // amber — stronger = more opaque
        : `rgba(167, 139, 250, ${eq.strength >= 3 ? 0.85 : 0.55})`; // violet
      try {
        const s = chart.addSeries(lwc.LineSeries, {
          autoscaleInfoProvider: () => null,
          color: col,
          lineWidth: eq.strength >= 3 ? 2 : 1,
          lineStyle: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: `${eq.kind}×${eq.strength}`,
        });
        s.setData([
          { time: (eq.time as unknown as UT), value: eq.price },
          { time: lastT, value: eq.price },
        ]);
      } catch { /* chart removed */ }
    }
  }

  // ── Breaker Blocks — flipped OBs (distinct from live OBs) ────────────────
  if ((c as { showBreakerBlocks?: boolean }).showBreakerBlocks && bars.length >= 30) {
    const breakers = detectBreakerBlocks(bars, 5);
    if (breakers.length) {
      candle.attachPrimitive({
        attached({ chart: _c, series: _s }) {},
        detached() {},
        paneViews: () => [{
          zOrder: () => 'normal' as const,
          renderer: () => ({
            draw: () => {},
            drawBackground: (target: import('fancy-canvas').CanvasRenderingTarget2D) => {
              const ts = chart.timeScale();
              target.useMediaCoordinateSpace(({ context: ctx }) => {
                for (const z of breakers) {
                  const x1 = ts.timeToCoordinate(z.time as import('lightweight-charts').Time);
                  const x2 = ts.timeToCoordinate(z.endTime as import('lightweight-charts').Time);
                  if (x1 === null || x2 === null) continue;
                  const yTop = candle.priceToCoordinate(z.top);
                  const yBot = candle.priceToCoordinate(z.bottom);
                  if (yTop === null || yBot === null) continue;
                  const left = Math.min(x1, x2);
                  const w    = Math.max(1, Math.abs(x2 - x1));
                  const top  = Math.min(yTop, yBot);
                  const h    = Math.max(1, Math.abs(yBot - yTop));
                  // Breakers: magenta (bull breaker) / orange (bear breaker) — distinct from OBs
                  const fill = z.breakerDir === 1
                    ? 'rgba(236, 72, 153, 0.18)'   // magenta — bull breaker
                    : 'rgba(249, 115, 22, 0.18)';  // orange — bear breaker
                  const edge = z.breakerDir === 1
                    ? 'rgba(236, 72, 153, 0.8)'
                    : 'rgba(249, 115, 22, 0.8)';
                  ctx.fillStyle = fill;
                  ctx.fillRect(left, top, w, h);
                  ctx.setLineDash([4, 3]);
                  ctx.strokeStyle = edge;
                  ctx.lineWidth = 1;
                  ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
                  ctx.setLineDash([]);
                  // Label
                  ctx.fillStyle = edge;
                  ctx.font = '8px ui-monospace, monospace';
                  ctx.fillText(z.breakerDir === 1 ? 'BRK↑' : 'BRK↓', left + 3, top + 10);
                }
              });
            },
          }),
        }],
      } as import('lightweight-charts').ISeriesPrimitive);
    }
  }

  // ── Volume Bubbles at HVN levels ──────────────────────────────────────────
  if ((c as { showVolBubbles?: boolean }).showVolBubbles && bars.length >= 40) {
    const lt = computeLiquidityThermal(bars, 300, 31);
    if (lt) {
      const lastT = bars[bars.length - 1]!.time as UT;
      const maxVol = lt.volBins.reduce((m, v) => Math.max(m, v), 0);
      // POC — gold line
      try {
        const poc = chart.addSeries(lwc.LineSeries, {
          autoscaleInfoProvider: () => null,
          color: 'rgba(255, 149, 0, 0.9)',
          lineWidth: 2, lineStyle: 0, priceLineVisible: false,
          lastValueVisible: true, crosshairMarkerVisible: false,
          title: 'POC',
        });
        poc.setData(bars.map(b => ({ time: b.time as UT, value: lt.poc })));
      } catch { /* removed */ }
      // Bubble primitive — circles sized by relative vol at each HVN
      candle.attachPrimitive({
        attached({ chart: _c, series: _s }) {},
        detached() {},
        paneViews: () => [{
          zOrder: () => 'normal' as const,
          renderer: () => ({
            draw: (target: import('fancy-canvas').CanvasRenderingTarget2D) => {
              const ts = chart.timeScale();
              const x = ts.timeToCoordinate(lastT);
              if (x === null) return;
              target.useMediaCoordinateSpace(({ context: ctx }) => {
                for (let i = 0; i < lt.levels.length; i++) {
                  const vol = lt.volBins[i] ?? 0;
                  if (vol < maxVol * 0.35) continue; // only HVNs
                  const midPrice = lt.levels[i]! + (lt.rangeHigh - lt.rangeLow) / lt.levels.length / 2;
                  const y = candle.priceToCoordinate(midPrice);
                  if (y === null) continue;
                  const r = Math.max(3, Math.min(14, (vol / maxVol) * 14));
                  const isAbove = midPrice > bars[bars.length - 1]!.close;
                  // Gold bubble outline + fill
                  ctx.beginPath();
                  ctx.arc(x + 28, y, r, 0, Math.PI * 2);
                  ctx.fillStyle = isAbove
                    ? 'rgba(248, 113, 113, 0.15)'    // red above (resistance)
                    : 'rgba(74, 222, 128, 0.15)';    // green below (support)
                  ctx.fill();
                  ctx.strokeStyle = isAbove
                    ? 'rgba(248, 113, 113, 0.7)'
                    : 'rgba(74, 222, 128, 0.7)';
                  ctx.lineWidth = 1;
                  ctx.stroke();
                }
                // POC bubble (gold, larger)
                const pocY = candle.priceToCoordinate(lt.poc);
                if (pocY !== null) {
                  ctx.beginPath();
                  ctx.arc(x + 28, pocY, 14, 0, Math.PI * 2);
                  ctx.fillStyle = 'rgba(255, 149, 0, 0.25)';
                  ctx.fill();
                  ctx.strokeStyle = 'rgba(255, 149, 0, 0.9)';
                  ctx.lineWidth = 2;
                  ctx.stroke();
                  ctx.fillStyle = 'rgba(255, 149, 0, 0.9)';
                  ctx.font = 'bold 7px ui-monospace';
                  ctx.textAlign = 'center';
                  ctx.fillText('POC', x + 28, pocY + 3);
                  ctx.textAlign = 'left';
                }
              });
            },
          }),
        }],
      } as import('lightweight-charts').ISeriesPrimitive);
    }
  }

  if (c.showOrderBlocks || c.showSwingRays) {
    const obs = c.showOrderBlocks
      ? detectOrderBlocks(bars, { maxEach: 14 })
      : [];
    const rays = c.showSwingRays
      ? detectSwingRays(bars, { pivot: 2, maxHighs: 14, maxLows: 14 })
      : [];
    if (obs.length || rays.length) {
      candle.attachPrimitive(
        createSigIntelPrimitive(obs, rays, {
          showOrderBlocks: c.showOrderBlocks,
          showSwingRays: c.showSwingRays,
          alphaScale: Math.max(0.36, sigAlphaScale),
        }),
      );
    }
  }

  /** Line overlays must not participate in right-scale autoscale (only candles), or pan/zoom flattens. */
  const lineNoAutoscale = {
    autoscaleInfoProvider: (_base: () => AutoscaleInfo | null) => null,
  };

  const line = (
    data: { time: UT; value: number }[],
    color: string,
    width = 1,
    visible = true,
  ) => {
    if (!visible || data.length === 0) return;
    const s = chart.addSeries(LineSeries, {
      ...lineNoAutoscale,
      color,
      lineWidth: width as import('lightweight-charts').LineWidth,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: true,
    });
    s.setData(data.filter((d) => Number.isFinite(d.value)));
  };

  const seriesLine = (
    pick: (i: number) => number,
    color: string,
    width = 1,
    show: boolean,
  ) => {
    const data = bars.map((b, i) => ({
      time: b.time as UT,
      value: pick(i),
    }));
    line(data, color, width, show);
  };

  /** BB/KC bands. */
  if (c.showBB) {
    seriesLine((i) => boom[i]!.upperBB, '#58a6ff', 1, true);
    seriesLine((i) => boom[i]!.lowerBB, '#58a6ff', 1, true);
  }
  if (c.showKC) {
    // KC at 50% opacity — context behind BB, not competing
    seriesLine((i) => boom[i]!.kcUpper, 'rgba(163, 113, 247, 0.5)', 1, true);
    seriesLine((i) => boom[i]!.kcLower, 'rgba(163, 113, 247, 0.5)', 1, true);
  }

  /** VWAP — session cumulative from first visible bar; colour flips by close vs VWAP (trend/read). */
  if (c.showVwap && bars.length >= 2) {
    const vw = vwapPerBar(bars);
    const bullCol = 'rgba(74, 222, 128, 0.9)';
    const bearCol = 'rgba(248, 113, 113, 0.88)';
    let i = 0;
    while (i < bars.length) {
      const bull = bars[i]!.close >= vw[i]!;
      const chunk: { time: UT; value: number }[] = [];
      while (i < bars.length && (bars[i]!.close >= vw[i]!) === bull) {
        chunk.push({ time: bars[i]!.time as UT, value: vw[i]! });
        i++;
      }
      if (chunk.length >= 2) line(chunk, bull ? bullCol : bearCol, 2, true);
    }
  }

  // BOOM squeeze box lines — boundary of the squeeze channel.
  if (c.showSqueeze) {
    const sqCol = c.squeezeLinesGreen ? 'rgba(72, 199, 116, 0.55)' : 'rgba(80, 200, 240, 0.55)';
    seriesLine((i) => boom[i]!.boxHighPlot, sqCol, 1, true);
    seriesLine((i) => boom[i]!.boxLowPlot, sqCol, 1, true);
  }

  if (c.showMas) {
    candle.attachPrimitive(
      createEmaRibbonPrimitive(
        bars,
        boom.map((b) => b.emaFast),
        boom.map((b) => b.emaSlow),
      ),
    );
  }
  if (c.showSessionLevels && sess) {
      // Start SIG levels farther back so they read as a cumulative target field.
      const startIdx = Math.max(0, Math.floor(bars.length * 0.5));
      const endIdx = bars.length - 1;
      const startTime = bars[startIdx]?.time as UT | undefined;
      const endTime = bars[endIdx]?.time as UT | undefined;

      /** One dashed segment per level; excluded from autoscale like other line overlays. */
      const levelSegment = (price: number | null, color: string, width = 1) => {
        if (price == null || !Number.isFinite(price) || !startTime || !endTime) return;
        const s = chart.addSeries(LineSeries, {
          ...lineNoAutoscale,
          color,
          lineWidth: width as import('lightweight-charts').LineWidth,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: true,
        });
        s.setData([
          { time: startTime, value: price },
          { time: endTime, value: price },
        ]);
      };

      const pl = (price: number | null, color: string, title: string) => {
        if (price == null || !Number.isFinite(price)) return;
        candle.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title,
        });
      };

      const pdh = sess.prevDayHigh;
      const pdl = sess.prevDayLow;
      const orh = sess.orHigh;
      const orl = sess.orLow;

      const pdMid =
        pdh != null && pdl != null && Number.isFinite(pdh) && Number.isFinite(pdl)
          ? (pdh + pdl) / 2
          : null;
      const pdQ1 =
        pdh != null && pdl != null && Number.isFinite(pdh) && Number.isFinite(pdl)
          ? pdl + (pdh - pdl) * 0.25
          : null;
      const pdQ3 =
        pdh != null && pdl != null && Number.isFinite(pdh) && Number.isFinite(pdl)
          ? pdl + (pdh - pdl) * 0.75
          : null;
      const orMid =
        orh != null && orl != null && Number.isFinite(orh) && Number.isFinite(orl)
          ? (orh + orl) / 2
          : null;

      levelSegment(pdh, rgbaLevel(136, 46, 224, 0.26));
      levelSegment(pdl, rgbaLevel(136, 46, 224, 0.24));
      levelSegment(pdQ3, rgbaLevel(167, 139, 250, 0.2));
      levelSegment(pdMid, rgbaLevel(167, 139, 250, 0.16));
      levelSegment(pdQ1, rgbaLevel(167, 139, 250, 0.2));
      levelSegment(orh, rgbaLevel(100, 180, 255, 0.24));
      levelSegment(orMid, rgbaLevel(125, 211, 252, 0.18));
      levelSegment(orl, rgbaLevel(100, 180, 255, 0.22));

      pl(pdh, rgbaLevel(136, 46, 224, 0.38), 'PDH');
      pl(pdl, rgbaLevel(136, 46, 224, 0.34), 'PDL');
      pl(orh, rgbaLevel(100, 180, 255, 0.34), 'OR↑');
      pl(orl, rgbaLevel(100, 180, 255, 0.3), 'OR↓');
    }

  type ChartMarker = {
    time: UT;
    position: 'belowBar' | 'aboveBar' | 'inBar';
    color: string;
    shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
    size: number;
  };

  const markers: ChartMarker[] = [];

  // ── SIG layer — gated by showCouncilArrows only ───────────────────────────
  if (c.showCouncilArrows && bars.length >= 20) {
    const mode = c.sigMode ?? 'balanced';
    const safetyDefenseOn = c.safetyDefenseOn === true;
    const strict = mode === 'strict' || safetyDefenseOn;
    const rvolMin = strict ? Math.max(c.sigRvolMin ?? 1.65, 1.35) : (c.sigRvolMin ?? 1.65);
    const atrExpandMin = strict
      ? Math.max(c.sigAtrExpandMin ?? 1.2, 1.03)
      : (c.sigAtrExpandMin ?? 1.2);
    const breakAtrFrac = strict
      ? Math.max(c.sigBreakAtrFrac ?? 0.03, 0.06)
      : (c.sigBreakAtrFrac ?? 0.03);

    // Pre-compute rolling RVOL (20-bar avg volume)
    const avgVol20 = new Array<number>(bars.length).fill(0);
    const avgVol50 = new Array<number>(bars.length).fill(0);
    let rollingVol = 0;
    let rollingVol50 = 0;
    for (let i = 0; i < bars.length; i++) {
      rollingVol += bars[i]!.volume ?? 0;
      if (i >= 20) rollingVol -= bars[i - 20]!.volume ?? 0;
      avgVol20[i] = i >= 19 ? rollingVol / 20 : 0;
      rollingVol50 += bars[i]!.volume ?? 0;
      if (i >= 50) rollingVol50 -= bars[i - 50]!.volume ?? 0;
      avgVol50[i] = i >= 49 ? rollingVol50 / 50 : 0;
    }

    // Pre-compute ATR(14) for expansion confirmation
    const atrPeriod = 14;
    const atr = new Array<number>(bars.length).fill(0);
    for (let i = 1; i < bars.length; i++) {
      const b = bars[i]!, bp = bars[i - 1]!;
      const tr = Math.max(b.high - b.low, Math.abs(b.high - bp.close), Math.abs(b.low - bp.close));
      atr[i] = i < atrPeriod
        ? tr
        : atr[i - 1]! + (tr - atr[i - 1]!) / atrPeriod;  // Wilder smoothing
    }

    for (let i = 1; i < bars.length; i++) {
      const bo = boom[i]!;
      const bar = bars[i]!;

      // High-accuracy breakout mode (balanced):
      // Prefer squeeze release, but allow immediate post-squeeze continuation.
      const releaseNow = bo.squeezeRelease;
      const releasePrev = i > 1 ? (boom[i - 1]!.squeezeRelease ?? false) : false;
      const squeezeContext = bo.squeezeOn || bo.squeezeActive || releaseNow || releasePrev;
      if (!squeezeContext) continue;
      const bull = bo.emaFast > bo.emaSlow;
      const boxBreakBull = bar.close > bo.boxHighPlot;
      const boxBreakBear = bar.close < bo.boxLowPlot;
      const boxBreak = bull ? boxBreakBull : boxBreakBear;
      if (!boxBreak) continue;

      const volNow = bar.volume ?? 0;
      const volAvg = avgVol20[i] ?? 0;
      const rvol = volAvg > 0 ? volNow / volAvg : 0;
      const rvolOk = rvol >= rvolMin;

      const atrNow = atr[i] ?? 0;
      const atrPrev = atr[i - 1] ?? 0;
      const atrOk = atrNow > 0 && atrPrev > 0 && atrNow >= atrPrev * atrExpandMin;

      // Require close to clear the box by a small ATR buffer to avoid edge pokes.
      const breakoutDist = bull ? bar.close - bo.boxHighPlot : bo.boxLowPlot - bar.close;
      const breakoutOk = atrNow > 0 && breakoutDist >= atrNow * breakAtrFrac;

      // Dead-market guard: block EOD/illiquid noise where relative RVOL can look good
      // against very small baselines. Balanced mode is intentionally looser.
      const volBase50 = avgVol50[i] ?? 0;
      const hasLiquidity = volBase50 > 0 && volNow >= volBase50 * (strict ? 0.62 : 0.35);
      const atrToPrice = bar.close > 0 ? atrNow / bar.close : 0;
      const atrRegimeOk = atrToPrice >= (strict ? 0.00045 : 0.0002);
      const body = Math.abs(bar.close - bar.open);
      const bodyOk = atrNow > 0 && body >= atrNow * (strict ? 0.34 : 0.16);
      const momentumOk = strict ? rvolOk && atrOk : rvolOk || atrOk || releaseNow;

      // Require box break + breakout distance + (rvol or atr momentum)
      // + live liquidity/volatility regime.
      if (!(breakoutOk && momentumOk && hasLiquidity && atrRegimeOk && bodyOk)) continue;

      markers.push({
        time: bar.time as UT,
        position: bull ? 'belowBar' : 'aboveBar',
        color: bull ? 'rgba(0, 229, 255, 0.40)' : 'rgba(255, 23, 68, 0.40)',
        shape: bull ? 'arrowUp' : 'arrowDown',
        size: 4,
      });
    }

    // Vote dots intentionally disabled on bar chart to reduce visual noise.
  }

  markers.sort((a, b) => Number(a.time) - Number(b.time));

  if (markers.length) createSeriesMarkers(candle, markers);

  if (!snapToLatest && initialLogicalRange != null) {
    try {
      chart.timeScale().setVisibleLogicalRange(initialLogicalRange);
    } catch {
      /* range may be invalid after series change */
    }
  } else if (snapToLatest) {
    chart.timeScale().scrollToRealTime();
  }

  // ── MM Brain — next MM stop + alternate stop lines + MTF ICT levels ──────
  // Computed from OracleSnapshot + ICT 4-phase model.
  // Gold line = primary target (highest-priority liquidity level in current direction).
  // Faint magenta = alternate stop (MM may fake this way first).
  // MTF levels drawn from daily bars if symbol provided.
  if ((c as { showMmBrain?: boolean }).showMmBrain !== false && bars.length >= 55) {
    try {
      // Fetch daily bars for MTF ICT level computation (PWH/PWL/PMH/PML/PQH/PQL)
      let dailyBars: Bar[] | undefined;
      if (symbol) {
        try {
          const { fetchBarsForSymbol } = await import('./fetchBars');
          dailyBars = await fetchBarsForSymbol(symbol, polygonKey, '1y1d');
        } catch { /* MTF fetch failed — proceed with single-TF snapshot */ }
      }

      const snap = buildOracleSnapshot(bars, symbol ?? 'UNKNOWN', 'auto', dailyBars);
      const mm = computeMMBrain(bars, snap);

      // ── MTF ICT level lines (PWH/PWL/PMH/PML/PQH/PQL) ─────────────────
      if (dailyBars && dailyBars.length >= 5) {
        const mtfLvls = computeMtfLevels(dailyBars);
        const lastT2 = bars[bars.length - 1]!.time as UT;
        const mtfStart = bars[Math.max(0, bars.length - 120)]!.time as UT;

        for (const m of mtfLvls) {
          // Price line (right axis label)
          candle.createPriceLine({
            price: m.price,
            color: m.color,
            lineWidth: m.lineWidth,
            lineStyle: m.lineStyle,
            axisLabelVisible: true,
            title: m.label,
          });
          // Horizontal segment across recent bars
          try {
            const ms = chart.addSeries(LineSeries, {
              ...lineNoAutoscale,
              color: m.color,
              lineWidth: m.lineWidth,
              lineStyle: m.lineStyle,
              priceLineVisible: false,
              lastValueVisible: false,
            });
            ms.setData([
              { time: mtfStart, value: m.price },
              { time: lastT2,   value: m.price },
            ]);
          } catch { /* chart removed */ }
        }
      }
      const lastT = bars[bars.length - 1]!.time as UT;
      const firstT = bars[Math.max(0, bars.length - 60)]!.time as UT;

      if (mm.nextStop && Number.isFinite(mm.nextStop)) {
        // Primary next stop — gold glowing price line + dashed horizontal segment
        candle.createPriceLine({
          price: mm.nextStop,
          color: 'rgba(253, 224, 71, 0.95)',
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `MM▶ ${mm.nextStopKind} ${mm.nextStopDist.toFixed(1)}ATR`,
        });
        // Dashed segment from recent bars to now — visual draw on chart
        try {
          const mmSeries = chart.addSeries(LineSeries, {
            ...lineNoAutoscale,
            color: 'rgba(253, 224, 71, 0.7)',
            lineWidth: 2,
            lineStyle: 1,   // dashed
            priceLineVisible: false,
            lastValueVisible: false,
          });
          mmSeries.setData([
            { time: firstT, value: mm.nextStop },
            { time: lastT,  value: mm.nextStop },
          ]);
        } catch { /* chart removed */ }
      }

      if (mm.alternateStop && Number.isFinite(mm.alternateStop)) {
        // Alternate (MM fake-out) — faint magenta
        candle.createPriceLine({
          price: mm.alternateStop,
          color: 'rgba(236, 72, 153, 0.55)',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `MM? alt`,
        });
      }

      // Co-Trader: bracket arrow + HUD card
      const ctSig = computeCoTraderSignal(bars, snap, mm);
      const lastBar = bars[bars.length - 1]!;
      candle.attachPrimitive(
        createCoTraderPrimitive(ctSig, lastBar.close, lastBar.time as import('lightweight-charts').Time),
      );
    } catch { /* MM Brain failed gracefully */ }
  }

  const ro = new ResizeObserver(() => {
    const s = size();
    chart.applyOptions({ width: s.w, height: s.h });
  });
  ro.observe(el);

  return { chart, ro };
}
