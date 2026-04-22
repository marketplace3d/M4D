import { memo, useEffect, useRef } from 'react';

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js';

/** Shared embed options (symbols set per cell). */
const OVERVIEW_BASE: Record<string, unknown> = {
  lineWidth: 2,
  lineType: 0,
  chartType: 'area',
  fontColor: 'rgb(106, 109, 120)',
  gridLineColor: 'rgba(242, 242, 242, 0.06)',
  volumeUpColor: 'rgba(34, 171, 148, 0.5)',
  volumeDownColor: 'rgba(247, 82, 95, 0.5)',
  backgroundColor: '#131722',
  widgetFontColor: '#DBDBDB',
  upColor: '#22ab94',
  downColor: '#f7525f',
  borderUpColor: '#22ab94',
  borderDownColor: '#f7525f',
  wickUpColor: '#22ab94',
  wickDownColor: '#f7525f',
  colorTheme: 'dark',
  isTransparent: false,
  locale: 'en',
  chartOnly: false,
  scalePosition: 'right',
  scaleMode: 'Normal',
  fontFamily: '-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif',
  valuesTracking: '1',
  changeMode: 'price-and-percent',
  dateRanges: ['1d|1', '1m|30', '3m|60', '12m|1D', '60m|1W', 'all|1M'],
  fontSize: '10',
  headerFontSize: 'medium',
  autosize: true,
  width: '100%',
  height: '100%',
  noTimeScale: false,
  hideDateRanges: true,
  hideMarketStatus: true,
  hideSymbolLogo: true,
};

const SYMBOL_CELLS: readonly { label: string; tvSymbol: string }[] = [
  { label: 'SPY', tvSymbol: 'NYSE:SPY' },
  { label: 'QQQ', tvSymbol: 'NASDAQ:QQQ' },
  { label: 'DIA', tvSymbol: 'NYSE:DIA' },
];

function cellConfig(label: string, tvSymbol: string): Record<string, unknown> {
  return {
    ...OVERVIEW_BASE,
    symbols: [[label, `${tvSymbol}|1D`]],
  };
}

const OverviewCell = memo(function OverviewCell({
  label,
  tvSymbol,
}: {
  label: string;
  tvSymbol: string;
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
    script.innerHTML = JSON.stringify(cellConfig(label, tvSymbol));
    wrap.appendChild(script);

    host.appendChild(wrap);

    return () => {
      host.innerHTML = '';
    };
  }, [label, tvSymbol]);

  return <div ref={hostRef} className="mission-council__tv-overview-cell-host" />;
});

/** Three TradingView symbol-overview embeds in a 1×3 row (⅓ each). */
function TradingViewSymbolOverview() {
  return (
    <div className="mission-council__tv-overview-grid-3">
      {SYMBOL_CELLS.map((c) => (
        <OverviewCell key={c.tvSymbol} label={c.label} tvSymbol={c.tvSymbol} />
      ))}
    </div>
  );
}

export default memo(TradingViewSymbolOverview);
