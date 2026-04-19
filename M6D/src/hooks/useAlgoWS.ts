import { useEffect, useRef, useState } from 'react';

export type AlgoWsStatus = 'disabled' | 'connecting' | 'open' | 'closed' | 'error';

export type WsBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type WsPayload =
  | { type: 'bar'; bar: WsBar }
  | { type: 'info'; message: string }
  | { type: 'unknown'; raw: unknown };

type UseAlgoWSArgs = {
  symbol: string;
  timeframe: string;
  enabled?: boolean;
};

export function useAlgoWS({ symbol, timeframe, enabled = true }: UseAlgoWSArgs) {
  const wsUrl = (import.meta.env.VITE_M4D_WS_URL as string | undefined)?.trim();
  const [status, setStatus] = useState<AlgoWsStatus>(enabled ? 'connecting' : 'disabled');
  const [error, setError] = useState<string>('');
  const [lastPayload, setLastPayload] = useState<WsPayload | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus('disabled');
      return;
    }
    if (!wsUrl) {
      setStatus('disabled');
      return;
    }

    setStatus('connecting');
    setError('');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('open');
      ws.send(
        JSON.stringify({
          op: 'subscribe',
          stream: 'bars',
          symbol,
          timeframe,
        }),
      );
    };

    ws.onclose = () => setStatus('closed');
    ws.onerror = () => {
      setStatus('error');
      setError('WS connection error');
    };

    ws.onmessage = (ev) => {
      try {
        const raw = JSON.parse(String(ev.data)) as Record<string, unknown>;
        if (raw.type === 'bar' && raw.bar && typeof raw.bar === 'object') {
          const bar = raw.bar as Record<string, unknown>;
          const parsed: WsBar = {
            time: Number(bar.time),
            open: Number(bar.open),
            high: Number(bar.high),
            low: Number(bar.low),
            close: Number(bar.close),
            volume: Number(bar.volume ?? 0),
          };
          if (
            Number.isFinite(parsed.time) &&
            Number.isFinite(parsed.open) &&
            Number.isFinite(parsed.high) &&
            Number.isFinite(parsed.low) &&
            Number.isFinite(parsed.close)
          ) {
            setLastPayload({ type: 'bar', bar: parsed });
            return;
          }
        }
        if (raw.type === 'info' && typeof raw.message === 'string') {
          setLastPayload({ type: 'info', message: raw.message });
          return;
        }
        setLastPayload({ type: 'unknown', raw });
      } catch {
        setLastPayload({ type: 'unknown', raw: ev.data });
      }
    };

    return () => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
      wsRef.current = null;
    };
  }, [enabled, symbol, timeframe, wsUrl]);

  return { wsUrl, status, error, lastPayload };
}

