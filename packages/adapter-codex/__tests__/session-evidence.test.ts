import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunHookSpec } from '../src/hook.ts';
import { runHook } from '../src/hook.ts';

const APPLY_PATCH = 'apply_patch';
const BASH = 'Bash';
const SESSION_ID = '../../host/session:one';
const OTHER_SESSION_ID = 'host-session-two';
const PROMPT = 'pdks witness\ncontinue';
const RECEIVED_AT_MS = 1_788_000_000_000;
const TARGET_FILE = '.codex/hooks/extra.mjs';
const WITNESS_TOKEN = 'pdks witness';
const ESCAPED_WITNESS_TOKEN = 'pdks "witness"';
const FAILURE_PREFIX = 'adapter-codex failed before spawn:';

type SpawnCall = {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
  stdio: readonly [string, string, string];
};

type SessionIr = {
  session?: {
    evidencePath?: string;
    userMessages: { text: string; timestampMs?: number }[];
    toolCalls: { name: string; args?: Record<string, unknown>; succeeded?: boolean }[];
    channels?: unknown;
  };
  actor?: unknown;
};

let repoRoot: string;
let stderr: string[];
let stdoutWrites: number;

beforeEach(() => {
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-codex-session-evidence-')));
  stderr = [];
  stdoutWrites = 0;
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  vi.spyOn(process.stdout, 'write').mockImplementation((() => {
    stdoutWrites += 1;
    return true;
  }) as typeof process.stdout.write);
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function installStubPolydeukes(): void {
  const packageDir = join(repoRoot, 'node_modules', 'polydeukes');
  mkdirSync(join(packageDir, 'dist'), { recursive: true });
  writeFileSync(join(repoRoot, 'package.json'), '{"name":"probe","private":true}\n');
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({ name: 'polydeukes', bin: { pdks: './dist/bin.js' } }),
  );
  writeFileSync(join(packageDir, 'dist', 'bin.js'), '');
}

function evidencePath(sessionId = SESSION_ID): string {
  return join(
    repoRoot,
    '.polydeukes',
    'codex-sessions',
    `${createHash('sha256').update(sessionId).digest('hex')}.jsonl`,
  );
}

function recordingSpawn(status: number | null): {
  calls: SpawnCall[];
  spawn: RunHookSpec['spawn'];
} {
  const calls: SpawnCall[] = [];
  return {
    calls,
    spawn: (spec: SpawnCall) => {
      calls.push({ ...spec, args: [...spec.args] });
      return { status };
    },
  };
}

function invoke(
  rawPayload: Record<string, unknown>,
  spawn: RunHookSpec['spawn'],
  nowMs = RECEIVED_AT_MS,
) {
  const spec: RunHookSpec & { now: () => number } = {
    repoRoot,
    rawPayload: JSON.stringify(rawPayload),
    spawn,
    now: () => nowMs,
  };
  return runHook(spec);
}

function lifecyclePayload(
  hookEventName: 'UserPromptSubmit' | 'PostToolUse' | 'SessionEnd',
  fields: Record<string, unknown> = {},
  sessionId = SESSION_ID,
): Record<string, unknown> {
  return { hook_event_name: hookEventName, session_id: sessionId, ...fields };
}

function preToolPayload(sessionId = SESSION_ID): Record<string, unknown> {
  return {
    cwd: repoRoot,
    hook_event_name: 'PreToolUse',
    model: 'gpt-5.3-codex',
    permission_mode: 'default',
    session_id: sessionId,
    tool_input: {
      command: [
        '*** Begin Patch',
        `*** Add File: ${TARGET_FILE}`,
        '+export {};',
        '*** End Patch',
        '',
      ].join('\n'),
    },
    tool_name: APPLY_PATCH,
    tool_use_id: 'call-session',
    transcript_path: join(repoRoot, 'unstable-transcript.jsonl'),
    turn_id: 'turn-session',
  };
}

function parsedSession(call: SpawnCall | undefined): SessionIr['session'] {
  return (JSON.parse(call?.stdin ?? 'null') as SessionIr).session;
}

describe('runHook — lifecycle evidence storage', () => {
  it('appends a timestamped user record under the SHA-256 session name and writes no stdout', () => {
    // A raw-id filename admits traversal, and a missing injected timestamp fabricates no
    // freshness for the witness valve. A lifecycle event must not spawn a verdict for a
    // human message that has already been accepted by the host.
    installStubPolydeukes();
    const { calls, spawn } = recordingSpawn(2);

    const outcome = invoke(lifecyclePayload('UserPromptSubmit', { prompt: PROMPT }), spawn);

    expect(outcome).toEqual({ exitCode: 0 });
    expect(calls).toEqual([]);
    expect(stdoutWrites).toBe(0);
    expect(evidencePath()).not.toContain(SESSION_ID);
    expect(readFileSync(evidencePath(), 'utf-8')).toBe(
      `${JSON.stringify({ kind: 'user', text: PROMPT, timestampMs: RECEIVED_AT_MS })}\n`,
    );
  });

  it('appends tool calls in event order, preserving plain-object args but never inventing succeeded', () => {
    // Saving only the last event loses precedent order; retaining tool_response or adding
    // `succeeded: true` claims an outcome the lifecycle payload does not prove. A scalar
    // tool_input is valid JSON but cannot become the IR args object.
    installStubPolydeukes();
    const lifecycle = recordingSpawn(2);
    invoke(
      lifecyclePayload('PostToolUse', {
        tool_name: BASH,
        tool_input: { command: 'pwd' },
        tool_response: { output: repoRoot },
      }),
      lifecycle.spawn,
    );
    invoke(
      lifecyclePayload('PostToolUse', { tool_name: APPLY_PATCH, tool_input: 'opaque' }),
      lifecycle.spawn,
    );
    const judgment = recordingSpawn(0);

    const outcome = invoke(preToolPayload(), judgment.spawn);

    expect(outcome).toEqual({ exitCode: 0 });
    expect(lifecycle.calls).toEqual([]);
    expect(judgment.calls).toHaveLength(1);
    expect(parsedSession(judgment.calls[0])?.toolCalls).toEqual([
      { name: BASH, args: { command: 'pwd' } },
      { name: APPLY_PATCH },
    ]);
    expect(
      parsedSession(judgment.calls[0])?.toolCalls.every((call) => !('succeeded' in call)),
    ).toBe(true);
  });

  it('supplies an empty named session when no evidence file exists, without actor or channels', () => {
    // Omitting session confuses a host-supplied empty observation with no session surface;
    // fabricating actor or channels asserts provenance this event never carried.
    installStubPolydeukes();
    const { calls, spawn } = recordingSpawn(0);

    invoke(preToolPayload(), spawn);

    const ir = JSON.parse(calls[0]?.stdin ?? 'null') as SessionIr;
    expect(ir.session).toEqual({
      evidencePath: evidencePath(),
      userMessages: [],
      toolCalls: [],
    });
    expect('actor' in ir).toBe(false);
    expect('channels' in (ir.session ?? {})).toBe(false);
  });

  it('deletes only its hashed session file, and treats an absent file as success', () => {
    // Clearing the directory on SessionEnd destroys resumed evidence for every other
    // session; treating ENOENT as failure makes a normal duplicate lifecycle signal noisy.
    installStubPolydeukes();
    const sessions = recordingSpawn(2);
    invoke(lifecyclePayload('UserPromptSubmit', { prompt: PROMPT }), sessions.spawn);
    invoke(
      lifecyclePayload('UserPromptSubmit', { prompt: 'other' }, OTHER_SESSION_ID),
      sessions.spawn,
    );

    expect(invoke(lifecyclePayload('SessionEnd'), sessions.spawn)).toEqual({ exitCode: 0 });
    expect(existsSync(evidencePath())).toBe(false);
    expect(existsSync(evidencePath(OTHER_SESSION_ID))).toBe(true);
    expect(invoke(lifecyclePayload('SessionEnd'), sessions.spawn)).toEqual({ exitCode: 0 });
    expect(sessions.calls).toEqual([]);
    expect(stdoutWrites).toBe(0);
  });
});

describe('runHook — lifecycle evidence failures', () => {
  it('reports an append failure but exits 0 without spawning or writing stdout', () => {
    // A lifecycle persistence failure cannot roll back the accepted human prompt. Returning
    // 2 or spawning the judge blocks after the fact; silence hides why the next valve is shut.
    installStubPolydeukes();
    writeFileSync(join(repoRoot, '.polydeukes'), 'not a directory');
    const { calls, spawn } = recordingSpawn(2);

    const outcome = invoke(lifecyclePayload('UserPromptSubmit', { prompt: PROMPT }), spawn);

    expect(outcome).toEqual({ exitCode: 0 });
    expect(calls).toEqual([]);
    expect(stderr.join('')).toMatch(/session evidence|codex-sessions/i);
    expect(stdoutWrites).toBe(0);
  });

  it.skipIf(process.getuid?.() === 0)(
    'reports a delete failure but exits 0 without deleting another session',
    () => {
      // A failed cleanup is advisory because the session is already over. Broad cleanup or
      // a blocking exit either loses unrelated evidence or changes a completed lifecycle.
      installStubPolydeukes();
      const { calls, spawn } = recordingSpawn(2);
      const sessionsDir = dirname(evidencePath());
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(
        evidencePath(),
        `${JSON.stringify({ kind: 'user', text: PROMPT, timestampMs: RECEIVED_AT_MS })}\n`,
      );
      chmodSync(sessionsDir, 0o500);
      try {
        const outcome = invoke(lifecyclePayload('SessionEnd'), spawn);
        expect(outcome).toEqual({ exitCode: 0 });
        expect(existsSync(evidencePath())).toBe(true);
        expect(calls).toEqual([]);
        expect(stderr.join('')).toMatch(/session evidence|delete|remove/i);
        expect(stdoutWrites).toBe(0);
      } finally {
        chmodSync(sessionsDir, 0o700);
      }
    },
  );

  it('fails closed before judgment when one evidence line is malformed', () => {
    // Folding a corrupt file into empty arrays turns provider failure into absence and can
    // let a history discipline pass. The spawned non-IR keeps the single telemetry writer.
    installStubPolydeukes();
    mkdirSync(dirname(evidencePath()), { recursive: true });
    writeFileSync(evidencePath(), '{not-json}\n');
    const { calls, spawn } = recordingSpawn(2);

    const outcome = invoke(preToolPayload(), spawn);

    expect(outcome).toEqual({ exitCode: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.stdin).toMatch(new RegExp(`^${FAILURE_PREFIX}`));
    expect(() => JSON.parse(calls[0]?.stdin ?? '')).toThrow();
    expect(stderr.join('')).toMatch(/session evidence|jsonl|record/i);
    expect(stderr.join('')).not.toMatch(/user terminal/i);
  });
});

describe('runHook — blocked-verdict recovery', () => {
  it('names the configured token and terminal fallback only after a valid blocked verdict with user evidence', () => {
    // A generic retry omits the first-line constraint and makes a mid-sentence token look
    // sufficient; attaching this hint before a verdict falsely suggests witness can repair
    // envelope or evidence corruption.
    installStubPolydeukes();
    writeFileSync(
      join(repoRoot, 'polydeukes.config.json'),
      JSON.stringify({
        languages: { typescript: { productionGlob: 'src/**/*.ts', testCmd: 'true' } },
        witness: { token: WITNESS_TOKEN, ttlMinutes: 10 },
      }),
    );
    const lifecycle = recordingSpawn(2);
    invoke(lifecyclePayload('UserPromptSubmit', { prompt: 'ordinary request' }), lifecycle.spawn);
    stderr = [];
    const judgment = recordingSpawn(2);

    const outcome = invoke(preToolPayload(), judgment.spawn);

    expect(outcome).toEqual({ exitCode: 2 });
    expect(judgment.calls).toHaveLength(1);
    expect(judgment.calls[0]?.stdin).toMatch(/^\{/);
    expect(stderr.join('')).toContain(WITNESS_TOKEN);
    expect(stderr.join('')).toMatch(/first line/i);
    expect(stderr.join('')).toMatch(/terminal/i);
  });

  it.each([
    [
      'an inline YAML mapping',
      [
        'languages:',
        '  typescript:',
        "    productionGlob: 'src/**/*.ts'",
        "    testCmd: 'true'",
        `witness: { token: "${WITNESS_TOKEN}", ttlMinutes: 10 }`,
        '',
      ].join('\n'),
      WITNESS_TOKEN,
    ],
    [
      'an escaped double-quoted YAML token',
      [
        'languages:',
        '  typescript:',
        "    productionGlob: 'src/**/*.ts'",
        "    testCmd: 'true'",
        'witness:',
        `  token: "${ESCAPED_WITNESS_TOKEN.replaceAll('"', '\\"')}"`,
        '  ttlMinutes: 10',
        '',
      ].join('\n'),
      ESCAPED_WITNESS_TOKEN,
    ],
  ] as const)(
    'reads the recovery token through the canonical config loader from %s',
    (_form, config, token) => {
      // A line-oriented token regexp accepts only one handwritten YAML layout and either
      // misses an inline mapping or prints YAML escape syntax instead of the configured
      // token. Recovery must agree with every form the judgment's config loader accepts.
      installStubPolydeukes();
      writeFileSync(join(repoRoot, 'polydeukes.config.yaml'), config);
      const lifecycle = recordingSpawn(2);
      invoke(lifecyclePayload('UserPromptSubmit', { prompt: 'ordinary request' }), lifecycle.spawn);
      stderr = [];
      const judgment = recordingSpawn(2);

      const outcome = invoke(preToolPayload(), judgment.spawn);

      expect(outcome).toEqual({ exitCode: 2 });
      expect(judgment.calls).toHaveLength(1);
      expect(judgment.calls[0]?.stdin).toMatch(/^\{/);
      expect(stderr.join('')).toContain(token);
      expect(stderr.join('')).toMatch(/first line/i);
      expect(stderr.join('')).toMatch(/terminal/i);
    },
  );

  it('says witness cannot release the call without UserPromptSubmit evidence and points to the terminal', () => {
    // Suggesting the token when no human record exists creates an impossible retry loop;
    // omitting terminal recovery leaves a correctly blocked self-edit with no next action.
    installStubPolydeukes();
    const { calls, spawn } = recordingSpawn(2);

    const outcome = invoke(preToolPayload(), spawn);

    expect(outcome).toEqual({ exitCode: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.stdin).toMatch(/^\{/);
    expect(stderr.join('')).toMatch(/UserPromptSubmit/i);
    expect(stderr.join('')).toMatch(/witness/i);
    expect(stderr.join('')).toMatch(/terminal/i);
  });

  it('adds no recovery hint when the judge crashes instead of returning a blocked verdict', () => {
    // Status 1 is infrastructure failure, not a blocked judgment. A witness instruction
    // here sends the operator toward a valve that never saw the call.
    installStubPolydeukes();
    const { spawn } = recordingSpawn(1);

    expect(invoke(preToolPayload(), spawn)).toEqual({ exitCode: 2 });
    expect(stderr.join('')).not.toMatch(/UserPromptSubmit|first line|user terminal/i);
  });
});
