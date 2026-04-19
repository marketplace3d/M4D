/** UI toggles — persisted in localStorage (+ sessionStorage mirror for legacy) */
export type ChartControls = {
  /** Master: when false, hide all overlays (candles only). */
  masterOn: boolean;
  showBB: boolean;
  showKC: boolean;
  /** EMA 38/62 — default off per UX */
  showMas: boolean;
  showSar: boolean;
  /** Squeeze box lines (BOOM3D) — faint green when on */
  squeezeLinesGreen: boolean;
  /** Full-height purple tint (~10% opacity) during squeeze (no-trade zone) */
  squeezePurpleBg: boolean;
  /** BOOM squeeze channel: boxHighPlot/boxLowPlot lines + trend fill (aqua/red/purple) */
  showSqueeze: boolean;
  showDarvas: boolean;
  /** Arrows = Darvas breakout + council vote ≥ minVote (not raw SlingShot) */
  showCouncilArrows: boolean;
  minVote: number;
  /** Fair value gap horizontal heat zones (bull cyan / bear orange) */
  showFvg: boolean;
  /** How many FVG zones to render (most recent in combined list; caps chart noise). */
  fvgMaxDisplay: number;
  /** SMC-style order-block bodies (demand/supply) extended to now */
  showOrderBlocks: boolean;
  /** Fractal swing highs/lows as dashed horizontal rays */
  showSwingRays: boolean;
  showSessionLevels: boolean;
  /** Mock X/sentiment 0–1 (wire API later). Env VITE_MOCK_SENTIMENT */
  useMockSentiment: boolean;
  /** Council score dots (circle, in-bar) — hue by vote strength */
  showVoteDots: boolean;
  /** Ichimoku Senkou cloud (A/B fill + span lines); not gated by master */
  showIchimoku: boolean;
  /** Price/time grid lines (Lightweight Charts grid) */
  showGrid: boolean;
  /** POC — volume-weighted centroid line on price chart (volume heat) */
  showPoc: boolean;
  /** VWAP + SD1 bands on price chart */
  showVwap: boolean;
  /** 0..100 — SIG overlay opacity (0 = transparent, 100 = full strength). */
  sigOpacity: number;
  /** 0..100 — purple squeeze background opacity only. */
  squeezePurpleOpacity: number;
  /** SIG profile: BAL (more signals) vs STR (stricter confirmations). */
  sigMode: 'balanced' | 'strict';
  /** RVOL minimum for SIG breakout confirmation. */
  sigRvolMin: number;
  /** ATR expansion multiplier minimum for SIG breakout confirmation. */
  sigAtrExpandMin: number;
  /** Minimum breakout distance as ATR fraction. */
  sigBreakAtrFrac: number;
  /** Safety defence protocol: stricter confirmation for capital protection mode. */
  safetyDefenseOn: boolean;
  /** Liquidity Thermal heatmap (300-bar, 31-bin BigBeluga-style) */
  showLt: boolean;
  /** Session killzone background bands: London Open (08-10 UTC) + NY Open (14-16 UTC) */
  showKillzones: boolean;
  /** Equal Highs / Equal Lows — ICT liquidity pool magnets */
  showEqualLevels: boolean;
  /** Breaker Blocks — mitigated OBs that flipped polarity */
  showBreakerBlocks: boolean;
  /** Volume bubbles at High Volume Node price levels */
  showVolBubbles: boolean;
  /** MM Brain — next MM stop line + phase label on chart */
  showMmBrain: boolean;
};

export const defaultControls: ChartControls = {
  masterOn: true,
  showBB: true,
  showKC: true,
  showMas: false,
  showSar: true,
  squeezeLinesGreen: true,
  squeezePurpleBg: true,
  showSqueeze: true,
  showDarvas: false,
  showCouncilArrows: true,
  minVote: 6,
  showFvg: true,
  fvgMaxDisplay: 28,
  showOrderBlocks: true,
  showSwingRays: true,
  showSessionLevels: true,
  useMockSentiment: true,
  showVoteDots: true,
  showIchimoku: true,
  showGrid: true,
  showPoc: true,
  showVwap: true,
  sigOpacity: 50,
  squeezePurpleOpacity: 22,
  sigMode: 'balanced',
  sigRvolMin: 1.65,
  sigAtrExpandMin: 1.2,
  sigBreakAtrFrac: 0.03,
  safetyDefenseOn: false,
  showLt: true,
  showKillzones: true,
  showEqualLevels: true,
  showBreakerBlocks: true,
  showVolBubbles: true,
  showMmBrain: true,
};

/** Every layer off — bare OHLC + max vertical fit (see chart `scaleMargins`). */
export const defaultControlsAllOff: ChartControls = {
  masterOn: false,
  showBB: false,
  showKC: false,
  showMas: false,
  showSar: false,
  squeezeLinesGreen: false,
  squeezePurpleBg: false,
  showSqueeze: false,
  showDarvas: false,
  showCouncilArrows: false,
  minVote: 6,
  showFvg: false,
  fvgMaxDisplay: 28,
  showOrderBlocks: false,
  showSwingRays: false,
  showSessionLevels: false,
  useMockSentiment: false,
  showVoteDots: false,
  showIchimoku: false,
  showGrid: false,
  showPoc: false,
  showVwap: false,
  sigOpacity: 50,
  squeezePurpleOpacity: 22,
  sigMode: 'balanced',
  sigRvolMin: 1.65,
  sigAtrExpandMin: 1.2,
  sigBreakAtrFrac: 0.03,
  safetyDefenseOn: false,
  showLt: false,
  showKillzones: false,
  showEqualLevels: false,
  showBreakerBlocks: false,
  showVolBubbles: false,
  showMmBrain: false,
};

const KEY = 'm4d-chart-controls';

export function loadControls(): ChartControls {
  if (typeof window === 'undefined') return { ...defaultControls };
  try {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      /* private mode */
    }
    if (!raw) {
      try {
        raw = sessionStorage.getItem(KEY);
      } catch {
        /* ignore */
      }
    }
    if (!raw) return { ...defaultControls };
    const p = JSON.parse(raw) as Partial<ChartControls> & { sigFaint?: number };
    const mv = Number(p.minVote);
    const op = Number(p.sigOpacity);
    const legacyFaint = Number(p.sigFaint);
    const purpleOp = Number(p.squeezePurpleOpacity);
    const sigRvolMinRaw = Number((p as Partial<ChartControls>).sigRvolMin);
    const sigAtrExpandMinRaw = Number((p as Partial<ChartControls>).sigAtrExpandMin);
    const sigBreakAtrFracRaw = Number((p as Partial<ChartControls>).sigBreakAtrFrac);
    const fvgMaxDisplayRaw = Number((p as Partial<ChartControls>).fvgMaxDisplay);
    const safetyDefenseOn = p.safetyDefenseOn === true;
    let sigOpacity = defaultControls.sigOpacity;
    if (Number.isFinite(op)) {
      sigOpacity = Math.max(0, Math.min(100, op));
    } else if (Number.isFinite(legacyFaint)) {
      sigOpacity = Math.max(0, Math.min(100, 100 - legacyFaint));
    }
    const squeezePurpleOpacity = Number.isFinite(purpleOp)
      ? Math.max(0, Math.min(100, purpleOp))
      : defaultControls.squeezePurpleOpacity;
    const sigMode =
      p.sigMode === 'strict' || p.sigMode === 'balanced'
        ? p.sigMode
        : defaultControls.sigMode;
    const sigRvolMin = Number.isFinite(sigRvolMinRaw)
      ? Math.max(1, Math.min(2.5, sigRvolMinRaw))
      : defaultControls.sigRvolMin;
    const sigAtrExpandMin = Number.isFinite(sigAtrExpandMinRaw)
      ? Math.max(1, Math.min(2, sigAtrExpandMinRaw))
      : defaultControls.sigAtrExpandMin;
    const sigBreakAtrFrac = Number.isFinite(sigBreakAtrFracRaw)
      ? Math.max(0.01, Math.min(0.3, sigBreakAtrFracRaw))
      : defaultControls.sigBreakAtrFrac;
    const fvgMaxDisplay = Number.isFinite(fvgMaxDisplayRaw)
      ? Math.max(4, Math.min(80, Math.round(fvgMaxDisplayRaw)))
      : defaultControls.fvgMaxDisplay;
    const { sigFaint: _legacyDrop, ...rest } = p;
    void _legacyDrop;
    return {
      ...defaultControls,
      ...rest,
      minVote: mv === 6 || mv === 7 ? mv : defaultControls.minVote,
      sigOpacity,
      squeezePurpleOpacity,
      sigMode,
      sigRvolMin,
      sigAtrExpandMin,
      sigBreakAtrFrac,
      fvgMaxDisplay,
      safetyDefenseOn,
      showLt: p.showLt !== false,   // default ON — only off if explicitly saved false
    };
  } catch {
    return { ...defaultControls };
  }
}

/** FVG + OB + swing rays + OR/PDH/PDL — “SIG levels” group. */
export function setSigLayers(c: ChartControls, on: boolean): ChartControls {
  return {
    ...c,
    showFvg: on,
    showOrderBlocks: on,
    showSwingRays: on,
    showSessionLevels: on,
  };
}

/** EMA 38/62 ribbon lines. */
export function setMasLayer(c: ChartControls, on: boolean): ChartControls {
  return { ...c, showMas: on };
}

export function saveControls(c: ChartControls) {
  const json = JSON.stringify(c);
  try {
    localStorage.setItem(KEY, json);
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.setItem(KEY, json);
  } catch {
    /* ignore */
  }
}
