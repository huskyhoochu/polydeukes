use serde_json::Value;

/// One human message of the session; a missing timestamp means freshness is unprovable.
pub struct UserMessage {
    pub text: String,
    pub timestamp_ms: Option<f64>,
}

/// The messages that carry text; an element without a string `text` is not a message.
pub fn user_messages(list: &[Value]) -> Vec<UserMessage> {
    list.iter()
        .filter_map(|entry| {
            let text = entry.get("text")?.as_str()?.to_string();
            let timestamp_ms = entry.get("timestampMs").and_then(Value::as_f64);
            Some(UserMessage { text, timestamp_ms })
        })
        .collect()
}
