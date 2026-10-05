import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { CovenantInput } from '../src/protocol.ts';
import { parseInput } from '../src/protocol.ts';

// The input IR schema describes what a host may send to `pdks covenant check`, and it is
// fixed on two sides. Against the command, the guarantee runs one way: an input the schema
// validates is one the command reads without refusing, so every fixture `parseInput` refuses,
// and every fixture the command's runner refuses after parsing, must be schema-invalid.
// Against the TS type, the fixtures carry the type itself: a VALID fixture is
// `satisfies CovenantInput`, and a SCHEMA-ONLY fixture is assigned to `CovenantInput` under
// `@ts-expect-error`, so tsc verifies the type side of the same fixture the schema is run
// against. Shapes without a fixture here are not fixed.

const schemaPath = fileURLToPath(new URL('../schema/covenant-input.schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

/** Whether the input validates against the published IR schema. */
function schemaAccepts(input: unknown): boolean {
  return validate(input) === true;
}

/** Whether `parseInput` accepts the input after a JSON round trip. */
function parserAccepts(input: unknown): boolean {
  return parseInput(JSON.stringify(input)).ok;
}

// Tool and subagent names are values an adapter fills in; the schema reads none of them.
const MUTATING_TOOL = 'fixture-edit';
const SHELL_TOOL = 'fixture-shell';
const SPAWN_KIND = 'fixture-task';
const COMMAND_ARG = 'command';
const AGENT_TYPE = 'fixture-reviewer';

const MINIMAL = {
  toolCalls: [],
  subagentSpawns: [],
  userMessages: [],
} satisfies CovenantInput;

const VALID_INPUTS: readonly CovenantInput[] = [
  // Every tool-call field, with the `create` arm and arbitrary nested `args` values.
  {
    toolCalls: [
      {
        name: MUTATING_TOOL,
        args: { file_path: 'src/a.ts', nested: { list: [1, 'two', null, { deep: true }] } },
        fileChange: { kind: 'create', path: 'src/a.ts', post: 'export {};\n' },
      },
    ],
    subagentSpawns: [{ kind: SPAWN_KIND }],
    userMessages: [{ text: 'add the module' }],
  } satisfies CovenantInput,
  // The `modify` arm beside a call carrying no evidence at all.
  {
    toolCalls: [
      {
        name: MUTATING_TOOL,
        fileChange: { kind: 'modify', path: 'src/a.ts', pre: 'a\n', post: 'b\n' },
      },
      { name: SHELL_TOOL, args: { [COMMAND_ARG]: 'ls' } },
    ],
    subagentSpawns: [],
    userMessages: [],
  } satisfies CovenantInput,
  // The `delete` arm with its optional text baseline.
  {
    toolCalls: [
      { name: MUTATING_TOOL, fileChange: { kind: 'delete', path: 'src/a.ts', pre: 'a\n' } },
    ],
    subagentSpawns: [],
    userMessages: [],
  } satisfies CovenantInput,
  // The `delete` arm without a baseline — a binary blob needs no content to be judged.
  {
    toolCalls: [{ name: MUTATING_TOOL, fileChange: { kind: 'delete', path: 'bin/blob' } }],
    subagentSpawns: [],
    userMessages: [],
  } satisfies CovenantInput,
  // The actor as the main session — the empty object is a positive value.
  { ...MINIMAL, actor: {} } satisfies CovenantInput,
  // The actor as a named subagent kind.
  { ...MINIMAL, actor: { agentType: AGENT_TYPE } } satisfies CovenantInput,
  // The host's full tool roster.
  {
    ...MINIMAL,
    tools: { mutating: [MUTATING_TOOL], shell: [SHELL_TOOL], commandArgs: [COMMAND_ARG] },
  } satisfies CovenantInput,
  // A session carrying every optional field it can prove.
  {
    ...MINIMAL,
    session: {
      evidencePath: '.polydeukes/session-evidence.json',
      userMessages: [{ text: 'first', timestampMs: 1_700_000_000_000 }, { text: 'bare' }],
      toolCalls: [
        { name: SHELL_TOOL, args: { [COMMAND_ARG]: 'pnpm test' }, succeeded: true },
        { name: MUTATING_TOOL, succeeded: false },
        { name: MUTATING_TOOL },
      ],
      channels: { sidecar: '[{"kind":"fixture-task"}]' },
    },
  } satisfies CovenantInput,
  // A session whose lists are empty: a host that named its evidence and delivered none.
  { ...MINIMAL, session: { userMessages: [], toolCalls: [] } } satisfies CovenantInput,
];

// One row per branch where `parseInput` or `isActor` refuses. Each must be schema-invalid
// too: a schema that validates one of these certifies an input the judge blocks at exit 2.
// The world branches need no rows here: a host may not send `world` at all (below).
const PARSER_REJECTED: readonly (readonly [string, unknown])[] = [
  // Top level: a value that is not an object.
  ['top level is an array, not an object', [MINIMAL]],
  // The three required lists, each absent in turn.
  ['toolCalls absent', { subagentSpawns: [], userMessages: [] }],
  ['subagentSpawns absent', { toolCalls: [], userMessages: [] }],
  ['userMessages absent', { toolCalls: [], subagentSpawns: [] }],
  // The same branch's other end: present but not an array. A schema that writes `items`
  // without `type: array` admits these, since `items` constrains arrays only.
  ['toolCalls is an object, not an array', { ...MINIMAL, toolCalls: {} }],
  ['subagentSpawns is a string, not an array', { ...MINIMAL, subagentSpawns: 'x' }],
  ['userMessages is null, not an array', { ...MINIMAL, userMessages: null }],
  // Null under an optional key: a nullable schema (written to match a Rust `Option`) admits
  // it, and the parser refuses it because `null` is neither an object nor a string.
  ['actor is null', { ...MINIMAL, actor: null }],
  ['actor.agentType is null', { ...MINIMAL, actor: { agentType: null } }],
  // Actor: the object itself, its closed key set, and its one field's type.
  ['actor is a string, not an object', { ...MINIMAL, actor: AGENT_TYPE }],
  ['actor carries an unknown key', { ...MINIMAL, actor: { agent_type: AGENT_TYPE } }],
  ['actor.agentType is a number, not a string', { ...MINIMAL, actor: { agentType: 1 } }],
];

// Shapes the parser accepts and the command's runner refuses before judging anything. The
// world axis is the runner's to fill, so an input carrying `world` is refused whatever it
// holds; a shell tool with no argument key is a roster the shell judge cannot read; and
// session evidence of the wrong shape cannot be judged. All three are TS-legal.
const RUNNER_REFUSED: readonly (readonly [string, CovenantInput])[] = [
  ['an empty world', { ...MINIMAL, world: {} }],
  [
    'a supplied world',
    { ...MINIMAL, world: { files: { 'docs/a.md': '# a\n' }, channels: { sidecar: '[]' } } },
  ],
  [
    'shell tools with no commandArgs key',
    { ...MINIMAL, tools: { mutating: [MUTATING_TOOL], shell: [SHELL_TOOL], commandArgs: [] } },
  ],
];

// The runner's session refusals that the TS type also forbids, so they sit under
// `@ts-expect-error` like the schema-only rows.
const SESSION_CHANNELS_NULL: CovenantInput = {
  ...MINIMAL,
  // @ts-expect-error — session channels are an object when present.
  session: { userMessages: [], toolCalls: [], channels: null },
};

const SESSION_SIDECAR_NOT_TEXT: CovenantInput = {
  ...MINIMAL,
  // @ts-expect-error — a channel carries text.
  session: { userMessages: [], toolCalls: [], channels: { sidecar: 0 } },
};

// Shapes the TS type forbids and the parser lets through. The schema is the only runtime
// side that refuses them, so a schema that opens here hands a Rust host a looser contract
// than a TS host compiles against. Each `@ts-expect-error` must be consumed by exactly the
// marked line: an unused directive is a tsc error, which is what fixes the type side.
const TOP_LEVEL_UNKNOWN_KEY: CovenantInput = {
  ...MINIMAL,
  // @ts-expect-error — the IR's top level is closed to the seven named fields.
  transcript: [],
};

const TOOL_CALL_WITHOUT_NAME: CovenantInput = {
  ...MINIMAL,
  // @ts-expect-error — `name` is required on every call element.
  toolCalls: [{ args: { file_path: 'src/a.ts' } }],
};

const FILE_CHANGE_UNKNOWN_KIND: CovenantInput = {
  ...MINIMAL,
  // @ts-expect-error — `kind` is closed to create | modify | delete.
  toolCalls: [{ name: MUTATING_TOOL, fileChange: { kind: 'rename', path: 'src/a.ts' } }],
};

const MODIFY_WITHOUT_PRE: CovenantInput = {
  ...MINIMAL,
  // @ts-expect-error — the modify arm requires `pre`; only delete's is optional.
  toolCalls: [{ name: MUTATING_TOOL, fileChange: { kind: 'modify', path: 'src/a.ts', post: 'b' } }],
};

const TOOLS_WITHOUT_COMMAND_ARGS: CovenantInput = {
  ...MINIMAL,
  // @ts-expect-error — all three roster lists are required once `tools` is present.
  tools: { mutating: [MUTATING_TOOL], shell: [SHELL_TOOL] },
};

const SESSION_TIMESTAMP_AS_STRING: CovenantInput = {
  ...MINIMAL,
  session: {
    // @ts-expect-error — `timestampMs` is a number, not an ISO string.
    userMessages: [{ text: 'first', timestampMs: '2026-10-06T00:00:00Z' }],
    toolCalls: [],
  },
};

// The element shapes of the other lists. Unconstrained, each would come out of a schema
// code generator as an untyped JSON value instead of a struct.
const SPAWN_WITHOUT_KIND: CovenantInput = {
  ...MINIMAL,
  // @ts-expect-error — a spawn element carries `kind`.
  subagentSpawns: [{ name: SPAWN_KIND }],
};

const USER_MESSAGE_WITHOUT_TEXT: CovenantInput = {
  ...MINIMAL,
  // @ts-expect-error — a user message carries `text`.
  userMessages: [{ body: 'add the module' }],
};

const TOOLS_ELEMENT_NOT_A_STRING: CovenantInput = {
  ...MINIMAL,
  // @ts-expect-error — roster lists hold tool names as strings.
  tools: { mutating: [1], shell: [SHELL_TOOL], commandArgs: [COMMAND_ARG] },
};

const SESSION_TOOL_CALL_WITHOUT_NAME: CovenantInput = {
  ...MINIMAL,
  session: {
    userMessages: [],
    // @ts-expect-error — a session tool call carries `name`.
    toolCalls: [{ succeeded: true }],
  },
};

// Every closed object, one unknown key each. An open object would let a misspelt field
// through, and code generated from the schema would drop it without a word.
const TOOL_CALL_UNKNOWN_KEY: CovenantInput = {
  ...MINIMAL,
  // @ts-expect-error — a call element is closed.
  toolCalls: [{ name: MUTATING_TOOL, fileChang: { kind: 'delete', path: 'a' } }],
};

const SPAWN_UNKNOWN_KEY: CovenantInput = {
  ...MINIMAL,
  // @ts-expect-error — a spawn element is closed.
  subagentSpawns: [{ kind: SPAWN_KIND, name: SPAWN_KIND }],
};

const USER_MESSAGE_UNKNOWN_KEY: CovenantInput = {
  ...MINIMAL,
  // @ts-expect-error — a user message is closed.
  userMessages: [{ text: 'a', timestampMs: 1 }],
};

const FILE_CHANGE_UNKNOWN_KEY: CovenantInput = {
  ...MINIMAL,
  toolCalls: [
    {
      name: MUTATING_TOOL,
      // @ts-expect-error — each FileChange arm is closed.
      fileChange: { kind: 'create', path: 'a', post: 'b', pre: 'c' },
    },
  ],
};

const TOOLS_UNKNOWN_KEY: CovenantInput = {
  ...MINIMAL,
  tools: {
    mutating: [MUTATING_TOOL],
    shell: [SHELL_TOOL],
    commandArgs: [COMMAND_ARG],
    // @ts-expect-error — the roster is closed to its three lists.
    readOnly: [],
  },
};

const SESSION_UNKNOWN_KEY: CovenantInput = {
  ...MINIMAL,
  // @ts-expect-error — a session is closed.
  session: { userMessages: [], toolCalls: [], transcriptPath: 'a' },
};

const SESSION_USER_MESSAGE_UNKNOWN_KEY: CovenantInput = {
  ...MINIMAL,
  session: {
    // @ts-expect-error — a session user message is closed.
    userMessages: [{ text: 'a', role: 'user' }],
    toolCalls: [],
  },
};

const SESSION_TOOL_CALL_UNKNOWN_KEY: CovenantInput = {
  ...MINIMAL,
  session: {
    userMessages: [],
    // @ts-expect-error — a session tool call is closed.
    toolCalls: [{ name: SHELL_TOOL, exitCode: 0 }],
  },
};

const SESSION_CHANNEL_UNKNOWN_KIND: CovenantInput = {
  ...MINIMAL,
  // @ts-expect-error — channel kinds are closed to `sidecar`.
  session: { userMessages: [], toolCalls: [], channels: { stdout: '' } },
};

const SCHEMA_ONLY_REJECTED: readonly (readonly [string, CovenantInput])[] = [
  ['toolCalls element carries an unknown key', TOOL_CALL_UNKNOWN_KEY],
  ['subagentSpawns element carries an unknown key', SPAWN_UNKNOWN_KEY],
  ['userMessages element carries an unknown key', USER_MESSAGE_UNKNOWN_KEY],
  ['fileChange arm carries an unknown key', FILE_CHANGE_UNKNOWN_KEY],
  ['tools carries an unknown key', TOOLS_UNKNOWN_KEY],
  ['session carries an unknown key', SESSION_UNKNOWN_KEY],
  ['session.userMessages element carries an unknown key', SESSION_USER_MESSAGE_UNKNOWN_KEY],
  ['session.toolCalls element carries an unknown key', SESSION_TOOL_CALL_UNKNOWN_KEY],
  ['session.channels carries an unknown kind', SESSION_CHANNEL_UNKNOWN_KIND],
  ['subagentSpawns element without kind', SPAWN_WITHOUT_KIND],
  ['userMessages element without text', USER_MESSAGE_WITHOUT_TEXT],
  ['tools roster element is a number', TOOLS_ELEMENT_NOT_A_STRING],
  ['session.toolCalls element without name', SESSION_TOOL_CALL_WITHOUT_NAME],
  ['top level carries an unknown key', TOP_LEVEL_UNKNOWN_KEY],
  ['toolCalls element without name', TOOL_CALL_WITHOUT_NAME],
  ['fileChange with an unknown kind', FILE_CHANGE_UNKNOWN_KIND],
  ['modify arm without pre', MODIFY_WITHOUT_PRE],
  ['tools roster missing commandArgs', TOOLS_WITHOUT_COMMAND_ARGS],
  ['session.userMessages timestampMs as a string', SESSION_TIMESTAMP_AS_STRING],
];

describe('covenant-input schema ⟺ parseInput (VALID fixtures)', () => {
  it.each(VALID_INPUTS.map((input, index) => [index, input] as const))(
    'valid input #%i: schema validates AND parseInput accepts',
    (_index, input) => {
      // A schema that drops an optional field, closes `args`, or requires `delete.pre`
      // rejects an IR the type permits and the judge accepts — a host generating from the
      // schema could then never send what a TS adapter sends.
      expect(schemaAccepts(input), JSON.stringify(validate.errors)).toBe(true);
      expect(parserAccepts(input)).toBe(true);
    },
  );
});

describe('covenant-input schema ⟺ parseInput (PARSER-REJECTED fixtures)', () => {
  it.each(PARSER_REJECTED)('%s: parseInput refuses AND schema rejects', (_title, input) => {
    // Schema-valid but parser-refused is the one drift the contract forbids: a host whose
    // generated types accept this shape is blocked at exit 2 with no build-time warning.
    expect(parserAccepts(input)).toBe(false);
    expect(schemaAccepts(input)).toBe(false);
  });
});

describe('covenant-input schema ⟺ the runner (RUNNER-REFUSED fixtures)', () => {
  it.each([
    ...RUNNER_REFUSED,
    ['session.channels is null', SESSION_CHANNELS_NULL] as const,
    ['session.channels.sidecar is not text', SESSION_SIDECAR_NOT_TEXT] as const,
  ])('%s: parseInput accepts, the runner refuses, AND schema rejects', (_title, input) => {
    // The parser lets these through and `pdks covenant check` still exits 2 before judging,
    // so a schema that validates one hands a host an input the command refuses.
    expect(parserAccepts(input)).toBe(true);
    expect(schemaAccepts(input)).toBe(false);
  });
});

describe('covenant-input schema beyond parseInput (SCHEMA-ONLY fixtures)', () => {
  it.each(SCHEMA_ONLY_REJECTED)('%s: schema rejects while parseInput accepts', (_title, input) => {
    // Asserting the parser accepts proves these rows are schema-only; a schema that opens
    // any of them (additionalProperties, required, enum, type) stays silent at runtime.
    expect(parserAccepts(input)).toBe(true);
    expect(schemaAccepts(input)).toBe(false);
  });
});

describe('covenant-input schema export', () => {
  it('package.json exports ./covenant-input.schema.json from the schema directory', () => {
    // The published path is what a consumer's `import ... from
    // '@polydeukes/core/covenant-input.schema.json'` resolves through; a schema file that
    // exists but is not exported is unreachable from an installed package.
    const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      exports: Record<string, unknown>;
    };
    expect(manifest.exports['./covenant-input.schema.json']).toBe(
      './schema/covenant-input.schema.json',
    );
  });
});
