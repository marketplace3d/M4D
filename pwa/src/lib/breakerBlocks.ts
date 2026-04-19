/**
 * Breaker Blocks — mitigated Order Blocks that flip polarity.
 *
 * ICT: when a bull OB is fully mitigated (price closes below its bottom),
 * the zone becomes a BEAR breaker (supply). Vice versa for bear OBs.
 * Breakers often act as institutional continuation zones on retest.
 */
import type { Bar } from '../../../indicators/boom3d-tech';
import { detectOrderBlocks, type OrderBlockZone } from './orderBlocks';

export type BreakerBlock = OrderBlockZone & {
  breakerDir: 1 | -1;  // 1 = bull breaker (was bear OB, now flipped), -1 = bear breaker
  mitigatedAt: number; // bar time when mitigation occurred
};

export function detectBreakerBlocks(bars: Bar[], maxEach = 6): BreakerBlock[] {
  const lastT = bars[bars.length - 1]!.time as number;
  const obs = detectOrderBlocks(bars, { maxEach: 30 });
  const breakers: BreakerBlock[] = [];

  for (const ob of obs) {
    // Find the bar where price fully broke through the OB
    const startIdx = bars.findIndex(b => (b.time as number) >= ob.time);
    if (startIdx < 0) continue;

    let mitigatedAt: number | null = null;
    for (let i = startIdx; i < bars.length; i++) {
      const b = bars[i]!;
      if (ob.dir === 1) {
        // Bull OB: breaker if price closes below OB bottom
        if (b.close < ob.bottom) { mitigatedAt = b.time as number; break; }
      } else {
        // Bear OB: breaker if price closes above OB top
        if (b.close > ob.top) { mitigatedAt = b.time as number; break; }
      }
    }

    if (mitigatedAt === null) continue; // not yet mitigated

    // Check: did price return into the zone after mitigation?
    const mitIdx = bars.findIndex(b => (b.time as number) >= mitigatedAt!);
    if (mitIdx < 0) continue;

    // Breaker remains active if price hasn't closed through the OTHER side
    let stillActive = true;
    for (let i = mitIdx + 1; i < bars.length; i++) {
      const b = bars[i]!;
      if (ob.dir === 1) {
        // Bear breaker: invalidated if price closes above OB top again
        if (b.close > ob.top) { stillActive = false; break; }
      } else {
        // Bull breaker: invalidated if price closes below OB bottom again
        if (b.close < ob.bottom) { stillActive = false; break; }
      }
    }

    if (!stillActive) continue;

    breakers.push({
      ...ob,
      endTime: lastT,
      breakerDir: ob.dir === 1 ? -1 : 1, // flipped polarity
      mitigatedAt,
    });
  }

  // Return most recent, capped
  const bull = breakers.filter(b => b.breakerDir === 1).slice(-maxEach);
  const bear = breakers.filter(b => b.breakerDir === -1).slice(-maxEach);
  return [...bull, ...bear];
}
