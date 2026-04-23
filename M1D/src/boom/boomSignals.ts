/** BOOM expansion layer — 10 weighted signals (example / mock). */

export type BoomSignal = {
  rank: number;
  id: string;
  label: string;
  icon: string;
  color: string;
  glow: string;
  desc: string;
  formula: string;
  weight: number;
};

export const BOOM_SIGNALS: BoomSignal[] = [
  {
    rank: 1,
    id: 'vol_surge',
    label: 'VOL SURGE',
    icon: '🚀',
    color: '#00ff88',
    glow: '#00ff8866',
    desc: 'Vol explosion post heat',
    formula: 'vol > SMA(20) × 2.5',
    weight: 20,
  },
  {
    rank: 2,
    id: 'trend_heat',
    label: 'TREND HEAT',
    icon: '🥵',
    color: '#ff4500',
    glow: '#ff450066',
    desc: '5m + 15m + Daily stack',
    formula: 'MTF momentum align',
    weight: 18,
  },
  {
    rank: 3,
    id: 'daily_bias',
    label: 'DAILY BIAS',
    icon: '📐',
    color: '#00cfff',
    glow: '#00cfff66',
    desc: 'Price vs prev day H/L',
    formula: 'close > prev_high → BULL',
    weight: 14,
  },
  {
    rank: 4,
    id: 'cog',
    label: 'CoG CONNECT',
    icon: '🧠',
    color: '#b388ff',
    glow: '#b388ff66',
    desc: 'Centre of Gravity cross',
    formula: 'CoG slope > threshold',
    weight: 13,
  },
  {
    rank: 5,
    id: 'money_flow',
    label: 'MONEY FLOW',
    icon: '💸',
    color: '#ffd600',
    glow: '#ffd60066',
    desc: 'Cumulative delta surge',
    formula: 'Σ vol×(close−open)',
    weight: 11,
  },
  {
    rank: 6,
    id: 'grok',
    label: 'GROK SCORE',
    icon: '⚡',
    color: '#ff6ec7',
    glow: '#ff6ec766',
    desc: 'AI confluence check',
    formula: 'score ≥ 8/10',
    weight: 10,
  },
  {
    rank: 7,
    id: 'sentiment',
    label: 'X SENTIMENT',
    icon: '📡',
    color: '#40e0d0',
    glow: '#40e0d066',
    desc: 'Retail + whale chatter',
    formula: 'sentiment_spike > 2σ',
    weight: 6,
  },
  {
    rank: 8,
    id: 'target_cluster',
    label: 'TARGET CLUSTER',
    icon: '🎯',
    color: '#ff9800',
    glow: '#ff980066',
    desc: 'Multi-level confluence',
    formula: 'H/L + pivot + FVG <0.5%',
    weight: 4,
  },
  {
    rank: 9,
    id: 'news',
    label: 'MACRO NEWS',
    icon: '📰',
    color: '#a5d6a7',
    glow: '#a5d6a766',
    desc: 'Non-gamed catalyst',
    formula: 'Grok RSS parse',
    weight: 3,
  },
  {
    rank: 10,
    id: 'audio',
    label: 'ENERGY CUE',
    icon: '🔊',
    color: '#ef9a9a',
    glow: '#ef9a9a66',
    desc: 'Audible energy rise',
    formula: 'threshold trigger → tone',
    weight: 1,
  },
];

export type SimSignalSlice = {
  active: boolean;
  strength: number;
  value: string;
};
