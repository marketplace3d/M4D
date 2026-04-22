import { memo, useEffect, useRef } from 'react';

const SCRIPT_ID = 'tv-ticker-tape-module';
const SCRIPT_SRC = 'https://widgets.tradingview-widget.com/w/en/tv-ticker-tape.js';
const SYMBOLS =
  'FOREXCOM:SPXUSD,FOREXCOM:NSXUSD,FOREXCOM:DJI,FX:EURUSD,BITSTAMP:BTCUSD,BITSTAMP:ETHUSD,CMCMARKETS:GOLD';

function ensureTickerTapeScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.ready === '1') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('tv-ticker-tape script failed')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.type = 'module';
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      script.dataset.ready = '1';
      resolve();
    };
    script.onerror = () => reject(new Error('tv-ticker-tape script failed'));
    document.head.appendChild(script);
  });
}

function TradingViewTopTickerTape() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    host.innerHTML = '';
    void ensureTickerTapeScript().then(async () => {
      if (cancelled || !hostRef.current) return;
      try {
        await customElements.whenDefined('tv-ticker-tape');
      } catch {
        return;
      }
      if (cancelled || !hostRef.current) return;

      const tape = document.createElement('tv-ticker-tape');
      tape.setAttribute('symbols', SYMBOLS);
      tape.setAttribute('transparent', '');
      hostRef.current.appendChild(tape);
    });

    return () => {
      cancelled = true;
      if (hostRef.current) hostRef.current.innerHTML = '';
    };
  }, []);

  return <div ref={hostRef} className="mission-council__top-ticker" aria-label="Top live ticker tape" />;
}

export default memo(TradingViewTopTickerTape);
