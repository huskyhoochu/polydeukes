//! Extraction: a pipeline maps a world value to a list of `{ key, value }` items. The head
//! lifts one source (or joins two other extractions) and each step maps items to items.

use std::cmp::Ordering;

use regress::Regex;
use serde_json::{Map, Value};

use crate::core::declaration::{Declaration, Head, Pipeline, Predicate, Step, Supply, Test};
use crate::core::validation::js_trim;

/// Source name to value. `state` holds `{ pre, post }`.
pub type World = Map<String, Value>;

/// One element of an extraction. A value of `None` is an absent property, which is not `null`.
pub struct Item {
    pub key: String,
    pub value: Option<Value>,
}

pub type Items = Vec<Item>;

/// Why a pipeline could not read the world: the source is absent or a value is unreadable
/// (`Error`), or the declaration lets the absence pass (`Pass`).
pub enum Problem {
    Error { source: String, reason: String },
    Pass,
}

fn item(key: impl Into<String>, value: Option<Value>) -> Item {
    Item {
        key: key.into(),
        value,
    }
}

fn positioned(values: &[Value]) -> Items {
    values
        .iter()
        .enumerate()
        .map(|(index, value)| item(index.to_string(), Some(value.clone())))
        .collect()
}

/// What an absent source means under the declaration's supply policy.
pub fn absent(declaration: &Declaration, source: &str) -> Problem {
    match declaration.supply_of(source) {
        Supply::Pass => Problem::Pass,
        Supply::Error | Supply::Empty => Problem::Error {
            source: source.to_string(),
            reason: format!("the world carries no source named '{source}'"),
        },
    }
}

/// Reads the pipelines of one declaration over one world.
pub struct Extractor<'a> {
    pub declaration: &'a Declaration,
    pub world: &'a World,
}

impl Extractor<'_> {
    fn pipeline(&self, name: &str) -> Result<&Pipeline, Problem> {
        self.declaration
            .pipelines
            .iter()
            .find(|pipeline| pipeline.name == name)
            .ok_or_else(|| Problem::Error {
                source: name.to_string(),
                reason: format!("no extract is named '{name}'"),
            })
    }

    /// The items of a pipeline that reads one value or joins two extractions.
    pub fn single(&self, name: &str) -> Result<Items, Problem> {
        let pipeline = self.pipeline(name)?;
        let steps = &pipeline.steps;
        let joined = |items| run_steps(steps, items, &pipeline.name);
        match &pipeline.head {
            Head::Source(source) => match self.world.get(source) {
                Some(value) => run_steps(steps, vec![item("0", Some(value.clone()))], source),
                None if self.declaration.supply_of(source) == Supply::Empty => {
                    run_steps(steps, Vec::new(), source)
                }
                None => Err(absent(self.declaration, source)),
            },
            Head::Union(left, right) => {
                let mut items = self.single(left)?;
                items.extend(self.single(right)?);
                joined(items)
            }
            Head::Intersect(left, right) => {
                let (left, right) = (self.single(left)?, self.single(right)?);
                joined(
                    left.into_iter()
                        .filter(|item| right.iter().any(|other| other.key == item.key))
                        .collect(),
                )
            }
            Head::OnlyIn { of, not_in, count } => {
                let (left, right) = (self.single(of)?, self.single(not_in)?);
                joined(if *count {
                    multiset_difference(left, &right)
                } else {
                    left.into_iter()
                        .filter(|item| !right.iter().any(|other| other.key == item.key))
                        .collect()
                })
            }
        }
    }

    /// The items of a pipeline over the paired source, once per side.
    pub fn pair(&self, name: &str) -> Result<(Items, Items), Problem> {
        let pipeline = self.pipeline(name)?;
        let Some(state) = self.world.get("state") else {
            return Err(absent(self.declaration, "state"));
        };
        let side = |key: &str| {
            let start = vec![item("0", state.get(key).cloned())];
            run_steps(&pipeline.steps, start, "state")
        };
        Ok((side("pre")?, side("post")?))
    }
}

fn consume<T>(list: &mut Vec<T>, position: Option<usize>) -> bool {
    position.is_some_and(|at| {
        list.swap_remove(at);
        true
    })
}

/// Pairs equal values first, so an unchanged item is never left over in place of a new one.
fn multiset_difference(left: Items, right: &[Item]) -> Items {
    let mut by_key: Vec<&str> = right.iter().map(|item| item.key.as_str()).collect();
    let mut by_value: Vec<(&str, String)> = right
        .iter()
        .map(|item| (item.key.as_str(), canonical(item.value.as_ref())))
        .collect();
    let mut unpaired = Vec::new();
    for item in left {
        let wanted = (item.key.as_str(), canonical(item.value.as_ref()));
        let at = by_value.iter().position(|entry| *entry == wanted);
        if consume(&mut by_value, at) {
            let at = by_key.iter().position(|key| *key == item.key);
            consume(&mut by_key, at);
        } else {
            unpaired.push(item);
        }
    }
    unpaired
        .into_iter()
        .filter(|item| {
            let at = by_key.iter().position(|key| *key == item.key);
            !consume(&mut by_key, at)
        })
        .collect()
}

fn run_steps(steps: &[Step], mut items: Items, source: &str) -> Result<Items, Problem> {
    for step in steps {
        items = run_step(step, items).map_err(|reason| Problem::Error {
            source: source.to_string(),
            reason,
        })?;
    }
    Ok(items)
}

/// JavaScript's `String(value)` for the values a world can hold.
pub fn js_string(value: Option<&Value>) -> String {
    match value {
        None => "undefined".to_string(),
        Some(Value::Null) => "null".to_string(),
        Some(Value::Bool(flag)) => flag.to_string(),
        Some(Value::Number(number)) => number.to_string(),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(elements)) => elements
            .iter()
            .map(|element| match element {
                Value::Null => String::new(),
                other => js_string(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".to_string(),
    }
}

/// A number the way JavaScript prints it: an integral value has no fraction.
#[expect(
    clippy::cast_possible_truncation,
    reason = "the value is integral and below 2^53, so the conversion is exact"
)]
pub fn number_value(number: f64) -> Value {
    if number.fract() == 0.0 && number.abs() < 9_007_199_254_740_992.0 {
        Value::from(number as i64)
    } else {
        Value::from(number)
    }
}

/// Rewrites every integral floating-point number to an integer, recursively.
pub fn normalize(value: Value) -> Value {
    match value {
        Value::Number(number) => match number.as_f64() {
            Some(float) if number.is_f64() => number_value(float),
            _ => Value::Number(number),
        },
        Value::Array(elements) => Value::Array(elements.into_iter().map(normalize).collect()),
        Value::Object(fields) => Value::Object(
            fields
                .into_iter()
                .map(|(key, field)| (key, normalize(field)))
                .collect(),
        ),
        other => other,
    }
}

fn utf16_order(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

/// The form two values compare by: object keys sorted, and an absent value distinct from `null`.
pub fn canonical(value: Option<&Value>) -> String {
    match value {
        None => " undefined".to_string(),
        Some(Value::Array(elements)) => format!(
            "[{}]",
            elements
                .iter()
                .map(|element| canonical(Some(element)))
                .collect::<Vec<_>>()
                .join(",")
        ),
        Some(Value::Object(fields)) => {
            let mut entries: Vec<(&String, &Value)> = fields.iter().collect();
            entries.sort_by(|left, right| utf16_order(left.0, right.0));
            let entries: Vec<String> = entries
                .into_iter()
                .map(|(key, field)| {
                    let key = serde_json::to_string(key).unwrap_or_default();
                    format!("{key}:{}", canonical(Some(field)))
                })
                .collect();
            format!("{{{}}}", entries.join(","))
        }
        Some(other) => serde_json::to_string(other).unwrap_or_default(),
    }
}

/// The order `sort` and `ordered` share, chosen once for the whole list: all numbers compare
/// numerically, anything else by its stringified form.
pub fn comparator(items: &[Item]) -> impl Fn(&Item, &Item) -> Ordering + use<> {
    let numeric = items
        .iter()
        .all(|item| matches!(item.value, Some(Value::Number(_))));
    move |left, right| {
        if numeric {
            let number = |item: &Item| item.value.as_ref().and_then(Value::as_f64);
            number(left)
                .partial_cmp(&number(right))
                .unwrap_or(Ordering::Equal)
        } else {
            utf16_order(
                &js_string(left.value.as_ref()),
                &js_string(right.value.as_ref()),
            )
        }
    }
}

fn walk_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.')
        .try_fold(value, |current, segment| current.as_object()?.get(segment))
}

fn holds(predicate: &Predicate, value: Option<&Value>) -> bool {
    let Some(Value::Object(fields)) = value else {
        return false;
    };
    let field = fields.get(&predicate.field);
    match &predicate.test {
        Test::Eq(expected) => canonical(field) == canonical(Some(&normalize(expected.clone()))),
        Test::Ne(expected) => canonical(field) != canonical(Some(&normalize(expected.clone()))),
        Test::Size(size) => {
            matches!(field, Some(Value::Array(elements)) if Some(elements.len()) == *size)
        }
        Test::NotIn(listed) => !listed
            .iter()
            .any(|entry| canonical(field) == canonical(Some(&normalize(entry.clone())))),
        Test::Lte(bound) => {
            matches!(field, Some(Value::Number(n)) if n.as_f64().is_some_and(|f| f <= *bound))
        }
        Test::Gte(bound) => {
            matches!(field, Some(Value::Number(n)) if n.as_f64().is_some_and(|f| f >= *bound))
        }
    }
}

fn admits(predicates: &[Predicate], value: Option<&Value>) -> bool {
    predicates.iter().all(|predicate| holds(predicate, value))
}

/// Enumerate a nested object's leaves; the dot path is both the key and the value.
fn flatten_leaves(value: Option<&Value>, prefix: &str, out: &mut Items) {
    let Some(Value::Object(fields)) = value else {
        if !prefix.is_empty() {
            out.push(item(prefix, Some(Value::String(prefix.to_string()))));
        }
        return;
    };
    for (key, inner) in fields {
        let path = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };
        flatten_leaves(Some(inner), &path, out);
    }
}

/// Capture group 1 of the first match, absent when nothing matches or the group is unbound.
fn first_group<'a>(regex: &Regex, text: &'a str) -> Option<&'a str> {
    text.get(regex.find(text)?.group(1)?)
}

fn json_step(items: Items) -> Result<Items, String> {
    items
        .into_iter()
        .map(|entry| {
            let text = js_string(entry.value.as_ref());
            let value = serde_json::from_str::<Value>(&text)
                .map_err(|_error| "the value is not valid JSON".to_string())?;
            Ok(item(entry.key, Some(normalize(value))))
        })
        .collect()
}

fn select_step(items: Items, path: &str) -> Items {
    items
        .into_iter()
        .flat_map(|entry| {
            let Some(root @ Value::Object(_)) = entry.value.as_ref() else {
                return Vec::new();
            };
            match walk_path(root, path) {
                None => Vec::new(),
                Some(Value::Array(elements)) => positioned(elements),
                Some(projected) => vec![item(entry.key, Some(projected.clone()))],
            }
        })
        .collect()
}

fn lines_step(items: &[Item]) -> Items {
    items
        .iter()
        .flat_map(|entry| {
            js_string(entry.value.as_ref())
                .split('\n')
                .enumerate()
                .map(|(index, line)| (index + 1, js_trim(line).to_string()))
                .filter(|(_, line)| !line.is_empty())
                .map(|(number, line)| item(number.to_string(), Some(Value::String(line))))
                .collect::<Vec<_>>()
        })
        .collect()
}

fn all_matches_step(items: &[Item], regex: &Regex) -> Items {
    items
        .iter()
        .flat_map(|entry| {
            let text = js_string(entry.value.as_ref());
            regex
                .find_iter(&text)
                .filter_map(|found| {
                    let whole = text.get(found.range())?;
                    let key = if found.captures.is_empty() {
                        whole
                    } else {
                        text.get(found.group(1)?)?
                    };
                    Some(item(key, Some(Value::String(whole.to_string()))))
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Adds the age of each turn against the snapshot clock and drops a turn that is undated or
/// dated after it.
fn age_step(items: Items) -> Items {
    items
        .into_iter()
        .filter_map(|entry| {
            let mut turn = entry.value.as_ref()?.as_object()?.clone();
            let age = turn.get("observedAtMs")?.as_f64()? - turn.get("timestampMs")?.as_f64()?;
            if age < 0.0 {
                return None;
            }
            turn.insert("ageMs".to_string(), number_value(age));
            Some(item(entry.key, Some(Value::Object(turn))))
        })
        .collect()
}

fn run_step(step: &Step, items: Items) -> Result<Items, String> {
    Ok(match step {
        Step::Json => json_step(items)?,
        Step::Select(path) => select_step(items, path),
        Step::Items => items
            .iter()
            .flat_map(|entry| match &entry.value {
                Some(Value::Array(elements)) => positioned(elements),
                _ => Vec::new(),
            })
            .collect(),
        Step::KeyBy(field) => items
            .into_iter()
            .filter_map(|entry| {
                let key = match entry.value.as_ref()?.as_object()?.get(field)? {
                    Value::Null | Value::Array(_) | Value::Object(_) => return None,
                    other => js_string(Some(other)),
                };
                Some(item(key, entry.value))
            })
            .collect(),
        Step::Field(name) => items
            .into_iter()
            .filter_map(|entry| {
                let property = entry.value.as_ref()?.as_object()?.get(name).cloned();
                Some(item(entry.key, property))
            })
            .collect(),
        Step::Filter(predicates) => items
            .into_iter()
            .filter(|entry| admits(predicates, entry.value.as_ref()))
            .collect(),
        Step::AfterLast(predicates) => {
            match items
                .iter()
                .rposition(|entry| admits(predicates, entry.value.as_ref()))
            {
                Some(last) => items.into_iter().skip(last + 1).collect(),
                None => items,
            }
        }
        Step::FlattenKeys => {
            let mut leaves = Vec::new();
            for entry in &items {
                flatten_leaves(entry.value.as_ref(), "", &mut leaves);
            }
            leaves
        }
        Step::Sort => {
            let mut sorted = items;
            let order = comparator(&sorted);
            sorted.sort_by(|left, right| order(left, right));
            sorted
        }
        Step::Lines => lines_step(&items),
        Step::KeyByPattern(regex) => items
            .into_iter()
            .filter_map(|entry| {
                let text = js_string(entry.value.as_ref());
                let key = first_group(regex, &text)?.to_string();
                Some(item(key, entry.value))
            })
            .collect(),
        Step::AllMatches(regex) => all_matches_step(&items, regex),
        Step::Matches(regex) => items
            .into_iter()
            .filter(|entry| regex.find(&js_string(entry.value.as_ref())).is_some())
            .collect(),
        Step::ToolUses {
            names,
            subagent_type,
        } => items
            .iter()
            .flat_map(|entry| tool_uses(entry, names.as_deref(), subagent_type.as_deref()))
            .collect(),
        Step::UserTexts(regex) => items
            .iter()
            .flat_map(|entry| user_texts(entry, regex))
            .collect(),
        Step::AgentType(wanted) => items
            .iter()
            .flat_map(|entry| agent_records(entry.value.as_ref(), wanted))
            .collect(),
        Step::First => items.into_iter().take(1).collect(),
        Step::Drop(count) => items.into_iter().skip(*count).collect(),
        Step::AgeMs => age_step(items),
    })
}

/// The two lists of a session snapshot, when the value is one.
type SnapshotLists<'a> = (&'a Map<String, Value>, &'a [Value], &'a [Value]);

fn snapshot_lists(entry: &Item) -> Option<SnapshotLists<'_>> {
    let snapshot = entry.value.as_ref()?.as_object()?;
    let messages = snapshot.get("userMessages")?.as_array()?;
    let calls = snapshot.get("toolCalls")?.as_array()?;
    Some((snapshot, messages, calls))
}

fn tool_uses(entry: &Item, names: Option<&[Value]>, subagent_type: Option<&str>) -> Items {
    let Some((_, _, calls)) = snapshot_lists(entry) else {
        return Vec::new();
    };
    calls
        .iter()
        .filter(|call| {
            names.is_none_or(|names| call.get("name").is_some_and(|name| names.contains(name)))
        })
        .filter(|call| {
            subagent_type.is_none_or(|kind| {
                call.get("args")
                    .and_then(|args| args.get("subagent_type"))
                    .and_then(Value::as_str)
                    == Some(kind)
            })
        })
        .map(|call| item(js_string(call.get("index")), Some(call.clone())))
        .collect()
}

fn user_texts(entry: &Item, regex: &Regex) -> Items {
    let Some((snapshot, messages, _)) = snapshot_lists(entry) else {
        return Vec::new();
    };
    messages
        .iter()
        .filter(|turn| regex.find(&js_string(turn.get("text"))).is_some())
        .filter_map(|turn| {
            let mut value = turn.as_object()?.clone();
            value.insert(
                "observedAtMs".to_string(),
                snapshot.get("observedAtMs")?.clone(),
            );
            Some(item(
                js_string(turn.get("index")),
                Some(Value::Object(value)),
            ))
        })
        .collect()
}

fn agent_records(value: Option<&Value>, wanted: &str) -> Items {
    let records: &[Value] = match value {
        Some(Value::Array(records)) => records,
        Some(single @ Value::Object(_)) => std::slice::from_ref(single),
        _ => &[],
    };
    records
        .iter()
        .enumerate()
        .filter(|(_, record)| {
            record.get("agentType").and_then(Value::as_str) == Some(wanted) && record.is_object()
        })
        .map(|(index, record)| item(index.to_string(), Some(record.clone())))
        .collect()
}
