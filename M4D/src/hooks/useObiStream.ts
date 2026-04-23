import { useCallback, useEffect, useRef, useState } from 'react';

export type ObiStatus = 'idle' | 'connecting' | 'auth' | 'live' | 'error' | 'unsupported';
export type ObiTick = { t: number; ratio: number };
export type TradeTick = { t: number; price: number; size: number; side: 'buy' | 'sell' | 'neutral' };

export type ObiSnapshot = {
  status: ObiStatus;
  obiRatio: number;
  obiSmooth: number;
  bidSize: number;
  askSize: number;
  bidPrice: number;
  askPrice: number;
  history: ObiTick[];
  trades: TradeTick[];
  errorMsg: string;
};

const HISTORY_MAX = 300;
const TRADES_MAX = 150;
const SMOOTH = 0.12;

const INIT: ObiSnapshot = {
  status: 'idle', obiRatio: 0.5, obiSmooth: 0.5,
  bidSize: 0, askSize: 0, bidPrice: 0, askPrice: 0,
  history: [], trades: [], errorMsg: '',
};

type EndpointCfg = {
  wsUrl: string;
  quoteSub: string;
  tradeSub: string | null;
  quoteEv: string;
  tradeEv: string | null;
};

const CRYPTO_SYMS = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'MATIC', 'DOT']);
const FUTURES_SYMS = new Set(['ES', 'NQ', 'MES', 'MNQ', 'YM', 'RTY', 'CL', 'GC', 'SI']);
const FOREX_MAP: Record<string, string> = {
  EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY',
  USDCHF: 'USD/CHF', AUDUSD: 'AUD/USD', USDCAD: 'USD/CAD',
  NZDUSD: 'NZD/USD', XAUUSD: 'XAU/USD', XAGUSD: 'XAG/USD',
};

function resolveEndpoint(sym: string): EndpointCfg | null {
  if (FUTURES_SYMS.has(sym)) return null;
  if (CRYPTO_SYMS.has(sym)) {
    return { wsUrl: 'wss://socket.polygon.io/crypto', quoteSub: `XQ.${sym}-USD`, tradeSub: `XT.${sym}-USD`, quoteEv: 'XQ', tradeEv: 'XT' };
  }
  const forexPair = FOREX_MAP[sym];
  if (forexPair) {
    return { wsUrl: 'wss://socket.polygon.io/forex', quoteSub: `C.${forexPair}`, tradeSub: null, quoteEv: 'C', tradeEv: null };
  }
  return { wsUrl: 'wss://socket.polygon.io/stocks', quoteSub: `Q.${sym}`, tradeSub: `T.${sym}`, quoteEv: 'Q', tradeEv: 'T' };
}

export function useObiStream(sym: string, apiKey: string | undefined, enabled = true): ObiSnapshot {
  const [snap, setSnap] = useState<ObiSnapshot>(INIT);
  const stateRef = useRef<ObiSnapshot>(INIT);

  const patch = useCallback((delta: Partial<ObiSnapshot>) => {
    stateRef.current = { ...stateRef.current, ...delta };
    setSnap({ ...stateRef.current });
  }, []);

  useEffect(() => {
    if (!enabled || !apiKey || !sym) {
      patch({ ...INIT, status: 'idle' });
      return;
    }
    const cfg = resolveEndpoint(sym);
    if (!cfg) {
      patch({ ...INIT, status: 'unsupported', errorMsg: `${sym}: futures need IBKR — Polygon doesn't cover` });
      return;
    }

    stateRef.current = { ...INIT, status: 'connecting' };
    setSnap(stateRef.current);

    let alive = true;
    let ws: WebSocket | null = new WebSocket(cfg.wsUrl);

    ws.onmessage = (ev: MessageEvent<unknown>) => {
      if (!alive) return;
      let msgs: unknown[];
      try { msgs = JSON.parse(String(ev.data)) as unknown[]; } catch { return; }
      if (!Array.isArray(msgs)) return;

      for (const raw of msgs) {
        if (typeof raw !== 'object' || raw === null) continue;
        const msg = raw as Record<string, unknown>;

        if (msg.ev === 'status') {
          const s = String(msg.status ?? '');
          if (s === 'connected') {
            ws?.send(JSON.stringify({ action: 'auth', params: apiKey }));
          } else if (s === 'auth_success') {
            patch({ status: 'auth' });
            const subs = [cfg.quoteSub, cfg.tradeSub].filter(Boolean).join(',');
            ws?.send(JSON.stringify({ action: 'subscribe', params: subs }));
          } else if (s === 'success') {
            patch({ status: 'live' });
          } else if (s === 'auth_failed') {
            patch({ status: 'error', errorMsg: 'auth failed — check Polygon key' });
          }
          continue;
        }

        // Quote event — stocks Q, crypto XQ, forex C
        if (msg.ev === cfg.quoteEv) {
          // stocks: bp/bs/ap/as — crypto: bp/bs/ap/as — forex: b/bs/a/as
          const bp = Number(msg.bp ?? msg.b ?? 0);
          const bs = Number(msg.bs ?? 0);
          const ap = Number(msg.ap ?? msg.a ?? 0);
          const as_ = Number(msg.as ?? 0);
          const t = Number(msg.t ?? Date.now());
          const total = bs + as_;
          const rawRatio = total > 0 ? bs / total : 0.5;
          const prev = stateRef.current;
          const smooth = prev.obiSmooth * (1 - SMOOTH) + rawRatio * SMOOTH;
          const history = [...prev.history, { t, ratio: smooth }].slice(-HISTORY_MAX);
          patch({ obiRatio: rawRatio, obiSmooth: smooth, bidSize: bs, askSize: as_, bidPrice: bp, askPrice: ap, history });
          continue;
        }

        // Trade event — stocks T, crypto XT
        if (cfg.tradeEv && msg.ev === cfg.tradeEv) {
          const price = Number(msg.p ?? 0);
          const size = Number(msg.s ?? msg.size ?? 0);
          const t = Number(msg.t ?? Date.now());
          const { bidPrice, askPrice } = stateRef.current;
          const side: TradeTick['side'] =
            askPrice > 0 && price >= askPrice ? 'buy' :
            bidPrice > 0 && price <= bidPrice ? 'sell' : 'neutral';
          const trades = [...stateRef.current.trades, { t, price, size, side }].slice(-TRADES_MAX);
          patch({ trades });
        }
      }
    };

    ws.onerror = () => alive && patch({ status: 'error', errorMsg: 'WebSocket error' });
    ws.onclose = () => {
      if (!alive) return;
      if (stateRef.current.status === 'live') patch({ status: 'error', errorMsg: 'connection lost' });
    };

    return () => {
      alive = false;
      try { ws?.close(); } catch { /* noop */ }
      ws = null;
      stateRef.current = { ...INIT };
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, apiKey, enabled]);

  return snap;
}
