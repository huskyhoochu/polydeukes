import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CovenantInput, SourceReader } from '../src/protocol.ts';
import { parseInput } from '../src/protocol.ts';

// The world axis's third field: `world.channels?: { sidecar?: string }` — the spawn-record
// list as JSON text, supplied by the session root. The key set is closed at `sidecar`, the
// value is a string, and absence is an absent key: `'[]'` says "the channel exists and holds
// no spawn" while a missing key says "there is no channel" — two different facts a
// declaration's supply policy disposes of differently. The parser shape-checks the field the
// same fail-closed way it already checks `files` and `changes`.

// Paths, channel texts, and the target are fixture values: the core transports the axis.
const TARGET = 'src/a.ts';
const FILE_EN = 'locales/en.json';
const SPAWN_TEXT = '[{"agentType":"tdd-test-writer","toolUseId":"t1"}]';

describe('CovenantInput.world.channels — type locks (bite under tsc --noEmit)', () => {
  it('channels is exactly { sidecar?: string }, itself optional', () => {
    // Catches the key set opened to Record<string, string> (a supplier writing a misspelt
    // channel would then supply nothing while typechecking), and the value widened past
    // string.
    expectTypeOf<NonNullable<CovenantInput['world']>['channels']>().toEqualTypeOf<
      { sidecar?: string } | undefined
    >();
  });

  it('SourceReader is the injected read both adapters implement', () => {
    // The two adapters and the covenant supply spec must agree on one signature; a reader
    // typed to return null (or to take a spec) would let an implementation disguise absence
    // as a value.
    expectTypeOf<SourceReader>().toEqualTypeOf<(path: string) => string | undefined>();
  });
});

/** The three required collections, empty, with the caller's `world` beside them. */
function payloadWith(world: unknown): string {
  return JSON.stringify({ toolCalls: [], subagentSpawns: [], userMessages: [], world });
}

describe('parseInput — a world carrying channels round-trips', () => {
  it('carries channels.sidecar through verbatim, beside files and changes', () => {
    // A parser that rebuilds the world from the two older fields drops the channel
    // silently, and every sidecar declaration reads absence on a session that supplied one.
    const world = {
      files: { [FILE_EN]: '{"a":1}' },
      changes: [TARGET],
      channels: { sidecar: SPAWN_TEXT },
    };

    const result = parseInput(payloadWith(world));

    expect(result.ok).toBe(true);
    if (result.ok === true) expect(result.value.world).toEqual(world);
  });

  it('accepts the empty forms — { channels: {} } and { channels: { sidecar: "[]" } }', () => {
    // `{}` is a supplier with nothing to say and `'[]'` is a channel that observed no
    // spawn; refusing either turns every spawn-free session into a blocked payload.
    for (const world of [{ channels: {} }, { channels: { sidecar: '[]' } }]) {
      const result = parseInput(payloadWith(world));

      expect(result.ok, `world: ${JSON.stringify(world)}`).toBe(true);
      if (result.ok === true) expect(result.value.world).toEqual(world);
    }
  });
});

describe('parseInput — channels is shape-checked, fail-closed', () => {
  it('refuses channels that is not a plain object: null, a string, an array', () => {
    // A parser that checks only the two older fields carries `channels: null` through, and
    // the first `world.channels.sidecar` lookup throws inside a judge body — a crash the
    // wrapper records as a verdict about the change instead of a refusal of the payload.
    for (const channels of [null, SPAWN_TEXT, [SPAWN_TEXT]]) {
      expect(
        parseInput(payloadWith({ channels })),
        `channels: ${JSON.stringify(channels)}`,
      ).toEqual({ ok: false, exitCode: 2 });
    }
  });

  it('refuses a channel key outside the closed set', () => {
    // The key set is closed at `sidecar`. A supplier writing under another name supplies
    // nothing while looking like a supply; a parser that ignores the key lets it stand.
    expect(parseInput(payloadWith({ channels: { spawns: SPAWN_TEXT } }))).toEqual({
      ok: false,
      exitCode: 2,
    });
  });

  it('refuses a non-string channel value: a number, null, a parsed array', () => {
    // `null` under the key would pass the engine's key-presence test as a supplied channel
    // whose text is missing, and a pre-parsed array skips the `json` step's own refusal of
    // unparseable text — both hand the judge a value the grammar never defined.
    for (const sidecar of [1, null, [{ agentType: 'x' }]]) {
      expect(
        parseInput(payloadWith({ channels: { sidecar } })),
        `sidecar: ${JSON.stringify(sidecar)}`,
      ).toEqual({ ok: false, exitCode: 2 });
    }
  });
});
