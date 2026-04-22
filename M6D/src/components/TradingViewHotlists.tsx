import { memo, useEffect, useRef } from 'react';

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-hotlists.js';

function TradingViewHotlists({
  backgroundColor,
  isTransparent,
}: {
  backgroundColor: string;
  isTransparent: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    host.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'tradingview-widget-container';

    const inner = document.createElement('div');
    inner.className = 'tradingview-widget-container__widget';
    wrap.appendChild(inner);

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = SCRIPT_SRC;
    script.async = true;
    script.innerHTML = JSON.stringify({
      exchange: 'NASDAQ',
      colorTheme: 'dark',
      dateRange: '1D',
      showChart: true,
      locale: 'en',
      largeChartUrl: '',
      isTransparent,
      backgroundColor,
      showSymbolLogo: false,
      showFloatingTooltip: false,
      plotLineColorGrowing: 'rgba(41, 98, 255, 1)',
      plotLineColorFalling: 'rgba(41, 98, 255, 1)',
      gridLineColor: 'rgba(240, 243, 250, 0)',
      scaleFontColor: '#DBDBDB',
      belowLineFillColorGrowing: 'rgba(41, 98, 255, 0.12)',
      belowLineFillColorFalling: 'rgba(41, 98, 255, 0.12)',
      belowLineFillColorGrowingBottom: 'rgba(41, 98, 255, 0)',
      belowLineFillColorFallingBottom: 'rgba(41, 98, 255, 0)',
      symbolActiveColor: 'rgba(41, 98, 255, 0.12)',
      width: '100%',
      height: '100%',
    });
    wrap.appendChild(script);

    host.appendChild(wrap);

    return () => {
      host.innerHTML = '';
    };
  }, [backgroundColor, isTransparent]);

  return <div ref={hostRef} className="mission-council__tv-hotlists-host" />;
}

export default memo(TradingViewHotlists);
