import type { CouncilBundle } from '../council';
import type { AlgoDayJson, AlgoTableRow } from './algoDayTypes';

export function mergeCouncilAndAlgoDay(council: CouncilBundle, day: AlgoDayJson): AlgoTableRow[] {
  const pa = day.per_algo ?? {};
  const lv = day.last_bar_votes ?? {};
  const rows: AlgoTableRow[] = [];

  const jTally = pa['J'] ?? { long_bars: 0, short_bars: 0, flat_bars: 0 };
  const jLast = lv['J'];
  rows.push({
    id: 'J',
    tier: 'JEDI',
    name: council.jedi.label,
    sub: council.jedi.sub,
    color: council.jedi.color,
    long: jTally.long_bars,
    short: jTally.short_bars,
    flat: jTally.flat_bars,
    lastVote: jLast?.vote ?? null,
    lastStrength: jLast?.strength ?? null,
    stub: false,
  });

  for (const a of council.algorithms) {
    const t = pa[a.id] ?? { long_bars: 0, short_bars: 0, flat_bars: 0 };
    const last = lv[a.id];
    const payload = last?.payload as { stub?: boolean } | undefined;
    rows.push({
      id: a.id,
      tier: a.tier,
      name: a.name,
      sub: a.sub,
      color: a.color,
      long: t.long_bars,
      short: t.short_bars,
      flat: t.flat_bars,
      lastVote: last?.vote ?? null,
      lastStrength: last?.strength ?? null,
      stub: Boolean(payload?.stub),
    });
  }

  return rows;
}
