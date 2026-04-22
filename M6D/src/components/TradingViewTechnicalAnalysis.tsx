import { memo, useEffect, useRef } from 'react';

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js';

/** Stable config — single-symbol technical analysis (SPX). */
const TECHNICAL_ANALYSIS_CONFIG: Record<string, unknown> = {
  colorTheme: 'dark',
  displayMode: 'single',
  isTransparent: true,
  locale: 'en',
  interval: '5m',
  disableInterval: false,
  width: '100%',
  height: '100%',
  symbol: 'SP:SPX',
  showIntervalTabs: true,
};

function TradingViewTechnicalAnalysis() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'tradingview-widget-container';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    wrap.appendChild(widget);

    const copyright = document.createElement('div');
    copyright.className = 'tradingview-widget-copyright';
    copyright.innerHTML =
      '<a href="https://www.tradingview.com/symbols/SP-SPX/technicals/" rel="noopener nofollow" target="_blank"><span class="blue-text">SPX analysis</span></a><span class="trademark"> by TradingView</span>';
    wrap.appendChild(copyright);

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = SCRIPT_SRC;
    script.async = true;
    script.innerHTML = JSON.stringify(TECHNICAL_ANALYSIS_CONFIG);
    wrap.appendChild(script);

    container.appendChild(wrap);

    return () => {
      container.innerHTML = '';
    };
  }, []);

  return <div ref={containerRef} className="mission-council__tv-ta-host" />;
}

export default memo(TradingViewTechnicalAnalysis);
