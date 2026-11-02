//! One markdown text split into a title, frontmatter, and preamble + H2 section rows.

use std::sync::LazyLock;

use regress::{Match, Regex};
use serde_json::{Map, Value};
use serde_saphyr::options::MergeKeyPolicy;

pub struct Link {
    pub wiki: bool,
    pub target: String,
}

pub struct Section {
    pub anchor: String,
    pub ord: usize,
    pub title: String,
    pub body: String,
    pub links: Vec<Link>,
}

pub struct Document {
    pub title: String,
    pub metadata: Map<String, Value>,
    pub sections: Vec<Section>,
}

/// Compiles a constant ECMAScript pattern.
pub fn constant(pattern: &str, flags: &str) -> Regex {
    Regex::with_flags(pattern, flags).expect("a constant pattern compiles")
}

static EXPLICIT_ANCHOR: LazyLock<Regex> = LazyLock::new(|| constant(r"\s*\{#([^}]+)\}\s*$", ""));
static CLOSING_HASHES: LazyLock<Regex> = LazyLock::new(|| constant(r"(?:^|\s+)#+\s*$", ""));
// A code span opens and closes on whole runs of backticks of one length and never runs past a
// blank line.
static CODE_SPAN: LazyLock<Regex> = LazyLock::new(|| {
    constant(
        r"(?<!`)(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?(?<!`)\1(?!`)",
        "",
    )
});
// `[[1]](https://…)` is a markdown link whose text is `[1]`, not a wikilink.
static WIKILINK: LazyLock<Regex> =
    LazyLock::new(|| constant(r"\[\[([^\]\n]+)\]\](?!\([a-z][a-z0-9+.-]*:[^)\s]*\))", "i"));
static ATTACHMENT: LazyLock<Regex> = LazyLock::new(|| {
    constant(
        r"\.(?:base|canvas|avif|bmp|gif|jpeg|jpg|png|svg|webp|flac|m4a|mp3|ogg|wav|webm|3gp|mkv|mov|mp4|ogv|pdf)$",
        "i",
    )
});
static MARKDOWN_LINK: LazyLock<Regex> =
    LazyLock::new(|| constant(r"(!?)\[(?:(?!\n[ \t]*\n)[^\]])*\]\(([^)\s]+)\)", ""));
static SCHEME: LazyLock<Regex> = LazyLock::new(|| constant(r"^[a-z][a-z0-9+.-]*:", "i"));
static SLUG_STRIP: LazyLock<Regex> = LazyLock::new(|| constant(r"[^\p{L}\p{M}\p{N}_\- ]", "u"));

/// The text of capture group `index` of a match.
pub fn group<'a>(found: &Match, text: &'a str, index: usize) -> Option<&'a str> {
    found.group(index).and_then(|range| text.get(range))
}

/// `text` with every match of `pattern` replaced by what `replacement` returns for it.
pub fn replace_all(
    pattern: &Regex,
    text: &str,
    mut replacement: impl FnMut(&Match) -> String,
) -> String {
    let mut out = String::new();
    let mut last = 0;
    for found in pattern.find_iter(text) {
        let range = found.range();
        out.push_str(text.get(last..range.start).unwrap_or_default());
        out.push_str(&replacement(&found));
        last = range.end;
    }
    out.push_str(text.get(last..).unwrap_or_default());
    out
}

fn remove_first(pattern: &Regex, text: &str) -> String {
    pattern.find(text).map_or_else(
        || text.to_string(),
        |found| {
            let range = found.range();
            format!(
                "{}{}",
                text.get(..range.start).unwrap_or_default(),
                text.get(range.end..).unwrap_or_default()
            )
        },
    )
}

/// The part of a wikilink target before its alias (`|`, or `\|` in a table row) and first `#`,
/// trimmed, and the text after the last `#` when there is one.
pub fn split_wiki_target(target: &str) -> (String, Option<String>) {
    let unaliased = target.find('|').map_or(target, |bar| {
        let cut = if target.get(..bar).is_some_and(|head| head.ends_with('\\')) {
            bar - 1
        } else {
            bar
        };
        target.get(..cut).unwrap_or_default()
    });
    match (unaliased.find('#'), unaliased.rfind('#')) {
        (Some(first), Some(last)) => (
            unaliased
                .get(..first)
                .unwrap_or_default()
                .trim()
                .to_string(),
            Some(unaliased.get(last + 1..).unwrap_or_default().to_string()),
        ),
        _ => (unaliased.trim().to_string(), None),
    }
}

/// The anchor an H2 heading gets when it declares none.
pub fn slug(title: &str) -> String {
    replace_all(&SLUG_STRIP, &title.to_lowercase(), |_| String::new()).replace(' ', "-")
}

fn collect_links(prose: &[String]) -> Vec<Link> {
    let text = replace_all(&CODE_SPAN, &prose.join("\n"), |_| String::new());
    let mut found = Vec::new();
    for hit in WIKILINK.find_iter(&text) {
        let target = group(&hit, &text, 1).unwrap_or_default();
        let (name, _) = split_wiki_target(target);
        let leaf = name.rsplit('/').next().unwrap_or_default();
        if ATTACHMENT.find(leaf).is_none() {
            found.push(Link {
                wiki: true,
                target: target.to_string(),
            });
        }
    }
    for hit in MARKDOWN_LINK.find_iter(&text) {
        let target = group(&hit, &text, 2).unwrap_or_default();
        if group(&hit, &text, 1) == Some("!") || SCHEME.find(target).is_some() {
            continue;
        }
        let path = target.split('#').next().unwrap_or_default();
        if path.is_empty() || path.strip_suffix(".md").is_some() {
            found.push(Link {
                wiki: false,
                target: target.to_string(),
            });
        }
    }
    let mut links: Vec<Link> = Vec::new();
    for link in found {
        if !links
            .iter()
            .any(|kept| kept.wiki == link.wiki && kept.target == link.target)
        {
            links.push(link);
        }
    }
    links
}

/// A fence marker (a run of three or more backticks or tildes) opening a line, indented at most
/// three spaces; a backtick fence's info string may not hold a backtick.
fn fence_marker(line: &str) -> Option<&str> {
    let rest = line.trim_start_matches(' ');
    if line.len() - rest.len() > 3 {
        return None;
    }
    let first = rest.chars().next().filter(|c| *c == '`' || *c == '~')?;
    let run = rest.len() - rest.trim_start_matches(first).len();
    if run < 3 {
        return None;
    }
    let (marker, tail) = rest.split_at_checked(run)?;
    (first == '~' || !tail.contains('`')).then_some(marker)
}

/// The text after `hashes` on a heading line indented at most three spaces; empty for a bare one.
fn heading<'a>(line: &'a str, hashes: &str) -> Option<&'a str> {
    let rest = line.trim_start_matches(' ');
    if line.len() - rest.len() > 3 {
        return None;
    }
    let after = rest.strip_prefix(hashes)?;
    if after.is_empty() {
        return Some("");
    }
    after.strip_prefix([' ', '\t'])
}

/// An integral float prints without a fraction, as `JSON.stringify` does.
fn integral(value: Value) -> Value {
    match value {
        Value::Number(number) => match number.as_f64() {
            Some(float) if number.is_f64() && float.fract() == 0.0 && float.abs() < 9.0e15 => {
                format!("{float:.0}")
                    .parse::<i64>()
                    .map_or(Value::Number(number), Value::from)
            }
            _ => Value::Number(number),
        },
        Value::Array(items) => Value::Array(items.into_iter().map(integral).collect()),
        Value::Object(map) => {
            Value::Object(map.into_iter().map(|(k, v)| (k, integral(v))).collect())
        }
        other => other,
    }
}

fn frontmatter(yaml: &str) -> Option<Map<String, Value>> {
    let options = serde_saphyr::options! {
        strict_booleans: true,
        merge_keys: MergeKeyPolicy::AsOrdinary,
    };
    match serde_saphyr::from_str_with_options::<Value>(yaml, options).ok()? {
        Value::Object(map) => match integral(Value::Object(map)) {
            Value::Object(map) => Some(map),
            _ => None,
        },
        _ => None,
    }
}

#[derive(Default)]
struct Block {
    lines: Vec<String>,
    prose: Vec<String>,
}

impl Block {
    fn add(&mut self, line: &str, prose: &str) {
        self.lines.push(line.to_string());
        self.prose.push(prose.to_string());
    }
}

struct Heading {
    title: String,
    anchor: Option<String>,
    block: Block,
}

fn build_sections(preamble: &Block, headings: Vec<Heading>) -> Vec<Section> {
    let mut sections = Vec::new();
    let preamble_body = preamble.lines.join("\n");
    if !preamble_body.trim().is_empty() {
        sections.push(Section {
            anchor: String::new(),
            ord: 0,
            title: String::new(),
            body: preamble_body,
            links: collect_links(&preamble.prose),
        });
    }
    // The preamble's empty anchor is always taken, so an H2 with an empty slug never collides
    // with it.
    let mut used = vec![String::new()];
    for heading in headings {
        let base = heading.anchor.unwrap_or_else(|| slug(&heading.title));
        let mut anchor = base.clone();
        let mut n = 1;
        while used.contains(&anchor) {
            anchor = format!("{base}-{n}");
            n += 1;
        }
        used.push(anchor.clone());
        sections.push(Section {
            anchor,
            ord: sections.len(),
            title: heading.title,
            body: heading.block.lines.join("\n"),
            links: collect_links(&heading.block.prose),
        });
    }
    sections
}

/// Splits a text into a title and preamble + H2 section rows; never refuses a text.
pub fn parse_document(id: &str, raw: &str) -> Document {
    let stripped = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let text = stripped.replace("\r\n", "\n").replace('\r', "\n");
    let mut content = text.as_str();
    let mut metadata = None;
    if text.starts_with("---\n")
        && let Some(end) = text.get(3..).and_then(|tail| tail.find("\n---\n"))
    {
        let end = end + 3;
        metadata = frontmatter(text.get(4..end).unwrap_or_default());
        content = text.get(end + 5..).unwrap_or_default();
    }

    let mut h1_title: Option<String> = None;
    let mut preamble = Block::default();
    let mut headings: Vec<Heading> = Vec::new();
    let mut fence: Option<(char, usize)> = None;

    for line in if content.is_empty() {
        Vec::new()
    } else {
        content.split('\n').collect()
    } {
        let marker = fence_marker(line);
        if let Some((fence_char, fence_len)) = fence {
            if let Some(marker) = marker
                && marker.starts_with(fence_char)
                && marker.len() >= fence_len
                && line.trim() == marker
            {
                fence = None;
            }
            current(&mut headings, &mut preamble).add(line, "");
            continue;
        }
        if let Some(marker) = marker {
            fence = marker.chars().next().map(|c| (c, marker.len()));
            current(&mut headings, &mut preamble).add(line, "");
            continue;
        }
        if let Some(rest) = heading(line, "##") {
            let (title, anchor) = match EXPLICIT_ANCHOR.find(rest) {
                Some(found) => (
                    rest.get(..found.start()).unwrap_or_default(),
                    group(&found, rest, 1).map(str::to_string),
                ),
                None => (rest, None),
            };
            headings.push(Heading {
                title: remove_first(&CLOSING_HASHES, title).trim().to_string(),
                anchor,
                block: Block::default(),
            });
            continue;
        }
        if h1_title.is_none()
            && let Some(rest) = heading(line, "#")
        {
            let title = remove_first(&CLOSING_HASHES, &remove_first(&EXPLICIT_ANCHOR, rest));
            if !title.trim().is_empty() {
                h1_title = Some(title.trim().to_string());
            }
        }
        current(&mut headings, &mut preamble).add(line, line);
    }

    let sections = build_sections(&preamble, headings);

    let metadata = metadata.unwrap_or_default();
    let title = match metadata.get("title").and_then(Value::as_str) {
        Some(title) if !title.trim().is_empty() => title.to_string(),
        _ => h1_title.unwrap_or_else(|| id.to_string()),
    };
    Document {
        title,
        metadata,
        sections,
    }
}

fn current<'a>(headings: &'a mut [Heading], preamble: &'a mut Block) -> &'a mut Block {
    match headings.last_mut() {
        Some(last) => &mut last.block,
        None => preamble,
    }
}
