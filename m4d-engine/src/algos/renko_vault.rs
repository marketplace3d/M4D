use serde_json::json;
use super::AlgoContext;

/// Bank B · RV — Renko Vault: ATR-based Renko bricks, 3 consecutive = signal.
pub fn eval_rv(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 20 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let atr = ctx.cache.atr14[idx];
    if !atr.is_finite() || atr < 1e-12 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let brick_size = atr;
    let start = if idx > 60 { idx - 60 } else { 0 };
    let mut brick_base = ctx.bars[start].close;
    let mut bricks: Vec<i8> = Vec::new();

    for k in (start + 1)..=idx {
        let c = ctx.bars[k].close;
        while c >= brick_base + brick_size {
            bricks.push(1);
            brick_base += brick_size;
        }
        while c <= brick_base - brick_size {
            bricks.push(-1);
            brick_base -= brick_size;
        }
    }

    let n = bricks.len();
    if n < 3 {
        return (0, 0.0, json!({"bricks":n}));
    }

    let last3: Vec<i8> = bricks[(n - 3)..].to_vec();
    let bull3 = last3.iter().all(|&b| b == 1);
    let bear3 = last3.iter().all(|&b| b == -1);

    let mut streak: usize = 1;
    if n >= 2 {
        let dir = bricks[n - 1];
        for k in (0..n - 1).rev() {
            if bricks[k] == dir { streak += 1; } else { break; }
        }
    }
    let strength = (streak as f64 / 10.0).min(1.0).max(0.2);

    if bull3 {
        (1, strength, json!({"bricks":n,"streak":streak,"dir":"bull","brick_size":brick_size}))
    } else if bear3 {
        (-1, strength, json!({"bricks":n,"streak":streak,"dir":"bear","brick_size":brick_size}))
    } else {
        (0, 0.0, json!({"bricks":n,"streak":streak}))
    }
}
