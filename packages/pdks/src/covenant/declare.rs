//! Judging one compiled declaration against one world: the scope decides first, then every
//! relate entry is evaluated in declaration order, one break per entry that does not hold.

use serde_json::Value;

use super::extract::{Extractor, Problem, World, absent};
use super::relations::{Witness, evaluate, render_message};
use crate::core::declaration::{Declaration, Scope, Supply};

/// One entry's failure: the text a human reads and the elements that produced it.
pub struct Break {
    pub id: String,
    pub message: String,
    pub witnesses: Vec<Witness>,
}

pub enum Verdict {
    OutOfScope,
    Pass,
    SupplyPass,
    Broken(Vec<Break>),
    Unjudgeable { source: String, reason: String },
}

/// True when the include list admits the text (an empty list admits every text) and the
/// exclude list names none.
pub fn scope_matches(scope: &Scope, text: &str) -> bool {
    let included =
        scope.include.is_empty() || scope.include.iter().any(|re| re.find(text).is_some());
    included && !scope.exclude.iter().any(|re| re.find(text).is_some())
}

/// Whether the declaration's scope admits the world. A fixed source the world lacks is a side
/// this call does not have (no `command` on a file edit, no `pre` on a create), so the world is
/// out of scope; a bound source the surface could not read is settled by the supply policy.
fn admits(declaration: &Declaration, world: &World) -> Result<bool, Problem> {
    let Some(scope) = &declaration.scope else {
        return Ok(true);
    };
    let bound = declaration
        .sources
        .iter()
        .any(|(name, _)| *name == scope.source);
    match world.get(&scope.source) {
        Some(Value::String(text)) => Ok(scope_matches(scope, text)),
        Some(_) => Ok(false),
        None if !bound => Ok(false),
        None if declaration.supply_of(&scope.source) == Supply::Empty => {
            Ok(scope_matches(scope, ""))
        }
        None => Err(absent(declaration, &scope.source)),
    }
}

fn from_problem(problem: Problem) -> Verdict {
    match problem {
        Problem::Pass => Verdict::SupplyPass,
        Problem::Error { source, reason } => Verdict::Unjudgeable { source, reason },
    }
}

/// A break outranks a supply pass: the world is a supply pass only when no entry broke.
pub fn judge(declaration: &Declaration, world: &World) -> Verdict {
    match admits(declaration, world) {
        Ok(true) => {}
        Ok(false) => return Verdict::OutOfScope,
        Err(problem) => return from_problem(problem),
    }
    let extractor = Extractor { declaration, world };
    let mut breaks = Vec::new();
    let mut passed_by_supply = false;
    for entry in &declaration.relate {
        match evaluate(&entry.relation, &extractor) {
            Ok(witnesses) if witnesses.is_empty() => {}
            Ok(witnesses) => breaks.push(Break {
                id: entry.id.clone(),
                message: render_message(entry, &witnesses),
                witnesses,
            }),
            Err(Problem::Pass) => passed_by_supply = true,
            Err(problem) => return from_problem(problem),
        }
    }
    if !breaks.is_empty() {
        Verdict::Broken(breaks)
    } else if passed_by_supply {
        Verdict::SupplyPass
    } else {
        Verdict::Pass
    }
}

/// Whether the declaration's witness block holds for the broken world `judge` admitted. It is
/// closed unless every witness entry holds, and a source it cannot read leaves it closed.
pub fn witness_opens(declaration: &Declaration, world: &World) -> bool {
    let Some(entries) = &declaration.witness else {
        return false;
    };
    let extractor = Extractor { declaration, world };
    entries.iter().all(|entry| {
        evaluate(&entry.relation, &extractor).is_ok_and(|witnesses| witnesses.is_empty())
    })
}
