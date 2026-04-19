// Bank A — Boom Strength (9 entry-precision algos)
mod niall_spike;
mod cyber_ict;
mod banshee_squeeze;
mod celtic_cross;
mod wolfhound;
mod stone_anchor;
mod high_king;
mod gallowglass_ob;
mod emerald_flow;

// Bank B — Algo Strategy Swords (9 structural algos)
mod eight_ema;
mod vega_trap;
mod market_shift;
mod dark_pool;
mod wyckoff_spring;
mod renko_vault;
mod harmonic_lens;
mod alpha_imbalance;
mod volkov_keltner;

// Bank C — Legend Trader Surface (9 positional algos)
mod stockbee_ep;
mod ict_weekly_fvg;
mod weinstein_stage;
mod casper_ifvg;
mod ttrades_fractal;
mod rayner_trend;
mod minervini_vcp;
mod oneil_breakout;
mod dragonfly_vol;

mod registry;

pub use registry::{all_algo_ids, run_algos_at_bar, AlgoContext};
