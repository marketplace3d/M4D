import { useCallback, useEffect, useState, type ReactNode } from 'react';
import './App.css';
import AlgoDataTablePage from './pages/AlgoDataTablePage';
import BoomExplore from './pages/BoomExplore';
import ControlRoomKnightsPage from './pages/ControlRoomKnightsPage';
import FullSystemVizPage from './pages/FullSystemVizPage';
import MissionCouncil from './pages/MissionCouncil';
import MissionHub from './pages/MissionHub';
import VizXYFlowPage from './pages/VizXYFlowPage';
import TvLwChartsPage from './pages/TvLwChartsPage';
import IctChartsPage from './pages/IctChartsPage';
import FxChartsPage from './pages/FxChartsPage';
import TvLwChartsLivePage from './pages/TvLwChartsLivePage';
import TradeBotPage from './pages/TradeBotPage';
import TestLabPage from './pages/TestLabPage';
import CryptoLabPage from './pages/CryptoLabPage';
import FootplatePage from './pages/FootplatePage';
import FlowMapsStudioPage from './pages/FlowMapsStudioPage';
import LaunchPadPage from './pages/LaunchPadPage';
import IctPageOld from './pages/IctPageOld';
import { MISSION_NAV_ITEMS, type MissionPage } from './missionNavConfig';
import { WarriorMobileSyncProvider } from './WarriorMobileSyncContext';
import ServiceOpsDash from './components/ServiceOpsDash';
import { useServiceHealth } from './hooks/useServiceHealth';

export type { MissionPage } from './missionNavConfig';

function readHashPage(): MissionPage {
  const h = window.location.hash;
  if (h === '#boom') return 'boom';
  if (h === '#spx') return 'spx';
  if (h === '#charts' || h === '#c') return 'spx';
  if (h === '#fx') return 'fx';
  if (h === '#chartslive' || h === '#clive') return 'chartslive';
  if (h === '#tradebot' || h === '#tbot' || h === '#trade' || h === '#t') return 'tradebot';
  if (h === '#test' || h === '#lab') return 'testlab';
  if (h === '#market' || h === '#council') return 'council';
  if (h === '#algos') return 'algos';
  if (h === '#warrior') return 'warrior';
  if (h === '#control' || h === '#mission') return 'missionviz';
  if (h === '#flowmaps' || h === '#maps') return 'flowmaps';
  if (h === '#pulse' || h === '#warriors' || h === '#w' || h === '#knights') return 'warriors';
  if (h === '#btc' || h === '#crypto') return 'crypto';
  if (h === '#footplate' || h === '#engine') return 'footplate';
  if (h === '#opt' || h === '#launchpad' || h === '#pad') return 'launchpad';
  if (h === '#ict') return 'ict';
  if (h === '#ict-old' || h === '#ictold') return 'ict-old';
  return 'hub';
}

export default function App() {
  const [page, setPage] = useState<MissionPage>(readHashPage);
  const [mobilePagesOpen, setMobilePagesOpen] = useState(false);
  const { services } = useServiceHealth(10_000);

  useEffect(() => {
    const onHash = () => setPage(readHashPage());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    setMobilePagesOpen(false);
  }, [page]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 721px)');
    const onChange = () => {
      if (mq.matches) setMobilePagesOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const titles: Record<MissionPage, string> = {
      hub: 'MISSION — HOME',
      council: 'MISSION — MARKET',
      algos: 'MISSION — ALGOS',
      boom: 'MISSION — BOOM',
      spx: 'MISSION — SPX',
      fx: 'MISSION — FX CHARTS',
      chartslive: 'MISSION — LIVE WS',
      tradebot: 'MISSION — TRADE🔥',
      testlab: 'MISSION — TEST',
      warrior: 'MISSION — COUNCIL',
      missionviz: 'MISSION — CONTROL',
      warriors: 'MISSION — PULSE',
      flowmaps: 'MISSION — MAP STUDIO',
      crypto: 'MISSION — BTC',
      footplate: 'MISSION — ENGINE',
      launchpad: 'MISSION — OPT',
      ict: 'MISSION — ICT CHARTS',
      'ict-old': 'MISSION — ICT TRADER (OLD)',
    };
    document.title = titles[page];
  }, [page]);

  const goHub = useCallback(() => {
    setPage('hub');
    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  }, []);

  const goCouncil = useCallback(() => {
    setPage('council');
    if (window.location.hash !== '#market') {
      window.location.hash = 'market';
    }
  }, []);

  const goAlgos = useCallback(() => {
    setPage('algos');
    if (window.location.hash !== '#algos') {
      window.location.hash = 'algos';
    }
  }, []);

  const goBoom = useCallback(() => {
    setPage('boom');
    if (window.location.hash !== '#boom') {
      window.location.hash = 'boom';
    }
  }, []);

  const goSpx = useCallback(() => {
    setPage('spx');
    if (window.location.hash !== '#spx') {
      window.location.hash = 'spx';
    }
  }, []);

  const goFx = useCallback(() => {
    setPage('fx');
    if (window.location.hash !== '#fx') {
      window.location.hash = 'fx';
    }
  }, []);

  const goWarrior = useCallback(() => {
    setPage('warrior');
    if (window.location.hash !== '#warrior') {
      window.location.hash = 'warrior';
    }
  }, []);

  const goChartsLive = useCallback(() => {
    setPage('chartslive');
    if (window.location.hash !== '#chartslive') {
      window.location.hash = 'chartslive';
    }
  }, []);

  const goTradeBot = useCallback(() => {
    setPage('tradebot');
    if (window.location.hash !== '#trade') {
      window.location.hash = 'trade';
    }
  }, []);

  const goTestLab = useCallback(() => {
    setPage('testlab');
    if (window.location.hash !== '#test') {
      window.location.hash = 'test';
    }
  }, []);

  const goMissionViz = useCallback(() => {
    setPage('missionviz');
    if (window.location.hash !== '#control') {
      window.location.hash = 'control';
    }
  }, []);

  const goWarriors = useCallback(() => {
    setPage('warriors');
    if (window.location.hash !== '#pulse') {
      window.location.hash = 'pulse';
    }
  }, []);

  const goFlowMaps = useCallback(() => {
    setPage('flowmaps');
    if (window.location.hash !== '#flowmaps') {
      window.location.hash = 'flowmaps';
    }
  }, []);

  const goCrypto = useCallback(() => {
    setPage('crypto');
    if (window.location.hash !== '#btc') {
      window.location.hash = 'btc';
    }
  }, []);

  const goFootplate = useCallback(() => {
    setPage('footplate');
    if (window.location.hash !== '#footplate') {
      window.location.hash = 'footplate';
    }
  }, []);

  const goLaunchPad = useCallback(() => {
    setPage('launchpad');
    if (window.location.hash !== '#opt') {
      window.location.hash = 'opt';
    }
  }, []);

  const goIct = useCallback(() => {
    setPage('ict');
    if (window.location.hash !== '#ict') {
      window.location.hash = 'ict';
    }
  }, []);

  const goIctOld = useCallback(() => {
    setPage('ict-old');
    if (window.location.hash !== '#ict-old') {
      window.location.hash = 'ict-old';
    }
  }, []);

  const navigateTo = useCallback(
    (p: MissionPage) => {
      switch (p) {
        case 'hub':
          goHub();
          break;
        case 'council':
          goCouncil();
          break;
        case 'warriors':
          goWarriors();
          break;
        case 'algos':
          goAlgos();
          break;
        case 'boom':
          goBoom();
          break;
        case 'spx':
          goSpx();
          break;
        case 'fx':
          goFx();
          break;
        case 'warrior':
          goWarrior();
          break;
        case 'chartslive':
          goChartsLive();
          break;
        case 'tradebot':
          goTradeBot();
          break;
        case 'testlab':
          goTestLab();
          break;
        case 'missionviz':
          goMissionViz();
          break;
        case 'flowmaps':
          goFlowMaps();
          break;
        case 'crypto':
          goCrypto();
          break;
        case 'footplate':
          goFootplate();
          break;
        case 'launchpad':
          goLaunchPad();
          break;
        case 'ict':
          goIct();
          break;
        case 'ict-old':
          goIctOld();
          break;
      }
    },
    [
      goHub,
      goCouncil,
      goWarriors,
      goAlgos,
      goBoom,
      goSpx,
      goFx,
      goWarrior,
      goChartsLive,
      goTradeBot,
      goTestLab,
      goMissionViz,
      goFlowMaps,
      goCrypto,
      goFootplate,
      goLaunchPad,
      goIct,
      goIctOld,
    ]
  );

  let main: ReactNode;
  switch (page) {
    case 'boom':
      main = <BoomExplore />;
      break;
    case 'spx':
      main = <TvLwChartsPage />;
      break;
    case 'fx':
      main = <FxChartsPage />;
      break;
    case 'chartslive':
      main = <TvLwChartsLivePage />;
      break;
    case 'tradebot':
      main = <TradeBotPage />;
      break;
    case 'testlab':
      main = <TestLabPage />;
      break;
    case 'council':
      main = <MissionCouncil onOpenWarriors={goWarriors} />;
      break;
    case 'algos':
      main = <AlgoDataTablePage />;
      break;
    case 'warrior':
      main = <VizXYFlowPage />;
      break;
    case 'missionviz':
      main = <FullSystemVizPage />;
      break;
    case 'warriors':
      main = <ControlRoomKnightsPage />;
      break;
    case 'flowmaps':
      main = <FlowMapsStudioPage />;
      break;
    case 'crypto':
      main = <CryptoLabPage />;
      break;
    case 'footplate':
      main = <FootplatePage />;
      break;
    case 'launchpad':
      main = <LaunchPadPage />;
      break;
    case 'ict':
      main = <IctChartsPage />;
      break;
    case 'ict-old':
      main = <IctPageOld />;
      break;
    default:
      main = (
        <MissionHub
          onCouncil={goCouncil}
          onLaunchPad={goLaunchPad}
          onFootplate={goFootplate}
          onWarriors={goWarriors}
          onTradeBot={goTradeBot}
          onBoom={goBoom}
          onSpx={goSpx}
          onFx={goFx}
          onCrypto={goCrypto}
          onWarrior={goWarrior}
          onMissionViz={goMissionViz}
        />
      );
  }

  return (
    <WarriorMobileSyncProvider>
    <div className="app-shell">
      <header className="app-nav" aria-label="MISSION pages">
        <div className="app-nav__left">
          <button
            type="button"
            className="app-nav__burger"
            aria-label="Open pages menu"
            aria-expanded={mobilePagesOpen}
            onClick={() => setMobilePagesOpen((o) => !o)}
          >
            ☰
          </button>
          <span className="app-nav__brand">MISSION</span>
          <span className="app-nav__port" title="Svelte PWA uses :5555">
            React · 127.0.0.1:5550
          </span>
          <span className="app-nav__menu-label app-nav__menu-label--hint">
            PAGES
          </span>
        </div>
        <div className="app-nav__right">
          <ServiceOpsDash services={services} />
        </div>
        <nav className="app-nav__tabs" aria-label="Primary">
          <button
            type="button"
            className={page === 'hub' ? 'app-nav__tab app-nav__tab--active' : 'app-nav__tab'}
            onClick={goHub}
          >
            HOME
          </button>
          <button
            type="button"
            className={page === 'council' ? 'app-nav__tab app-nav__tab--active' : 'app-nav__tab'}
            onClick={goCouncil}
          >
            ⚔ MARKET
          </button>
          <button
            type="button"
            className={page === 'warriors' ? 'app-nav__tab app-nav__tab--active' : 'app-nav__tab'}
            onClick={goWarriors}
          >
            PULSE
          </button>
          <button
            type="button"
            className={page === 'spx' ? 'app-nav__tab app-nav__tab--active' : 'app-nav__tab'}
            onClick={goSpx}
          >
            SPX
          </button>
          <button
            type="button"
            className={page === 'fx' ? 'app-nav__tab app-nav__tab--active' : 'app-nav__tab'}
            onClick={goFx}
            style={{ color: page === 'fx' ? '#38bdf8' : undefined }}
          >
            FX
          </button>
          <button
            type="button"
            className={page === 'ict' ? 'app-nav__tab app-nav__tab--active' : 'app-nav__tab'}
            onClick={goIct}
            style={{ color: page === 'ict' ? '#a78bfa' : undefined }}
          >
            ICT
          </button>
          <button
            type="button"
            className={page === 'crypto' ? 'app-nav__tab app-nav__tab--active' : 'app-nav__tab'}
            onClick={goCrypto}
            style={{ color: page === 'crypto' ? '#00ff88' : undefined }}
          >
            BTC
          </button>
          <button
            type="button"
            className={page === 'warrior' ? 'app-nav__tab app-nav__tab--active' : 'app-nav__tab'}
            onClick={goWarrior}
          >
            COUNCIL
          </button>
          <button
            type="button"
            className={page === 'missionviz' ? 'app-nav__tab app-nav__tab--active' : 'app-nav__tab'}
            onClick={goMissionViz}
          >
            CONTROL
          </button>
          <button
            type="button"
            className={page === 'launchpad' ? 'app-nav__tab app-nav__tab--active' : 'app-nav__tab'}
            onClick={goLaunchPad}
            style={{ color: page === 'launchpad' ? '#f59e0b' : undefined }}
          >
            ⚡ OPT
          </button>
          <button
            type="button"
            className={page === 'boom' ? 'app-nav__tab app-nav__tab--active' : 'app-nav__tab'}
            onClick={goBoom}
          >
            BOOM
          </button>
          <button
            type="button"
            className={page === 'tradebot' ? 'app-nav__tab app-nav__tab--active' : 'app-nav__tab'}
            onClick={goTradeBot}
          >
            TRADE🔥
          </button>
        </nav>
      </header>

      <aside className="app-rail" aria-label="Quick pages (synced with header)">
        {MISSION_NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              page === item.id ? 'app-rail__btn app-rail__btn--active' : 'app-rail__btn'
            }
            title={item.label}
            aria-label={item.label}
            aria-current={page === item.id ? 'page' : undefined}
            onClick={() => navigateTo(item.id)}
          >
            <span className="app-rail__icon" aria-hidden>
              {item.icon}
            </span>
            <span className="app-rail__label">{item.label}</span>
          </button>
        ))}
      </aside>

      {mobilePagesOpen && (
        <button
          type="button"
          className="app-mobile-drawer__backdrop"
          aria-label="Close pages menu"
          onClick={() => setMobilePagesOpen(false)}
        />
      )}
      <div
        className={
          mobilePagesOpen
            ? 'app-mobile-drawer app-mobile-drawer--open'
            : 'app-mobile-drawer'
        }
        role="dialog"
        aria-modal="true"
        aria-label="All pages"
      >
        <div className="app-mobile-drawer__head">
          <span>MISSION · PAGES</span>
          <button
            type="button"
            className="app-mobile-drawer__close"
            aria-label="Close"
            onClick={() => setMobilePagesOpen(false)}
          >
            ×
          </button>
        </div>
        <nav className="app-mobile-drawer__list" aria-label="Choose page">
          {MISSION_NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={
                page === item.id
                  ? 'app-mobile-drawer__item app-mobile-drawer__item--active'
                  : 'app-mobile-drawer__item'
              }
              onClick={() => navigateTo(item.id)}
            >
              <span className="app-mobile-drawer__ico" aria-hidden>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <nav className="app-mobile-bar" aria-label="Quick pages">
        {MISSION_NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              page === item.id
                ? 'app-mobile-bar__btn app-mobile-bar__btn--active'
                : 'app-mobile-bar__btn'
            }
            aria-current={page === item.id ? 'page' : undefined}
            title={item.label}
            aria-label={item.label}
            onClick={() => navigateTo(item.id)}
          >
            <span className="app-mobile-bar__icon" aria-hidden>
              {item.icon}
            </span>
            <span className="app-mobile-bar__cap">{item.shortLabel}</span>
          </button>
        ))}
      </nav>

      <main className="app-main">{main}</main>
    </div>
    </WarriorMobileSyncProvider>
  );
}
