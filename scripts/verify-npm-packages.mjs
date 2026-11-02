// Installs the packages pack-npm-packages.mjs built into a fresh consumer with npm and runs them:
//   node scripts/verify-npm-packages.mjs <out-dir>
// The umbrella alone installs one executable and registers no hook; each extension adds its own.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? '');
assert(process.argv[2] && existsSync(out), 'usage: verify-npm-packages.mjs <out-dir>');
const { version } = JSON.parse(readFileSync(join(out, 'pdks', 'package.json'), 'utf8'));

// The real path: macOS's tmpdir is a link, and init registers resolved paths.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-npm-verify-')));
const consumer = join(scratch, 'consumer');
const env = { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' };

const run = (command, args, { input, expect = 0 } = {}) => {
  const result = spawnSync(command, args, { cwd: consumer, input, encoding: 'utf8', env });
  assert.equal(
    result.status,
    expect,
    `${command} ${args.join(' ')} exited ${result.status}\n${result.stdout}${result.stderr}`,
  );
  return result;
};
const tarballs = {};
const install = (crate) => run('npm', ['install', tarballs[crate]]);
const write = (path) =>
  JSON.stringify({
    toolCalls: [
      {
        name: 'session-write',
        args: { file_path: path, content: 'x\n' },
        fileChange: { kind: 'create', path, post: 'x\n' },
      },
    ],
    subagentSpawns: [],
    userMessages: [],
    tools: { mutating: ['session-write'], shell: [], commandArgs: [] },
  });

try {
  mkdirSync(join(scratch, 'packs'));
  for (const crate of ['pdks', 'pdks-claude-code', 'pdks-codex', 'pdks-memory']) {
    const packed = spawnSync(
      'npm',
      ['pack', join(out, crate), '--pack-destination', join(scratch, 'packs')],
      {
        encoding: 'utf8',
        env,
      },
    );
    assert.equal(packed.status, 0, `npm pack ${crate}: ${packed.stderr}`);
    tarballs[crate] = join(scratch, 'packs', packed.stdout.trim().split('\n').at(-1));
  }
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), '{"name":"consumer","private":true}\n');
  run('git', ['init', '-q']);

  // The umbrella alone: one executable, the Rust judge, no host registration.
  install('pdks');
  assert.deepEqual(readdirSync(join(consumer, 'node_modules/.bin')), ['pdks']);
  assert(
    !existsSync(join(consumer, 'node_modules/@polydeukes')),
    'the umbrella installed an extension',
  );
  assert.equal(run('npx', ['pdks', '--version']).stdout.trim(), `pdks ${version}`);
  run('npx', ['pdks', 'init']);
  assert(!existsSync(join(consumer, '.claude')), 'pdks init wrote a host registration');
  run('npx', ['pdks', 'covenant', 'check'], { input: write('notes.txt') });
  run('npx', ['pdks', 'covenant', 'check', '--enforce', 'block'], {
    input: write('polydeukes.config.yaml'),
    expect: 2,
  });

  // The Claude Code extension registers the node_modules/.bin entries, which keep their path
  // across an upgrade, and the registered command blocks a protected write.
  install('pdks-claude-code');
  run('npx', ['pdks-claude-code', 'init']);
  const settings = JSON.parse(readFileSync(join(consumer, '.claude/settings.json'), 'utf8'));
  const bin = join(consumer, 'node_modules/.bin');
  const hooks = Object.values(settings.hooks).flatMap((groups) =>
    groups.flatMap((group) => group.hooks),
  );
  assert(hooks.length > 0, 'pdks-claude-code init registered no hook');
  for (const hook of hooks) {
    assert.equal(hook.command, join(bin, 'pdks-claude-code'));
    assert.equal(hook.args[hook.args.indexOf('--pdks') + 1], join(bin, 'pdks'));
  }
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 's-1',
    cwd: consumer,
    tool_name: 'Write',
    tool_input: { file_path: join(consumer, 'polydeukes.config.yaml'), content: 'x\n' },
  });
  run(hooks[0].command, hooks[0].args, { input: payload, expect: 2 });

  install('pdks-codex');
  run('npx', ['pdks-codex', 'init']);
  const codex = JSON.parse(readFileSync(join(consumer, '.codex/hooks.json'), 'utf8'));
  const codexHooks = Object.values(codex.hooks).flatMap((groups) =>
    groups.flatMap((group) => group.hooks),
  );
  assert(codexHooks.length > 0, 'pdks-codex init registered no hook');
  const quoted = [join(bin, 'pdks-codex'), 'hook', '--project-root', consumer, '--pdks']
    .concat(join(bin, 'pdks'))
    .map((word) => `'${word}'`)
    .join(' ');
  for (const hook of codexHooks) assert.equal(hook.command, quoted);
  const bash = JSON.stringify({
    session_id: 's-1',
    turn_id: 't-1',
    transcript_path: null,
    cwd: consumer,
    hook_event_name: 'PreToolUse',
    model: 'gpt-5',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_use_id: 'call-1',
    tool_input: { command: 'rm polydeukes.config.yaml' },
  });
  run('sh', ['-c', quoted], { input: bash, expect: 2 });

  // `pdks memory` finds pdks-memory on PATH through node_modules/.bin.
  install('pdks-memory');
  mkdirSync(join(consumer, 'docs'));
  writeFileSync(
    join(consumer, 'docs/release.md'),
    '# Release steps\n\nTag the commit, then publish.\n',
  );
  appendFileSync(
    join(consumer, 'polydeukes.config.yaml'),
    "\nmemory:\n  include:\n    - 'docs/**/*.md'\n",
  );
  const found = JSON.parse(run('npx', ['pdks', 'memory', 'search', 'publish', '--json']).stdout);
  assert.equal(
    found.results[0]?.conceptId,
    'docs/release',
    `memory search missed the document: ${JSON.stringify(found)}`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
