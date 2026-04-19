import type { Bar } from '../../../indicators/boom3d-tech';

export type FvgZone = {
  time: number;
  endTime: number;
  top: number;
  bottom: number;
  dir: 1 | -1;
};

/**
 * FVG detection — exact port of TV-SUPER-OB-FVG.pine by makuchaku & eFe.
 *
 * Bull FVG (isFvgUp at bar i): bars[i].low > bars[i-2].high
 *   box: left=bars[i-2].time, top=bars[i].low, bottom=bars[i-2].high
 *
 * Bear FVG (isFvgDown at bar i): bars[i].high < bars[i-2].low
 *   box: left=bars[i-2].time, top=bars[i-2].low, bottom=bars[i].high
 *
 * Each box extends right until price enters it (mitigation = bar range overlaps zone).
 * Keeps last maxZones per side.
 */
export function detectFvgZones(bars: Bar[], maxZones = 10): FvgZone[] {
  const lastT = bars[bars.length - 1]!.time as number;
  const bull: FvgZone[] = [];
  const bear: FvgZone[] = [];

  for (let i = 2; i < bars.length; i++) {
    const b0 = bars[i - 2]!;
    const bi = bars[i]!;

    // Bull FVG: current low > bar[i-2] high
    if (bi.low > b0.high) {
      const top    = bi.low;
      const bottom = b0.high;
      let endT = lastT;
      for (let k = i + 1; k < bars.length; k++) {
        const bk = bars[k]!;
        if ((bk.high > bottom && bk.low < bottom) || (bk.high > top && bk.low < top)) {
          endT = bk.time as number;
          break;
        }
      }
      bull.push({ time: b0.time as number, endTime: endT, top, bottom, dir: 1 });
      if (bull.length > maxZones) bull.shift();
    }

    // Bear FVG: current high < bar[i-2] low
    if (bi.high < b0.low) {
      const top    = b0.low;
      const bottom = bi.high;
      let endT = lastT;
      for (let k = i + 1; k < bars.length; k++) {
        const bk = bars[k]!;
        if ((bk.high > bottom && bk.low < bottom) || (bk.high > top && bk.low < top)) {
          endT = bk.time as number;
          break;
        }
      }
      bear.push({ time: b0.time as number, endTime: endT, top, bottom, dir: -1 });
      if (bear.length > maxZones) bear.shift();
    }
  }

  return [...bull, ...bear];
}
