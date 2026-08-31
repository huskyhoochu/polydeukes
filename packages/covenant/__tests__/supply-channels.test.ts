import { describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.ts';
// The supply layer's channel axis. A registration's `sources` element carries one of two
// kinds — `{ name, file }` or `{ name, sidecar: true }` — and the plan splits them:
// `files` is a path list, `channels` the de-duplicated list of channel kinds the bindings
// name (today `'sidecar'` alone). `supplySources` fills the channel side through an
// injected `readChannel`, under the same discipline as `read`: `undefined` is absence (no
// key), a throw is the caller's fail-closed path — and an ABSENT `readChannel` (the commit
// surface, which has no session) leaves every channel absent.
import { planSources, supplySources } from '../src/supply.ts';
import { exitThunk } from './helpers.js';

// Source names, file paths, and channel texts are fixture values.
const SPAWNS = { name: 'spawns', sidecar: true } as const;
const AGENTS = { name: 'agents', sidecar: true } as const;
const EN = { name: 'en', file: 'locales/en.json' };
const SIDECAR = 'sidecar';
const SPAWN_TEXT = '[{"agentType":"tdd-test-writer","toolUseId":"t1"}]';

/** A declare-shaped registration carrying the given source bindings. */
function declareReg(
  label: string,
  sources: readonly NonNullable<CovenantRegistration['sources']>[number][],
): CovenantRegistration {
  return { label, protectedPaths: [], body: exitThunk(0), sources };
}

/** A `readChannel` answering from a table and recording every kind it was asked for. */
function tableReadChannel(table: Record<string, string | undefined>) {
  const asked: string[] = [];
  const readChannel = (kind: string): string | undefined => {
    asked.push(kind);
    return table[kind];
  };
  return { readChannel, asked };
}

/** A `read` over files, recording what it was asked. */
function tableRead(table: Record<string, string | undefined>) {
  const asked: string[] = [];
  const read = (path: string): string | undefined => {
    asked.push(path);
    return table[path];
  };
  return { read, asked };
}

describe('planSources — the channel axis of the plan', () => {
  it('two sidecar bindings under different names plan the kind once', () => {
    // The plan lists KINDS, not binding names: a planner keyed by name reads the channel
    // twice and keys one reading under a name no merge rule consults; one that never
    // de-duplicates asks the reader twice for one fact.
    const plan = planSources({
      registrations: [
        declareReg('writer-precedent', [SPAWNS]),
        declareReg('spawn-audit', [AGENTS]),
      ],
    });

    expect(plan.channels).toEqual([SIDECAR]);
  });

  it('no binding at all plans { files: [], channels: [] }', () => {
    // The degenerate plan must carry BOTH axes: a root reading `plan.channels` on a config
    // without a declare entry would crash the session hook on `undefined`.
    const plan = planSources({ registrations: [declareReg('scoped-only', [])] });

    expect(plan).toEqual({ files: [], channels: [] });
  });

  it('a mixed registration splits by kind: the file path to files, the channel kind to channels', () => {
    // The union is discriminated by which key the binding carries. A planner that treats
    // every binding as a file pushes `undefined` (or the binding name) into the path list,
    // and the root then reads a path nobody named.
    const plan = planSources({ registrations: [declareReg('mixed', [EN, SPAWNS])] });

    expect(plan).toEqual({ files: [EN.file], channels: [SIDECAR] });
  });
});

describe('supplySources — readChannel fills the channel side under the read discipline', () => {
  it('a kind the reader answers lands under its kind, asked exactly once', () => {
    // Reading twice doubles the cost per dispatch; keying under the binding name instead
    // of the kind hides the value from the merge rule that looks it up by kind.
    const { readChannel, asked } = tableReadChannel({ [SIDECAR]: SPAWN_TEXT });

    const supplied = supplySources({
      plan: { files: [], channels: [SIDECAR] },
      read: () => undefined,
      readChannel,
    });

    expect(asked).toEqual([SIDECAR]);
    expect(supplied.channels).toEqual({ [SIDECAR]: SPAWN_TEXT });
  });

  it('a kind whose reader answered undefined has no key — not a key holding undefined', () => {
    // The merge's absence test is key presence; a key present with `undefined` reads as a
    // supplied channel, the declaration's `supply: error` never fires, and an absent
    // session passes for an observed one. That is the fail-open the axis forbids.
    const { readChannel } = tableReadChannel({ [SIDECAR]: undefined });

    const supplied = supplySources({
      plan: { files: [], channels: [SIDECAR] },
      read: () => undefined,
      readChannel,
    });

    expect(SIDECAR in supplied.channels).toBe(false);
  });

  it('keeps an empty-string channel text as a present value', () => {
    // A truthiness check turns a present-but-empty channel into an absence and flips the
    // supply policy's disposition for a session that answered.
    const { readChannel } = tableReadChannel({ [SIDECAR]: '' });

    const supplied = supplySources({
      plan: { files: [], channels: [SIDECAR] },
      read: () => undefined,
      readChannel,
    });

    expect(supplied.channels).toEqual({ [SIDECAR]: '' });
  });

  it('with no readChannel injected, every planned channel is absent', () => {
    // The commit surface injects none — it has no session. Defaulting the reader (to `''`
    // or `'[]'`) fabricates an observation that never happened; crashing on the missing
    // reader takes the whole commit down for a declaration `supply: pass` meant to skip.
    const supplied = supplySources({
      plan: { files: [], channels: [SIDECAR] },
      read: () => undefined,
    });

    expect(supplied.channels).toEqual({});
  });

  it('lets a throwing readChannel propagate untouched', () => {
    // A reader failure that is not absence (an unreadable sidecar directory) must reach
    // the root's fail-closed path; folding it into absence lets `supply: pass` skip a
    // channel the root could not read.
    const readChannel = (): string | undefined => {
      throw new Error('EACCES: permission denied');
    };

    expect(() =>
      supplySources({
        plan: { files: [], channels: [SIDECAR] },
        read: () => undefined,
        readChannel,
      }),
    ).toThrow('EACCES: permission denied');
  });

  it('the file axis and the channel axis fill independently in one call', () => {
    // One verb, two readers: a supply that routes the channel kind through `read` (or the
    // file path through `readChannel`) crosses the axes — the file text lands under a kind
    // no merge consults, and the channel under a path.
    const { read, asked: askedPaths } = tableRead({ [EN.file]: '{"a":1}' });
    const { readChannel, asked: askedKinds } = tableReadChannel({ [SIDECAR]: SPAWN_TEXT });

    const supplied = supplySources({
      plan: { files: [EN.file], channels: [SIDECAR] },
      read,
      readChannel,
    });

    expect(askedPaths).toEqual([EN.file]);
    expect(askedKinds).toEqual([SIDECAR]);
    expect(supplied).toEqual({
      files: { [EN.file]: '{"a":1}' },
      channels: { [SIDECAR]: SPAWN_TEXT },
    });
  });
});
