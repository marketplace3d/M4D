/// Bank column for `algo_votes` — matches roster tiers in `M4D_AlgoSystem_migration.sql` (`JEDI`, `A`, `B`, `C`).
pub fn bank_for_algo(algo_id: &str) -> &'static str {
    match algo_id {
        "J" => "JEDI",
        "NS" | "CI" | "BQ" | "CC" | "WH" | "SA" | "HK" | "GO" | "EF" => "A",
        "8E" | "VT" | "MS" | "DP" | "WS" | "RV" | "HL" | "AI" | "VK" => "B",
        _ => "C",
    }
}
