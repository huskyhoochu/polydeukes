// Installs the packages pack-npm-packages.mjs built into fresh consumers with npm and pnpm and
// runs them:
//   node scripts/verify-npm-packages.mjs <out-dir>
// The umbrella alone installs one executable and registers no hook; each extension adds its own.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
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
const target = {
  'darwin arm64': 'aarch64-apple-darwin',
  'linux x64': 'x86_64-unknown-linux-musl',
  'linux arm64': 'aarch64-unknown-linux-musl',
}[`${process.platform} ${process.arch}`];
assert(target, `no prebuilt executable for ${process.platform} ${process.arch}`);

// The real path: macOS's tmpdir is a link, and init registers resolved paths.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-npm-verify-')));
const consumer = join(scratch, 'consumer');
const env = { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' };

const run = (command, args, { input, expect = 0, cwd = consumer, env: childEnv = env } = {}) => {
  const result = spawnSync(command, args, { cwd, input, encoding: 'utf8', env: childEnv });
  assert.equal(
    result.status,
    expect,
    `${command} ${args.join(' ')} exited ${result.status}\n${result.stdout}${result.stderr}`,
  );
  return result;
};
const tarballs = {};
const install = (crate) => run('npm', ['install', tarballs[crate]]);
const pack = (dir, destination) => {
  const packed = spawnSync('npm', ['pack', dir, '--pack-destination', destination], {
    encoding: 'utf8',
    env,
  });
  assert.equal(packed.status, 0, `npm pack ${dir}: ${packed.stderr}`);
  return join(destination, packed.stdout.trim().split('\n').at(-1));
};
const hooksOf = (file) =>
  Object.values(JSON.parse(readFileSync(file, 'utf8')).hooks).flatMap((groups) =>
    groups.flatMap((group) => group.hooks),
  );

// Each extension's init registers the platform executables under the consumer's
// node_modules/<package>, which keep their path across an upgrade, and the registered command
// blocks a protected write without Node in between. Returns the two registered commands.
const checkRegistrations = (cwd) => {
  const adapter = join(cwd, 'node_modules/@polydeukes/adapter-claude-code/bin', target);
  const pdks = join(cwd, 'node_modules/polydeukes/bin', target, 'pdks');
  const hooks = hooksOf(join(cwd, '.claude/settings.json'));
  assert(hooks.length > 0, 'pdks-claude-code init registered no hook');
  for (const hook of hooks) {
    assert.equal(hook.command, join(adapter, 'pdks-claude-code'));
    assert.equal(hook.args[hook.args.indexOf('--pdks') + 1], pdks);
  }
  const codexHooks = hooksOf(join(cwd, '.codex/hooks.json'));
  assert(codexHooks.length > 0, 'pdks-codex init registered no hook');
  const quoted = [
    join(cwd, 'node_modules/@polydeukes/adapter-codex/bin', target, 'pdks-codex'),
    'hook',
    '--project-root',
    cwd,
    '--pdks',
    pdks,
  ]
    .map((word) => `'${word}'`)
    .join(' ');
  for (const hook of codexHooks) assert.equal(hook.command, quoted);
  const blocks = () => {
    const nodeless = { ...env, PATH: '/usr/bin:/bin' };
    assert.notEqual(spawnSync('node', ['-v'], { env: nodeless }).status, 0, 'node is in /usr/bin');
    run(hooks[0].command, hooks[0].args, {
      cwd,
      input: claudeWrite(cwd),
      expect: 2,
      env: nodeless,
    });
    run('sh', ['-c', quoted], { cwd, input: codexRemove(cwd), expect: 2, env: nodeless });
  };
  blocks();
  return blocks;
};
const claudeWrite = (cwd) =>
  JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 's-1',
    cwd,
    tool_name: 'Write',
    tool_input: { file_path: join(cwd, 'polydeukes.config.yaml'), content: 'x\n' },
  });
const codexRemove = (cwd) =>
  JSON.stringify({
    session_id: 's-1',
    turn_id: 't-1',
    transcript_path: null,
    cwd,
    hook_event_name: 'PreToolUse',
    model: 'gpt-5',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_use_id: 'call-1',
    tool_input: { command: 'rm polydeukes.config.yaml' },
  });
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
  for (const crate of ['pdks', 'pdks-claude-code', 'pdks-codex', 'pdks-memory'])
    tarballs[crate] = pack(join(out, crate), join(scratch, 'packs'));
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

  install('pdks-claude-code');
  run('npx', ['pdks-claude-code', 'init']);
  install('pdks-codex');
  run('npx', ['pdks-codex', 'init']);
  const blocks = checkRegistrations(consumer);

  // An upgrade replaces the packages under the same node_modules paths, so the registration
  // runs without init again.
  mkdirSync(join(scratch, 'upgrade'));
  const upgraded = ['pdks', 'pdks-claude-code', 'pdks-codex'].map((crate) => {
    const dir = join(scratch, 'upgrade', crate);
    cpSync(join(out, crate), dir, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({ ...manifest, version: `${version}-upgrade` }, null, 2)}\n`,
    );
    return pack(dir, join(scratch, 'upgrade'));
  });
  run('npm', ['install', ...upgraded]);
  assert.equal(
    JSON.parse(readFileSync(join(consumer, 'node_modules/polydeukes/package.json'), 'utf8'))
      .version,
    `${version}-upgrade`,
  );
  blocks();

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

  // pnpm links node_modules/<package> into its versioned store and puts a relative
  // ./node_modules/.bin on PATH for exec, which init does not search.
  const pnpmConsumer = join(scratch, 'pnpm-consumer');
  mkdirSync(pnpmConsumer);
  writeFileSync(join(pnpmConsumer, 'package.json'), '{"name":"consumer","private":true}\n');
  run('git', ['init', '-q'], { cwd: pnpmConsumer });
  run('pnpm', ['add', tarballs.pdks, tarballs['pdks-claude-code'], tarballs['pdks-codex']], {
    cwd: pnpmConsumer,
  });
  run('pnpm', ['exec', 'pdks-claude-code', 'init'], { cwd: pnpmConsumer });
  run('pnpm', ['exec', 'pdks-codex', 'init'], { cwd: pnpmConsumer });
  const pnpmBlocks = checkRegistrations(pnpmConsumer);
  // pnpm moves node_modules/<package> to a new versioned store directory on upgrade.
  run('pnpm', ['add', ...upgraded], { cwd: pnpmConsumer });
  assert.equal(
    JSON.parse(readFileSync(join(pnpmConsumer, 'node_modules/polydeukes/package.json'), 'utf8'))
      .version,
    `${version}-upgrade`,
  );
  pnpmBlocks();
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
