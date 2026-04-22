import { memo, useEffect, useRef } from 'react';

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

const ADVANCED_CHART_BASE_CONFIG: Record<string, unknown> = {
  allow_symbol_change: true,
  calendar: false,
  details: false,
  hide_side_toolbar: true,
  hide_top_toolbar: false,
  hide_legend: false,
  hide_volume: true,
  hotlist: true,
  interval: '15',
  locale: 'en',
  save_image: true,
  style: '1',
  symbol: 'CAPITALCOM:US500',
  theme: 'dark',
  timezone: 'Etc/UTC',
  backgroundColor: 'rgba(0, 0, 0, 1)',
  gridColor: 'rgba(0, 0, 0, 0.02)',
  watchlist: [],
  withdateranges: false,
  compareSymbols: [
    { symbol: 'BITSTAMP:BTCUSD', position: 'SameScale' },
    { symbol: 'PEPPERSTONE:NAS100', position: 'SameScale' },
    { symbol: 'OANDA:EURUSD', position: 'SameScale' },
    { symbol: 'OANDA:XAGUSD', position: 'SameScale' },
    { symbol: 'FOREXCOM:XAUUSD', position: 'SameScale' },
  ],
  studies: [],
  autosize: true,
};

type Props = {
  symbol?: string;
  title?: string;
  tradingViewPath?: string;
};

function TradingViewAdvancedSpyChart({
  symbol = 'CAPITALCOM:US500',
  title = 'US500 chart',
  tradingViewPath = 'CAPITALCOM-US500',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'tradingview-widget-container';
    wrap.style.width = '100%';
    wrap.style.height = '100%';
    wrap.style.backgroundColor = '#000000';
    wrap.style.colorScheme = 'dark';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.width = '100%';
    widget.style.height = 'calc(100% - 32px)';
    widget.style.backgroundColor = '#000000';
    widget.style.colorScheme = 'dark';
    wrap.appendChild(widget);

    const copyright = document.createElement('div');
    copyright.className = 'tradingview-widget-copyright';
    copyright.innerHTML =
      `<a href="https://www.tradingview.com/symbols/${tradingViewPath}/" rel="noopener nofollow" target="_blank"><span class="blue-text">${title}</span></a><span class="trademark"> by TradingView</span>`;
    wrap.appendChild(copyright);

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = SCRIPT_SRC;
    script.async = true;
    script.innerHTML = JSON.stringify({
      ...ADVANCED_CHART_BASE_CONFIG,
      symbol,
    });
    wrap.appendChild(script);

    container.appendChild(wrap);

    return () => {
      container.innerHTML = '';
    };
  }, [symbol, title, tradingViewPath]);

  return <div ref={containerRef} className="mission-council__tv-advanced-host" />;
}

export default memo(TradingViewAdvancedSpyChart);
