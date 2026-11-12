use serde_json::{Map, Value, json};
use unicode_normalization::UnicodeNormalization;

mod bundle {
    include!(concat!(env!("OUT_DIR"), "/docs_bundle.rs"));
}

const TOPICS: [&str; 6] = [
    "install",
    "recipes",
    "config",
    "discipline",
    "witness",
    "covenant",
];
const LANGUAGES: [&str; 2] = ["en", "ko"];
const DEFAULT_LIMIT: usize = 5;
const MAX_LIMIT: usize = 50;

struct Section {
    id: String,
    title: String,
    text: String,
}

struct Translation {
    path: String,
    title: String,
    summary: String,
    terms: Vec<String>,
}

struct Document {
    id: String,
    translations: [Translation; 2],
}

impl Document {
    fn translation(&self, language: &str) -> &Translation {
        let [en, ko] = &self.translations;
        if language == "ko" { ko } else { en }
    }
}

struct SearchResult {
    document_id: String,
    section_id: String,
    title: String,
    excerpt: String,
    source: String,
    command: String,
    score: u64,
}

struct Search {
    language: &'static str,
    query: String,
    results: Vec<SearchResult>,
}

fn root_help() -> String {
    let topics = TOPICS.map(|topic| format!("  {topic}")).join("\n");
    format!(
        "pdks docs\nUsage: pdks docs [topic]\n       pdks docs search <query> [--lang en|ko] [--limit N] [--json]\n       pdks docs show <document-id> [--lang en|ko] [--section <section-id>] [--json]\n\nTopics:\n{topics}\n"
    )
}

fn is_id(value: &str) -> bool {
    let mut chars = value.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn quote_shell_word(value: &str) -> String {
    let plain = !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_@%+=:,./-".contains(c));
    if plain {
        value.to_owned()
    } else {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }
}

fn shell_command(parts: &[&str]) -> String {
    parts
        .iter()
        .map(|part| quote_shell_word(part))
        .collect::<Vec<_>>()
        .join(" ")
}

fn language_from(value: &str) -> Result<&'static str, String> {
    match value {
        "en" => Ok("en"),
        "ko" => Ok("ko"),
        other => Err(format!("unsupported language: {other}")),
    }
}

#[derive(Default)]
struct Flags<'a> {
    language: Option<&'static str>,
    limit: Option<usize>,
    section: Option<&'a str>,
    json: bool,
}

/// Parse the flags after a query form's positional argument, in order, so the first invalid one
/// is the one reported. `allowed` is the form's own subset of `--lang --limit --section --json`.
fn parse_flags<'a>(args: &'a [String], form: &str, allowed: &[&str]) -> Result<Flags<'a>, String> {
    let mut flags = Flags::default();
    let mut seen: Vec<&str> = Vec::new();
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        let arg = arg.as_str();
        if !allowed.contains(&arg) {
            return Err(if arg.starts_with("--") {
                format!("unknown {form} flag: {arg}")
            } else {
                format!("unexpected {form} argument: {arg}")
            });
        }
        if seen.contains(&arg) {
            return Err(format!("duplicate {arg}"));
        }
        seen.push(arg);
        if arg == "--json" {
            flags.json = true;
            continue;
        }
        let value = rest
            .next()
            .filter(|value| !value.starts_with("--"))
            .ok_or_else(|| format!("missing {arg} value"))?;
        match arg {
            "--lang" => flags.language = Some(language_from(value)?),
            "--limit" => {
                let valid = value.chars().all(|c| c.is_ascii_digit()) && !value.starts_with('0');
                flags.limit = Some(
                    value
                        .parse::<usize>()
                        .ok()
                        .filter(|limit| valid && (1..=MAX_LIMIT).contains(limit))
                        .ok_or_else(|| format!("invalid limit: {value}"))?,
                );
            }
            _ if is_id(value) => flags.section = Some(value),
            _ => return Err(format!("invalid section id: {value}")),
        }
    }
    Ok(flags)
}

fn fence_of(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim();
    let marker = trimmed.chars().next().filter(|c| *c == '`' || *c == '~')?;
    let length = trimmed.chars().take_while(|c| *c == marker).count();
    (length >= 3).then_some((marker, length))
}

/// Level and text of an ATX heading line, level 0 when the line is not one.
fn heading(line: &str) -> (usize, &str) {
    let level = line.chars().take_while(|c| *c == '#').count();
    let rest = line.get(level..).unwrap_or("");
    if (1..=6).contains(&level) && rest.starts_with(char::is_whitespace) {
        (level, rest.trim_start_matches(char::is_whitespace))
    } else {
        (0, "")
    }
}

fn anchor_id(line: &str) -> Option<&str> {
    let id = line
        .trim()
        .strip_prefix("<a id=\"")?
        .strip_suffix("\"></a>")?;
    is_id(id).then_some(id)
}

/// Index of the nearest non-blank line before `index`.
fn previous_nonblank(lines: &[&str], index: usize) -> Option<usize> {
    lines
        .get(..index)?
        .iter()
        .rposition(|line| !line.trim().is_empty())
}

struct Start {
    id: String,
    title: String,
    level: usize,
    line: usize,
}

fn parse_sections(markdown: &str) -> Result<Vec<Section>, String> {
    let lines: Vec<&str> = markdown.split('\n').collect();
    let mut line_starts = Vec::with_capacity(lines.len());
    let mut offset = 0;
    for line in &lines {
        line_starts.push(offset);
        offset += line.len() + 1;
    }
    let mut starts: Vec<Start> = Vec::new();
    let mut top_level: Vec<usize> = Vec::new();
    let mut fence: Option<(char, usize)> = None;

    for (index, line) in lines.iter().enumerate() {
        if let Some(found) = fence_of(line) {
            match fence {
                None => fence = Some(found),
                Some((marker, length)) if marker == found.0 && found.1 >= length => fence = None,
                Some(_) => {}
            }
            continue;
        }
        if fence.is_some() {
            continue;
        }
        let (level, title) = heading(line);
        let anchor_line = previous_nonblank(&lines, index);
        if level == 1 {
            let boundary = anchor_line
                .filter(|at| lines.get(*at).and_then(|l| anchor_id(l)).is_some())
                .unwrap_or(index);
            top_level.push(boundary);
        }
        if level < 2 {
            continue;
        }
        let missing = || format!("missing anchor for heading: {line}");
        let at = anchor_line.ok_or_else(missing)?;
        let id = lines
            .get(at)
            .and_then(|l| anchor_id(l))
            .ok_or_else(missing)?;
        starts.push(Start {
            id: id.to_owned(),
            title: title.to_owned(),
            level,
            line: at,
        });
    }

    let mut sections: Vec<Section> = Vec::with_capacity(starts.len());
    for (index, start) in starts.iter().enumerate() {
        let mut end_line = top_level
            .iter()
            .copied()
            .find(|line| *line > start.line)
            .unwrap_or(lines.len());
        if let Some(next) = starts
            .iter()
            .skip(index + 1)
            .find(|candidate| candidate.level <= start.level)
        {
            end_line = end_line.min(next.line);
        }
        let begin = line_starts.get(start.line).copied().unwrap_or(0);
        let end = line_starts.get(end_line).copied().unwrap_or(markdown.len());
        if sections.iter().any(|section| section.id == start.id) {
            return Err(format!("duplicate section id: {}", start.id));
        }
        sections.push(Section {
            id: start.id.clone(),
            title: start.title.clone(),
            text: markdown.get(begin..end).unwrap_or("").to_owned(),
        });
    }
    Ok(sections)
}

fn text_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned()
}

fn translation(document: &Value, language: &str) -> Translation {
    let entry = document.get(language).unwrap_or(&Value::Null);
    Translation {
        path: text_field(entry, "path"),
        title: text_field(entry, "title"),
        summary: text_field(entry, "summary"),
        terms: entry
            .get("terms")
            .and_then(Value::as_array)
            .map(|terms| {
                terms
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn load_catalog() -> Result<(Vec<Document>, Value), String> {
    let catalog: Value =
        serde_json::from_str(bundle::CATALOG).map_err(|error| error.to_string())?;
    let documents = catalog
        .get("documents")
        .and_then(Value::as_array)
        .ok_or("docs catalog has no documents")?
        .iter()
        .filter(|document| document.get("bundled") == Some(&Value::Bool(true)))
        .map(|document| Document {
            id: text_field(document, "id"),
            translations: LANGUAGES.map(|language| translation(document, language)),
        })
        .collect();
    let topics = catalog.get("topics").cloned().unwrap_or(Value::Null);
    Ok((documents, topics))
}

fn markdown_of(path: &str) -> Result<&'static str, String> {
    bundle::FILES
        .iter()
        .find(|(file, _)| *file == path)
        .map(|(_, text)| *text)
        .ok_or_else(|| format!("document not bundled: {path}"))
}

fn section_source(path: &str, section_id: &str) -> String {
    format!("{path}#{section_id}")
}

/// A whole document or one of its sections: its Markdown and its source.
fn section_from_document(
    document: &Document,
    language: &str,
    section_id: Option<&str>,
) -> Result<(String, String), String> {
    let translation = document.translation(language);
    let markdown = markdown_of(&translation.path)?;
    let Some(wanted) = section_id else {
        return Ok((markdown.to_owned(), translation.path.clone()));
    };
    let section = parse_sections(markdown)?
        .into_iter()
        .find(|section| section.id == wanted)
        .ok_or_else(|| format!("unknown section: {wanted}"))?;
    Ok((section.text, section_source(&translation.path, &section.id)))
}

fn excerpt_for(markdown: &str, query: &str) -> String {
    let needle = query.nfc().collect::<String>().to_lowercase();
    let haystack = markdown.to_lowercase();
    let Some(at) = haystack.find(&needle) else {
        return markdown.chars().take(160).collect();
    };
    let at = haystack.get(..at).unwrap_or("").chars().count();
    let start = at.saturating_sub(40);
    let end = markdown.chars().count().min(at + query.nfc().count() + 80);
    markdown
        .chars()
        .skip(start)
        .take(end.saturating_sub(start))
        .collect()
}

fn score_field(field: &str, query: &str, weight: u64) -> u64 {
    let field = field.to_lowercase();
    let query = query.to_lowercase();
    if !field.contains(&query) {
        0
    } else if field == query {
        weight * 4
    } else if field.starts_with(&query) || field.ends_with(&query) {
        weight * 3
    } else {
        weight * 2
    }
}

fn section_score(translation: &Translation, markdown: &str, query: &str, title: &str) -> u64 {
    let normalized = query.nfc().collect::<String>().to_lowercase();
    let mut tokens: Vec<&str> = Vec::new();
    for token in normalized.split_whitespace() {
        if !tokens.contains(&token) {
            tokens.push(token);
        }
    }
    let terms = translation.terms.join(" ");
    let mut score = 0;
    for token in tokens {
        let token_score = score_field(title, token, 100)
            + score_field(&translation.title, token, 30)
            + score_field(&translation.summary, token, 20)
            + score_field(&terms, token, 15)
            + score_field(markdown, token, 10);
        if token_score == 0 {
            return 0;
        }
        score += token_score;
    }
    score
}

fn search_bundle(
    documents: &[Document],
    query: &str,
    language: &'static str,
    limit: usize,
) -> Result<Search, String> {
    let mut results: Vec<SearchResult> = Vec::new();
    for document in documents {
        let translation = document.translation(language);
        for section in parse_sections(markdown_of(&translation.path)?)? {
            let score = section_score(translation, &section.text, query, &section.title);
            if score == 0 {
                continue;
            }
            results.push(SearchResult {
                document_id: document.id.clone(),
                excerpt: excerpt_for(&section.text, query),
                source: section_source(&translation.path, &section.id),
                command: shell_command(&[
                    "pdks",
                    "docs",
                    "show",
                    &document.id,
                    "--lang",
                    language,
                    "--section",
                    &section.id,
                ]),
                section_id: section.id,
                title: section.title,
                score,
            });
        }
    }
    results.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.document_id.cmp(&right.document_id))
            .then_with(|| left.section_id.cmp(&right.section_id))
    });
    results.truncate(limit);
    Ok(Search {
        language,
        query: query.to_owned(),
        results,
    })
}

fn search_json(search: &Search) -> Result<String, String> {
    let results: Vec<Value> = search
        .results
        .iter()
        .map(|result| {
            json!({
                "documentId": result.document_id,
                "sectionId": result.section_id,
                "title": result.title,
                "excerpt": result.excerpt,
                "source": result.source,
                "command": result.command,
                "score": result.score,
            })
        })
        .collect();
    let payload = json!({
        "schemaVersion": 1,
        "packageVersion": env!("CARGO_PKG_VERSION"),
        "language": search.language,
        "query": search.query,
        "count": results.len(),
        "results": results,
    });
    serde_json::to_string(&payload)
        .map(|text| text + "\n")
        .map_err(|error| error.to_string())
}

fn render_search_text(search: &Search) -> String {
    if search.results.is_empty() {
        return format!("0 results for {}\n[]\n", search.query);
    }
    let mut blocks = vec![format!(
        "{} results for {} ({})",
        search.results.len(),
        search.query,
        search.language
    )];
    for (index, result) in search.results.iter().enumerate() {
        blocks.push(format!(
            "{}. {}#{} {} [{}]\n   {}\n   {}\n   {}",
            index + 1,
            result.document_id,
            result.section_id,
            result.title,
            result.score,
            result.excerpt,
            result.source,
            result.command
        ));
    }
    blocks.join("\n\n") + "\n"
}

fn find_document<'a>(documents: &'a [Document], id: &str) -> Option<&'a Document> {
    documents.iter().find(|document| document.id == id)
}

fn render_topic(
    documents: &[Document],
    topics: &Value,
    topic: &str,
    language: &str,
) -> Result<String, String> {
    let entry = topics
        .get(topic)
        .ok_or_else(|| format!("unknown docs topic: {topic}"))?;
    let mut parts: Vec<String> = Vec::new();
    for reference in entry
        .get("references")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let id = text_field(reference, "documentId");
        let document =
            find_document(documents, &id).ok_or_else(|| format!("unknown topic document: {id}"))?;
        let section_id = reference.get("sectionId").and_then(Value::as_str);
        parts.push(section_from_document(document, language, section_id)?.0);
    }
    let see_also = text_field(entry, "seeAlso");
    parts.push(format!(
        "See also: {}",
        shell_command(&["pdks", "docs", "show", &see_also, "--lang", language])
    ));
    Ok(parts.join("\n\n") + "\n")
}

fn show(documents: &[Document], args: &[String]) -> Result<String, String> {
    if let [flag] = args
        && flag == "--help"
    {
        return Ok(root_help());
    }
    let document_id = args.first().ok_or("missing document id")?;
    if !is_id(document_id) {
        return Err(format!("invalid document id: {document_id}"));
    }
    let flags = parse_flags(
        args.get(1..).unwrap_or(&[]),
        "show",
        &["--lang", "--section", "--json"],
    )?;
    let language = flags.language.unwrap_or("en");
    let document = find_document(documents, document_id)
        .ok_or_else(|| format!("unknown document: {document_id}"))?;
    let (markdown, source) = section_from_document(document, language, flags.section)?;
    if !flags.json {
        return Ok(markdown);
    }
    let mut payload = Map::new();
    payload.insert("schemaVersion".to_owned(), json!(1));
    payload.insert(
        "packageVersion".to_owned(),
        json!(env!("CARGO_PKG_VERSION")),
    );
    payload.insert("language".to_owned(), json!(language));
    payload.insert("documentId".to_owned(), json!(document_id));
    payload.insert("sectionId".to_owned(), json!(flags.section));
    payload.insert("source".to_owned(), json!(source));
    payload.insert("markdown".to_owned(), json!(markdown));
    serde_json::to_string(&Value::Object(payload))
        .map(|text| text + "\n")
        .map_err(|error| error.to_string())
}

/// The complete stdout of one `pdks docs` query, or the reason it failed.
pub fn run(args: &[String]) -> Result<String, String> {
    let Some(first) = args.first() else {
        return Ok(root_help());
    };
    if args.len() == 1 && first == "--help" {
        return Ok(root_help());
    }
    let (documents, topics) = load_catalog()?;
    let rest = args.get(1..).unwrap_or(&[]);
    match first.as_str() {
        "search" => {
            if let [flag] = rest
                && flag == "--help"
            {
                return Ok(root_help());
            }
            let query = rest.first().ok_or("missing search query")?.trim();
            if query.is_empty() {
                return Err("empty search query".to_owned());
            }
            let flags = parse_flags(
                rest.get(1..).unwrap_or(&[]),
                "search",
                &["--lang", "--limit", "--json"],
            )?;
            let search = search_bundle(
                &documents,
                query,
                flags.language.unwrap_or("en"),
                flags.limit.unwrap_or(DEFAULT_LIMIT),
            )?;
            if flags.json {
                search_json(&search)
            } else {
                Ok(render_search_text(&search))
            }
        }
        "show" => show(&documents, rest),
        topic if TOPICS.contains(&topic) => {
            let flags = parse_flags(rest, "docs", &["--lang"])?;
            render_topic(&documents, &topics, topic, flags.language.unwrap_or("en"))
        }
        other => Err(format!("unknown docs command: {other}")),
    }
}
