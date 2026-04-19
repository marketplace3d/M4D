import { useCallback, useEffect, useRef, useState } from 'react';

export type BinanceStatus = 'idle' | 'connecting' | 'live' | 'error';
export type DomLevel = { price: number; qty: number };
export type DomSnap = { bids: DomLevel[]; asks: DomLevel[]; t: number; mid: number };
export type BinanceTrade = { t: number; price: number; qty: number; side: 'buy' | 'sell' };

export type BinanceObiSnapshot = {
  status: BinanceStatus;
  obiRatio: number;
  obiSmooth: number;
  bidDepth: number;
  askDepth: number;
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  domHistory: DomSnap[];
  trades: BinanceTrade[];
  errorMsg: string;
};

const HISTORY_MAX = 240;  // 24 seconds at 100ms
const TRADES_MAX = 200;
const SMOOTH = 0.08;

const INIT: BinanceObiSnapshot = {
  status: 'idle', obiRatio: 0.5, obiSmooth: 0.5,
  bidDepth: 0, askDepth: 0, bestBid: 0, bestAsk: 0, midPrice: 0,
  domHistory: [], trades: [], errorMsg: '',
};

// BTC → btcusdt, ETH → ethusdt, BTCUSDT → btcusdt
function toBinancePair(sym: string): string {
  const s = sym.toUpperCase();
  if (s.endsWith('USDT')) return s.toLowerCase();
  if (s.endsWith('USD')) return s.toLowerCase() + 't';
  return s.toLowerCase() + 'usdt';
}

export function useBinanceObiStream(sym: string, enabled = true): BinanceObiSnapshot {
  const [snap, setSnap] = useState<BinanceObiSnapshot>(INIT);
  const stateRef = useRef<BinanceObiSnapshot>(INIT);

  const patch = useCallback((delta: Partial<BinanceObiSnapshot>) => {
    stateRef.current = { ...stateRef.current, ...delta };
    setSnap({ ...stateRef.current });
  }, []);

  useEffect(() => {
    if (!enabled || !sym) {
      patch({ ...INIT, status: 'idle' });
      return;
    }

    const pair = toBinancePair(sym);
    const url = `wss://stream.binance.com:9443/stream?streams=${pair}@depth20@100ms/${pair}@trade`;

    stateRef.current = { ...INIT, status: 'connecting' };
    setSnap(stateRef.current);
    let alive = true;
    let ws: WebSocket | null = new WebSocket(url);

    ws.onopen = () => alive && patch({ status: 'live' });

    ws.onmessage = (ev: MessageEvent<unknown>) => {
      if (!alive) return;
      let envelope: { stream: string; data: Record<string, unknown> };
      try { envelope = JSON.parse(String(ev.data)) as typeof envelope; }
      catch { return; }

      const { stream, data: d } = envelope;

      if (stream.includes('@depth')) {
        const rawBids = (d.bids ?? []) as [string, string][];
        const rawAsks = (d.asks ?? []) as [string, string][];

        // Binance bids sorted desc (best bid first), asks sorted asc (best ask first)
        const bids: DomLevel[] = rawBids.slice(0, 10).map(([p, q]) => ({ price: +p, qty: +q }));
        const asks: DomLevel[] = rawAsks.slice(0, 10).map(([p, q]) => ({ price: +p, qty: +q }));

        const bestBid = bids[0]?.price ?? 0;
        const bestAsk = asks[0]?.price ?? 0;
        const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : stateRef.current.midPrice;

        const bidDepth = bids.reduce((s, l) => s + l.qty, 0);
        const askDepth = asks.reduce((s, l) => s + l.qty, 0);
        const total = bidDepth + askDepth;
        const rawRatio = total > 0 ? bidDepth / total : 0.5;
        const smooth = stateRef.current.obiSmooth * (1 - SMOOTH) + rawRatio * SMOOTH;

        const domSnap: DomSnap = { bids, asks, t: Date.now(), mid };
        const domHistory = [...stateRef.current.domHistory, domSnap].slice(-HISTORY_MAX);

        patch({ obiRatio: rawRatio, obiSmooth: smooth, bidDepth, askDepth, bestBid, bestAsk, midPrice: mid, domHistory });
        return;
      }

      if (stream.includes('@trade')) {
        const price = +(d.p ?? 0);
        const qty = +(d.q ?? 0);
        const t = Number(d.T ?? Date.now());
        // m: true → buyer is market maker → sell aggressor hit the bid
        // m: false → seller is market maker → buy aggressor hit the ask
        const side: 'buy' | 'sell' = d.m === true ? 'sell' : 'buy';
        const trades = [...stateRef.current.trades, { t, price, qty, side }].slice(-TRADES_MAX);
        patch({ trades });
      }
    };

    ws.onerror = () => alive && patch({ status: 'error', errorMsg: 'Binance WS error' });
    ws.onclose = () => {
      if (!alive) return;
      if (stateRef.current.status === 'live') patch({ status: 'error', errorMsg: 'connection closed' });
    };

    return () => {
      alive = false;
      try { ws?.close(); } catch { /* noop */ }
      ws = null;
      stateRef.current = { ...INIT };
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, enabled]);

  return snap;
}
