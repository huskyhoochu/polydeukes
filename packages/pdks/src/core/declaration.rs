//! A discipline's declaration: its grammar is validated and it is compiled into the form the
//! judge runs in one pass. A declaration that passes carries compiled regular expressions,
//! typed pipelines and relate entries; one that fails answers the first fault found.

use std::fmt;

use regress::{Flags, Regex};
use serde_json::{Map, Value};

use super::validation::{normalize_relative, reject_unknown_keys};

/// Where a declaration is wrong and why.
pub struct Fault {
    pub location: String,
    pub reason: String,
}

impl fmt::Display for Fault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.location, self.reason)
    }
}

type Check<T> = Result<T, Fault>;

fn fail<T>(location: &str, reason: impl Into<String>) -> Check<T> {
    Err(Fault {
        location: location.to_string(),
        reason: reason.into(),
    })
}

const FIXED_SOURCES: [&str; 7] = [
    "target.path",
    "pre",
    "post",
    "state",
    "changes",
    "command",
    "actor",
];
const STRING_SOURCES: [&str; 4] = ["target.path", "pre", "post", "command"];
const SOURCE_KINDS: [&str; 3] = ["file", "sidecar", "transcript"];
const COMBINATORS: [&str; 3] = ["union", "onlyIn", "intersect"];
const SUPPLY_POLICIES: [&str; 3] = ["error", "pass", "empty"];
const PAIRED_SOURCE: &str = "state";
const STEP_NAMES: [&str; 20] = [
    "source",
    "json",
    "select",
    "items",
    "keyBy",
    "keyByPattern",
    "allMatches",
    "field",
    "filter",
    "afterLast",
    "flattenKeys",
    "sort",
    "lines",
    "matches",
    "toolUses",
    "userTexts",
    "agentType",
    "first",
    "drop",
    "ageMs",
];

#[derive(Clone)]
pub enum Binding {
    File(String),
    Sidecar,
    Transcript,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Supply {
    Error,
    Pass,
    Empty,
}

#[derive(Clone)]
pub struct Scope {
    pub source: String,
    pub include: Vec<Regex>,
    pub exclude: Vec<Regex>,
}

#[derive(Clone)]
pub enum Head {
    Source(String),
    Union(String, String),
    OnlyIn {
        of: String,
        not_in: String,
        count: bool,
    },
    Intersect(String, String),
}

impl Head {
    fn references(&self) -> Vec<&str> {
        match self {
            Self::Source(_) => Vec::new(),
            Self::Union(left, right) | Self::Intersect(left, right) => vec![left, right],
            Self::OnlyIn { of, not_in, .. } => vec![of, not_in],
        }
    }
}

#[derive(Clone)]
pub enum Test {
    Eq(Value),
    Ne(Value),
    Size(Option<usize>),
    NotIn(Vec<Value>),
    Lte(f64),
    Gte(f64),
}

#[derive(Clone)]
pub struct Predicate {
    pub field: String,
    pub test: Test,
}

#[derive(Clone)]
pub enum Step {
    Json,
    Select(String),
    Items,
    KeyBy(String),
    KeyByPattern(Regex),
    AllMatches(Regex),
    Field(String),
    Filter(Vec<Predicate>),
    AfterLast(Vec<Predicate>),
    FlattenKeys,
    Sort,
    Lines,
    Matches(Regex),
    ToolUses {
        names: Option<Vec<Value>>,
        subagent_type: Option<String>,
    },
    UserTexts(Regex),
    AgentType(String),
    First,
    Drop(usize),
    AgeMs,
}

#[derive(Clone)]
pub struct Pipeline {
    pub name: String,
    pub head: Head,
    pub steps: Vec<Step>,
}

impl Pipeline {
    /// A pipeline over the paired source runs once per side.
    pub fn paired(&self) -> bool {
        matches!(&self.head, Head::Source(name) if name == PAIRED_SOURCE)
    }
}

#[derive(Clone)]
pub enum Relation {
    Empty(String),
    NonEmpty(String),
    Equal(String, String),
    Subset { of: String, within: String },
    Implies { of: String, requires: String },
    Ordered { of: String, strict: bool },
    Unchanged(String),
}

impl Relation {
    fn name(&self) -> &'static str {
        match self {
            Self::Empty(_) => "empty",
            Self::NonEmpty(_) => "nonEmpty",
            Self::Equal(..) => "equal",
            Self::Subset { .. } => "subset",
            Self::Implies { .. } => "implies",
            Self::Ordered { .. } => "ordered",
            Self::Unchanged(_) => "unchanged",
        }
    }

    fn references(&self) -> Vec<&str> {
        match self {
            Self::Empty(of)
            | Self::NonEmpty(of)
            | Self::Ordered { of, .. }
            | Self::Unchanged(of) => vec![of],
            Self::Equal(left, right) => vec![left, right],
            Self::Subset { of, within: other }
            | Self::Implies {
                of,
                requires: other,
            } => {
                vec![of, other]
            }
        }
    }
}

#[derive(Clone)]
pub enum Message {
    One(String),
    BySide { left: String, right: String },
}

#[derive(Clone)]
pub struct Relate {
    pub id: String,
    pub relation: Relation,
    pub message: Message,
}

/// A compiled declaration. `pipelines` holds the body's extractions and then the witness
/// block's own; `witness` is the witness block's relate entries.
#[derive(Clone)]
pub struct Declaration {
    pub scope: Option<Scope>,
    pub sources: Vec<(String, Binding)>,
    pub supply: Vec<(String, Supply)>,
    pub pipelines: Vec<Pipeline>,
    pub relate: Vec<Relate>,
    pub witness: Option<Vec<Relate>>,
}

impl Declaration {
    /// What an absent source does; the default is an error.
    pub fn supply_of(&self, source: &str) -> Supply {
        self.supply
            .iter()
            .find(|(name, _)| name == source)
            .map_or(Supply::Error, |(_, policy)| *policy)
    }

    fn head_sources(&self) -> impl Iterator<Item = &str> {
        self.pipelines
            .iter()
            .filter_map(|pipeline| match &pipeline.head {
                Head::Source(name) => Some(name.as_str()),
                _ => None,
            })
    }

    /// True when the declaration reads the change itself: `pre`, `post`, `state` or the path.
    pub fn reads_change(&self) -> bool {
        const CHANGE_SOURCES: [&str; 4] = ["target.path", "pre", "post", "state"];
        self.head_sources()
            .chain(self.scope.iter().map(|scope| scope.source.as_str()))
            .any(|name| CHANGE_SOURCES.contains(&name))
    }

    /// Whether the declaration reads anything a shell call carries without a file change.
    pub fn reads_call(&self) -> bool {
        self.head_sources()
            .chain(self.scope.iter().map(|scope| scope.source.as_str()))
            .any(|name| name == "command" || name == "actor")
    }

    /// The evidence channels the declaration binds, in a fixed order.
    pub fn channels(&self) -> Vec<&'static str> {
        let mut found = Vec::new();
        let mut reads = |channel: &'static str, bound: bool| {
            if bound && !found.contains(&channel) {
                found.push(channel);
            }
        };
        let binds = |wanted: fn(&Binding) -> bool| self.sources.iter().any(|(_, b)| wanted(b));
        reads("transcript", binds(|b| matches!(b, Binding::Transcript)));
        reads("channel", binds(|b| matches!(b, Binding::Sidecar)));
        let named = |wanted: &str| {
            self.scope
                .as_ref()
                .is_some_and(|scope| scope.source == wanted)
                || self.head_sources().any(|name| name == wanted)
        };
        reads("command", named("command"));
        reads("actor", self.head_sources().any(|name| name == "actor"));
        reads("changes", self.head_sources().any(|name| name == "changes"));
        let order = ["transcript", "channel", "command", "actor", "changes"];
        order
            .into_iter()
            .filter(|name| found.contains(name))
            .collect()
    }
}

fn quoted(names: &[&str]) -> String {
    names
        .iter()
        .map(|name| format!("'{name}'"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn only_keys(map: &Map<String, Value>, allowed: &[&str], location: &str) -> Check<()> {
    reject_unknown_keys(map, allowed, location).or_else(|reason| fail(location, reason))
}

fn object<'a>(value: &'a Value, location: &str, what: &str) -> Check<&'a Map<String, Value>> {
    match value.as_object() {
        Some(map) => Ok(map),
        None => fail(location, format!("{what} must be an object")),
    }
}

fn text(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
}

fn pattern(source: &str, ignore_case: bool) -> Option<Regex> {
    Regex::with_flags(source, Flags::from(if ignore_case { "i" } else { "" })).ok()
}

/// Validate and compile the declaration block of the entry `id`.
pub fn compile_declaration(id: &str, block: &Map<String, Value>) -> Check<Declaration> {
    let keys = [
        "mechanism",
        "scope",
        "sources",
        "supply",
        "extract",
        "relate",
        "witness",
    ];
    only_keys(block, &keys, &format!("{id} declare"))?;
    let Some(mechanism) = text(block.get("mechanism")) else {
        return fail(id, "mechanism must be a non-empty string");
    };
    let sources = block
        .get("sources")
        .map(|value| parse_sources(id, value))
        .transpose()?
        .unwrap_or_default();
    let scope = block
        .get("scope")
        .map(|value| parse_scope(id, value, &sources))
        .transpose()?;
    let supply = block
        .get("supply")
        .map(|value| parse_supply(id, value, &sources))
        .transpose()?
        .unwrap_or_default();
    let Some(extract) = block.get("extract") else {
        return fail(id, "needs an extract block");
    };
    let mut pipelines = parse_extract(id, extract, "extract", &sources, &[])?;
    let Some(relate) = block.get("relate") else {
        return fail(id, "needs a relate array");
    };
    let mut ids = Vec::new();
    let relate = parse_relate(id, "relate", relate, &pipelines, &mut ids)?;
    let witness = block
        .get("witness")
        .map(|value| parse_witness(id, value, &sources, &mut pipelines, &mut ids))
        .transpose()?;
    let declaration = Declaration {
        scope,
        sources,
        supply,
        pipelines,
        relate,
        witness,
    };
    check_mechanism(id, mechanism, &declaration)?;
    Ok(declaration)
}

fn parse_sources(id: &str, value: &Value) -> Check<Vec<(String, Binding)>> {
    let location = format!("{id} sources");
    let mut bindings = Vec::new();
    for (name, entry) in object(value, &location, "sources")? {
        let here = format!("{location}.{name}");
        if name.is_empty() {
            return fail(&location, "sources carries an empty source name");
        }
        if FIXED_SOURCES.contains(&name.as_str()) {
            return fail(
                &here,
                format!(
                    "shadows the world's own source of that name — the fixed names are {}",
                    quoted(&FIXED_SOURCES)
                ),
            );
        }
        let entry = object(entry, &here, "the binding")?;
        let kinds: Vec<&str> = entry
            .keys()
            .map(String::as_str)
            .filter(|key| SOURCE_KINDS.contains(key))
            .collect();
        only_keys(entry, &SOURCE_KINDS, &here)?;
        let binding = match kinds.as_slice() {
            ["file"] => Binding::File(parse_file(entry.get("file"), &here)?),
            [marker @ ("sidecar" | "transcript")] => {
                if entry.get(*marker) != Some(&Value::Bool(true)) {
                    return fail(&here, format!("{marker} must be the literal true"));
                }
                if *marker == "sidecar" {
                    Binding::Sidecar
                } else {
                    Binding::Transcript
                }
            }
            _ => {
                let reason = format!(
                    "must name exactly one kind, one of {}",
                    quoted(&SOURCE_KINDS)
                );
                return fail(&here, reason);
            }
        };
        bindings.push((name.clone(), binding));
    }
    Ok(bindings)
}

/// A repo-relative path the supply layer can join onto the root, normalized once.
fn parse_file(value: Option<&Value>, location: &str) -> Check<String> {
    let Some(file) = text(value) else {
        return fail(location, "file must be a non-empty string");
    };
    if file.starts_with('/') {
        return fail(
            location,
            format!("file must be a repo-relative path, not '{file}'"),
        );
    }
    if file.split('/').any(|segment| segment == "..") {
        return fail(location, format!("file carries a '..' segment: '{file}'"));
    }
    Ok(normalize_relative(file))
}

fn is_file_source(sources: &[(String, Binding)], name: &str) -> bool {
    sources
        .iter()
        .any(|(bound, binding)| bound == name && matches!(binding, Binding::File(_)))
}

fn parse_scope(id: &str, value: &Value, sources: &[(String, Binding)]) -> Check<Scope> {
    let location = format!("{id} scope");
    let scope = object(value, &location, "scope")?;
    only_keys(
        scope,
        &["source", "include", "exclude", "excludeIgnoreCase"],
        &location,
    )?;
    let Some(source) = text(scope.get("source")) else {
        return fail(&location, "source must be a non-empty string");
    };
    if !STRING_SOURCES.contains(&source) && !is_file_source(sources, source) {
        return fail(
            &location,
            format!(
                "source '{source}' is not a string-valued source; scope admits {}, or a file source",
                quoted(&STRING_SOURCES)
            ),
        );
    }
    let ignore_case = match scope.get("excludeIgnoreCase") {
        None => false,
        Some(Value::Bool(flag)) => *flag,
        Some(_) => return fail(&location, "excludeIgnoreCase must be a boolean"),
    };
    Ok(Scope {
        source: source.to_string(),
        include: scope_patterns(scope, "include", false, &location)?,
        exclude: scope_patterns(scope, "exclude", ignore_case, &location)?,
    })
}

fn scope_patterns(
    scope: &Map<String, Value>,
    key: &str,
    ignore_case: bool,
    location: &str,
) -> Check<Vec<Regex>> {
    let Some(list) = scope.get(key) else {
        return Ok(Vec::new());
    };
    let items: Option<Vec<&str>> = list
        .as_array()
        .and_then(|items| items.iter().map(Value::as_str).collect());
    let Some(items) = items else {
        return fail(location, format!("{key} must be an array of strings"));
    };
    items
        .into_iter()
        .map(|source| match pattern(source, ignore_case) {
            Some(regex) => Ok(regex),
            None => fail(
                location,
                format!("cannot compile the expression '{source}'"),
            ),
        })
        .collect()
}

fn parse_supply(
    id: &str,
    value: &Value,
    sources: &[(String, Binding)],
) -> Check<Vec<(String, Supply)>> {
    let location = format!("{id} supply");
    let mut policies = Vec::new();
    for (source, policy) in object(value, &location, "supply")? {
        let declared = sources.iter().any(|(name, _)| name == source);
        if !FIXED_SOURCES.contains(&source.as_str()) && !declared {
            return fail(
                &location,
                format!("names the source '{source}', which no fixed name or binding supplies"),
            );
        }
        let policy = match policy.as_str() {
            Some("error") => Supply::Error,
            Some("pass") => Supply::Pass,
            Some("empty") if source == PAIRED_SOURCE => {
                return fail(
                    &location,
                    "'empty' does not apply to the paired source — an absent pair is not two empty states",
                );
            }
            Some("empty") => Supply::Empty,
            _ => {
                let reason = format!("{source} must be one of {}", quoted(&SUPPLY_POLICIES));
                return fail(&location, reason);
            }
        };
        policies.push((source.clone(), policy));
    }
    Ok(policies)
}

/// One extract block. `outer` is the extractions an inner block may also reference.
fn parse_extract(
    id: &str,
    value: &Value,
    label: &str,
    sources: &[(String, Binding)],
    outer: &[Pipeline],
) -> Check<Vec<Pipeline>> {
    let location = format!("{id} {label}");
    let mut pipelines = Vec::new();
    for (name, steps) in object(value, &location, label)? {
        pipelines.push(parse_pipeline(
            &format!("{location} {name}"),
            name,
            steps,
            sources,
        )?);
    }
    for pipeline in &pipelines {
        let here = format!("{location} {}", pipeline.name);
        for target in pipeline.head.references() {
            let known = pipelines
                .iter()
                .chain(outer)
                .find(|other| other.name == target);
            match known {
                None => {
                    return fail(
                        &here,
                        format!("references '{target}', which no extract defines"),
                    );
                }
                Some(other) if other.paired() => {
                    return fail(
                        &here,
                        format!(
                            "combines '{target}', which reads a before/after pair — a combinator takes single extractions"
                        ),
                    );
                }
                Some(_) => {}
            }
        }
        if reaches_itself(&pipelines, &pipeline.name) {
            return fail(&here, "takes part in a reference cycle");
        }
    }
    Ok(pipelines)
}

fn reaches_itself(pipelines: &[Pipeline], start: &str) -> bool {
    let mut stack = vec![start];
    let mut seen: Vec<&str> = Vec::new();
    while let Some(name) = stack.pop() {
        let Some(pipeline) = pipelines.iter().find(|pipeline| pipeline.name == name) else {
            continue;
        };
        for target in pipeline.head.references() {
            if target == start {
                return true;
            }
            if !seen.contains(&target) {
                seen.push(target);
                stack.push(target);
            }
        }
    }
    false
}

fn parse_pipeline(
    location: &str,
    name: &str,
    steps: &Value,
    sources: &[(String, Binding)],
) -> Check<Pipeline> {
    let Some((first, rest)) = steps.as_array().and_then(|steps| steps.split_first()) else {
        return fail(location, "must be a non-empty array of steps");
    };
    let head = parse_head(location, first, sources)?;
    let steps = rest
        .iter()
        .map(|step| parse_step(location, step))
        .collect::<Check<Vec<_>>>()?;
    Ok(Pipeline {
        name: name.to_string(),
        head,
        steps,
    })
}

fn parse_head(location: &str, step: &Value, sources: &[(String, Binding)]) -> Check<Head> {
    let args = object(step, location, "a step")?;
    let Some(op) = text(args.get("op")) else {
        return fail(location, "op must be a non-empty string");
    };
    let reference = |key: &str| match text(args.get(key)) {
        Some(name) => Ok(name.to_string()),
        None => fail(location, format!("'{op}' takes a string '{key}'")),
    };
    let pair = || match args.get("of").and_then(Value::as_array).map(Vec::as_slice) {
        Some([Value::String(left), Value::String(right)])
            if !left.is_empty() && !right.is_empty() && left != right =>
        {
            Ok((left.clone(), right.clone()))
        }
        _ => fail(
            location,
            format!("'{op}' takes 'of' as two distinct extract names"),
        ),
    };
    match op {
        "source" => {
            only_keys(args, &["op", "of"], location)?;
            let of = reference("of")?;
            let bound = sources.iter().any(|(name, _)| *name == of);
            if !FIXED_SOURCES.contains(&of.as_str()) && !bound {
                return fail(
                    location,
                    format!(
                        "reads the source '{of}', which is neither a fixed name nor bound by this declaration"
                    ),
                );
            }
            Ok(Head::Source(of))
        }
        "union" | "intersect" => {
            only_keys(args, &["op", "of"], location)?;
            let (left, right) = pair()?;
            Ok(if op == "union" {
                Head::Union(left, right)
            } else {
                Head::Intersect(left, right)
            })
        }
        "onlyIn" => {
            only_keys(args, &["op", "of", "notIn", "count"], location)?;
            let (of, not_in) = (reference("of")?, reference("notIn")?);
            if of == not_in {
                return fail(location, format!("'onlyIn' names '{of}' on both sides"));
            }
            let count = match args.get("count") {
                None => false,
                Some(Value::Bool(flag)) => *flag,
                Some(_) => return fail(location, "'onlyIn' takes 'count' as a boolean"),
            };
            Ok(Head::OnlyIn { of, not_in, count })
        }
        _ => fail(
            location,
            format!(
                "a pipeline begins with 'source' or one of {} — found '{op}'",
                COMBINATORS.join(", ")
            ),
        ),
    }
}

fn string_arg(args: &Map<String, Value>, key: &str, op: &str, location: &str) -> Check<String> {
    match text(args.get(key)) {
        Some(value) => Ok(value.to_string()),
        None => fail(
            location,
            format!("'{op}' needs '{key}' as a non-empty string"),
        ),
    }
}

fn regex_arg(args: &Map<String, Value>, op: &str, location: &str) -> Check<Regex> {
    let source = string_arg(args, "re", op, location)?;
    let ignore_case = match args.get("i") {
        None => false,
        Some(Value::Bool(flag)) => *flag,
        Some(_) => return fail(location, format!("'{op}' takes 'i' as a boolean")),
    };
    match pattern(&source, ignore_case) {
        Some(regex) => Ok(regex),
        None => fail(
            location,
            format!("'{op}' cannot compile the expression '{source}'"),
        ),
    }
}

/// A non-negative whole number as a count. YAML reads `2.0` as a float, and the JS original
/// accepts it as the integer it equals.
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the filter admits only whole values in 0..=2^53, which a usize holds exactly"
)]
fn whole(value: &Value) -> Option<usize> {
    value
        .as_f64()
        .filter(|n| n.fract() == 0.0 && (0.0..=9_007_199_254_740_991.0).contains(n))
        .map(|n| n as usize)
}

/// How many capture groups an expression has: the alternation with an empty branch always
/// matches, and a match carries one slot per group.
fn group_count(source: &str) -> usize {
    pattern(&format!("(?:{source})|"), false)
        .and_then(|regex| regex.find(""))
        .map_or(0, |found| found.captures.len())
}

fn parse_predicates(args: &Map<String, Value>, op: &str, location: &str) -> Check<Vec<Predicate>> {
    let Some(when) = args.get("when").and_then(Value::as_array) else {
        return fail(
            location,
            format!("'{op}' needs 'when' as an array of predicates"),
        );
    };
    when.iter()
        .map(|predicate| {
            let Some(predicate) = predicate.as_object() else {
                return fail(
                    location,
                    format!("each '{op}' predicate needs a string 'field'"),
                );
            };
            let Some(field) = predicate.get("field").and_then(Value::as_str) else {
                return fail(
                    location,
                    format!("each '{op}' predicate needs a string 'field'"),
                );
            };
            let mut operators = predicate.iter().filter(|(key, _)| *key != "field");
            let (Some((name, operand)), None) = (operators.next(), operators.next()) else {
                return fail(
                    location,
                    format!("each '{op}' predicate takes exactly one operator"),
                );
            };
            let number = || {
                operand.as_f64().map_or_else(
                    || {
                        fail(
                            location,
                            format!("'{op}' predicate '{name}' compares against a number"),
                        )
                    },
                    Ok,
                )
            };
            let test = match name.as_str() {
                "eq" => Test::Eq(operand.clone()),
                "ne" => Test::Ne(operand.clone()),
                "size" => {
                    number()?;
                    Test::Size(whole(operand))
                }
                "lte" => Test::Lte(number()?),
                "gte" => Test::Gte(number()?),
                "notIn" => match operand.as_array() {
                    Some(listed) => Test::NotIn(listed.clone()),
                    None => {
                        return fail(
                            location,
                            format!("'{op}' predicate 'notIn' takes an array of values"),
                        );
                    }
                },
                _ => {
                    return fail(
                        location,
                        format!("each '{op}' predicate takes exactly one operator"),
                    );
                }
            };
            Ok(Predicate {
                field: field.to_string(),
                test,
            })
        })
        .collect()
}

fn parse_step(location: &str, step: &Value) -> Check<Step> {
    let args = object(step, location, "a step")?;
    let Some(op) = text(args.get("op")) else {
        return fail(location, "op must be a non-empty string");
    };
    if op == "source" {
        return fail(
            location,
            "'source' stands only as the first step of a pipeline",
        );
    }
    if COMBINATORS.contains(&op) {
        return fail(
            location,
            format!("'{op}' stands only as the first step of a pipeline"),
        );
    }
    if args.get("of").is_some_and(Value::is_array) || args.contains_key("notIn") {
        return fail(
            location,
            format!(
                "op '{op}' references two extractions but is not one of {}",
                COMBINATORS.join(", ")
            ),
        );
    }
    let allowed: &[&str] = match op {
        "select" => &["path"],
        "keyBy" => &["field"],
        "field" => &["name"],
        "filter" | "afterLast" => &["when"],
        "keyByPattern" | "allMatches" | "matches" | "userTexts" => &["re", "i"],
        "toolUses" => &["names", "subagentType"],
        "agentType" => &["is"],
        "drop" => &["n"],
        "json" | "items" | "flattenKeys" | "sort" | "lines" | "first" | "ageMs" => &[],
        _ => {
            return fail(
                location,
                format!(
                    "'{op}' is not a registered extract step — the registry carries {}",
                    STEP_NAMES.join(", ")
                ),
            );
        }
    };
    if let Some(key) = args
        .keys()
        .find(|key| *key != "op" && !allowed.contains(&key.as_str()))
    {
        return fail(
            location,
            format!("'{op}' does not take the argument '{key}'"),
        );
    }
    build_step(op, args, location)
}

/// The typed step for a registered `op` whose arguments are all admitted keys.
fn build_step(op: &str, args: &Map<String, Value>, location: &str) -> Check<Step> {
    let text_arg = |key: &str| string_arg(args, key, op, location);
    Ok(match op {
        "json" => Step::Json,
        "items" => Step::Items,
        "flattenKeys" => Step::FlattenKeys,
        "sort" => Step::Sort,
        "lines" => Step::Lines,
        "first" => Step::First,
        "ageMs" => Step::AgeMs,
        "select" => Step::Select(text_arg("path")?),
        "keyBy" => Step::KeyBy(text_arg("field")?),
        "field" => Step::Field(text_arg("name")?),
        "agentType" => Step::AgentType(text_arg("is")?),
        "filter" => Step::Filter(parse_predicates(args, op, location)?),
        "afterLast" => Step::AfterLast(parse_predicates(args, op, location)?),
        "matches" => Step::Matches(regex_arg(args, op, location)?),
        "allMatches" => Step::AllMatches(regex_arg(args, op, location)?),
        "userTexts" => Step::UserTexts(regex_arg(args, op, location)?),
        "keyByPattern" => {
            let regex = regex_arg(args, op, location)?;
            if group_count(&text_arg("re")?) == 0 {
                return fail(location, "'keyByPattern' needs at least one capture group");
            }
            Step::KeyByPattern(regex)
        }
        "toolUses" => {
            let names = match args.get("names") {
                None => None,
                Some(Value::Array(names)) => Some(names.clone()),
                Some(_) => {
                    return fail(
                        location,
                        "'toolUses' takes 'names' as an array of tool names",
                    );
                }
            };
            let subagent_type = match args.get("subagentType") {
                None => None,
                Some(Value::String(kind)) => Some(kind.clone()),
                Some(_) => return fail(location, "'toolUses' takes 'subagentType' as a string"),
            };
            Step::ToolUses {
                names,
                subagent_type,
            }
        }
        _ => {
            let count = args.get("n").and_then(whole);
            match count {
                Some(count) => Step::Drop(count),
                None => return fail(location, "'drop' needs 'n' as a non-negative integer"),
            }
        }
    })
}

fn parse_relate(
    id: &str,
    label: &str,
    value: &Value,
    pipelines: &[Pipeline],
    ids: &mut Vec<String>,
) -> Check<Vec<Relate>> {
    let location = format!("{id} {label}");
    let Some(entries) = value.as_array().filter(|entries| !entries.is_empty()) else {
        return fail(&location, "must be a non-empty array");
    };
    let mut relate = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let here = format!("{location}[{index}]");
        let entry = object(entry, &here, "the entry")?;
        only_keys(
            entry,
            &["id", "relation", "message", "messageBySide"],
            &here,
        )?;
        let Some(entry_id) = text(entry.get("id")) else {
            return fail(&here, "id must be a non-empty string");
        };
        if ids.iter().any(|seen| seen == entry_id) {
            return fail(&here, format!("duplicates the entry id '{entry_id}'"));
        }
        ids.push(entry_id.to_string());
        let here = format!("{here} '{entry_id}'");
        let relation = parse_relation(&here, entry.get("relation"))?;
        check_references(&here, &relation, pipelines)?;
        let message = parse_message(&here, entry, &relation)?;
        relate.push(Relate {
            id: entry_id.to_string(),
            relation,
            message,
        });
    }
    Ok(relate)
}

fn parse_relation(location: &str, value: Option<&Value>) -> Check<Relation> {
    let Some(relation) = value.and_then(Value::as_object) else {
        return fail(location, "relation must be an object");
    };
    let op = relation
        .get("op")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let name_of = |key: &str| match text(relation.get(key)) {
        Some(name) => Ok(name.to_string()),
        None => fail(
            location,
            format!("relation {op} needs '{key}' as an extract name"),
        ),
    };
    let allowed: &[&str] = match op {
        "empty" | "nonEmpty" | "equal" | "unchanged" => &["op", "of"],
        "subset" => &["op", "of", "in"],
        "implies" => &["op", "of", "requires"],
        "ordered" => &["op", "of", "strict"],
        _ => {
            let names = [
                "empty",
                "nonEmpty",
                "equal",
                "subset",
                "implies",
                "ordered",
                "unchanged",
            ];
            return fail(
                location,
                format!("relation op is '{op}' — must be one of {}", quoted(&names)),
            );
        }
    };
    only_keys(relation, allowed, location)?;
    Ok(match op {
        "empty" => Relation::Empty(name_of("of")?),
        "nonEmpty" => Relation::NonEmpty(name_of("of")?),
        "unchanged" => Relation::Unchanged(name_of("of")?),
        "subset" => Relation::Subset {
            of: name_of("of")?,
            within: name_of("in")?,
        },
        "implies" => Relation::Implies {
            of: name_of("of")?,
            requires: name_of("requires")?,
        },
        "ordered" => {
            let strict = match relation.get("strict") {
                None => false,
                Some(Value::Bool(flag)) => *flag,
                Some(_) => return fail(location, "relation ordered strict must be a boolean"),
            };
            Relation::Ordered {
                of: name_of("of")?,
                strict,
            }
        }
        _ => match relation
            .get("of")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
        {
            Some([Value::String(left), Value::String(right)])
                if !left.is_empty() && !right.is_empty() && left != right =>
            {
                Relation::Equal(left.clone(), right.clone())
            }
            _ => {
                return fail(
                    location,
                    "relation equal takes 'of' as two distinct extract names",
                );
            }
        },
    })
}

/// Every name resolves, and a pair is compared only by `unchanged`.
fn check_references(location: &str, relation: &Relation, pipelines: &[Pipeline]) -> Check<()> {
    let wants_pair = matches!(relation, Relation::Unchanged(_));
    for name in relation.references() {
        let Some(pipeline) = pipelines.iter().find(|pipeline| pipeline.name == name) else {
            return fail(
                location,
                format!("references '{name}', which no extract in scope defines"),
            );
        };
        if pipeline.paired() != wants_pair {
            let reason = if wants_pair {
                format!(
                    "'unchanged' compares a before/after pair, and '{name}' reads a single state"
                )
            } else {
                format!(
                    "'{}' takes a single extraction, and '{name}' reads a before/after pair",
                    relation.name()
                )
            };
            return fail(location, reason);
        }
    }
    Ok(())
}

fn parse_message(
    location: &str,
    entry: &Map<String, Value>,
    relation: &Relation,
) -> Check<Message> {
    match (entry.get("message"), entry.get("messageBySide")) {
        (Some(message), None) => match message.as_str().filter(|message| !message.is_empty()) {
            Some(message) => Ok(Message::One(message.to_string())),
            None => fail(location, "message must be a non-empty string"),
        },
        (None, Some(by_side)) => {
            if !matches!(relation, Relation::Equal(..)) {
                let reason = format!(
                    "carries messageBySide on {} — only equal has two sides",
                    relation.name()
                );
                return fail(location, reason);
            }
            let by_side = object(by_side, location, "messageBySide")?;
            only_keys(by_side, &["left", "right"], location)?;
            match (text(by_side.get("left")), text(by_side.get("right"))) {
                (Some(left), Some(right)) => Ok(Message::BySide {
                    left: left.to_string(),
                    right: right.to_string(),
                }),
                _ => fail(
                    location,
                    "messageBySide needs a non-empty 'left' and 'right'",
                ),
            }
        }
        _ => fail(
            location,
            "needs exactly one of 'message' and 'messageBySide'",
        ),
    }
}

fn parse_witness(
    id: &str,
    value: &Value,
    sources: &[(String, Binding)],
    pipelines: &mut Vec<Pipeline>,
    ids: &mut Vec<String>,
) -> Check<Vec<Relate>> {
    let location = format!("{id} witness");
    let witness = object(value, &location, "witness")?;
    only_keys(witness, &["extract", "relate"], &location)?;
    if let Some(extract) = witness.get("extract") {
        let own = parse_extract(id, extract, "witness.extract", sources, pipelines)?;
        if let Some(shadow) = own
            .iter()
            .find(|own| pipelines.iter().any(|body| body.name == own.name))
        {
            let reason = format!(
                "extract '{}' shadows the body extract of the same name",
                shadow.name
            );
            return fail(&location, reason);
        }
        pipelines.extend(own);
    }
    let Some(relate) = witness.get("relate") else {
        return fail(&location, "needs a relate array");
    };
    parse_relate(id, "witness relate", relate, pipelines, ids)
}

struct Mechanism {
    name: &'static str,
    axes: &'static [&'static str],
    relations: &'static [&'static str],
    witness: bool,
    scope: Option<&'static str>,
}

const ALL_AXES: &[&str] = &["change", "actor", "world", "history"];
const ALL_RELATIONS: &[&str] = &[
    "empty",
    "nonEmpty",
    "equal",
    "subset",
    "implies",
    "ordered",
    "unchanged",
];

const fn shape(
    name: &'static str,
    axes: &'static [&'static str],
    relations: &'static [&'static str],
) -> Mechanism {
    Mechanism {
        name,
        axes,
        relations,
        witness: false,
        scope: None,
    }
}

const MECHANISMS: [Mechanism; 17] = [
    shape("pairing", &["world"], &["equal", "subset"]),
    shape("companion", &["change", "world"], &["implies"]),
    shape("monotonic-order", &["change", "world"], &["ordered"]),
    shape("fingerprint-sync", &["world"], &["equal"]),
    shape("producer-owned", &["actor"], &["empty", "nonEmpty"]),
    shape("self-absolution-ban", &["change"], &["unchanged", "empty"]),
    shape("actor-scope", &["actor"], &["empty", "nonEmpty"]),
    shape("precedent", &["history", "world"], &["nonEmpty"]),
    shape("phase-order", &["history"], &["ordered"]),
    shape("turn-locality", &["history"], &["nonEmpty"]),
    shape("stated-ground", &["history"], &["nonEmpty"]),
    shape("controlled-vocabulary", &["change", "world"], &["subset"]),
    Mechanism {
        scope: Some("target.path"),
        ..shape("naming", &["change"], &["empty", "nonEmpty"])
    },
    shape("added-only", &["change"], &["empty"]),
    shape("one-way-marker", &["change"], &["subset"]),
    Mechanism {
        witness: true,
        ..shape("scoped-valve", ALL_AXES, ALL_RELATIONS)
    },
    Mechanism {
        scope: Some("command"),
        ..shape("forbidden-command", &["change"], &["empty"])
    },
];

/// The mechanism name is checked against the shape the declaration's syntax derives: the
/// axes its `source` heads name and the relations its body relates.
fn check_mechanism(id: &str, mechanism: &str, declaration: &Declaration) -> Check<()> {
    let location = format!("{id} mechanism");
    let Some(spec) = MECHANISMS.iter().find(|spec| spec.name == mechanism) else {
        let names: Vec<&str> = MECHANISMS.iter().map(|spec| spec.name).collect();
        return fail(
            &location,
            format!("'{mechanism}' must be one of {}", quoted(&names)),
        );
    };
    if spec.witness && declaration.witness.is_none() {
        return fail(&location, format!("'{mechanism}' needs a witness block"));
    }
    let scope_source = declaration
        .scope
        .as_ref()
        .map(|scope| scope.source.as_str());
    if let Some(pinned) = spec.scope
        && scope_source != Some(pinned)
    {
        return fail(&location, format!("'{mechanism}' scopes on '{pinned}'"));
    }
    let mut axes: Vec<&str> = Vec::new();
    for name in declaration.head_sources() {
        let kind = match declaration.sources.iter().find(|(bound, _)| bound == name) {
            Some((_, Binding::Transcript)) => "history",
            Some(_) => "world",
            None if name == "actor" => "actor",
            None => "change",
        };
        if !axes.contains(&kind) {
            axes.push(kind);
        }
    }
    let mut relations: Vec<&str> = Vec::new();
    for entry in &declaration.relate {
        if !relations.contains(&entry.relation.name()) {
            relations.push(entry.relation.name());
        }
    }
    if axes.iter().all(|axis| spec.axes.contains(axis))
        && relations
            .iter()
            .all(|relation| spec.relations.contains(relation))
    {
        return Ok(());
    }
    fail(
        &location,
        format!(
            "'{mechanism}' expects relations {} on axes {}; this declaration relates {} on {}",
            quoted(spec.relations),
            quoted(spec.axes),
            quoted(&relations),
            quoted(&axes)
        ),
    )
}
