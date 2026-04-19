mod algos;
mod fetcher;
mod processor;
mod store;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use reqwest::Client;
use serde_json::json;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use fetcher::asset_list;
use processor::Indicators;

const DATA_DIR: &str = "engine/data";
const DB_PATH: &str = "engine/data/algo_state.db";
const ALGO_DAY_JSON: &str = "engine/data/algo_day.json";
const BAR_LIMIT: u32 = 100; // fetch last 100 daily bars
const RUN_INTERVAL_SECS: u64 = 300; // 5 minutes

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "engine=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Ensure data directory exists.
    std::fs::create_dir_all(DATA_DIR)?;

    let client = Arc::new(
        Client::builder()
            .timeout(Duration::from_secs(30))
            .build()?,
    );

    tracing::info!("engine starting — interval {RUN_INTERVAL_SECS}s, {} assets", asset_list().len());

    loop {
        let run_start = std::time::Instant::now();
        tracing::info!("--- engine run start ---");

        match run_once(&client).await {
            Ok(n) => tracing::info!("engine run complete: {n} assets processed in {:?}", run_start.elapsed()),
            Err(e) => tracing::error!("engine run error: {e}"),
        }

        tokio::time::sleep(Duration::from_secs(RUN_INTERVAL_SECS)).await;
    }
}

async fn run_once(client: &Arc<Client>) -> Result<usize, Box<dyn std::error::Error>> {
    let symbols = asset_list();

    // Fetch all assets concurrently using tokio tasks.
    let mut handles = Vec::new();
    for sym in &symbols {
        let c = client.clone();
        let sym_owned = sym.to_string();
        let h = tokio::spawn(async move {
            match fetcher::fetch_daily_bars(&c, &sym_owned, BAR_LIMIT).await {
                Ok(bars) => Some((sym_owned, bars)),
                Err(e) => {
                    tracing::warn!("fetch failed for {sym_owned}: {e}");
                    None
                }
            }
        });
        handles.push(h);
    }

    let mut results = Vec::new();
    for h in handles {
        if let Ok(r) = h.await {
            results.push(r);
        }
    }

    // Open SQLite connection (single thread — engine is single process).
    let conn = store::open(DB_PATH)?;

    let warmup = Indicators::warmup();
    let timestamp = chrono::Utc::now()
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let mut asset_day_entries = Vec::new();
    let mut processed = 0_usize;

    for result in results.into_iter().flatten() {
        let (symbol, bars): (String, Vec<processor::Bar>) = result;
        if bars.len() < warmup + 2 {
            tracing::warn!("{symbol}: not enough bars ({}) for warmup", bars.len());
            continue;
        }

        let ind = Indicators::build(&bars);
        let last_idx = bars.len() - 1;

        // Score only the last bar (current day).
        let votes = algos::run_all(&bars, &ind, last_idx);

        // Compute JEDI score: normalized -100 to +100 from sum of non-COMP votes.
        let contributing: Vec<&algos::Vote> = votes.iter().filter(|v| v.algo_id != "COMP").collect();
        let vote_sum: i32 = contributing.iter().map(|v| v.vote as i32).sum();
        let max_sum = contributing.len() as f64;
        let jedi_score = if max_sum > 0.0 {
            (vote_sum as f64 / max_sum) * 100.0
        } else {
            0.0
        };

        let last_bar = &bars[last_idx];
        let prev_bar = &bars[last_idx - 1];
        let change_pct = if prev_bar.close > 0.0 {
            (last_bar.close - prev_bar.close) / prev_bar.close * 100.0
        } else {
            0.0
        };

        // Persist to SQLite.
        if let Err(e) = store::upsert_algo_score(
            &conn,
            &symbol,
            last_bar.time,
            last_bar.open,
            last_bar.close,
            jedi_score,
        ) {
            tracing::warn!("{symbol}: db score upsert failed: {e}");
        }

        let vote_triples: Vec<(&'static str, i8, f64)> = votes
            .iter()
            .map(|v| (v.algo_id, v.vote, v.strength))
            .collect();

        if let Err(e) = store::insert_algo_votes(
            &conn,
            &symbol,
            last_idx,
            last_bar.time,
            &vote_triples,
        ) {
            tracing::warn!("{symbol}: db votes insert failed: {e}");
        }

        // Collect for algo_day.json.
        let vote_map: HashMap<String, i8> =
            votes.iter().map(|v| (v.algo_id.to_string(), v.vote)).collect();

        asset_day_entries.push(json!({
            "symbol": symbol,
            "price": last_bar.close,
            "change_pct": change_pct,
            "jedi_score": jedi_score,
            "votes": vote_map,
        }));

        processed += 1;
        tracing::debug!("{symbol}: jedi={jedi_score:.1} price={:.4}", last_bar.close);
    }

    // Write algo_day.json atomically (write to .tmp then rename).
    let day_snap = json!({
        "timestamp": timestamp,
        "assets": asset_day_entries,
    });
    let json_text = serde_json::to_string_pretty(&day_snap)?;
    let tmp_path = format!("{ALGO_DAY_JSON}.tmp");
    std::fs::write(&tmp_path, &json_text)?;
    std::fs::rename(&tmp_path, ALGO_DAY_JSON)?;
    tracing::info!("algo_day.json written ({} assets)", processed);

    Ok(processed)
}

// Pull in futures for join_all.
mod futures {
    pub async fn join_all<F: std::future::Future>(
        futs: impl IntoIterator<Item = F>,
    ) -> Vec<F::Output> {
        let futs: Vec<_> = futs.into_iter().collect();
        let mut results = Vec::with_capacity(futs.len());
        for f in futs {
            results.push(f.await);
        }
        results
    }
}
