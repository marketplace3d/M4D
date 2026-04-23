import { memo, useEffect, useRef } from 'react';

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-timeline.js';

const TIMELINE_CONFIG: Record<string, unknown> = {
  displayMode: 'regular',
  feedMode: 'all_symbols',
  colorTheme: 'dark',
  isTransparent: false,
  locale: 'en',
  width: '100%',
  height: '100%',
};

function TradingViewTimeline() {
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
    script.innerHTML = JSON.stringify(TIMELINE_CONFIG);
    wrap.appendChild(script);

    container.appendChild(wrap);

    return () => {
      container.innerHTML = '';
    };
  }, []);

  return <div ref={containerRef} className="mission-council__tv-timeline-host" />;
}

export default memo(TradingViewTimeline);
