import type { Bar } from '$indicators/boom3d-tech';
import type { Boom3dBarOut } from '$indicators/boom3d-tech';
import { atr, ema, sma } from './taHelpers';

/** 0–10 council score: ATR↑, vol↑, heat↑, mock sentiment, + BOOM3D squeeze/expansion/stack */
export function councilVoteSeries(
  bars: Bar[],
  boom: Boom3dBarOut[],
  opts: { mockSentiment: number },
): number[] {
  const n = bars.length;
  const close = bars.map((b) => b.close);
  const vol = bars.map((b) => b.volume ?? 0);
  const a = atr(bars, 14);
  const ema50 = ema(close, 50);
  const ema100 = ema(close, 100);
  const ema200 = ema(close, 200);
  const volAvg = sma(vol, 20);

  const scores = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i++) {
    let s = 0;
    const b = boom[i]!;
    const c = close[i]!;

    if (b.squeezeOn) s += 1;
    else {
      const expansion = b.upperBB > b.kcUpper || b.lowerBB < b.kcLower;
      if (expansion) s += 1;
    }

    const va = volAvg[i];
    if (isFinite(va) && va > 0 && vol[i]! > va * 1.2) s += 1;

    const above = c > ema50[i]! && c > ema100[i]! && c > ema200[i]!;
    if (above) s += 1.5;

    if (i >= 5 && isFinite(a[i]!) && isFinite(a[i - 5]!) && a[i]! > a[i - 5]!) s += 1.5;

    const heatUp = i >= 10 && c > close[i - 10]!;
    if (heatUp) s += 1.5;

    if (opts.mockSentiment >= 0.55) s += 1;

    scores[i] = Math.min(10, Math.round(s * 2) / 2);
  }
  return scores;
}
