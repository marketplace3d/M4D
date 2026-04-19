'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, Time, ColorType, LineStyle } from 'lightweight-charts';

interface CandleData {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface HeatseekerProps {
  data: CandleData[];
  width?: number;
  height?: number;
}

const HeatseekerChart: React.FC<HeatseekerProps> = ({ data, width = 900, height = 600 }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const [alphaScore, setAlphaScore] = useState(0);
  const [regime, setRegime] = useState('RANGING');
  const [tier, setTier] = useState('C');
  const [jediDirection, setJediDirection] = useState<'bull' | 'bear' | 'neutral'>('neutral');

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width,
      height,
      layout: {
        background: { color: '#001133' }, // base dark blue (flame starts here)
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2B2B43' },
        horzLines: { color: '#2B2B43' },
      },
      crosshair: { mode: 0 },
      timeScale: { timeVisible: true, secondsVisible: false },
    });

    chartRef.current = chart;

    // Candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#00ff88',
      downColor: '#ff0088',
      borderVisible: false,
      wickUpColor: '#00ff88',
      wickDownColor: '#ff0088',
    });
    candlestickSeriesRef.current = candlestickSeries;

    // Volume histogram
    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;

    // Feed data
    const candleData = data.map(d => ({
      time: d.time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    const volumeData = data.map(d => ({
      time: d.time,
      value: d.volume,
      color: d.close >= d.open ? '#00ff8833' : '#ff008833',
    }));

    candlestickSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    // Simulate Heatseeker calculations (replace with your real Pine logic ported to TS)
    const simulateHeatseeker = () => {
      const latestClose = data[data.length - 1]?.close || 0;
      const simulatedAlpha = Math.floor(45 + Math.random() * 55); // 45-100
      const simulatedRegimeScore = (Math.random() - 0.5) * 2;

      setAlphaScore(simulatedAlpha);

      let reg = 'RANGING';
      if (simulatedRegimeScore > 0.5) reg = 'BULL TREND';
      else if (simulatedRegimeScore < -0.5) reg = 'BEAR TREND';
      else if (Math.abs(simulatedRegimeScore) > 0.3) reg = 'TRANSITION';
      setRegime(reg);

      const t = simulatedAlpha >= 85 ? 'S' : simulatedAlpha >= 72 ? 'A' : simulatedAlpha >= 58 ? 'B' : 'C';
      setTier(t);

      setJediDirection(simulatedRegimeScore > 0.4 && simulatedAlpha >= 72 ? 'bull' :
                       simulatedRegimeScore < -0.4 && simulatedAlpha >= 72 ? 'bear' : 'neutral');

      // Flame background simulation (update chart background dynamically)
      let bgColor = '#001133';
      if (simulatedAlpha > 80) bgColor = '#ff3300';      // fire red
      else if (simulatedAlpha > 65) bgColor = '#ffee00'; // yellow
      else if (simulatedAlpha > 50) bgColor = '#ffaa00'; // orange
      else if (simulatedAlpha > 35) bgColor = '#00bbff'; // cyan

      chart.applyOptions({
        layout: { background: { color: bgColor, type: ColorType.Solid } },
      });

      // Example: Add target line (ULTIMATE / NEXT)
      if (t === 'S' || t === 'A') {
        const targetPrice = latestClose * (simulatedRegimeScore > 0 ? 1.015 : 0.985);
        // In real implementation, use price line or custom marker
        console.log(`Heatseeker ${t} Target: ${targetPrice.toFixed(2)}`);
      }
    };

    // Run simulation on data change (in production, compute from real indicators)
    simulateHeatseeker();

    // Resize handler
    const handleResize = () => {
      chart.resize(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data, width, height]);

  return (
    <div className="relative">
      {/* Chart Container */}
      <div ref={chartContainerRef} />

      {/* Overlay Info Panel (MAXCOGVIZ style) */}
      <div className="absolute top-4 right-4 bg-black/80 text-white p-4 rounded-lg font-mono text-sm border border-gray-700">
        <div>REGIME: <span className={regime.includes('BULL') ? 'text-lime-400' : regime.includes('BEAR') ? 'text-red-400' : 'text-yellow-400'}>{regime}</span></div>
        <div>ALPHA: <span className="text-yellow-400">{alphaScore}</span> ({tier})</div>
        <div>SAFETY: <span className={safetyFactor > 1 ? 'text-lime-400' : 'text-orange-400'}>{safetyFactor > 1 ? 'FULL' : 'TIGHT'}</span></div>
        <div className="mt-2 text-xs">
          JEDI WISDOM: 
          <span className={jediDirection === 'bull' ? 'text-cyan-400' : jediDirection === 'bear' ? 'text-pink-400' : 'text-gray-400'}>
            {jediDirection === 'bull' ? ' ▲ BULLISH ALIGNMENT' : jediDirection === 'bear' ? ' ▼ BEARISH ALIGNMENT' : ' NEUTRAL — WAIT'}
          </span>
        </div>
      </div>

      {/* Legend / Targets Info */}
      <div className="absolute bottom-4 left-4 text-xs text-gray-400 bg-black/70 px-3 py-1 rounded">
        S/A = ULTIMATE / NEXT TARGETS • Flame = Regime Heat • Arrows = Confluence Signals
      </div>
    </div>
  );
};

export default HeatseekerChart;