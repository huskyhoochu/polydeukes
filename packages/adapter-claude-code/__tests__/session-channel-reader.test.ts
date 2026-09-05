import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionChannelReader } from '../src/session-channel-reader.ts';

// The spawn sidecar channel: `sessionChannelReader({ transcriptPath })` answers a channel
// kind with the spawn-record list as JSON text, or with absence. The location and shape
// were fixed by probing the live host: a transcript at `<dir>/<sessionId>.jsonl` keeps its
// subagent records beside it as `<dir>/<sessionId>/subagents/agent-*.meta.json`, one
// object per file — `{ agentType, description, toolUseId, spawnDepth }`. The reader's
// three answers are three facts: a JSON array of the parsed records (the channel and its
// content), `[]`-shaped text (the channel exists and observed no spawn), and `undefined`
// (there is no channel at all).

// Session ids, agent names, and record fields are fixture values.
const SESSION_ID = 'sess-1';
const SIDECAR = 'sidecar';
const WRITER_META = {
  agentType: 'tdd-test-writer',
  description: 'write the failing tests',
  toolUseId: 't1',
  spawnDepth: 1,
};
const REVIEWER_META = {
  agentType: 'code-reviewer',
  description: 'review the diff',
  toolUseId: 't2',
  spawnDepth: 1,
};

let dir: string;
let transcriptPath: string;
let subagentsDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-channel-read-'));
  transcriptPath = join(dir, `${SESSION_ID}.jsonl`);
  writeFileSync(transcriptPath, '{"type":"user"}\n');
  subagentsDir = join(dir, SESSION_ID, 'subagents');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write one meta file under the session's subagents directory. */
function writeMeta(name: string, content: string): void {
  mkdirSync(subagentsDir, { recursive: true });
  writeFileSync(join(subagentsDir, name), content);
}

describe('sessionChannelReader — the sidecar kind', () => {
  it('answers the parsed records as one JSON array, in filename order', () => {
    // The later-sorting file is written FIRST: a reader that keeps the directory's
    // enumeration order (creation order on some filesystems) reverses the list, and the
    // witness order two runs report stops being deterministic.
    writeMeta('agent-002.meta.json', JSON.stringify(REVIEWER_META));
    writeMeta('agent-001.meta.json', JSON.stringify(WRITER_META));

    const text = sessionChannelReader({ transcriptPath })(SIDECAR);

    expect(text).toBeDefined();
    expect(JSON.parse(text as string)).toEqual([WRITER_META, REVIEWER_META]);
  });

  it('answers the empty list text when the directory exists and holds no meta file', () => {
    // "The channel observed no spawn" and "there is no channel" are different facts: a
    // reader answering undefined here hands the verdict to the supply policy, and under
    // `pass` a session that provably spawned nothing skips a judgment it should fail.
    mkdirSync(subagentsDir, { recursive: true });

    const text = sessionChannelReader({ transcriptPath })(SIDECAR);

    expect(text).toBeDefined();
    expect(JSON.parse(text as string)).toEqual([]);
  });

  it('answers undefined when there is no subagents directory beside the transcript', () => {
    // The main transcript exists and the sidecar does not — the shape of every session
    // that never spawned a subagent on a host that creates the directory lazily. A reader
    // that throws here blocks every such call; one that answers '[]' fabricates an
    // observation.
    expect(sessionChannelReader({ transcriptPath })(SIDECAR)).toBeUndefined();
  });

  it('answers undefined for an empty or relative transcript path — never a cwd-relative read', () => {
    // An empty string passes a typeof check upstream, and `dirname('')` is `'.'`: the
    // sidecar would resolve against the hook's cwd, where a checked-out `subagents/`
    // directory could pass its records off as this session's spawn evidence.
    expect(sessionChannelReader({ transcriptPath: '' })(SIDECAR)).toBeUndefined();
    expect(sessionChannelReader({ transcriptPath: 'sess-1.jsonl' })(SIDECAR)).toBeUndefined();
  });

  it('answers undefined with no transcript path at all', () => {
    // No transcript means no place to derive the sidecar from; the channel is absent and
    // the declaration's supply policy disposes of it, same as the context family's
    // forfeit on the same absence.
    expect(sessionChannelReader({})(SIDECAR)).toBeUndefined();
  });

  it('keeps only the parseable records when one meta file holds broken JSON', () => {
    // Evidence reduction, the transcript provider's own discipline: a broken record
    // shrinks the evidence rather than poisoning it. Failing the whole channel would let
    // one corrupt file erase a spawn that provably happened; passing the raw text through
    // would hand `json` an unparseable value and fail supply on a valid neighbour.
    writeMeta('agent-001.meta.json', '{ not json');
    writeMeta('agent-002.meta.json', JSON.stringify(REVIEWER_META));

    const text = sessionChannelReader({ transcriptPath })(SIDECAR);

    expect(text).toBeDefined();
    expect(JSON.parse(text as string)).toEqual([REVIEWER_META]);
  });

  it('a directory entry inside subagents/ contributes nothing and the file records still answer', () => {
    // A host can leave a directory in the sidecar — here one whose NAME matches the meta
    // pattern, the hardest shape. Reading it as a meta file throws EISDIR and takes the
    // whole channel down; non-file entries stay out of the enumeration and the channel
    // answers its real records.
    mkdirSync(join(subagentsDir, 'agent-000.meta.json'), { recursive: true });
    writeMeta('agent-001.meta.json', JSON.stringify(WRITER_META));

    const text = sessionChannelReader({ transcriptPath })(SIDECAR);

    expect(text).toBeDefined();
    expect(JSON.parse(text as string)).toEqual([WRITER_META]);
  });

  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'throws on a permission refusal — never absence',
    () => {
      // The same fail direction the file readers pin: folding a refusal into absence lets a
      // `supply: pass` declaration skip a channel the root could not read, with no
      // fail-closed row saying so. Skipped as root, which no mode can refuse.
      writeMeta('agent-001.meta.json', JSON.stringify(WRITER_META));
      chmodSync(subagentsDir, 0o000);
      try {
        expect(() => sessionChannelReader({ transcriptPath })(SIDECAR)).toThrow();
      } finally {
        chmodSync(subagentsDir, 0o700);
      }
    },
  );

  it('answers undefined for a kind it does not carry', () => {
    // The kind universe is the caller's plan; a reader that answers the sidecar text for
    // every kind supplies a future channel (or a typo) with spawn records.
    writeMeta('agent-001.meta.json', JSON.stringify(WRITER_META));

    expect(sessionChannelReader({ transcriptPath })('other-kind')).toBeUndefined();
  });
});
