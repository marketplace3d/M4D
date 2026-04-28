# ICTSMC Docs Pack

- Council iter-opt brief: `COUNCIL-ITER-OPT.md`
- Candidate algo snapshot: `ICTSMC-ALGO-CANDIDATE.ts`
- Optimization artifacts:
  - `ds/data/ictsmc_opt_full_sweep.json`
  - `ds/data/ictsmc_opt_strict_shortlist.json`

## Intent
This folder is the council handoff package for iterative optimization and governance on the ICTSMC branch.

## Next Optimization Pass (Documented)
- Promote IOPT to per-symbol reality tuning (ES/NQ/BTC) with separate presets.
- Stop relying on CIS-style early flip exits as default replay behavior.
- Evaluate and rank exit families:
  - LQ targets only
  - LQ + EMA13 safety
  - LQ + trailing ATR
  - LQ + anchored VWAP trail
- Use mode-separated performance (COUNCIL/ICT/BOTH/JEDI/MASTER/BOOM) for selection, not a single merged tape.
