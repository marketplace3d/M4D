import { memo, useEffect, useRef, useState } from 'react';

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-market-quotes.js';

function TradingViewMarketOverview() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setLoaded(false);
    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.id = 'tradingview-wrapper';
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
      colorTheme: 'dark',
      locale: 'en',
      largeChartUrl: '',
      isTransparent: false,
      showSymbolLogo: true,
      backgroundColor: 'rgba(0, 0, 0, 1)',
      symbolsGroups: [
        {
          name: 'Indices',
          symbols: [
            { name: 'FOREXCOM:SPXUSD', displayName: 'S&P 500 Index' },
            { name: 'FOREXCOM:NSXUSD', displayName: 'US 100 Cash CFD' },
            { name: 'FOREXCOM:DJI', displayName: 'Dow Jones Industrial Average Index' },
            { name: 'INDEX:NKY', displayName: 'Japan 225' },
            { name: 'INDEX:DEU40', displayName: 'DAX Index' },
            { name: 'FOREXCOM:UKXGBP', displayName: 'FTSE 100 Index' },
          ],
        },
        {
          name: 'Futures',
          symbols: [
            { name: 'BMFBOVESPA:ISP1!', displayName: 'S&P 500' },
            { name: 'BMFBOVESPA:EUR1!', displayName: 'Euro' },
            { name: 'CMCMARKETS:GOLD', displayName: 'Gold' },
            { name: 'PYTH:WTI3!', displayName: 'WTI Crude Oil' },
            { name: 'BMFBOVESPA:CCM1!', displayName: 'Corn' },
          ],
        },
        {
          name: 'Bonds',
          symbols: [
            { name: 'EUREX:FGBL1!', displayName: 'Euro Bund' },
            { name: 'EUREX:FBTP1!', displayName: 'Euro BTP' },
            { name: 'EUREX:FGBM1!', displayName: 'Euro BOBL' },
          ],
        },
        {
          name: 'Forex',
          symbols: [
            { name: 'FX:EURUSD', displayName: 'EUR to USD' },
            { name: 'FX:GBPUSD', displayName: 'GBP to USD' },
            { name: 'FX:USDJPY', displayName: 'USD to JPY' },
            { name: 'FX:USDCHF', displayName: 'USD to CHF' },
            { name: 'FX:AUDUSD', displayName: 'AUD to USD' },
            { name: 'FX:USDCAD', displayName: 'USD to CAD' },
          ],
        },
      ],
      support_host: 'https://www.tradingview.com',
      width: '100%',
      height: '100%',
    });
    widget.appendChild(script);

    container.appendChild(wrap);

    const forceIframeBlack = (iframe: HTMLIFrameElement) => {
      iframe.style.backgroundColor = '#000000';
      iframe.style.colorScheme = 'dark';
      iframe.style.border = 'none';
    };

    const attachIframeLoad = (iframe: HTMLIFrameElement) => {
      if (iframe.dataset.tvBound === '1') return;
      iframe.dataset.tvBound = '1';
      forceIframeBlack(iframe);
      const reveal = () => setLoaded(true);
      iframe.addEventListener('load', reveal, { once: true });
      // If already loaded from cache, reveal on next frame.
      requestAnimationFrame(() => {
        try {
          const docReady = iframe.contentDocument?.readyState;
          if (docReady === 'interactive' || docReady === 'complete') setLoaded(true);
        } catch {
          // Cross-origin access can throw; ignore and rely on load event.
        }
      });
    };

    const scan = () => {
      const iframe = container.querySelector('iframe');
      if (iframe instanceof HTMLIFrameElement) attachIframeLoad(iframe);
    };
    scan();

    const observer = new MutationObserver(() => scan());
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      container.innerHTML = '';
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`mission-council__tv-market-overview-host${loaded ? ' is-loaded' : ''}`}
    />
  );
}

export default memo(TradingViewMarketOverview);
