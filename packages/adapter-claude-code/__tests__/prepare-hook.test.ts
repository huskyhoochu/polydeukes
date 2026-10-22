import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareHook } from '../src/prepare-hook.ts';

const TOOL = 'Write';
const TARGET = 'nested.txt';
const NOW = 1_800_000_000_000;
let repoRoot: string;
beforeEach(() => {
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-prepare-')));
});
afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});
function payload(extra: Record<string, unknown> = {}) {
  const toolInput = { file_path: TARGET, content: 'new text\n' };
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 'session-a',
    tool_name: TOOL,
    tool_input: toolInput,
    cwd: repoRoot,
    ...extra,
  });
}
function prepare(rawPayload: string) {
  return prepareHook({ repoRoot, rawPayload });
}

describe('prepareHook process-free input contract', () => {
  it('returns a judged create with the actual target and content without an npm installation', () => {
    // Dropping mutation evidence would make protected-path judgment fall back to mentions.
    const result = prepare(payload());
    expect(result).toMatchObject({
      outcome: 'check',
      input: {
        toolCalls: [
          { name: TOOL, fileChange: { kind: 'create', path: TARGET, post: 'new text\n' } },
        ],
      },
    });
  });
  it.each([
    ['absent', ''],
    ['cut JSON', '{"tool'],
    ['non-object', 'null'],
  ])('returns unavailable for %s input', (_name, raw) => {
    // Treating an incomplete envelope as an empty observation would fabricate permission.
    expect(prepare(raw)).toMatchObject({ outcome: 'unavailable', reason: expect.any(String) });
  });
  it('refuses an explicitly truncated envelope before making an IR', () => {
    // Complete JSON can still carry a host truncation marker.
    expect(prepare(payload({ truncated: true }))).toMatchObject({
      outcome: 'unavailable',
      reason: expect.any(String),
    });
  });
  it('allows future envelope fields without dropping consumed mutation evidence', () => {
    // Rejecting an unused host field would block every call after an additive host upgrade.
    const result = prepare(payload({ future_host_field: { version: 2 } }));
    expect(result).toMatchObject({
      outcome: 'check',
      input: { toolCalls: [{ fileChange: { path: TARGET } }] },
    });
  });
  it('resolves a relative file against the event cwd before making it root relative', () => {
    // Root-anchoring a relative event path judges a different file from the host.
    mkdirSync(join(repoRoot, 'sub'));
    expect(prepare(payload({ cwd: join(repoRoot, 'sub') }))).toMatchObject({
      outcome: 'check',
      input: { toolCalls: [{ fileChange: { path: `sub/${TARGET}` } }] },
    });
  });
  it('reports a pre-state read failure instead of claiming a creation', () => {
    // A directory at the target is unreadable file evidence, rather than a missing file.
    mkdirSync(join(repoRoot, TARGET));
    expect(prepare(payload())).toMatchObject({
      outcome: 'unavailable',
      reason: expect.any(String),
    });
  });
});

describe('prepareHook transcript provenance', () => {
  it.each([
    ['human', { kind: 'human' }, true],
    ['unknown', undefined, false],
  ])(
    'carries %s-origin witness evidence according to proved provenance',
    (_name, origin, admitted) => {
      // Losing the source check opens the witness; losing the transcript removes a valid human choice.
      const transcript = join(repoRoot, 'transcript.jsonl');
      const text = 'witness token';
      writeFileSync(
        transcript,
        `${JSON.stringify({ type: 'user', origin, promptSource: 'typed', message: { role: 'user', content: text }, timestamp: new Date(NOW).toISOString(), uuid: 'message-1' })}\n`,
      );
      const result = prepare(payload({ transcript_path: transcript }));
      expect(result.outcome).toBe('check');
      if (result.outcome !== 'check') throw new Error('expected observed input');
      expect(result.input.session?.userMessages ?? []).toEqual(
        admitted ? [{ text, timestampMs: NOW }] : [],
      );
    },
  );
});

describe('prepareHook file targets outside the project', () => {
  it('carries an outside target under its spelled and real name instead of refusing it', () => {
    // Refusing a scratchpad write outside the checkout stops ordinary work; emitting only the
    // real path leaves the judge without the spelled name a protected list can match.
    const host = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-host-')));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-outside-')));
    const alias = join(host, 'outside-alias');
    try {
      symlinkSync(outside, alias, 'dir');
      const target = join(outside, TARGET);
      writeFileSync(target, 'old text\n');
      const result = prepare(
        payload({
          tool_input: { file_path: join(alias, TARGET), content: 'new text\n' },
        }),
      );
      expect(result).toMatchObject({
        outcome: 'check',
        input: {
          toolCalls: [
            { fileChange: { path: join(alias, TARGET) } },
            { fileChange: { path: realpathSync(target) } },
          ],
        },
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
      rmSync(host, { recursive: true, force: true });
    }
  });

  it('carries a not-yet-created outside target under its spelled and real name', () => {
    // A file the host is about to create has no final path to realpath, so emitting only the
    // real name loses the alias path the host wrote and emitting only the alias misses the
    // file that is actually written.
    const host = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-host-')));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-outside-')));
    const alias = join(host, 'outside-alias');
    try {
      symlinkSync(outside, alias, 'dir');
      const result = prepare(
        payload({ tool_input: { file_path: join(alias, 'new.txt'), content: 'new text\n' } }),
      );
      expect(result).toMatchObject({
        outcome: 'check',
        input: {
          toolCalls: [
            { fileChange: { path: join(alias, 'new.txt') } },
            { fileChange: { path: join(realpathSync(outside), 'new.txt') } },
          ],
        },
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
      rmSync(host, { recursive: true, force: true });
    }
  });

  it('resolves a relative outside target from the event cwd to its absolute real path', () => {
    // Anchoring the relative path at the project root, or leaving it relative in the IR,
    // judges a different file from the one the host writes outside the checkout.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-sibling-')));
    try {
      const target = join('..', basename(outside), 'relative.txt');
      const result = prepare(payload({ tool_input: { file_path: target, content: 'new text\n' } }));
      expect(result).toMatchObject({
        outcome: 'check',
        input: {
          toolCalls: [{ fileChange: { path: join(realpathSync(outside), 'relative.txt') } }],
        },
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('keeps an absolute target inside the project root root-relative', () => {
    // Turning every absolute target absolute would judge an inside file under a path the
    // root-relative protected list does not contain.
    const target = join(repoRoot, TARGET);
    writeFileSync(target, 'old text\n');
    const result = prepare(payload({ tool_input: { file_path: target, content: 'new text\n' } }));
    expect(result).toMatchObject({
      outcome: 'check',
      input: { toolCalls: [{ fileChange: { path: TARGET } }] },
    });
  });
});

describe('prepareHook outside targets hidden by a link or by case', () => {
  it('refuses an outside target reached through a dangling symbolic link', () => {
    // Following a dangling link writes somewhere the link names rather than the target the
    // host reported, so the call has no provable path and must be refused.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-dangling-')));
    try {
      const alias = join(outside, 'alias');
      symlinkSync(join(outside, 'missing', 'config.toml'), alias);
      const result = prepare(payload({ tool_input: { file_path: alias, content: 'new text\n' } }));
      expect(result).toMatchObject({ outcome: 'unavailable', reason: expect.any(String) });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('reports the stored case of an outside directory on a case-folding file system', (context) => {
    // A target written with different case names the same file; keeping the requested
    // spelling leaves the protected list unable to match what is actually written.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-stored-')));
    try {
      mkdirSync(join(outside, '.codex'), { recursive: true });
      if (!existsSync(join(outside, '.CODEX'))) {
        context.skip();
        return;
      }
      const result = prepare(
        payload({
          tool_input: { file_path: join(outside, '.CODEX', 'config.toml'), content: 'new text\n' },
        }),
      );
      expect(result).toMatchObject({
        outcome: 'check',
        input: {
          toolCalls: [
            { fileChange: { path: join(outside, '.CODEX', 'config.toml') } },
            {
              fileChange: {
                path: join(realpathSync.native(outside), '.codex', 'config.toml'),
              },
            },
          ],
        },
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('prepareHook judges a target under both names', () => {
  function targetPaths(rawPayload: string) {
    const result = prepare(rawPayload);
    expect(result.outcome).toBe('check');
    if (result.outcome !== 'check') throw new Error('expected observed input');
    return result.input.toolCalls.map((call) => call.fileChange?.path);
  }

  it('carries a spelled and a real name for a protected file that links outside the root', () => {
    // Keeping only the spelled name protects the link path but not the file actually written;
    // keeping only the real name drops the protected segment the spelled path names.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-link-file-')));
    try {
      const real = join(outside, 'cs');
      writeFileSync(real, 'old text\n');
      mkdirSync(join(repoRoot, '.claude'), { recursive: true });
      symlinkSync(real, join(repoRoot, '.claude', 'settings.json'));
      expect(
        targetPaths(
          payload({
            tool_input: { file_path: '.claude/settings.json', content: 'new text\n' },
          }),
        ),
      ).toEqual(['.claude/settings.json', realpathSync(real)]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('carries a spelled and a real name for a protected directory that links inside the root', () => {
    // Reading only the link path leaves the real directory unprotected; collapsing to the
    // real path loses the protected segment that names the link.
    mkdirSync(join(repoRoot, 'tools', 'hk'), { recursive: true });
    mkdirSync(join(repoRoot, '.claude'), { recursive: true });
    symlinkSync(join(repoRoot, 'tools', 'hk'), join(repoRoot, '.claude', 'hooks'), 'dir');
    expect(
      targetPaths(
        payload({
          tool_input: { file_path: '.claude/hooks/x.sh', content: 'new text\n' },
        }),
      ),
    ).toEqual(['.claude/hooks/x.sh', 'tools/hk/x.sh']);
  });

  it('carries a spelled and a real name for an inside link to an outside directory', () => {
    // Judging only the link path misses the outside protected file the link writes; judging
    // only the real path skips the protected segment that names the link.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-link-dir-')));
    try {
      mkdirSync(join(outside, '.codex'), { recursive: true });
      symlinkSync(join(outside, '.codex'), join(repoRoot, 'link'), 'dir');
      expect(
        targetPaths(
          payload({
            tool_input: { file_path: 'link/config.toml', content: 'new text\n' },
          }),
        ),
      ).toEqual(['link/config.toml', join(realpathSync(outside), '.codex', 'config.toml')]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('keeps only the spelled name when realpath fails with ENOTDIR', () => {
    // Treating ENOTDIR as a missing target, or refusing the call, would hide or block a write
    // whose only provable name is the one the host spelled.
    writeFileSync(join(repoRoot, 'README.md'), 'readme\n');
    expect(
      targetPaths(
        payload({
          tool_input: { file_path: 'README.md/x', content: 'new text\n' },
        }),
      ),
    ).toEqual(['README.md/x']);
  });

  it('refuses an outside target reached through a symbolic-link loop', () => {
    // Treating a loop as an unresolved name would keep the spelled path alone and let a call
    // whose real target realpath could not inspect pass judgment.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-loop-')));
    try {
      symlinkSync(join(outside, 'b'), join(outside, 'a'));
      symlinkSync(join(outside, 'a'), join(outside, 'b'));
      const result = prepare(
        payload({ tool_input: { file_path: join(outside, 'a', 'x'), content: 'new text\n' } }),
      );
      expect(result).toMatchObject({ outcome: 'unavailable', reason: expect.any(String) });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses an outside target under a directory without search permission', (context) => {
    // Reading EACCES as a missing target would emit only the spelled name and let the call
    // pass on a path whose real target realpath could not inspect.
    if (process.getuid?.() === 0) {
      context.skip();
      return;
    }
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-locked-')));
    const locked = join(outside, 'locked');
    try {
      mkdirSync(locked);
      writeFileSync(join(locked, 'inside.txt'), 'old text\n');
      chmodSync(locked, 0o000);
      const result = prepare(
        payload({ tool_input: { file_path: join(locked, 'x'), content: 'new text\n' } }),
      );
      expect(result).toMatchObject({ outcome: 'unavailable', reason: expect.any(String) });
    } finally {
      chmodSync(locked, 0o755);
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('prepareHook working-directory context', () => {
  it.each(['.', 'sub'])('carries shell cwd %s without rewriting the command', (directory) => {
    // Dropping cwd routes a relative redirect to a different file; rewriting command loses its evidence.
    const shellTool = 'Bash';
    const command = "printf 'literal ../text' > gate.txt";
    mkdirSync(join(repoRoot, 'sub'));
    const result = prepare(
      payload({
        cwd: join(repoRoot, directory),
        tool_name: shellTool,
        tool_input: { command: command },
      }),
    );
    expect(result).toMatchObject({
      outcome: 'check',
      input: { toolCalls: [{ name: shellTool, cwd: directory, args: { command: command } }] },
    });
  });
});
