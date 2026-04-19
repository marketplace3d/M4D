use serde::Serialize;

/// Aligns with TS `Bar` in `indicators/boom3d-tech.ts` (`time` = Unix seconds).
#[derive(Clone, Debug, Serialize)]
pub struct Bar {
    pub time: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

impl Bar {
    pub fn typical_price(&self) -> f64 {
        (self.high + self.low + self.close) / 3.0
    }
}
