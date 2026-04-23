import { memo, useState } from 'react';
import { StockHeatmap, type Exchanges } from 'react-ts-tradingview-widgets';
import TradingViewEtfHeatmap from './TradingViewEtfHeatmap';
import TradingViewAdvancedSpyChart from './TradingViewAdvancedSpyChart';
import TradingViewEconomicEvents from './TradingViewEconomicEvents';
import TradingViewForexHeatMap from './TradingViewForexHeatMap';
import TradingViewHotlists from './TradingViewHotlists';
import TradingViewMarketSummaryBar from './TradingViewMarketSummaryBar';
import TradingViewTimeline from './TradingViewTimeline';
/** Stable references — inline arrays/objects re-created each render break memo() inside the TV lib and remount iframes (visible flashing). */
const SPX_HEAT_EXCHANGES: Exchanges[] = ['NASDAQ', 'NYSE'];

type Props = {
  widgetBg: string;
  widgetTransparent: boolean;
};

/**
 * Live TradingView embeds: tape, symbol overview, sector + crypto heatmaps, US ETF + forex (½+½ row).
 * Data is served by TradingView (no Polygon key required for these widgets).
 */
function MarketTradingViewLive({ widgetBg, widgetTransparent }: Props) {
  const [hotlistTransparent, setHotlistTransparent] = useState(false);
  const hotlistBg = hotlistTransparent ? 'transparent' : '#000000';

  return (
    <section className="mission-council__tv-live" aria-label="Live market views TradingView">
      <TradingViewMarketSummaryBar />

      <div className="mission-council__tv-advanced-grid">
        <div className="mission-council__tv-panel mission-council__tv-panel--flush mission-council__tv-panel--hotlists">
          <div className="mission-council__tv-widget mission-council__tv-widget--advanced">
            <TradingViewAdvancedSpyChart
              symbol="CAPITALCOM:US500"
              title="US500 chart"
              tradingViewPath="CAPITALCOM-US500"
            />
          </div>
        </div>
        <div className="mission-council__tv-panel mission-council__tv-panel--flush">
          <div className="mission-council__tv-widget mission-council__tv-widget--advanced">
            <TradingViewAdvancedSpyChart
              symbol="PEPPERSTONE:NAS100"
              title="NQ100 chart"
              tradingViewPath="PEPPERSTONE-NAS100"
            />
          </div>
        </div>
      </div>

      <div className="mission-council__tv-triple-flex">
        <div className="mission-council__tv-panel mission-council__tv-panel--flush">
          <div className="mission-council__tv-widget">
            <StockHeatmap
              colorTheme="dark"
              dataSource="SPX500"
              exchanges={SPX_HEAT_EXCHANGES}
              grouping="sector"
              blockSize="market_cap_basic"
              blockColor="change"
              isZoomEnabled
              hasTopBar={false}
              height={420}
            />
          </div>
        </div>
        <div className="mission-council__tv-panel mission-council__tv-panel--flush">
          <div className="mission-council__tv-widget mission-council__tv-widget--timeline">
            <TradingViewTimeline />
          </div>
        </div>
        <div className="mission-council__tv-panel mission-council__tv-panel--etf mission-council__tv-panel--flush">
          <div className="mission-council__tv-widget mission-council__tv-widget--etf">
            <TradingViewEtfHeatmap backgroundColor={widgetBg} isTransparent={widgetTransparent} />
          </div>
        </div>
      </div>

    </section>
  );
}

export default memo(MarketTradingViewLive);
