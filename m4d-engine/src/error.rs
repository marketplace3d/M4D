use thiserror::Error;

#[derive(Error, Debug)]
pub enum EngineError {
    #[error("IO: {0}")]
    Io(#[from] std::io::Error),
    #[error("CSV: {0}")]
    Csv(#[from] csv::Error),
    #[error("SQLite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("{0}")]
    Msg(String),
}
