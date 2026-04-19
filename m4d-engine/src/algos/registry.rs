use std::collections::HashMap;

use serde_json::json;

use crate::bar::Bar;
use crate::indicators::IndicatorCache;
use crate::vote::AlgoVoteRow;

use super::{
    niall_spike, cyber_ict, banshee_squeeze, celtic_cross, wolfhound,
    stone_anchor, high_king, gallowglass_ob, emerald_flow,
    eight_ema, vega_trap, market_shift, dark_pool, wyckoff_spring,
    renko_vault, harmonic_lens, alpha_imbalance, volkov_keltner,
    stockbee_ep, ict_weekly_fvg, weinstein_stage, casper_ifvg,
    ttrades_fractal, rayner_trend, minervini_vcp, oneil_breakout, dragonfly_vol,
};

/// Ordered roster: Jedi + 27 grid (matches `council-algos.v1.json`).
pub fn all_algo_ids() -> Vec<&'static str> {
    vec![
        "J", "NS", "CI", "BQ", "CC", "WH", "SA", "HK", "GO", "EF", "8E", "VT", "MS", "DP", "WS",
        "RV", "HL", "AI", "VK", "SE", "IC", "WN", "CA", "TF", "RT", "MM", "OR", "DV",
    ]
}

pub struct AlgoContext<'a> {
    pub bars: &'a [Bar],
    pub cache: &'a IndicatorCache,
}

/// Jedi: 1 vote per algo (equal weight). Score = sum of all 27 votes (−27 to +27).
/// Threshold ±7 of ±27 max.
fn eval_jedi(last: &HashMap<&str, (i8, f64)>) -> (i8, f64, serde_json::Value) {
    let bank_a: Vec<&str> = vec!["NS","CI","BQ","CC","WH","SA","HK","GO","EF"];
    let bank_b: Vec<&str> = vec!["8E","VT","MS","DP","WS","RV","HL","AI","VK"];
    let bank_c: Vec<&str> = vec!["SE","IC","WN","CA","TF","RT","MM","OR","DV"];

    let tally = |ids: &[&str]| -> (i32, i32, i32) {
        let (mut l, mut s, mut f) = (0_i32, 0_i32, 0_i32);
        for id in ids {
            match last.get(id).map(|x| x.0).unwrap_or(0) {
                1 => l += 1, -1 => s += 1, _ => f += 1,
            }
        }
        (l, s, f)
    };

    let (al, as_, _) = tally(&bank_a);
    let (bl, bs, _) = tally(&bank_b);
    let (cl, cs, _) = tally(&bank_c);

    let long_total = al + bl + cl;
    let short_total = as_ + bs + cs;
    let score = long_total - short_total; // −27 to +27

    let direction = if score >= 7 { 1_i8 } else if score <= -7 { -1 } else { 0 };
    let strength = (score.abs() as f64 / 27.0).min(1.0);

    (direction, strength, json!({
        "score": score,
        "long": long_total,
        "short": short_total,
        "bank_a": format!("{}L/{}S", al, as_),
        "bank_b": format!("{}L/{}S", bl, bs),
        "bank_c": format!("{}L/{}S", cl, cs),
    }))
}

pub fn run_algos_at_bar(ctx: &AlgoContext, idx: usize, session_id: &str) -> Vec<AlgoVoteRow> {
    let t = ctx.bars[idx].time;
    let sid = session_id.to_string();
    let mut map: HashMap<&str, (i8, f64)> = HashMap::new();
    let mut rows = Vec::new();

    for id in all_algo_ids() {
        if id == "J" { continue; }
        let (vote, strength, payload) = match id {
            // Bank A
            "NS" => niall_spike::eval_ns(ctx, idx),
            "CI" => cyber_ict::eval_ci(ctx, idx),
            "BQ" => banshee_squeeze::eval_bq(ctx, idx),
            "CC" => celtic_cross::eval_cc(ctx, idx),
            "WH" => wolfhound::eval_wh(ctx, idx),
            "SA" => stone_anchor::eval_sa(ctx, idx),
            "HK" => high_king::eval_hk(ctx, idx),
            "GO" => gallowglass_ob::eval_go(ctx, idx),
            "EF" => emerald_flow::eval_ef(ctx, idx),
            // Bank B
            "8E" => eight_ema::eval_8e(ctx, idx),
            "VT" => vega_trap::eval_vt(ctx, idx),
            "MS" => market_shift::eval_ms(ctx, idx),
            "DP" => dark_pool::eval_dp(ctx, idx),
            "WS" => wyckoff_spring::eval_ws(ctx, idx),
            "RV" => renko_vault::eval_rv(ctx, idx),
            "HL" => harmonic_lens::eval_hl(ctx, idx),
            "AI" => alpha_imbalance::eval_ai(ctx, idx),
            "VK" => volkov_keltner::eval_vk(ctx, idx),
            // Bank C
            "SE" => stockbee_ep::eval_se(ctx, idx),
            "IC" => ict_weekly_fvg::eval_ic(ctx, idx),
            "WN" => weinstein_stage::eval_wn(ctx, idx),
            "CA" => casper_ifvg::eval_ca(ctx, idx),
            "TF" => ttrades_fractal::eval_tf(ctx, idx),
            "RT" => rayner_trend::eval_rt(ctx, idx),
            "MM" => minervini_vcp::eval_mm(ctx, idx),
            "OR" => oneil_breakout::eval_or(ctx, idx),
            "DV" => dragonfly_vol::eval_dv(ctx, idx),
            _ => unreachable!(),
        };
        map.insert(id, (vote, strength));
        rows.push(AlgoVoteRow {
            session_id: sid.clone(),
            bar_index: idx,
            time: t,
            algo_id: id.to_string(),
            vote,
            strength,
            payload,
        });
    }

    let (jv, js, jp) = eval_jedi(&map);
    rows.insert(
        0,
        AlgoVoteRow {
            session_id: sid,
            bar_index: idx,
            time: t,
            algo_id: "J".to_string(),
            vote: jv,
            strength: js,
            payload: jp,
        },
    );

    rows
}
