type Props = {
  onCouncil:    () => void;
  onLaunchPad:  () => void;
  onFootplate:  () => void;
  onWarriors:   () => void;
  onTradeBot:   () => void;
  onBoom:       () => void;
  onSpx:        () => void;
  onFx:         () => void;
  onCrypto: () => void;
  onWarrior:    () => void;
  onMissionViz: () => void;
};

const mono = "'JetBrains Mono', 'Fira Code', monospace";
const sans = "'IBM Plex Sans', system-ui, sans-serif";

interface DeckCard {
  icon: string;
  label: string;
  sub: string;
  hash: string;
  accent: string;
  onClick: () => void;
  primary?: boolean;
}

export default function MissionHub({
  onCouncil, onLaunchPad, onFootplate,
  onWarriors, onTradeBot, onBoom,
  onSpx, onFx, onCrypto, onWarrior, onMissionViz,
}: Props) {
  const primary: DeckCard[] = [
    { icon: '⚔', label: 'MARKET',     sub: '27-algo vote · 3 banks · JEDI master',       hash: '#market',    accent: '#60a5fa', onClick: onCouncil,   primary: true },
    { icon: '⚡', label: 'OPT',        sub: 'L · H · G · Elon 5-step decision engine',    hash: '#opt',       accent: '#f59e0b', onClick: onLaunchPad, primary: true },
    { icon: '🚂', label: 'ENGINE',     sub: 'Live pipeline · pressure gauges · proposals', hash: '#footplate', accent: '#22c55e', onClick: onFootplate, primary: true },
  ];

  const secondary: DeckCard[] = [
    { icon: '27', label: 'PULSE',     sub: '27-panel control room',    hash: '#pulse',     accent: '#a78bfa', onClick: onWarriors   },
    { icon: '🔥', label: 'TRADE',     sub: 'TSLA + market lanes',      hash: '#trade',     accent: '#f97316', onClick: onTradeBot   },
    { icon: '✦',  label: 'BOOM',      sub: 'Expansion signals',        hash: '#boom',      accent: '#34d399', onClick: onBoom       },
    { icon: '📈', label: 'SPX',       sub: 'S&P proxy strip · own symbol', hash: '#spx',       accent: '#6b7280', onClick: onSpx        },
    { icon: '€',  label: 'FX',        sub: 'Forex strip · same engine', hash: '#fx',       accent: '#38bdf8', onClick: onFx         },
    { icon: '₿',  label: 'BTC',       sub: 'Scanner · /crypto/live/ · WS ticks', hash: '#btc',    accent: '#00ff88', onClick: onCrypto },
    { icon: '⚔',  label: 'COUNCIL',   sub: 'XY Flow · Jedi graph',     hash: '#warrior',   accent: '#6b7280', onClick: onWarrior    },
    { icon: '🛡',  label: 'CONTROL',   sub: 'Spec · opt loop',          hash: '#control',   accent: '#6b7280', onClick: onMissionViz },
  ];

  return (
    <div style={{
      background: '#010409', color: '#e6edf3', minHeight: '100%',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '48px 24px 64px', fontFamily: sans,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&family=JetBrains+Mono:wght@400;700&display=swap');
        .hub-card { transition: transform 0.12s, border-color 0.12s, background 0.12s; cursor: pointer; }
        .hub-card:hover { transform: translateY(-2px); }
      `}</style>

      {/* Wordmark */}
      <div style={{ textAlign: 'center', marginBottom: 56 }}>
        <div style={{ fontFamily: mono, fontSize: 11, color: '#6b7280', letterSpacing: '0.18em', marginBottom: 10 }}>
          MAXCOGVIZ 4D
        </div>
        <h1 style={{ fontFamily: mono, fontSize: 52, fontWeight: 700, letterSpacing: '-0.04em', margin: 0, lineHeight: 1 }}>
          M4D
        </h1>
        <div style={{ fontFamily: mono, fontSize: 11, color: '#374151', letterSpacing: '0.12em', marginTop: 10 }}>
          27-ALGO ENSEMBLE · ELON ITER OP DECK · RUST + DJANGO
        </div>
      </div>

      {/* ── Primary deck ──────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, width: '100%', maxWidth: 820, marginBottom: 16 }}>
        {primary.map(c => (
          <button
            key={c.label}
            className="hub-card"
            onClick={c.onClick}
            style={{
              background: c.accent + '0d', border: `1.5px solid ${c.accent}44`,
              borderRadius: 12, padding: '28px 22px', textAlign: 'left',
              color: '#e6edf3', fontFamily: sans,
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 10 }}>{c.icon}</div>
            <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: c.accent, letterSpacing: '0.06em', marginBottom: 6 }}>
              {c.label}
            </div>
            <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.5 }}>{c.sub}</div>
            <div style={{ fontFamily: mono, fontSize: 9, color: '#374151', marginTop: 12 }}>{c.hash}</div>
          </button>
        ))}
      </div>

      {/* ── Secondary grid ────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, width: '100%', maxWidth: 820 }}>
        {secondary.map(c => (
          <button
            key={c.label}
            className="hub-card"
            onClick={c.onClick}
            style={{
              background: '#0d1117', border: '1px solid #21262d',
              borderRadius: 8, padding: '16px 16px', textAlign: 'left',
              color: '#e6edf3', fontFamily: sans,
            }}
          >
            <div style={{ fontSize: 16, marginBottom: 6 }}>{c.icon}</div>
            <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: c.accent, letterSpacing: '0.05em', marginBottom: 4 }}>
              {c.label}
            </div>
            <div style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.4 }}>{c.sub}</div>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div style={{ fontFamily: mono, fontSize: 9, color: '#21262d', marginTop: 48, letterSpacing: '0.1em' }}>
        127.0.0.1:5555
      </div>
    </div>
  );
}
