//! The seven relations. Each answers a witness list rather than a boolean: an empty list means
//! the relation holds, and every other list names the elements that broke it in the order the
//! extraction supplied them. `empty`, `subset` and `ordered` are written directly; the other
//! four are expansions over them.

use serde_json::Value;

use super::extract::{Extractor, Item, Problem, canonical, comparator, js_string};
use crate::core::declaration::{Message, Relate, Relation};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Left,
    Right,
}

/// One element for which a relation does not hold. `before` is the pre value behind an
/// `unchanged` witness.
pub struct Witness {
    pub key: String,
    pub value: Option<Value>,
    pub side: Option<Side>,
    pub before: Option<Value>,
}

fn witness(entry: &Item) -> Witness {
    Witness {
        key: entry.key.clone(),
        value: entry.value.clone(),
        side: None,
        before: None,
    }
}

/// The `of` items whose value occurs nowhere in `within`, duplicates kept.
fn subset(of: &[Item], within: &[Item]) -> Vec<Witness> {
    let present: Vec<String> = within
        .iter()
        .map(|entry| canonical(entry.value.as_ref()))
        .collect();
    of.iter()
        .filter(|entry| !present.contains(&canonical(entry.value.as_ref())))
        .map(witness)
        .collect()
}

pub fn evaluate(relation: &Relation, extractor: &Extractor) -> Result<Vec<Witness>, Problem> {
    Ok(match relation {
        Relation::Empty(of) => extractor.single(of)?.iter().map(witness).collect(),
        Relation::NonEmpty(of) => {
            if extractor.single(of)?.is_empty() {
                vec![Witness {
                    key: of.clone(),
                    value: Some(Value::Null),
                    side: None,
                    before: None,
                }]
            } else {
                Vec::new()
            }
        }
        Relation::Subset { of, within } => {
            subset(&extractor.single(of)?, &extractor.single(within)?)
        }
        Relation::Equal(left, right) => {
            let (left, right) = (extractor.single(left)?, extractor.single(right)?);
            let tag = |side, found: Vec<Witness>| {
                found.into_iter().map(move |entry| Witness {
                    side: Some(side),
                    ..entry
                })
            };
            tag(Side::Left, subset(&left, &right))
                .chain(tag(Side::Right, subset(&right, &left)))
                .collect()
        }
        Relation::Implies { of, requires } => {
            let (of, requires) = (extractor.single(of)?, extractor.single(requires)?);
            of.iter()
                .filter(|entry| !requires.iter().any(|other| other.key == entry.key))
                .map(witness)
                .collect()
        }
        Relation::Ordered { of, strict } => {
            let items = extractor.single(of)?;
            let order = comparator(&items);
            items
                .windows(2)
                .filter_map(|pair| {
                    let [previous, next] = pair else { return None };
                    let ordering = order(previous, next);
                    (ordering.is_gt() || (*strict && ordering.is_eq())).then(|| witness(next))
                })
                .collect()
        }
        Relation::Unchanged(of) => {
            let (pre, post) = extractor.pair(of)?;
            post.iter()
                .filter_map(|entry| {
                    let before = pre.iter().rfind(|other| other.key == entry.key)?;
                    (canonical(before.value.as_ref()) != canonical(entry.value.as_ref())).then(
                        || Witness {
                            before: before.value.clone(),
                            ..witness(entry)
                        },
                    )
                })
                .collect()
        }
    })
}

fn text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(other) => serde_json::to_string(other).unwrap_or_default(),
        None => js_string(None),
    }
}

/// The break text: the first witness fills the template in one pass, and the witnesses beyond
/// it are counted in a suffix rather than listed, so one break stays one line.
pub fn render_message(entry: &Relate, witnesses: &[Witness]) -> String {
    let Some(first) = witnesses.first() else {
        return String::new();
    };
    let mut rest = match &entry.message {
        Message::One(template) => template.as_str(),
        Message::BySide { left, right } => {
            if first.side == Some(Side::Right) {
                right
            } else {
                left
            }
        }
    };
    let mut rendered = String::new();
    while let Some(character) = rest.chars().next() {
        if let Some(after) = rest.strip_prefix("{key}") {
            rendered.push_str(&first.key);
            rest = after;
        } else if let Some(after) = rest.strip_prefix("{value}") {
            rendered.push_str(&text(first.value.as_ref()));
            rest = after;
        } else if let Some(after) = rest.strip_prefix("{before}") {
            if let Some(before) = &first.before {
                rendered.push_str(&text(Some(before)));
            }
            rest = after;
        } else {
            rendered.push(character);
            rest = rest.get(character.len_utf8()..).unwrap_or_default();
        }
    }
    if witnesses.len() > 1 {
        rendered.push_str(" (+");
        rendered.push_str(&(witnesses.len() - 1).to_string());
        rendered.push(')');
    }
    rendered
}
