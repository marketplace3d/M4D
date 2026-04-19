import type { Bar } from '../../../indicators/boom3d-tech';

export type OrderBlockZone = {
  time: number;
  endTime: number;
  top: number;
  bottom: number;
  dir: 1 | -1;
};

/**
 * Super OB detection — exact port of TV-SUPER-OB-FVG.pine by makuchaku & eFe.
 *
 * Bull OB (isObUp at bar i):
 *   bars[i-2] is DOWN, bars[i-1] is UP, bars[i-1].close > bars[i-2].high
 *   box: top=bars[i-2].high, bottom=min(bars[i-2].low, bars[i-1].low)
 *
 * Bear OB (isObDown at bar i):
 *   bars[i-2] is UP, bars[i-1] is DOWN, bars[i-1].close < bars[i-2].low
 *   box: top=max(bars[i-2].high, bars[i-1].high), bottom=bars[i-2].low
 *
 * Each box extends right until price enters it (mitigation).
 * Keeps last maxEach per side.
 */
export function detectOrderBlocks(
  bars: Bar[],
  opts?: { maxEach?: number },
): OrderBlockZone[] {
  const maxEach = opts?.maxEach ?? 10;
  const lastT = bars[bars.length - 1]!.time as number;

  const bull: OrderBlockZone[] = [];
  const bear: OrderBlockZone[] = [];

  for (let i = 2; i < bars.length; i++) {
    const b0 = bars[i - 2]!;  // trapped candle (2 bars ago at signal bar)
    const b1 = bars[i - 1]!;  // signal candle  (1 bar ago at signal bar)

    const b0Down = b0.close < b0.open;
    const b0Up   = b0.close > b0.open;
    const b1Up   = b1.close > b1.open;
    const b1Down = b1.close < b1.open;

    // Bull OB: trapped=DOWN, signal=UP, signal.close > trapped.high
    if (b0Down && b1Up && b1.close > b0.high) {
      const top    = b0.high;
      const bottom = Math.min(b0.low, b1.low);
      // Find mitigation: first bar from i where price enters the zone
      let endT = lastT;
      for (let k = i; k < bars.length; k++) {
        const bk = bars[k]!;
        // mitigated when bar range crosses bottom or top of box
        if ((bk.high > bottom && bk.low < bottom) || (bk.high > top && bk.low < top)) {
          endT = bk.time as number;
          break;
        }
      }
      bull.push({ time: b0.time as number, endTime: endT, top, bottom, dir: 1 });
      if (bull.length > maxEach) bull.shift();
    }

    // Bear OB: trapped=UP, signal=DOWN, signal.close < trapped.low
    if (b0Up && b1Down && b1.close < b0.low) {
      const top    = Math.max(b0.high, b1.high);
      const bottom = b0.low;
      let endT = lastT;
      for (let k = i; k < bars.length; k++) {
        const bk = bars[k]!;
        if ((bk.high > bottom && bk.low < bottom) || (bk.high > top && bk.low < top)) {
          endT = bk.time as number;
          break;
        }
      }
      bear.push({ time: b0.time as number, endTime: endT, top, bottom, dir: -1 });
      if (bear.length > maxEach) bear.shift();
    }
  }

  return [...bull, ...bear];
}
