//! M4D Rust engine: historic bars → algo votes → JSON feeds / toy backtest.
pub mod algos;
pub mod backtest;
pub mod bank;
pub mod bar;
pub mod error;
pub mod indicators;
pub mod load;
pub mod runner;
pub mod sqlite_export;
pub mod vote;

pub use bar::Bar;
pub use error::EngineError;
pub use load::load_csv;
