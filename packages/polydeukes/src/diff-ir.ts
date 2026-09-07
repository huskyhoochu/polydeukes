/**
 * unified diff → `CovenantInput`. One pure translation, no judgment and no disk.
 *
 * The accepted grammar is finite: `diff --git` blocks and header-less `---`/`+++` blocks,
 * covering creation, deletion, modification, mode-only changes, renames, and binary blobs.
 * Anything else throws, so an unrecognised shape fails the run closed instead of translating
 * to a partial observation.
 *
 * A modification's `pre`/`post` are the hunk's `-` and `+` lines, never the whole file: a
 * unified diff carries the changed lines and the context around them, and reconstructing the
 * file from them is not a translation. A creation and a deletion carry the whole text because
 * every line of the file is in the hunk.
 */

import type { CovenantInput } from '@polydeukes/core';

/** The tool name a staged write is dispatched under — telemetry and configs read it. */
export const STAGED_WRITE = 'staged-write';

/** The tool name a staged deletion is dispatched under. */
export const STAGED_DELETE = 'staged-delete';

/** {@link covenantInputFromUnifiedDiff} input — the diff text a producer wrote. */
export type CovenantInputFromUnifiedDiffSpec = {
  /** The whole unified diff; zero bytes is the empty observation. */
  text: string;
};

type ToolCall = CovenantInput['toolCalls'][number];

/** What one file block of the diff says, before it becomes toolCalls. */
type Block = {
  /** The `diff --git` header's two paths, when the block carries that header. */
  headerPaths?: { old: string; new: string };
  /** The `---` side's path, or null for `/dev/null`. */
  oldPath?: string | null;
  /** The `+++` side's path, or null for `/dev/null`. */
  newPath?: string | null;
  renameFrom?: string;
  renameTo?: string;
  binary: boolean;
  /** `deleted file mode` seen — the only sign of a deletion when the file was empty. */
  deletedFile: boolean;
  /** `new file mode` seen — the only sign of a creation when the file is empty. */
  newFile: boolean;
  removed: string[];
  added: string[];
};

function emptyBlock(): Block {
  return { binary: false, deletedFile: false, newFile: false, removed: [], added: [] };
}

/** A path as git prints it after `rename from` / `rename to`: quoted only when it has to be. */
function readBarePath(raw: string): string {
  return raw.startsWith('"') ? unquotePath(raw) : raw;
}

/**
 * Decode git's C-quoted path form: the octal escapes are BYTES of the path, so they are
 * collected and decoded as UTF-8 together — decoding each one on its own would turn every
 * non-ASCII character into replacement characters.
 */
function unquotePath(quoted: string): string {
  const body = quoted.slice(1, -1);
  const bytes: number[] = [];
  for (let at = 0; at < body.length; at += 1) {
    const char = body[at] as string;
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf-8'));
      continue;
    }
    const next = body[at + 1] as string;
    const octal = body.slice(at + 1, at + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(Number.parseInt(octal, 8));
      at += 3;
      continue;
    }
    const simple: Record<string, number> = {
      t: 0x09,
      n: 0x0a,
      r: 0x0d,
      '"': 0x22,
      '\\': 0x5c,
    };
    bytes.push(simple[next] ?? Buffer.from(next, 'utf-8')[0] ?? 0);
    at += 1;
  }
  return Buffer.from(bytes).toString('utf-8');
}

/**
 * The path a `---`/`+++` line names, or null for `/dev/null`. A quoted path is unquoted
 * before anything is cut, because a quoted path may itself contain a tab; an unquoted one is
 * cut at the tab `diff -u` puts its timestamp behind. Exactly one `a/` or `b/` level is
 * stripped, so a repository directory literally named `a/` survives.
 */
function readPath(rest: string, prefix: 'a/' | 'b/'): string | null {
  let path: string;
  if (rest.startsWith('"')) {
    const end = rest.lastIndexOf('"');
    path = unquotePath(rest.slice(0, end + 1));
  } else {
    const tab = rest.indexOf('\t');
    path = tab === -1 ? rest : rest.slice(0, tab);
  }
  if (path === '/dev/null') return null;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** The two paths of a `diff --git a/X b/Y` header, or undefined when they cannot be read. */
function readHeaderPaths(rest: string): { old: string; new: string } | undefined {
  if (rest.startsWith('"')) {
    const end = rest.indexOf('" "');
    if (end === -1) return undefined;
    const old = unquotePath(rest.slice(0, end + 1));
    const next = unquotePath(rest.slice(end + 2));
    return { old: stripOnce(old, 'a/'), new: stripOnce(next, 'b/') };
  }
  // Unquoted paths may contain spaces, and git writes no separator between the two. The
  // halves are equal in length whenever the prefixes are, which is git's own output; the
  // midpoint split is what recovers them.
  const middle = rest.length % 2 === 1 ? (rest.length - 1) / 2 : -1;
  if (middle > 0 && rest[middle] === ' ') {
    return {
      old: stripOnce(rest.slice(0, middle), 'a/'),
      new: stripOnce(rest.slice(middle + 1), 'b/'),
    };
  }
  const at = rest.indexOf(' ');
  if (at === -1) return undefined;
  return { old: stripOnce(rest.slice(0, at), 'a/'), new: stripOnce(rest.slice(at + 1), 'b/') };
}

function stripOnce(path: string, prefix: 'a/' | 'b/'): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** The old and new line counts a hunk header declares, or undefined when it is not one. */
function readHunkCounts(line: string): { old: number; new: number } | undefined {
  const match = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
  if (match === null) return undefined;
  return {
    old: match[1] === undefined ? 1 : Number.parseInt(match[1], 10),
    new: match[2] === undefined ? 1 : Number.parseInt(match[2], 10),
  };
}

/**
 * Split the text into file blocks, reading hunk bodies by the line counts their headers
 * declare. The counts are what keeps a removed `-- note` line (which reads as `--- note`)
 * from being taken for a new file header: header lines are only recognised outside a hunk.
 */
function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let block: Block | undefined;

  const open = (): Block => {
    if (block === undefined) {
      block = emptyBlock();
      blocks.push(block);
    }
    return block;
  };

  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] as string;
    if (line === '' && at === lines.length - 1) continue;

    if (line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) {
      throw new Error(`unified diff: combined diffs are not translatable: ${line}`);
    }

    if (line.startsWith('diff --git ')) {
      block = emptyBlock();
      blocks.push(block);
      block.headerPaths = readHeaderPaths(line.slice('diff --git '.length));
      continue;
    }

    if (line.startsWith('--- ')) {
      // A second `---` outside a hunk starts a new header-less block.
      if (block !== undefined && block.oldPath !== undefined) block = undefined;
      open().oldPath = readPath(line.slice(4), 'a/');
      continue;
    }

    if (line.startsWith('+++ ')) {
      const current = open();
      if (current.oldPath === undefined) {
        throw new Error(`unified diff: '+++' line with no '---' partner: ${line}`);
      }
      current.newPath = readPath(line.slice(4), 'b/');
      continue;
    }

    const counts = readHunkCounts(line);
    if (counts !== undefined) {
      const current = open();
      if (current.oldPath === undefined || current.newPath === undefined) {
        if (current.headerPaths === undefined) {
          throw new Error(`unified diff: hunk with no file header: ${line}`);
        }
      }
      let oldLeft = counts.old;
      let newLeft = counts.new;
      while ((oldLeft > 0 || newLeft > 0) && at + 1 < lines.length) {
        const body = lines[at + 1] as string;
        at += 1;
        if (body.startsWith('\\')) continue;
        // A line the declared counts have no room for is a malformed hunk: judging the
        // lines that fit and dropping the rest would be an observation smaller than the
        // input, so the whole run fails closed instead.
        if (body.startsWith('+') && newLeft > 0) {
          current.added.push(body.slice(1));
          newLeft -= 1;
          continue;
        }
        if (body.startsWith('-') && oldLeft > 0) {
          current.removed.push(body.slice(1));
          oldLeft -= 1;
          continue;
        }
        if ((body.startsWith(' ') || body === '') && oldLeft > 0 && newLeft > 0) {
          oldLeft -= 1;
          newLeft -= 1;
          continue;
        }
        throw new Error(`unified diff: unknown hunk line: ${body}`);
      }
      continue;
    }

    if (line.startsWith('rename from ')) {
      open().renameFrom = readBarePath(line.slice('rename from '.length));
      continue;
    }
    if (line.startsWith('rename to ')) {
      open().renameTo = readBarePath(line.slice('rename to '.length));
      continue;
    }
    if (line.startsWith('deleted file mode ')) {
      open().deletedFile = true;
      continue;
    }
    if (line.startsWith('new file mode ')) {
      open().newFile = true;
      continue;
    }
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      const current = open();
      current.binary = true;
      if (line.endsWith('and /dev/null differ')) current.deletedFile = true;
    }
    // Everything else outside a hunk is an extended header line (`index`, `old mode`,
    // `similarity index`, a binary patch's base85 payload) that names nothing this
    // translation reads.
  }

  return blocks;
}

/** The toolCalls one block translates to, in the order the judgment sees them. */
function blockToolCalls(block: Block): ToolCall[] {
  const { renameFrom, renameTo } = block;
  if (renameFrom !== undefined && renameTo !== undefined) {
    return [
      {
        name: STAGED_DELETE,
        args: { file_path: renameFrom },
        fileChange: { kind: 'delete', path: renameFrom },
      },
      {
        name: STAGED_WRITE,
        args: { file_path: renameTo },
        fileChange: {
          kind: 'modify',
          path: renameTo,
          pre: block.removed.join('\n'),
          post: block.added.join('\n'),
        },
      },
    ];
  }

  // An empty file's deletion or creation carries no `---`/`+++` pair and no hunk, so the
  // mode line is the only evidence of which one it is.
  const deletion = block.newPath === null || block.deletedFile;
  const path = deletion
    ? (block.oldPath ?? block.headerPaths?.old)
    : (block.newPath ?? block.headerPaths?.new);
  if (path === undefined || path === null) {
    throw new Error('unified diff: a file block names no path');
  }

  if (block.binary) {
    return [{ name: deletion ? STAGED_DELETE : STAGED_WRITE, args: { file_path: path } }];
  }

  if (deletion) {
    return [
      {
        name: STAGED_DELETE,
        args: { file_path: path },
        fileChange: { kind: 'delete', path, pre: block.removed.join('\n') },
      },
    ];
  }

  if (block.oldPath === null || block.newFile) {
    return [
      {
        name: STAGED_WRITE,
        args: { file_path: path },
        fileChange: { kind: 'create', path, post: block.added.join('\n') },
      },
    ];
  }

  return [
    {
      name: STAGED_WRITE,
      args: { file_path: path },
      fileChange: {
        kind: 'modify',
        path,
        pre: block.removed.join('\n'),
        post: block.added.join('\n'),
      },
    },
  ];
}

/**
 * Translate a unified diff into the covenant input IR: one toolCall per file block in input
 * order (a rename is two, the deletion first), and no `actor` key — a diff proves no author.
 */
export function covenantInputFromUnifiedDiff(
  spec: CovenantInputFromUnifiedDiffSpec,
): CovenantInput {
  const blocks = parseBlocks(spec.text);
  // Text that is not blank yet contains no block the grammar recognizes — a colored diff,
  // a pager banner, anything else — must not translate to "nothing staged": an empty
  // observation is a pass, and this input may describe a whole commit.
  if (blocks.length === 0 && spec.text.trim() !== '') {
    throw new Error('unified diff: no file block recognized in the input');
  }
  const toolCalls: ToolCall[] = [];
  for (const block of blocks) {
    if (block.oldPath !== undefined && block.newPath === undefined) {
      throw new Error(`unified diff: '---' line with no '+++' partner: ${block.oldPath}`);
    }
    toolCalls.push(...blockToolCalls(block));
  }
  return { toolCalls, subagentSpawns: [], userMessages: [] };
}
