import { useEffect, useMemo, useRef, useState } from 'react';

export type SteamPhase = 'ACCUMULATION' | 'COMPRESSION' | 'POP'

export type ObPressure = {
  pressure: number;   // [-1..1], +buy / -sell
  confidence: number; // [0..1]
  delta: number;      // velocity: Δ of EMA pressure
  deltaD: number;     // acceleration: ΔΔ (delta of delta)
  phase: SteamPhase;
  exhausted: boolean; // high abs pressure + ΔΔ turning negative → climax
  status: 'idle' | 'live' | 'error';
};

const INIT: ObPressure = { pressure: 0, confidence: 0, delta: 0, deltaD: 0, phase: 'ACCUMULATION', exhausted: false, status: 'idle' };

function toPhase(pressure: number, exhausted: boolean): SteamPhase {
  if (exhausted) return 'POP'
  if (Math.abs(pressure) > 0.28) return 'COMPRESSION'
  return 'ACCUMULATION'
}

function toForexPair(sym: string): string | null {
  const s = sym.toUpperCase();
  if (s === 'EURUSD') return 'EUR/USD';
  if (s === 'GBPUSD') return 'GBP/USD';
  if (s === 'USDJPY') return 'USD/JPY';
  if (s === 'XAUUSD' || s === 'XAU') return 'XAU/USD';
  return null;
}

function toCryptoPair(sym: string): string | null {
  const s = sym.toUpperCase();
  if (s === 'BTC') return 'BTC-USD';
  if (s === 'ETH') return 'ETH-USD';
  if (s === 'SOL') return 'SOL-USD';
  return null;
}

export function useObPressureStream(symbol: string, polygonKey?: string): ObPressure {
  const [snap, setSnap] = useState<ObPressure>(INIT);
  const histRef = useRef<number[]>([]);  // rolling last 4 EMA values
  const channel = useMemo(() => {
    const fx = toForexPair(symbol);
    if (fx) return { url: 'wss://socket.polygon.io/forex', sub: `C.${fx}`, ev: 'C' };
    const c = toCryptoPair(symbol);
    if (c) return { url: 'wss://socket.polygon.io/crypto', sub: `XQ.${c}`, ev: 'XQ' };
    if (symbol && /^[A-Z]{1,5}$/.test(symbol.toUpperCase())) {
      return { url: 'wss://socket.polygon.io/stocks', sub: `Q.${symbol.toUpperCase()}`, ev: 'Q' };
    }
    return null;
  }, [symbol]);

  useEffect(() => {
    histRef.current = [];
    if (!polygonKey || !channel) {
      setSnap(INIT);
      return;
    }
    let alive = true;
    let ws: WebSocket | null = new WebSocket(channel.url);
    let ema = 0;
    const a = 0.15;
    const err = () => alive && setSnap((s) => ({ ...s, status: 'error' }));

    ws.onmessage = (ev) => {
      if (!alive) return;
      let msgs: unknown[];
      try { msgs = JSON.parse(String(ev.data)) as unknown[]; } catch { return; }
      if (!Array.isArray(msgs)) return;
      for (const raw of msgs) {
        if (typeof raw !== 'object' || raw == null) continue;
        const m = raw as Record<string, unknown>;
        if (m.ev === 'status') {
          const st = String(m.status ?? '');
          if (st === 'connected') ws?.send(JSON.stringify({ action: 'auth', params: polygonKey }));
          if (st === 'auth_success') ws?.send(JSON.stringify({ action: 'subscribe', params: channel.sub }));
          continue;
        }
        if (m.ev !== channel.ev) continue;
        const bidSize = Number(m.bs ?? 0);
        const askSize = Number(m.as ?? 0);
        const total = bidSize + askSize;
        const rawPressure = total > 0 ? (bidSize - askSize) / total : 0;
        ema = ema * (1 - a) + rawPressure * a;
        const pressure = Math.max(-1, Math.min(1, ema));
        const hist = histRef.current;
        hist.push(pressure);
        if (hist.length > 4) hist.shift();
        const n = hist.length;
        const d1 = n >= 2 ? hist[n-1]! - hist[n-2]! : 0;  // velocity
        const d0 = n >= 3 ? hist[n-2]! - hist[n-3]! : 0;  // prev velocity
        const deltaD = d1 - d0;
        const exhausted = Math.abs(pressure) > 0.42 && deltaD < -0.018;
        const confidence = Math.min(1, Math.abs(ema) * 2.2);
        setSnap({ pressure, confidence, delta: d1, deltaD, phase: toPhase(pressure, exhausted), exhausted, status: 'live' });
      }
    };
    ws.onerror = err;
    ws.onclose = err;
    return () => {
      alive = false;
      try { ws?.close(); } catch { /* noop */ }
      ws = null;
    };
  }, [channel, polygonKey]);

  return snap;
}

