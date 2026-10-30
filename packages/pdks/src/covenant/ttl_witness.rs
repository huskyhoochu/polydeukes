//! The time-boxed witness valve.
//!
//! A human types the agreed token alone on the first line of a message; the valve then holds
//! for `ttl_ms` from that message's timestamp. No state is stored: every judgment re-reads
//! the session's human messages against the clock.

use crate::core::telemetry::now_ms;
use crate::core::transcript::UserMessage;
use crate::core::validation::js_trim;

pub struct TtlSpec {
    token: String,
    ttl_ms: f64,
}

impl TtlSpec {
    /// The token is trimmed once so both sides of the first-line comparison normalize alike.
    /// A token holding a line break could never equal a first line.
    pub fn new(token: &str, ttl_ms: f64) -> Result<Self, String> {
        let token = js_trim(token);
        if token.is_empty() {
            return Err("ttlWitness: token must be non-empty after trimming".to_string());
        }
        if token.contains(['\r', '\n']) {
            return Err("ttlWitness: token must not contain line breaks".to_string());
        }
        if !(ttl_ms.is_finite() && ttl_ms > 0.0) {
            return Err("ttlWitness: ttlMs must be a finite positive number".to_string());
        }
        Ok(Self {
            token: token.to_string(),
            ttl_ms,
        })
    }
}

/// The valve of one run: closed when the config names no witness.
pub struct Valve<'a> {
    pub ttl: Option<&'a TtlSpec>,
    pub messages: &'a [UserMessage],
}

impl Valve<'_> {
    /// A message opens the valve when its first line is the token and
    /// `0 <= now - timestamp <= ttl`. A message without a timestamp proves no freshness.
    pub fn opens(&self) -> bool {
        let Some(spec) = self.ttl else {
            return false;
        };
        let judged_at = now_f64();
        self.messages.iter().any(|message| {
            invokes_token(&message.text, &spec.token)
                && message.timestamp_ms.is_some_and(|sent_at| {
                    let elapsed = judged_at - sent_at;
                    elapsed >= 0.0 && elapsed <= spec.ttl_ms
                })
        })
    }
}

/// Whether an utterance invokes the token rather than mentions it: its first line, trimmed,
/// equals the token. `trim` covers the whole Unicode space class on purpose; a lone `\r`
/// is not a line break, so such a message is refused.
fn invokes_token(text: &str, token: &str) -> bool {
    text.split('\n')
        .next()
        .is_some_and(|first_line| js_trim(first_line) == token)
}

#[expect(
    clippy::cast_precision_loss,
    reason = "epoch milliseconds are far below 2^53"
)]
fn now_f64() -> f64 {
    now_ms() as f64
}

/// The instant the last witness expired, in epoch milliseconds, or `None` when no token
/// message proves one: the latest token message not dated in the future, its timestamp plus
/// the window, when that instant has passed and is a representable date.
pub fn witness_expired_at(spec: &TtlSpec, messages: &[UserMessage]) -> Option<i64> {
    let judged_at = now_f64();
    let mut latest: Option<f64> = None;
    for message in messages {
        let Some(sent_at) = message.timestamp_ms else {
            continue;
        };
        if !sent_at.is_finite() || sent_at > judged_at || !invokes_token(&message.text, &spec.token)
        {
            continue;
        }
        if latest.is_none_or(|current| sent_at > current) {
            latest = Some(sent_at);
        }
    }
    let expired_at = latest? + spec.ttl_ms;
    if expired_at >= judged_at || expired_at.abs() > 8.64e15 {
        return None;
    }
    Some(expired_at_ms(expired_at))
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "bounded to the date range above"
)]
fn expired_at_ms(expired_at: f64) -> i64 {
    expired_at.trunc() as i64
}
