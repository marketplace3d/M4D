import { memo, useEffect, useRef } from 'react';

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-etf-heatmap.js';

function TradingViewEtfHeatmap({
  backgroundColor,
  isTransparent,
}: {
  backgroundColor: string;
  isTransparent: boolean;
}) {
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
    script.innerHTML = JSON.stringify({
      dataSource: 'AllUSEtf',
      blockSize: 'volume',
      blockColor: 'change',
      grouping: 'asset_class',
      locale: 'en',
      symbolUrl: '',
      colorTheme: 'dark',
      backgroundColor,
      isTransparent,
      hasTopBar: false,
      isDataSetEnabled: false,
      isZoomEnabled: true,
      hasSymbolTooltip: true,
      isMonoSize: false,
      width: '100%',
      height: '100%',
    });
    wrap.appendChild(script);

    container.appendChild(wrap);

    return () => {
      container.innerHTML = '';
    };
  }, [backgroundColor, isTransparent]);

  return <div ref={containerRef} className="mission-council__tv-etf-host" />;
}

export default memo(TradingViewEtfHeatmap);
