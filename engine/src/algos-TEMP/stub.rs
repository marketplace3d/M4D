use serde_json::json;

pub fn stub_payload(id: &str) -> serde_json::Value {
    json!({
        "stub": true,
        "algo_id": id,
        "note": "not yet ported to m4d-engine"
    })
}
