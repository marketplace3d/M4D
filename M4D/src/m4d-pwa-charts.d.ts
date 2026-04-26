/**
 * Ambient typings for Vite-aliased PWA modules (`@pwa/lib/*`, `$indicators/*`).
 * Implementation lives under `pwa/` and `indicators/`; we avoid compiling those
 * trees with MISSION's stricter `tsc` options.
 */
declare module '$indicators/boom3d-tech' {
  export type Bar = {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
}

declare module '@pwa/lib/chartControls' {
  export type ChartControls = {
    masterOn: boolean;
    showBB: boolean;
    showKC: boolean;
    showMas: boolean;
    showSar: boolean;
    squeezeLinesGreen: boolean;
    squeezePurpleBg: boolean;
    showSqueeze: boolean;
    showDarvas: boolean;
    showCouncilArrows: boolean;
    minVote: number;
    showFvg: boolean;
    fvgMaxDisplay: number;
    showOrderBlocks: boolean;
    showSwingRays: boolean;
    showSessionLevels: boolean;
    useMockSentiment: boolean;
    showVoteDots: boolean;
    showIchimoku: boolean;
    showGrid: boolean;
    showPoc: boolean;
    showVwap: boolean;
    sigOpacity: number;
    squeezePurpleOpacity: number;
    sigMode: 'balanced' | 'strict';
    sigRvolMin: number;
    sigAtrExpandMin: number;
    sigBreakAtrFrac: number;
    safetyDefenseOn: boolean;
    showLt: boolean;
    showLt2: boolean;
    showLt3: boolean;
  };
  export const defaultControls: ChartControls;
  export const defaultControlsAllOff: ChartControls;
  export function loadControls(): ChartControls;
  export function saveControls(c: ChartControls): void;
  export function setSigLayers(c: ChartControls, on: boolean): ChartControls;
  export function setMasLayer(c: ChartControls, on: boolean): ChartControls;
}

declare module '@pwa/lib/chartTimeframes' {
  export type TimeframePreset = '1d1m' | '5d5m' | '1m15m' | '1y1d';
  export const TIMEFRAME_OPTIONS: { id: TimeframePreset; label: string }[];
  export function loadTimeframe(): TimeframePreset;
  export function saveTimeframe(tf: TimeframePreset): void;
}

declare module '@pwa/lib/fetchBars' {
  import type { Bar } from '$indicators/boom3d-tech';
  export type ChartSymbol = string;
  export const SYMBOLS: { id: ChartSymbol; label: string; polygon: string; note?: string }[];
  export function fetchBarsForSymbol(
    sym: ChartSymbol,
    vitePolygonKey?: string | undefined,
    preset?: import('@pwa/lib/chartTimeframes').TimeframePreset,
  ): Promise<Bar[]>;
}

declare module '@pwa/lib/chartStripSymbol' {
  import type { ChartSymbol } from '@pwa/lib/fetchBars';
  export type ChartStripId = 'spx' | 'fx' | 'ict' | 'btc';
  export function defaultSymbolForStrip(id: ChartStripId): ChartSymbol;
  export function loadChartStripSymbol(id: ChartStripId): ChartSymbol | null;
  export function saveChartStripSymbol(id: ChartStripId, sym: ChartSymbol): void;
}

declare module '@pwa/lib/computePriceTargets' {
  import type { Bar } from '$indicators/boom3d-tech';
  export type TargetBucket = 'vp' | 'sess' | 'ob' | 'liq';
  export type PriceTargetRow = {
    id: string;
    label: string;
    price: number;
    rating: number;
    bucket: TargetBucket;
    sources: string[];
  };
  export type LiquidityThermalResult = {
    levels: number[];
    volBins: number[];
    pocIdx: number;
    poc: number;
    hvnsAbove: number[];
    hvnsBelow: number[];
    buyLiqPct: number;
    sellLiqPct: number;
    imbalance: number;
    rangeHigh: number;
    rangeLow: number;
  };
  export function computePriceTargets(bars: Bar[]): {
    targets: PriceTargetRow[];
    lastClose: number;
    atr: number;
    lt: LiquidityThermalResult | null;
  };
  export function formatTargetPrice(p: number): string;
}

declare module '@pwa/lib/obiChartHeatTargets' {
  import type { Bar } from '$indicators/boom3d-tech';
  import type { LiquidityThermalResult, PriceTargetRow } from '@pwa/lib/computePriceTargets';

  export type ObiLineDensity = 3 | 7 | 'multi';
  export type ObiLineSpread = 'normal' | 'wide';
  export type ObiLineOpts = { show: boolean; density: ObiLineDensity; spread: ObiLineSpread };
  export type HeatTargetLite = { price: number; tier: string };

  export function buildObiChartHeatTargets(
    bars: Bar[],
    lt: LiquidityThermalResult | null,
    targetRows: PriceTargetRow[],
    packAtr: number,
    opts: ObiLineOpts,
  ): HeatTargetLite[];
}

declare module '@pwa/lib/obiBoomMinimalControls' {
  import type { ChartControls } from '@pwa/lib/chartControls';
  export function obiBoomMinimalControls(c: ChartControls): ChartControls;
}

declare module '@pwa/lib/boomChartBuild' {
  import type { Bar } from '$indicators/boom3d-tech';
  import type { ChartControls } from '@pwa/lib/chartControls';
  import type { IChartApi, LogicalRange } from 'lightweight-charts';

  export type MountBoomChartOpts = {
    snapToLatest?: boolean;
    initialLogicalRange?: LogicalRange | null;
    compactUi?: boolean;
    symbol?: string;
    polygonKey?: string;
  };

  export function mountBoomChart(
    el: HTMLElement,
    bars: Bar[],
    controls: ChartControls,
    opts?: MountBoomChartOpts,
  ): Promise<{ chart: IChartApi; ro: ResizeObserver }>;
}

declare module '@pwa/lib/oracleSnapshot' {
  export function buildOracleSnapshot(...args: any[]): any;
}

declare module '@pwa/lib/mmBrain' {
  export type MMPhase = 'ACCUMULATION' | 'MANIPULATION' | 'DISPLACEMENT' | 'DISTRIBUTION';
  export type MMPrediction = any;
  export function computeMMBrain(...args: any[]): any;
}

declare module '*.jsx' {
  export const XSentinelOrb: any;
  export const CouncilOrb: any;
  export const JediMasterOrb: any;
  const Component: any;
  export default Component;
}

declare module '../viz/SocialAlphaPulse' {
  const Component: any;
  export default Component;
}

declare module '@pwa/lib/coTraderSignal' {
  export type CoTraderSignal = unknown;
  export function computeCoTraderSignal(...args: any[]): any;
}

declare module '@pwa/lib/ictLiquiditySynthesis' {
  import type { Bar } from '$indicators/boom3d-tech';
  import type { MMPrediction } from '@pwa/lib/mmBrain';
  import type { CoTraderSignal } from '@pwa/lib/coTraderSignal';
  import type { PriceTargetRow } from '@pwa/lib/computePriceTargets';

  export type IctLevelClass = 'ERL' | 'IRL_RANGE' | 'IRL_INNER' | 'VALUE' | 'MICRO';
  export type IctUnifiedLevel = {
    price: number;
    kind: string;
    class: IctLevelClass;
    gravity: number;
    proxPct: number;
    dir: 'above' | 'below' | 'at';
    sources: string[];
  };
  export type IctNextStop = {
    price: number | null;
    kind: string;
    ictClass: IctLevelClass;
    distAtr: number;
    source: 'MM_BRAIN' | 'ERL_DRAW' | 'FALLBACK';
  };
  export type IctDirectionPriority = {
    bias: 'BULL' | 'BEAR' | 'NEUTRAL';
    rawStrength: number;
    strength: number;
    drivers: string[];
  };
  export type IctSynthesisResult = {
    asset: string;
    tf: string;
    timestamp: number;
    price: number;
    atr: number;
    levels: IctUnifiedLevel[];
    primaryNextStop: IctNextStop;
    nextErlInBias: IctNextStop;
    direction: IctDirectionPriority;
    snapshot: unknown;
    mm: MMPrediction;
    coTrader: CoTraderSignal;
    targets: PriceTargetRow[];
    dataGaps: string[];
    councilContext: string;
    councilCompact: boolean;
    mtfLevelCount: number;
  };
  export type IctSynthesisOptions = {
    asset?: string;
    tf?: string;
    dailyBars?: Bar[];
    compact?: boolean;
  };
  /** `dailyBars` enables PWH/PWL/PMH/PML/PQH/PQL in Oracle + ERL classification */
  export function computeIctSynthesis(
    bars: Bar[],
    opts?: IctSynthesisOptions,
  ): IctSynthesisResult;
}

