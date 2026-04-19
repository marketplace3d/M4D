use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

use clap::{Parser, Subcommand};

use m4d_engine::backtest::simple_vote_sum_backtest;
use m4d_engine::load_csv;
use m4d_engine::runner::{run_historic, summarize_algo_day};
use m4d_engine::sqlite_export::import_votes_jsonl;

#[derive(Parser)]
#[command(name = "m4d-processor", version, about = "M4D historic algo processor + JSON outputs")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Run algos on a CSV of OHLCV bars; write votes + algo_day + backtest JSON.
    Historic {
        #[arg(short, long)]
        csv: PathBuf,
        #[arg(short, long, default_value = "SYMBOL")]
        symbol: String,
        #[arg(short, long, default_value = "./out")]
        out_dir: PathBuf,
        #[arg(long, default_value_t = 5)]
        enter: i32,
        #[arg(long, default_value_t = 0)]
        exit: i32,
        /// E.g. `2026-03-27_BTC` — matches `algo_votes.session_id`. Default: UTC date + `_` + symbol.
        #[arg(long)]
        session_id: Option<String>,
        #[arg(long)]
        no_votes: bool,
    },
    /// Import `votes.jsonl` into SQLite `algo_votes` (needs `algo_metadata` seeded; session key `{id}:b{bar}`).
    SqliteExport {
        #[arg(short, long)]
        db: PathBuf,
        #[arg(short, long)]
        votes: PathBuf,
    },
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Historic {
            csv,
            symbol,
            out_dir,
            enter,
            exit,
            session_id,
            no_votes,
        } => {
            std::fs::create_dir_all(&out_dir)?;
            let bars = load_csv(&csv)?;
            let session_id = session_id.unwrap_or_else(|| {
                let d = chrono::Utc::now().format("%Y-%m-%d");
                format!("{}_{}", d, symbol)
            });
            let run = run_historic(&bars, &symbol, &session_id);

            let bars_path = out_dir.join("bars.json");
            {
                let f = File::create(&bars_path)?;
                let mut w = BufWriter::new(f);
                writeln!(
                    w,
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({
                        "session_id": session_id,
                        "symbol": symbol,
                        "count": bars.len(),
                        "bars": bars,
                    }))?
                )?;
            }

            if !no_votes {
                let votes_path = out_dir.join("votes.jsonl");
                let f = File::create(&votes_path)?;
                let mut w = BufWriter::new(f);
                for v in &run.votes {
                    writeln!(w, "{}", serde_json::to_string(v)?)?;
                }
            }

            let summary = summarize_algo_day(&session_id, &symbol, &bars, &run);
            {
                let p = out_dir.join("algo_day.json");
                let f = File::create(&p)?;
                serde_json::to_writer_pretty(f, &summary)?;
            }

            let bt = simple_vote_sum_backtest(&bars, &run.votes, enter, exit);
            {
                let p = out_dir.join("backtest.json");
                let f = File::create(&p)?;
                serde_json::to_writer_pretty(f, &bt)?;
            }

            eprintln!(
                "session={} bars={} warmup={} vote_rows={} → {}",
                session_id,
                bars.len(),
                run.warmup,
                run.votes.len(),
                out_dir.display()
            );
        }
        Commands::SqliteExport { db, votes } => {
            let n = import_votes_jsonl(&db, &votes)?;
            eprintln!("sqlite-import wrote {} rows → {}", n, db.display());
        }
    }
    Ok(())
}
