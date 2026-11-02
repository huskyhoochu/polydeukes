//! The documents the include globs reach, and everything derived from them: tickets, resolved
//! links, obligation rows, and supersession targets. Computed from the files on every run.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::Path;

use globset::{Glob, GlobBuilder, GlobSet, GlobSetBuilder};
use serde_json::{Map, Value};

use crate::config::{Direction, ObligationRule, Settings, TicketRule, TicketSource};
use crate::parse::{parse_document, slug, split_wiki_target};

pub struct Section {
    pub id: String,
    pub ord: usize,
    pub title: String,
    pub body: String,
}

pub struct Doc {
    pub id: String,
    pub title: String,
    pub metadata: Map<String, Value>,
    pub ticket: Option<String>,
    pub sections: Vec<Section>,
}

/// One link of a section, with the document and section it resolved to.
pub struct Link {
    pub doc: String,
    pub from: String,
    pub wiki: bool,
    pub raw: String,
    pub dst_doc: Option<String>,
    pub dst_section: Option<String>,
}

impl Link {
    /// The link as written: `[[x]]` for a wikilink, the target otherwise.
    pub fn written(&self) -> String {
        if self.wiki {
            format!("[[{}]]", self.raw)
        } else {
            self.raw.clone()
        }
    }

    pub fn to(&self) -> Option<&str> {
        self.dst_section.as_deref().or(self.dst_doc.as_deref())
    }
}

pub struct Obligation {
    pub key: String,
    pub section_id: String,
    pub ord: i64,
    pub doc_title: String,
    pub section_title: String,
    pub text: String,
}

pub struct Supersession {
    pub doc: String,
    pub direction: Direction,
    pub raw: String,
    pub dst: Option<String>,
}

/// A link as parsed, before its target is resolved.
struct RawLink {
    doc: String,
    from: String,
    wiki: bool,
    raw: String,
}

pub struct Corpus {
    pub docs: Vec<Doc>,
    pub links: Vec<Link>,
    pub obligations: Vec<Obligation>,
    pub supersessions: Vec<Supersession>,
}

impl Corpus {
    /// The other documents whose ticket is the same string, in id order.
    pub fn related(&self, doc: &Doc) -> Vec<&str> {
        let Some(ticket) = &doc.ticket else {
            return Vec::new();
        };
        self.docs
            .iter()
            .filter(|other| other.id != doc.id && other.ticket.as_ref() == Some(ticket))
            .map(|other| other.id.as_str())
            .collect()
    }
}

fn glob_set(patterns: &[String]) -> Result<GlobSet, String> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        let glob: Glob = GlobBuilder::new(pattern)
            .literal_separator(true)
            .case_insensitive(cfg!(target_os = "macos"))
            .build()
            .map_err(|error| format!("invalid glob {pattern}: {error}"))?;
        builder.add(glob);
    }
    builder
        .build()
        .map_err(|error| format!("invalid glob: {error}"))
}

/// The directory a glob's literal leading components name, and how many levels below it a match
/// can sit (`None` when `**` makes it unbounded).
fn reach(pattern: &str) -> (String, Option<usize>) {
    let parts: Vec<&str> = pattern.split('/').collect();
    let dirs = parts.len().saturating_sub(1);
    let literal = parts
        .iter()
        .take(dirs)
        // An empty or `..` component would let the joined walk start outside the root.
        .take_while(|part| {
            !part.is_empty() && **part != ".." && !part.contains(['*', '?', '[', '{'])
        })
        .count();
    let prefix = parts
        .iter()
        .take(literal)
        .copied()
        .collect::<Vec<_>>()
        .join("/");
    let depth = (!pattern.contains("**")).then_some(parts.len() - literal);
    (prefix, depth)
}

struct Walk<'a> {
    root: &'a Path,
    include: &'a GlobSet,
    exclude: &'a GlobSet,
    found: BTreeMap<String, String>,
}

impl Walk<'_> {
    /// Collects the regular `.md` files below `rel` that the globs select, never following a
    /// symbolic link and leaving out everything under a directory an exclude glob matches.
    fn visit(&mut self, rel: &str, levels: Option<usize>) {
        let Ok(entries) = fs::read_dir(self.root.join(rel)) else {
            return;
        };
        for entry in entries.flatten() {
            let (Ok(name), Ok(kind)) = (entry.file_name().into_string(), entry.file_type()) else {
                continue;
            };
            // Node's glob never reaches a dot entry through a wildcard component.
            if name.starts_with('.') {
                continue;
            }
            let path = if rel.is_empty() {
                name
            } else {
                format!("{rel}/{name}")
            };
            if kind.is_dir() {
                if !self.exclude.is_match(&path) && levels != Some(1) {
                    self.visit(&path, levels.map(|n| n - 1));
                }
            } else if kind.is_file()
                && let Some(id) = path.strip_suffix(".md")
                && self.include.is_match(&path)
                && !self.exclude.is_match(&path)
            {
                self.found.insert(id.to_string(), path.clone());
            }
        }
    }
}

fn without_dot_slash(patterns: &[String]) -> Vec<String> {
    patterns
        .iter()
        .map(|pattern| {
            let mut rest = pattern.as_str();
            while let Some(tail) = rest.strip_prefix("./") {
                rest = tail;
            }
            rest.to_string()
        })
        .collect()
}

fn list_documents(root: &Path, settings: &Settings) -> Result<BTreeMap<String, String>, String> {
    let patterns = without_dot_slash(&settings.include);
    let include = glob_set(&patterns)?;
    let exclude = glob_set(&without_dot_slash(&settings.exclude))?;
    let mut walk = Walk {
        root,
        include: &include,
        exclude: &exclude,
        found: BTreeMap::new(),
    };
    for pattern in &patterns {
        let (prefix, levels) = reach(pattern);
        walk.visit(&prefix, levels);
    }
    Ok(walk.found)
}

fn ticket_for(
    id: &str,
    title: &str,
    metadata: &Map<String, Value>,
    rules: &[TicketRule],
) -> Option<String> {
    for rule in rules {
        if let Some(kind) = &rule.kind
            && metadata.get("type").and_then(Value::as_str) != Some(kind)
        {
            continue;
        }
        let raw = match &rule.from {
            TicketSource::Title => Some(title),
            TicketSource::Path => Some(id),
            TicketSource::Frontmatter(key) => metadata.get(key).and_then(Value::as_str),
        };
        let Some(raw) = raw.filter(|raw| !raw.trim().is_empty()) else {
            continue;
        };
        let ticket = match &rule.pattern {
            None => Some(raw),
            Some(pattern) => pattern.find(raw).and_then(|found| raw.get(found.range())),
        };
        if let Some(ticket) = ticket.filter(|ticket| !ticket.trim().is_empty()) {
            return Some(ticket.to_string());
        }
    }
    None
}

/// Rows unique by section, position, and key: the first one wins.
struct Obligations {
    rows: Vec<Obligation>,
    seen: HashSet<(String, i64, String)>,
}

impl Obligations {
    fn add(&mut self, row: Obligation) {
        if self
            .seen
            .insert((row.section_id.clone(), row.ord, row.key.clone()))
        {
            self.rows.push(row);
        }
    }
}

struct Rows {
    obligations: Obligations,
    supersessions: Vec<Supersession>,
}

impl Rows {
    /// The obligation and supersession rows the rules read from one section.
    fn add_section(
        &mut self,
        settings: &Settings,
        doc_title: &str,
        ticket: Option<&String>,
        section_id: &str,
        section: &crate::parse::Section,
    ) {
        let doc_id = section_id.split('#').next().unwrap_or_default();
        let lines: Vec<&str> = section.body.split('\n').collect();
        for rule in &settings.obligations {
            match rule {
                ObligationRule::Section(title) => {
                    // The preamble has no title, so no section rule reads it.
                    if !section.anchor.is_empty()
                        && let Some(ticket) = ticket
                        && title.find(&section.title).is_some()
                    {
                        self.obligations.add(Obligation {
                            key: ticket.clone(),
                            section_id: section_id.to_string(),
                            ord: -1,
                            doc_title: doc_title.to_string(),
                            section_title: section.title.clone(),
                            text: section.body.clone(),
                        });
                    }
                }
                ObligationRule::Line { line, key } => {
                    for (ord, text) in (0_i64..).zip(&lines) {
                        if line.find(text).is_none() {
                            continue;
                        }
                        for found in key.find_iter(text) {
                            self.obligations.add(Obligation {
                                key: text.get(found.range()).unwrap_or_default().to_string(),
                                section_id: section_id.to_string(),
                                ord,
                                doc_title: doc_title.to_string(),
                                section_title: section.title.clone(),
                                text: text.trim().to_string(),
                            });
                        }
                    }
                }
            }
        }
        for rule in &settings.supersedes {
            for text in &lines {
                if rule.line.find(text).is_none() {
                    continue;
                }
                for found in rule.key.find_iter(text) {
                    let raw = text.get(found.range()).unwrap_or_default();
                    if !self.supersessions.iter().any(|row| {
                        row.doc == doc_id && row.direction == rule.direction && row.raw == raw
                    }) {
                        self.supersessions.push(Supersession {
                            doc: doc_id.to_string(),
                            direction: rule.direction,
                            raw: raw.to_string(),
                            dst: None,
                        });
                    }
                }
            }
        }
    }
}

pub fn build(root: &Path, settings: &Settings) -> Result<Corpus, String> {
    let mut docs = Vec::new();
    let mut raw_links: Vec<RawLink> = Vec::new();
    let mut rows = Rows {
        obligations: Obligations {
            rows: Vec::new(),
            seen: HashSet::new(),
        },
        supersessions: Vec::new(),
    };
    for (id, rel) in list_documents(root, settings)? {
        let bytes =
            fs::read(root.join(&rel)).map_err(|error| format!("cannot read {rel}: {error}"))?;
        let parsed = parse_document(&id, &String::from_utf8_lossy(&bytes));
        let ticket = ticket_for(&id, &parsed.title, &parsed.metadata, &settings.ticket);
        let mut sections = Vec::new();
        for section in parsed.sections {
            let section_id = format!("{id}#{}", section.anchor);
            for link in &section.links {
                raw_links.push(RawLink {
                    doc: id.clone(),
                    from: section_id.clone(),
                    wiki: link.wiki,
                    raw: link.target.clone(),
                });
            }
            rows.add_section(
                settings,
                &parsed.title,
                ticket.as_ref(),
                &section_id,
                &section,
            );
            sections.push(Section {
                id: section_id,
                ord: section.ord,
                title: section.title,
                body: section.body,
            });
        }
        docs.push(Doc {
            id,
            title: parsed.title,
            metadata: parsed.metadata,
            ticket,
            sections,
        });
    }
    let index = Index::new(&docs);
    let links = raw_links
        .into_iter()
        .map(
            |RawLink {
                 doc,
                 from,
                 wiki,
                 raw,
             }| {
                let (dst_doc, dst_section) = if wiki {
                    index.wiki_target(&doc, &raw)
                } else {
                    index.markdown_target(&doc, &raw)
                };
                Link {
                    doc,
                    from,
                    wiki,
                    raw,
                    dst_doc,
                    dst_section,
                }
            },
        )
        .collect();
    for row in &mut rows.supersessions {
        let ticketed: Vec<&Doc> = docs
            .iter()
            .filter(|doc| doc.ticket.as_deref() == Some(row.raw.as_str()) && doc.id != row.doc)
            .collect();
        row.dst = index
            .named_document(&row.doc, &row.raw, Some(&row.doc))
            .map(str::to_string)
            .or_else(|| match ticketed.as_slice() {
                [only] => Some(only.id.clone()),
                _ => None,
            });
    }
    Ok(Corpus {
        docs,
        links,
        obligations: rows.obligations.rows,
        supersessions: rows.supersessions,
    })
}

fn dirname(id: &str) -> &str {
    id.rfind('/').map_or(".", |at| id.get(..at).unwrap_or("."))
}

/// `path.posix.normalize` for a relative path.
fn normalize(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." if parts.last().is_some_and(|last| *last != "..") => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    if parts.is_empty() {
        ".".to_string()
    } else {
        parts.join("/")
    }
}

struct Index {
    docs: HashSet<String>,
    sections: HashSet<String>,
    by_anchor: HashMap<String, Vec<(String, String)>>,
    by_last_segment: HashMap<String, Vec<String>>,
}

impl Index {
    fn new(docs: &[Doc]) -> Self {
        let mut index = Self {
            docs: HashSet::new(),
            sections: HashSet::new(),
            by_anchor: HashMap::new(),
            by_last_segment: HashMap::new(),
        };
        for doc in docs {
            index.docs.insert(doc.id.clone());
            let last = doc.id.rsplit('/').next().unwrap_or_default().to_lowercase();
            index
                .by_last_segment
                .entry(last)
                .or_default()
                .push(doc.id.clone());
            for section in &doc.sections {
                index.sections.insert(section.id.clone());
                let anchor = section.id.get(doc.id.len() + 1..).unwrap_or_default();
                index
                    .by_anchor
                    .entry(anchor.to_string())
                    .or_default()
                    .push((doc.id.clone(), section.id.clone()));
            }
        }
        index
    }

    /// The document whose id equals the name or ends in `/<name>`, ignoring case, other than
    /// `excluded`; among several, the one in the source's directory.
    fn named_document(&self, source: &str, name: &str, excluded: Option<&str>) -> Option<&str> {
        let lower = name.to_lowercase();
        let suffix = format!("/{lower}");
        let last = lower.rsplit('/').next().unwrap_or_default();
        let candidates: Vec<&str> = self
            .by_last_segment
            .get(last)
            .into_iter()
            .flatten()
            .map(String::as_str)
            .filter(|id| {
                let lower_id = id.to_lowercase();
                Some(*id) != excluded && (lower_id == lower || lower_id.ends_with(&suffix))
            })
            .collect();
        let near: Vec<&str> = if candidates.len() > 1 {
            candidates
                .into_iter()
                .filter(|id| dirname(id) == dirname(source))
                .collect()
        } else {
            candidates
        };
        match near.as_slice() {
            [only] => Some(only),
            _ => None,
        }
    }

    fn markdown_target(&self, source: &str, raw: &str) -> (Option<String>, Option<String>) {
        let (path, anchor) = match raw.split_once('#') {
            Some((path, anchor)) => (path, Some(anchor)),
            None => (raw, None),
        };
        let mut document = source.to_string();
        if !path.is_empty() {
            if path.starts_with('/') {
                return (None, None);
            }
            let dir = dirname(source);
            let joined = normalize(&if dir == "." {
                path.to_string()
            } else {
                format!("{dir}/{path}")
            });
            // A path that climbs above the root names no document; it is never clamped.
            if joined == ".." || joined.starts_with("../") {
                return (None, None);
            }
            document = joined.strip_suffix(".md").unwrap_or(&joined).to_string();
        }
        if !self.docs.contains(&document) {
            return (None, None);
        }
        let section = anchor
            .map(|anchor| format!("{document}#{anchor}"))
            .filter(|section| self.sections.contains(section));
        (Some(document), section)
    }

    /// The name before the alias and the first `#` names a document (empty: the source), and
    /// the text after the last `#` a section of it by anchor, then by slug; a block fragment
    /// names no section. With no document and no fragment, a section of the source named by the
    /// name comes next, then the one section anywhere with that anchor.
    fn wiki_target(&self, source: &str, raw: &str) -> (Option<String>, Option<String>) {
        let (name, heading) = split_wiki_target(raw);
        let document = if name.is_empty() {
            Some(source)
        } else {
            self.named_document(source, &name, None)
        };
        if let Some(document) = document {
            let section = heading
                .filter(|heading| !heading.starts_with('^'))
                .and_then(|heading| {
                    [
                        format!("{document}#{heading}"),
                        format!("{document}#{}", slug(&heading)),
                    ]
                    .into_iter()
                    .find(|section| self.sections.contains(section))
                });
            return (Some(document.to_string()), section);
        }
        if heading.is_some() {
            return (None, None);
        }
        let own = format!("{source}#{name}");
        if self.sections.contains(&own) {
            return (Some(source.to_string()), Some(own));
        }
        match self.by_anchor.get(&name).map(Vec::as_slice) {
            Some([(doc, section)]) => (Some(doc.clone()), Some(section.clone())),
            _ => (None, None),
        }
    }
}
