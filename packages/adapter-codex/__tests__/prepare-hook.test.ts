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

const TOOL = 'apply_patch';
const TARGET = 'nested.txt';
let repoRoot: string;
beforeEach(() => {
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-prepare-')));
});
afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});
function payload(extra: Record<string, unknown> = {}) {
  const toolInput = {
    command: `*** Begin Patch\n*** Add File: ${TARGET}\n+new text\n*** End Patch\n`,
  };
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

describe('prepareHook lifecycle provenance and session boundaries', () => {
  function lifecycle(event: string, fields: Record<string, unknown> = {}, session = 'session-a') {
    return prepare(
      JSON.stringify({ hook_event_name: event, session_id: session, cwd: repoRoot, ...fields }),
    );
  }
  function sessionInput(session = 'session-a') {
    const result = prepare(payload({ session_id: session }));
    expect(result.outcome).toBe('check');
    if (result.outcome !== 'check') throw new Error('expected observed input');
    return result.input.session;
  }
  it('records an unknown-source prompt without admitting it as human witness evidence', () => {
    // The event name and absence of a subagent marker cannot prove a human origin.
    expect(lifecycle('UserPromptSubmit', { prompt: 'open witness' })).toEqual({
      outcome: 'recorded',
    });
    expect(sessionInput()?.userMessages ?? []).toEqual([]);
  });
  it('keeps failed post-tool evidence distinct from successful precedent', () => {
    // Converting a failed call into succeeded grants history-dependent permissions.
    lifecycle('PostToolUse', {
      tool_name: 'Bash',
      tool_input: { command: 'false' },
      tool_response: { exit_code: 1 },
      success: false,
    });
    const calls = sessionInput()?.toolCalls ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]?.succeeded).not.toBe(true);
    expect(sessionInput('other-session')?.toolCalls ?? []).toEqual([]);
  });
  it('cleans the ended session while retaining another session history', () => {
    // A shared sidecar reset destroys unrelated active evidence.
    lifecycle('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'pwd' } });
    lifecycle(
      'PostToolUse',
      { tool_name: 'Bash', tool_input: { command: 'whoami' } },
      'other-session',
    );
    expect(lifecycle('SessionEnd')).toEqual({ outcome: 'recorded' });
    expect(sessionInput()?.toolCalls ?? []).toEqual([]);
    expect(sessionInput('other-session')?.toolCalls).toHaveLength(1);
  });
});

describe('prepareHook file targets outside the project', () => {
  it('carries an outside patch target under its spelled and real name instead of refusing it', () => {
    // Refusing a patch outside the checkout stops ordinary work; emitting only the real path
    // leaves the judge without the spelled name a protected list can match.
    const host = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-host-')));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-outside-')));
    const alias = join(host, 'outside-alias');
    try {
      symlinkSync(outside, alias, 'dir');
      const target = join(outside, TARGET);
      writeFileSync(target, 'old text\n');
      const patch = [
        '*** Begin Patch',
        `*** Update File: ${join(alias, TARGET)}`,
        '@@',
        '-old text',
        '+new text',
        '*** End Patch',
        '',
      ].join('\n');
      const result = prepare(payload({ tool_input: { command: patch } }));
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

  it('carries a not-yet-created outside patch target under its spelled and real name', () => {
    // A file the patch is about to create has no final path to realpath, so emitting only the
    // real name loses the alias path the patch wrote and emitting only the alias misses the
    // file that is actually written.
    const host = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-host-')));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-outside-')));
    const alias = join(host, 'outside-alias');
    try {
      symlinkSync(outside, alias, 'dir');
      const patch = [
        '*** Begin Patch',
        `*** Add File: ${join(alias, 'new.txt')}`,
        '+new text',
        '*** End Patch',
        '',
      ].join('\n');
      const result = prepare(payload({ tool_input: { command: patch } }));
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

  it('resolves a relative outside patch target from the event cwd to its absolute real path', () => {
    // Anchoring the relative path at the project root, or leaving it relative in the IR,
    // judges a different file from the one the patch writes outside the checkout.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-sibling-')));
    try {
      const target = join('..', basename(outside), 'relative.txt');
      const patch = [
        '*** Begin Patch',
        `*** Add File: ${target}`,
        '+new text',
        '*** End Patch',
        '',
      ].join('\n');
      const result = prepare(payload({ tool_input: { command: patch } }));
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

  it('keeps an absolute patch target inside the project root root-relative', () => {
    // Turning every absolute target absolute would judge an inside file under a path the
    // root-relative protected list does not contain.
    const patch = [
      '*** Begin Patch',
      `*** Add File: ${join(repoRoot, TARGET)}`,
      '+new text',
      '*** End Patch',
      '',
    ].join('\n');
    const result = prepare(payload({ tool_input: { command: patch } }));
    expect(result).toMatchObject({
      outcome: 'check',
      input: { toolCalls: [{ fileChange: { path: TARGET } }] },
    });
  });
});

describe('prepareHook outside targets hidden by a link or by case', () => {
  it('refuses an outside patch target reached through a dangling symbolic link', () => {
    // Following a dangling link creates the file where the link points, not at the path the
    // patch names, so the call has no provable target and must be refused.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-dangling-')));
    try {
      const alias = join(outside, 'alias');
      symlinkSync(join(outside, 'missing', 'config.toml'), alias);
      const patch = [
        '*** Begin Patch',
        `*** Add File: ${alias}`,
        '+new text',
        '*** End Patch',
        '',
      ].join('\n');
      const result = prepare(payload({ tool_input: { command: patch } }));
      expect(result).toMatchObject({ outcome: 'unavailable', reason: expect.any(String) });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('reports the stored case of an outside directory on a case-folding file system', (context) => {
    // A patch target written with different case names the same file; keeping the requested
    // spelling leaves the protected list unable to match what is actually written.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-stored-')));
    try {
      mkdirSync(join(outside, '.codex'), { recursive: true });
      if (!existsSync(join(outside, '.CODEX'))) {
        context.skip();
        return;
      }
      const target = join(outside, '.CODEX', 'config.toml');
      const patch = [
        '*** Begin Patch',
        `*** Add File: ${target}`,
        '+new text',
        '*** End Patch',
        '',
      ].join('\n');
      const result = prepare(payload({ tool_input: { command: patch } }));
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
  function patchPayload(...lines: string[]) {
    return payload({
      tool_input: {
        command: ['*** Begin Patch', ...lines, '*** End Patch', ''].join('\n'),
      },
    });
  }
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
          patchPayload('*** Update File: .claude/settings.json', '@@', '-old text', '+new text'),
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
    expect(targetPaths(patchPayload('*** Add File: .claude/hooks/x.sh', '+new text'))).toEqual([
      '.claude/hooks/x.sh',
      'tools/hk/x.sh',
    ]);
  });

  it('carries a spelled and a real name for an inside link to an outside directory', () => {
    // Judging only the link path misses the outside protected file the link writes; judging
    // only the real path skips the protected segment that names the link.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-link-dir-')));
    try {
      mkdirSync(join(outside, '.codex'), { recursive: true });
      symlinkSync(join(outside, '.codex'), join(repoRoot, 'link'), 'dir');
      expect(targetPaths(patchPayload('*** Add File: link/config.toml', '+new text'))).toEqual([
        'link/config.toml',
        join(realpathSync(outside), '.codex', 'config.toml'),
      ]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('keeps only the spelled name when realpath fails with ENOTDIR', () => {
    // Treating ENOTDIR as a missing target, or refusing the call, would hide or block a write
    // whose only provable name is the one the patch spelled.
    writeFileSync(join(repoRoot, 'README.md'), 'readme\n');
    expect(targetPaths(patchPayload('*** Add File: README.md/x', '+new text'))).toEqual([
      'README.md/x',
    ]);
  });

  it('refuses an outside target reached through a symbolic-link loop', () => {
    // Treating a loop as an unresolved name would keep the spelled path alone and let a call
    // whose real target realpath could not inspect pass judgment.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-loop-')));
    try {
      symlinkSync(join(outside, 'b'), join(outside, 'a'));
      symlinkSync(join(outside, 'a'), join(outside, 'b'));
      const result = prepare(
        payload({
          tool_input: {
            command: [
              '*** Begin Patch',
              `*** Add File: ${join(outside, 'a', 'x')}`,
              '+new text',
              '*** End Patch',
              '',
            ].join('\n'),
          },
        }),
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
        payload({
          tool_input: {
            command: [
              '*** Begin Patch',
              `*** Add File: ${join(locked, 'x')}`,
              '+new text',
              '*** End Patch',
              '',
            ].join('\n'),
          },
        }),
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
        tool_input: { command },
      }),
    );
    expect(result).toMatchObject({
      outcome: 'check',
      input: { toolCalls: [{ name: shellTool, cwd: directory, args: { command } }] },
    });
  });
});
