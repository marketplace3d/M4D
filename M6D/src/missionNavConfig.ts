/** Route ids for MISSION shell — single source for synced nav (rail, mobile bar, drawer). */
export type MissionPage =
  | 'hub'
  | 'council'
  | 'warriors'
  | 'algos'
  | 'boom'
  | 'spx'
  | 'fx'
  | 'ict'
  | 'ict-old'
  | 'chartslive'
  | 'tradebot'
  | 'testlab'
  | 'warrior'
  | 'missionviz'
  | 'flowmaps'
  | 'crypto'
  | 'footplate'
  | 'launchpad';

export const MISSION_NAV_ITEMS = [
  { id: 'hub' as const,        label: 'HOME',      shortLabel: 'HOME',   icon: '⌂'  },
  { id: 'council' as const,    label: 'MARKET',    shortLabel: 'MKT',    icon: '⚔'  },
  { id: 'warriors' as const,   label: 'PULSE',     shortLabel: 'PUL',    icon: '27' },
  { id: 'spx' as const,        label: 'SPX',       shortLabel: 'SPX',    icon: '📈' },
  { id: 'fx' as const,          label: 'FX',        shortLabel: 'FX',     icon: '€'  },
  { id: 'ict' as const,        label: 'ICT',       shortLabel: 'ICT',    icon: '◈'  },
  { id: 'ict-old' as const,    label: 'ICT·OLD',   shortLabel: 'I·O',    icon: '◇'  },
  { id: 'crypto' as const,     label: 'BTC',       shortLabel: 'BTC',    icon: '₿'  },
  { id: 'warrior' as const,    label: 'COUNCIL',   shortLabel: 'CNC',    icon: '⚔'  },
  { id: 'missionviz' as const, label: 'CONTROL',   shortLabel: 'CTL',    icon: '🛡' },
  { id: 'launchpad' as const,  label: '⚡ OPT',     shortLabel: 'OPT',    icon: '⚡' },
  { id: 'footplate' as const,  label: '🚂 ENGINE', shortLabel: '🚂',     icon: '🚂' },
  { id: 'boom' as const,       label: 'BOOM',      shortLabel: 'BOOM',   icon: '✦'  },
  { id: 'tradebot' as const,   label: 'TRADE🔥',  shortLabel: 'T🔥',    icon: '🔥' },
] as const;
