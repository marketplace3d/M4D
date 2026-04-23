import { memo, useEffect, useRef, useState } from 'react';

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-tickers.js';

function TradingViewMarketsTickers() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setLoaded(false);
    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'tradingview-widget-container';
    wrap.style.backgroundColor = '#000000';
    wrap.style.colorScheme = 'dark';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.backgroundColor = '#000000';
    widget.style.colorScheme = 'dark';
    wrap.appendChild(widget);

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = SCRIPT_SRC;
    script.async = true;
    script.innerHTML = JSON.stringify({
      backgroundColor: '#000000',
      symbols: [
        { proName: 'FOREXCOM:SPXUSD', title: 'S&P 500 Index' },
        { proName: 'FOREXCOM:NSXUSD', title: 'US 100 Cash CFD' },
        { proName: 'FX_IDC:EURUSD', title: 'EUR to USD' },
        { proName: 'BITSTAMP:BTCUSD', title: 'Bitcoin' },
        { proName: 'TVC:GOLD', title: '' },
      ],
      colorTheme: 'dark',
      locale: 'en',
      largeChartUrl: '',
      isTransparent: false,
      showSymbolLogo: false,
      width: '100%',
      height: 72,
    });
    wrap.appendChild(script);

    container.appendChild(wrap);

    const bindIframe = (iframe: HTMLIFrameElement) => {
      if (iframe.dataset.tvBound === '1') return;
      iframe.dataset.tvBound = '1';
      const reveal = () => setLoaded(true);
      iframe.addEventListener('load', reveal, { once: true });
    };

    const scan = () => {
      const iframe = container.querySelector('iframe');
      if (iframe instanceof HTMLIFrameElement) bindIframe(iframe);
    };
    scan();

    const observer = new MutationObserver(scan);
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      container.innerHTML = '';
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`mission-council__tv-tickers-host${loaded ? ' is-loaded' : ''}`}
    />
  );
}

export default memo(TradingViewMarketsTickers);
