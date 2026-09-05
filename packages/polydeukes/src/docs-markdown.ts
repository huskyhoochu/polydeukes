import { createHash } from 'node:crypto';

import type { DocsSection } from './docs-types.ts';

const headingPattern = /^(#{1,6})\s+(.*)$/;
const anchorPattern = /^<a id="([a-z0-9][a-z0-9-]*)"><\/a>$/;
const sectionHeadingLevel = 2;

function fenceMatch(line: string): { marker: '`' | '~'; length: number } | null {
  const match = /^(`{3,}|~{3,})/.exec(line.trim());
  if (!match) return null;
  return { marker: match[0][0] as '`' | '~', length: match[0].length };
}

function headingLevel(line: string): number {
  return headingPattern.exec(line)?.[1].length ?? 0;
}

function headingText(line: string): string {
  return headingPattern.exec(line)?.[2] ?? '';
}

function anchorId(line: string): string | null {
  return anchorPattern.exec(line.trim())?.[1] ?? null;
}

/** Compute a hex SHA-256 digest of the exact UTF-8 Markdown without normalizing whitespace. */
export function hashMarkdown(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}

/**
 * Retrieve original Markdown by stable anchor ID, including the anchor and child headings.
 *
 * @param markdown - Complete document whose section anchors must be valid.
 * @param sectionId - Anchor ID without a leading hash sign.
 * @returns Unmodified section text up to the next same-level or higher-level heading.
 * @throws If the section is absent or the document has missing or duplicate section anchors.
 */
export function extractSection(markdown: string, sectionId: string): string {
  const sections = parseSections(markdown, { requireAnchors: true });
  const section = sections.find((entry) => entry.id === sectionId);
  if (!section) {
    throw new Error(`section not found: ${sectionId}`);
  }
  return section.text;
}

/**
 * Find anchored H2–H6 sections outside code fences, preserving their original Markdown.
 *
 * @param markdown - Complete source document to divide into retrievable sections.
 * @param options - Require anchors for every H2–H6 heading, or omit unanchored headings.
 * @returns Sections in document order, including nested content and their anchor lines.
 * @throws If section IDs repeat or a required anchor is missing or not adjacent to its heading.
 */
export function parseSections(
  markdown: string,
  options: { requireAnchors: boolean },
): DocsSection[] {
  const lines = markdown.split('\n');
  const lineStarts: number[] = [0];
  for (let index = 0; index < lines.length - 1; index += 1) {
    lineStarts[index + 1] = lineStarts[index] + lines[index].length + 1;
  }
  const starts: Array<{
    id: string;
    title: string;
    level: number;
    startLine: number;
    startOffset: number;
  }> = [];
  const topLevelBoundaries: number[] = [];
  let fence: { marker: '`' | '~'; length: number } | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = fenceMatch(line);
    if (match) {
      if (fence === undefined) {
        fence = match;
      } else if (fence.marker === match.marker && match.length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (fence !== undefined) {
      continue;
    }
    if (headingLevel(line) === 1) {
      let previous = index - 1;
      while (previous >= 0 && lines[previous].trim() === '') previous -= 1;
      topLevelBoundaries.push(previous >= 0 && anchorId(lines[previous]) ? previous : index);
    }
    if (headingLevel(line) < sectionHeadingLevel) {
      continue;
    }

    let anchorLine = index - 1;
    while (anchorLine >= 0 && lines[anchorLine].trim() === '') {
      anchorLine -= 1;
    }
    if (anchorLine < 0) {
      if (options.requireAnchors) {
        throw new Error(`missing anchor for heading: ${line}`);
      }
      continue;
    }
    const id = anchorId(lines[anchorLine]);
    if (!id) {
      if (options.requireAnchors) {
        throw new Error(`missing anchor for heading: ${line}`);
      }
      continue;
    }
    const blankSpan = lines.slice(anchorLine + 1, index).every((entry) => entry.trim() === '');
    if (!blankSpan) {
      if (options.requireAnchors) {
        throw new Error(`anchor not adjacent to heading: ${line}`);
      }
      continue;
    }

    starts.push({
      id,
      title: headingText(line),
      level: headingLevel(line),
      startLine: anchorLine,
      startOffset: lineStarts[anchorLine],
    });
  }

  const sections: DocsSection[] = starts.map((start, index) => {
    let endLine = topLevelBoundaries.find((line) => line > start.startLine) ?? lines.length;
    for (let candidate = index + 1; candidate < starts.length; candidate += 1) {
      if (starts[candidate].level <= start.level) {
        endLine = Math.min(endLine, starts[candidate].startLine);
        break;
      }
    }
    const endOffset = endLine >= lines.length ? markdown.length : lineStarts[endLine];
    return {
      id: start.id,
      title: start.title,
      level: start.level,
      startLine: start.startLine,
      endLine,
      text: markdown.slice(start.startOffset, endOffset),
    };
  });

  const ids = new Set<string>();
  for (const section of sections) {
    if (ids.has(section.id)) {
      throw new Error(`duplicate section id: ${section.id}`);
    }
    ids.add(section.id);
  }

  return sections;
}

/**
 * Look up a stable section ID after validating the document's section anchors.
 *
 * @param markdown - Complete source document, not just the target section.
 * @param sectionId - Anchor ID without a leading hash sign.
 * @returns The section and its source bounds, or undefined when the ID is absent.
 * @throws If the document has missing or duplicate section anchors.
 */
export function headingMatch(markdown: string, sectionId: string): DocsSection | undefined {
  return parseSections(markdown, { requireAnchors: true }).find(
    (section) => section.id === sectionId,
  );
}
