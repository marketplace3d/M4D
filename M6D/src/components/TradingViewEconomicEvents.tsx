import { memo, useEffect, useRef } from 'react';

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-events.js';

const EVENTS_CONFIG: Record<string, unknown> = {
  colorTheme: 'dark',
  isTransparent: false,
  locale: 'en',
  countryFilter: 'us',
  importanceFilter: '0,1',
  width: '100%',
  height: '100%',
};

function TradingViewEconomicEvents() {
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

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = SCRIPT_SRC;
    script.async = true;
    script.innerHTML = JSON.stringify(EVENTS_CONFIG);
    wrap.appendChild(script);

    container.appendChild(wrap);

    return () => {
      container.innerHTML = '';
    };
  }, []);

  return <div ref={containerRef} className="mission-council__tv-events-host" />;
}

export default memo(TradingViewEconomicEvents);
