//! The execution wrapper: translate a judgment by enforce level, consult the witness valve,
//! write the break reason to stderr, and record exactly one telemetry row per call.

use std::path::Path;

use super::ttl_witness::Valve;
use crate::core::telemetry::{self, Event};

/// The observer's posture. `Advise` records a break without stopping it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Enforce {
    Advise,
    Block,
}

/// `Unjudgeable` is a misassembly no judge could read: it blocks at either enforce level and
/// carries no reason.
pub enum Judgment {
    Upheld,
    Broken(String),
    Unjudgeable,
}

/// What one wrapped judgment recorded. `valve_refused` is set when the valve was asked to
/// relax a block and kept it.
pub struct Verdict {
    pub event: Event,
    pub valve_refused: bool,
}

impl Verdict {
    pub fn is_blocked(&self) -> bool {
        self.event == Event::Blocked
    }
}

/// The order is judge, translate, valve: only a break that would block is put to the valve,
/// and what remains is recorded once, so a witnessed break leaves no `blocked` row.
pub fn run_covenant(
    judgment: &Judgment,
    label: &str,
    subject: &str,
    enforce: Enforce,
    valve: Option<&Valve>,
    telemetry_path: &Path,
) -> Verdict {
    let mut valve_refused = false;
    let event = match (judgment, enforce) {
        (Judgment::Upheld, _) => Event::Passed,
        (Judgment::Broken(_), Enforce::Advise) => Event::Advised,
        (Judgment::Broken(_), Enforce::Block) | (Judgment::Unjudgeable, _) => match valve {
            Some(valve) if valve.opens() => Event::Witnessed,
            Some(_) => {
                valve_refused = true;
                Event::Blocked
            }
            None => Event::Blocked,
        },
    };
    if let Judgment::Broken(reason) = judgment {
        eprintln!("{reason}");
    }
    telemetry::append(telemetry_path, event, label, subject);
    Verdict {
        event,
        valve_refused,
    }
}
