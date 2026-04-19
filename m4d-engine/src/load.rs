use std::path::Path;

use crate::bar::Bar;
use crate::error::EngineError;

/// Load OHLCV CSV with columns: time, open, high, low, close, volume (header row).
pub fn load_csv(path: &Path) -> Result<Vec<Bar>, EngineError> {
    let mut rdr = csv::ReaderBuilder::new()
        .flexible(true)
        .trim(csv::Trim::All)
        .from_path(path)?;

    let headers: Vec<String> = rdr
        .headers()?
        .iter()
        .map(|s| s.to_lowercase())
        .collect();

    let pos = |name: &str| -> Result<usize, EngineError> {
        headers
            .iter()
            .position(|h| h == name)
            .ok_or_else(|| EngineError::Msg(format!("missing column '{name}' in CSV")))
    };

    let i_t = pos("time")?;
    let i_o = pos("open")?;
    let i_h = pos("high")?;
    let i_l = pos("low")?;
    let i_c = pos("close")?;
    let i_v = headers.iter().position(|h| h == "volume");

    let mut out = Vec::new();
    for rec in rdr.records() {
        let rec = rec?;
        let parse = |i: usize| -> Result<f64, EngineError> {
            rec.get(i)
                .ok_or_else(|| EngineError::Msg("short row".into()))?
                .parse::<f64>()
                .map_err(|e| EngineError::Msg(format!("parse float: {e}")))
        };
        let parse_i64 = |i: usize| -> Result<i64, EngineError> {
            let s = rec
                .get(i)
                .ok_or_else(|| EngineError::Msg("short row".into()))?;
            let v: i64 = s
                .parse()
                .map_err(|_| EngineError::Msg(format!("bad time '{s}'")))?;
            Ok(v)
        };

        let mut t = parse_i64(i_t)?;
        if t > 1_000_000_000_000 {
            t /= 1000;
        }
        let open = parse(i_o)?;
        let high = parse(i_h)?;
        let low = parse(i_l)?;
        let close = parse(i_c)?;
        let volume = if let Some(iv) = i_v {
            rec.get(iv)
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(0.0)
        } else {
            0.0
        };

        out.push(Bar {
            time: t,
            open,
            high,
            low,
            close,
            volume,
        });
    }

    if out.len() < 2 {
        return Err(EngineError::Msg("need at least 2 bars".into()));
    }

    Ok(out)
}
