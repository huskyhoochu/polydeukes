import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { covenantModule } from '../src/covenant/module.ts';
// A session-surface block the witness valve could have opened but did not ends with ONE
// stderr line saying which of three states the valve is in: not configured (naming the
// config file), configured with no token message inside the TTL, or expired (naming the
// instant). The line is text only — exit code and telemetry are the judgment's and never
// move — and it never prints the token. Nothing is written when the valve was not
// consulted: no session, no block, or a block that landed before any registration judged.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { BASELINE_FIRST_RUN_ROW, telemetryRows, writeConfigAt } from './helpers.ts';

/** Injected fixture values — the host roster, the protected entry, the valve. */
const MUTATING_TOOL = 'session-write';
const SHELL_TOOL = 'shell-tool';
const COMMAND_ARG = 'command';
const TOOLS = { mutating: [MUTATING_TOOL], shell: [], commandArgs: [] };
const SHELL_TOOLS = { mutating: [MUTATING_TOOL], shell: [SHELL_TOOL], commandArgs: [COMMAND_ARG] };
const PROTECTED_ENTRY = 'gate';
const PROTECTED_FILE = 'gate/inner.txt';
const SCOPED_TARGET = 'lib/a.ts';
const WITNESS_TOKEN = 'agreed-token';
const TTL_MINUTES = 10;
const TTL_MS = TTL_MINUTES * 60_000;
const PRECEDENT_ID = 'lib-needs-a-probe';
const PRECEDENT_TOOL = 'probe-tool';
const SESSION_SOURCE = 'session';
/** The file `writeConfigAt` writes — the discovered config path the line must name. */
const CONFIG_FILE = 'polydeukes.config.json';
/** The umbrella's meta-covenant label — an observable contract, not a fixture choice. */
const SELF_MOD_LABEL = 'self-mod';
const SHELL_MOD_LABEL = 'shell-mod';

/** The three state lines — the contract, so the suite spells them out in full. */
const NO_WITNESS_LINE = `no witness is configured; a person can add witness: { token, ttlMinutes } to ${CONFIG_FILE}, or make this change themselves`;
const NO_TOKEN_LINE = `a person can open this for ${TTL_MINUTES} minutes by sending the witness token alone on the first line of a message`;
const expiredLine = (expiredAtMs: number): string =>
  `${NO_TOKEN_LINE}; the last witness expired at ${new Date(expiredAtMs).toISOString()}`;
const STATE_PREFIXES = ['no witness is configured', 'a person can open this for'];

type Session = NonNullable<CovenantInput['session']>;
type ToolCall = CovenantInput['toolCalls'][number];

/** A precedent declaration over `lib/` whose break lands `advised` (no `enforce`). */
const precedentEntry = {
  id: PRECEDENT_ID,
  why: 'a lib edit follows a successful probe',
  declare: {
    mechanism: 'precedent',
    scope: { source: 'target.path', include: ['^lib/'] },
    sources: { [SESSION_SOURCE]: { transcript: true } },
    supply: { [SESSION_SOURCE]: 'pass' },
    extract: {
      probes: [
        { op: 'source', of: SESSION_SOURCE },
        { op: 'toolUses', names: [PRECEDENT_TOOL] },
      ],
    },
    relate: [
      {
        id: 'probed',
        relation: { op: 'nonEmpty', of: 'probes' },
        message: 'no probe precedes this edit',
      },
    ],
  },
};

let repoRoot: string;
let outside: string;
let telemetryPath: string;
let stderr: string[];

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-check-witness-state-'));
  outside = mkdtempSync(join(tmpdir(), 'pdks-check-witness-state-outside-'));
  telemetryPath = join(outside, 'roi.log');
  stderr = [];
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const rows = () => telemetryRows(telemetryPath);
const stderrText = () => stderr.join('');
const stderrLines = () => stderrText().split('\n');
const stateLines = () =>
  stderrLines().filter((line) => STATE_PREFIXES.some((prefix) => line.startsWith(prefix)));

function writeConfig(extra: Record<string, unknown>): void {
  writeConfigAt(repoRoot, telemetryPath, extra);
}

function ir(toolCalls: ToolCall[], extra: Partial<CovenantInput> = {}): CovenantInput {
  return { toolCalls, subagentSpawns: [], userMessages: [], ...extra };
}

function writeCall(path: string, post = 'text\n'): ToolCall {
  return {
    name: MUTATING_TOOL,
    args: { file_path: path, content: post },
    fileChange: { kind: 'create', path, post },
  };
}

/** An ordinary human request — the session has heard a person, so the valve could hear one. */
const ORDINARY_MESSAGE = { text: 'please update the gate', timestampMs: Date.now() - 1_000 };

function sessionOf(overrides: Partial<Session> = {}): Session {
  return { userMessages: [ORDINARY_MESSAGE], toolCalls: [], ...overrides };
}

/** A token utterance in its invoking form — first line alone, prose after. */
function tokenMessage(timestampMs?: number): Session['userMessages'][number] {
  return {
    text: `${WITNESS_TOKEN}\nplease proceed`,
    ...(timestampMs === undefined ? {} : { timestampMs }),
  };
}

/** The session surface at `enforce: block` — the posture under which a meta-covenant blocks. */
function check(input: CovenantInput) {
  return runCovenantCheck({ surface: 'session', repoRoot, input, telemetryPath, enforce: 'block' });
}

describe('a block the valve refused ends with one line naming the valve state', () => {
  it('no witness: in the config — the not-configured line names the discovered config file; the judgment is unchanged', async () => {
    // Without `witness:` the runner hands the registrations an always-closed valve and
    // must still record that it was consulted. A runner that skips the line when no valve
    // is configured leaves the person who can add one with no pointer; one that writes a
    // fixed `polydeukes.config.yaml` points at a file that does not exist here.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await check(
      ir([writeCall(PROTECTED_FILE)], { tools: TOOLS, session: sessionOf() }),
    );

    expect(result.exitCode).toBe(2);
    expect(stderrLines()).toContain(NO_WITNESS_LINE);
    expect(stateLines()).toHaveLength(1);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY]]);
  });

  it('witness configured, no token message — the open-for-n-minutes line carries ttlMinutes and no expiry suffix', async () => {
    // The person has not typed the token; the line says how, with the window the config
    // holds. A runner that prints the TTL in milliseconds or appends an expiry for a token
    // that was never sent describes a state the session is not in.
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      witness: { token: WITNESS_TOKEN, ttlMinutes: TTL_MINUTES },
    });

    const result = await check(
      ir([writeCall(PROTECTED_FILE)], { tools: TOOLS, session: sessionOf() }),
    );

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY]]);
    expect(stderrLines()).toContain(NO_TOKEN_LINE);
    expect(stderrText()).not.toContain('expired');
    expect(stderrText()).not.toContain(WITNESS_TOKEN);
  });

  it('a token message older than the TTL — the line ends with the instant timestampMs + ttlMs', async () => {
    // Expiry is the latest timestamped token message plus the TTL. A runner that reports
    // the message time itself, or now, or the TTL in the wrong unit, names an instant the
    // person cannot reconcile with what they typed.
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      witness: { token: WITNESS_TOKEN, ttlMinutes: TTL_MINUTES },
    });
    const sentAtMs = Date.now() - TTL_MS - 60_000;

    const result = await check(
      ir([writeCall(PROTECTED_FILE)], {
        tools: TOOLS,
        session: sessionOf({ userMessages: [tokenMessage(sentAtMs)] }),
      }),
    );

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY]]);
    expect(stderrLines()).toContain(expiredLine(sentAtMs + TTL_MS));
    expect(stderrText()).not.toContain(WITNESS_TOKEN);
  });

  it('two expired token messages, the later one listed first — the instant is the LATER timestamp + ttlMs', async () => {
    // "The last witness" is the latest timestamp, not the last array element or the first.
    // A runner taking the first message, or the last one by position, names an expiry an
    // hour too early here.
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      witness: { token: WITNESS_TOKEN, ttlMinutes: TTL_MINUTES },
    });
    const laterMs = Date.now() - TTL_MS - 60_000;
    const earlierMs = laterMs - 3_600_000;

    const result = await check(
      ir([writeCall(PROTECTED_FILE)], {
        tools: TOOLS,
        session: sessionOf({ userMessages: [tokenMessage(laterMs), tokenMessage(earlierMs)] }),
      }),
    );

    expect(result.exitCode).toBe(2);
    expect(stderrLines()).toContain(expiredLine(laterMs + TTL_MS));
  });

  it('an expired token message beside a future-dated one — the future one is ignored, the expired instant is named', async () => {
    // A timestamp ahead of the clock proves nothing about freshness. A runner taking the
    // maximum timestamp without the not-in-the-future bound reports an expiry still to
    // come, or opens the valve on a forged clock.
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      witness: { token: WITNESS_TOKEN, ttlMinutes: TTL_MINUTES },
    });
    const sentAtMs = Date.now() - TTL_MS - 60_000;
    const futureMs = Date.now() + 3_600_000;

    const result = await check(
      ir([writeCall(PROTECTED_FILE)], {
        tools: TOOLS,
        session: sessionOf({ userMessages: [tokenMessage(sentAtMs), tokenMessage(futureMs)] }),
      }),
    );

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY]]);
    expect(stderrLines()).toContain(expiredLine(sentAtMs + TTL_MS));
  });

  it.each([
    ['mid-sentence on the first line', `please send ${WITNESS_TOKEN}\nnow`],
    ['alone on the second line', `please proceed\n${WITNESS_TOKEN}`],
  ])(
    'an old message carrying the token %s is not a token message — the no-token line, no expiry',
    async (_form, text) => {
      // Expiry is decided by the same first-line comparison the valve uses. A runner that
      // selects candidates by substring reports an expiry for an utterance that could
      // never have opened the valve.
      writeConfig({
        protectedPaths: [PROTECTED_ENTRY],
        witness: { token: WITNESS_TOKEN, ttlMinutes: TTL_MINUTES },
      });

      const result = await check(
        ir([writeCall(PROTECTED_FILE)], {
          tools: TOOLS,
          session: sessionOf({
            userMessages: [{ text, timestampMs: Date.now() - TTL_MS - 60_000 }],
          }),
        }),
      );

      expect(result.exitCode).toBe(2);
      expect(stderrLines()).toContain(NO_TOKEN_LINE);
      expect(stderrText()).not.toContain('expired');
    },
  );

  it('a shell mutation of the protected path refused by shell-mod — the not-configured line, once', async () => {
    // The valve is shared by every registration, so a shell-axis refusal reports the same
    // state. A runner that wraps only the self-mod valve leaves a shell-mod block silent.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await check(
      ir([{ name: SHELL_TOOL, args: { [COMMAND_ARG]: `echo x >> ${PROTECTED_FILE}` } }], {
        tools: SHELL_TOOLS,
        session: sessionOf(),
      }),
    );

    expect(result.exitCode).toBe(2);
    expect(rows()).toContainEqual(['blocked', SHELL_MOD_LABEL, PROTECTED_ENTRY]);
    expect(stateLines()).toEqual([NO_WITNESS_LINE]);
  });

  it.each([
    ['before the earliest instant a Date holds', -9e15],
    ['null, as a serialized NaN arrives', null],
  ])(
    'a token message whose timestampMs is %s proves no expiry — the no-token line, the rows unchanged',
    async (_form, timestampMs) => {
      // The IR's timestamp is any number a caller sends. Adding the TTL to one outside the
      // Date range and formatting it throws, which the runner's catch turns into a second,
      // fail-closed row; `null + ttl` names an instant in 1970.
      writeConfig({
        protectedPaths: [PROTECTED_ENTRY],
        witness: { token: WITNESS_TOKEN, ttlMinutes: TTL_MINUTES },
      });

      const result = await check(
        ir([writeCall(PROTECTED_FILE)], {
          tools: TOOLS,
          session: sessionOf({
            userMessages: [
              {
                text: `${WITNESS_TOKEN}\nplease proceed`,
                timestampMs,
              } as Session['userMessages'][number],
            ],
          }),
        }),
      );

      expect(result.exitCode).toBe(2);
      expect(rows()).toEqual([
        BASELINE_FIRST_RUN_ROW,
        ['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY],
      ]);
      expect(stateLines()).toEqual([NO_TOKEN_LINE]);
    },
  );

  it('a token message without timestampMs proves no expiry — the no-token line, not an expired one', async () => {
    // Freshness unprovable is not expired: a runner that folds a missing timestamp into
    // `undefined + ttl` prints `Invalid Date`, and one that treats it as 0 prints 1970.
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      witness: { token: WITNESS_TOKEN, ttlMinutes: TTL_MINUTES },
    });

    const result = await check(
      ir([writeCall(PROTECTED_FILE)], {
        tools: TOOLS,
        session: sessionOf({ userMessages: [tokenMessage()] }),
      }),
    );

    expect(result.exitCode).toBe(2);
    expect(stderrLines()).toContain(NO_TOKEN_LINE);
    expect(stderrText()).not.toContain('expired');
  });

  it('two blocks the valve refused in one run — the line is written once', async () => {
    // The valve is one per session, so the state is one fact. A runner that appends the
    // line per refused registration says it twice and the block counts become noise.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await check(
      ir([writeCall(PROTECTED_FILE), writeCall(PROTECTED_FILE, 'other\n')], {
        tools: TOOLS,
        session: sessionOf(),
      }),
    );

    expect(result.exitCode).toBe(2);
    expect(rows().filter(([event]) => event === 'blocked')).toHaveLength(2);
    expect(stateLines()).toEqual([NO_WITNESS_LINE]);
  });
});

describe('no line when the valve was not refused', () => {
  it('a token inside the TTL opens the valve — witnessed, exit 0, no state line', async () => {
    // The line describes a refusal. A runner keyed on "a valve exists" rather than "a
    // valve refused" tells the person to send a token they just sent.
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      witness: { token: WITNESS_TOKEN, ttlMinutes: TTL_MINUTES },
    });

    const result = await check(
      ir([writeCall(PROTECTED_FILE)], {
        tools: TOOLS,
        session: sessionOf({ userMessages: [tokenMessage(Date.now() - 1_000)] }),
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['witnessed', SELF_MOD_LABEL, PROTECTED_ENTRY],
    ]);
    expect(stateLines()).toEqual([]);
  });

  it.each([
    ['configured', { witness: { token: WITNESS_TOKEN, ttlMinutes: TTL_MINUTES } }],
    ['absent', {}],
  ])(
    'a session carrying no human message at all, witness %s — the block stands with no state line',
    async (_form, extra) => {
      // A session in which no person was ever heard is a host whose message evidence is not
      // reaching the IR, so no token typed now would reach the valve either. A line telling
      // the person to type one, or to configure one, sends them down a path that cannot
      // open the block; the adapter that knows why the evidence is missing says so instead.
      writeConfig({ protectedPaths: [PROTECTED_ENTRY], ...extra });

      const result = await check(
        ir([writeCall(PROTECTED_FILE)], {
          tools: TOOLS,
          session: sessionOf({ userMessages: [] }),
        }),
      );

      expect(result.exitCode).toBe(2);
      expect(rows()).toEqual([
        BASELINE_FIRST_RUN_ROW,
        ['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY],
      ]);
      expect(stateLines()).toEqual([]);
    },
  );

  it('an input without session has no valve — the block stands with no state line', async () => {
    // A session-free input (a host that proves no evidence) cannot be opened by a token,
    // so a line inviting one sends the person to a valve that is not there.
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      witness: { token: WITNESS_TOKEN, ttlMinutes: TTL_MINUTES },
    });

    const result = await check(ir([writeCall(PROTECTED_FILE)], { tools: TOOLS }));

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY]]);
    expect(stateLines()).toEqual([]);
  });

  it('a session-carrying input whose block came from a failed assembly — exit 2, no state line', async () => {
    // Fail-closed is a block the valve never saw: no registration judged, so no token could
    // have opened it. A runner keyed on `exitCode === 2` with a session present invites a
    // token against a crash.
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      witness: { token: WITNESS_TOKEN, ttlMinutes: TTL_MINUTES },
    });
    const covenant = {
      ...covenantModule,
      selfModRegistration: () => {
        throw new Error('assembly failed');
      },
    };

    const result = await runCovenantCheck({
      surface: 'session',
      repoRoot,
      input: ir([writeCall(PROTECTED_FILE)], { tools: TOOLS, session: sessionOf() }),
      telemetryPath,
      enforce: 'block',
      covenant,
    });

    expect(result.exitCode).toBe(2);
    expect(rows().map(([event]) => event)).toContain('blocked');
    expect(stateLines()).toEqual([]);
  });

  it('a run whose only break is advised — exit 0 and no state line', async () => {
    // Nothing was refused: the entry's own rung is advise. A runner keyed on "any break"
    // rather than `event === 'blocked'` prints an opening instruction for a call that ran.
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      witness: { token: WITNESS_TOKEN, ttlMinutes: TTL_MINUTES },
      sessionDisciplines: [precedentEntry],
    });

    const result = await check(
      ir([writeCall(SCOPED_TARGET)], { tools: TOOLS, session: sessionOf() }),
    );

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['advised', PRECEDENT_ID, SCOPED_TARGET]]);
    expect(stateLines()).toEqual([]);
  });
});
