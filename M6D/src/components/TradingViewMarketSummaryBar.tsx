import { memo, useEffect, useRef } from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'tv-market-summary': import('react').DetailedHTMLProps<
        import('react').HTMLAttributes<HTMLElement> & { direction?: 'horizontal' | 'vertical' },
        HTMLElement
      >;
    }
  }
}

const SCRIPT_ID = 'tv-market-summary-module';
const SCRIPT_SRC = 'https://widgets.tradingview-widget.com/w/en/tv-market-summary.js';

function ensureSummaryScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.ready === '1') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('tv-market-summary script failed')), {
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
    script.onerror = () => reject(new Error('tv-market-summary script failed'));
    document.head.appendChild(script);
  });
}

function TradingViewMarketSummaryBar() {
  const hostRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ensureSummaryScript().then(async () => {
      try {
        await customElements.whenDefined('tv-market-summary');
      } catch {
        return;
      }
      if (cancelled) return;
      if (hostRef.current) hostRef.current.setAttribute('direction', 'horizontal');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mission-council__tv-market-summary-bar">
      <tv-market-summary ref={hostRef} direction="horizontal" />
    </div>
  );
}

export default memo(TradingViewMarketSummaryBar);
