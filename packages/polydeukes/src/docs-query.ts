/**
 * `queryDocs` — the offline documentation query.
 *
 * The bundled English guides, answered from the installed version. An AI partner that
 * searches the web gets whatever release the internet indexed; this returns the document
 * that shipped with the code doing the judging, with no network at all.
 *
 * The domain is the five topics below and nothing else. An unknown topic throws instead of
 * resolving to something near it: an answer to a question we never mapped is
 * indistinguishable from a real one by the time it reaches a reader.
 *
 * Every failure throws so the bin can leave stdout at zero bytes and exit 2. Text written
 * halfway is read as the document and quoted as the document — the same direction the
 * judging surface fails in, for the same reason.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The finite query domain — the topic list `pdks docs` prints with no argument. */
export const TOPICS = ['install', 'config', 'discipline', 'covenant', 'witness'] as const;

type Topic = (typeof TOPICS)[number];

/** One answer fragment: a bundled document, whole or cut down to one heading's section. */
type SectionRef = { file: string; heading?: string };

/** The mapping, as data: which document answers a topic, and what to read next. */
const TOPIC_MAP: Record<Topic, { sections: readonly SectionRef[]; seeAlso: string }> = {
  install: {
    sections: [{ file: 'installation.md' }],
    seeAlso: 'reference/polydeukes.md',
  },
  config: {
    sections: [{ file: 'reference/configuration.md' }],
    seeAlso: 'reference/core.md',
  },
  discipline: {
    sections: [{ file: 'reference/configuration.md', heading: '## `disciplines`' }],
    seeAlso: 'reference/covenant.md',
  },
  covenant: {
    sections: [{ file: 'configuration.md', heading: '## What enforcement looks like' }],
    seeAlso: 'reference/polydeukes.md',
  },
  witness: {
    sections: [
      { file: 'reference/configuration.md', heading: '## `witness`' },
      { file: 'troubleshooting.md', heading: '## Opening a blocked call — the witness' },
    ],
    seeAlso: 'reference/covenant.md',
  },
};

/** A fenced block opens and closes on a line whose trimmed form starts with the marker. */
const FENCE = /^(?:`{3,}|~{3,})/;
/** An ATX heading, and its level in the capture. */
const HEADING = /^(#{1,6}) /;

function isTopic(value: string): value is Topic {
  return (TOPICS as readonly string[]).includes(value);
}

function headingLevel(line: string): number {
  return HEADING.exec(line)?.[1].length ?? 0;
}

/**
 * The body of one section of `markdown`: from the line equal to `heading` up to just before
 * the next heading of the same or a higher level, returned verbatim.
 *
 * `heading` is matched by exact string equality. A document that renames its heading kills
 * the query here rather than letting a normalizing matcher hand back a neighbouring section
 * with full confidence.
 *
 * Both scans — for the start and for the boundary — run outside code fences. `#` lines
 * inside a fence are content: the guides really carry them, and a fence-blind scanner cuts
 * the answer at one of those lines while still looking like a success.
 */
export function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const level = headingLevel(heading);
  let openMarker: string | undefined;
  let start = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (FENCE.test(trimmed)) {
      // Opener and closer are both compared trimmed. An indented fence closed by a strict
      // bare-marker test would stay open to end of file, and every heading after it would
      // silently stop being a heading — the guides carry a two-space-indented one.
      if (openMarker === undefined) {
        openMarker = trimmed[0];
      } else if (trimmed[0] === openMarker) {
        openMarker = undefined;
      }
      continue;
    }
    if (openMarker !== undefined) {
      continue;
    }
    if (start === -1) {
      if (line === heading) {
        start = i;
      }
      continue;
    }
    if (headingLevel(line) > 0 && headingLevel(line) <= level) {
      return lines.slice(start, i).join('\n');
    }
  }

  if (start === -1) {
    throw new Error(`heading not found: ${heading}`);
  }
  // A section that closes the document ends at end of file; the topic map points at one.
  return lines.slice(start).join('\n');
}

function readSection(docsRoot: string, section: SectionRef): string {
  const path = join(docsRoot, section.file);
  if (!existsSync(path)) {
    // Named, never swallowed into empty text: a silently incomplete bundle would otherwise
    // reach a reader as the document itself.
    throw new Error(`bundled document missing: ${section.file}`);
  }
  const markdown = readFileSync(path, 'utf-8');
  return section.heading === undefined ? markdown : extractSection(markdown, section.heading);
}

/** `queryDocs` input — the bundle to read from, and which topic to answer. */
export type QueryDocsSpec = {
  /** Root of the bundled documents (`dist/docs`), the only tree read here. */
  docsRoot: string;
  /** ABSENT lists the topics; anything not in {@link TOPICS} throws, empty string included. */
  topic?: string;
};

/**
 * Answer one documentation query.
 *
 * With no topic the result is the listing — how an AI discovers what it may ask at all.
 * With one, it is the mapped section body followed by the bundled reference to read next.
 */
export function queryDocs(spec: QueryDocsSpec): { text: string } {
  if (spec.topic === undefined) {
    return { text: `Polydeukes docs:\n${TOPICS.map((t) => `  pdks docs ${t}`).join('\n')}\n` };
  }
  if (!isTopic(spec.topic)) {
    throw new Error(`unknown docs topic '${spec.topic}' — known topics: ${TOPICS.join(', ')}`);
  }

  const entry = TOPIC_MAP[spec.topic];
  const body = entry.sections.map((section) => readSection(spec.docsRoot, section)).join('\n');
  // Resolved against the bundle, not printed as the bare relative name. A reader given
  // `reference/core.md` has to guess where the bundle lives before it can open anything, and
  // this line is the only way most of the reference layer is reached at all. A path a file-read
  // tool can take is the difference between a pointer and a dead end, and a dead end sends the
  // reader back to the web search this command replaces.
  return { text: `${body}\nSee also: ${join(spec.docsRoot, entry.seeAlso)}\n` };
}
