// Installs the formulae homebrew-formulae.mjs wrote from a local tap and runs them:
//   node scripts/verify-homebrew-formulae.mjs <formula-dir>
// Run it on a Homebrew without the tap huskyhoochu/polydeukes; it removes the tap and the four
// formulae when it ends. pdks alone installs one executable and registers no hook; each extension
// adds its own, registered under $(brew --prefix)/bin so that `brew upgrade` keeps the path.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
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

const formulae = resolve(process.argv[2] ?? '');
assert(
  process.argv[2] && existsSync(formulae),
  'usage: verify-homebrew-formulae.mjs <formula-dir>',
);
const version = readFileSync(join(formulae, 'pdks.rb'), 'utf8').match(/^ {2}version "(.+)"$/m)?.[1];
assert(version, 'pdks.rb names no version');

const tap = 'huskyhoochu/polydeukes';
const names = ['pdks', 'pdks-claude-code', 'pdks-codex', 'pdks-memory'];
const env = {
  ...process.env,
  HOMEBREW_NO_AUTO_UPDATE: '1',
  HOMEBREW_NO_INSTALL_CLEANUP: '1',
  HOMEBREW_NO_ANALYTICS: '1',
  HOMEBREW_NO_ENV_HINTS: '1',
};
// The real path: macOS's tmpdir is a link, and init registers resolved paths.
const consumer = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-brew-verify-')));

const run = (command, args, { input, expect = 0 } = {}) => {
  const result = spawnSync(command, args, { cwd: consumer, input, encoding: 'utf8', env });
  assert.equal(
    result.status,
    expect,
    `${command} ${args.join(' ')} exited ${result.status}\n${result.stdout}${result.stderr}`,
  );
  return result;
};
const brew = (...args) => run('brew', args).stdout.trim();
const hooksOf = (file) =>
  Object.values(JSON.parse(readFileSync(file, 'utf8')).hooks).flatMap((groups) =>
    groups.flatMap((group) => group.hooks),
  );
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

const prefix = brew('--prefix');
const bin = join(prefix, 'bin');
// The cleanup below removes the tap and the four formulae, so an installed copy stops the run here.
assert(!existsSync(brew('--repository', tap)), `${tap} is already tapped`);
assert.deepEqual(
  readdirSync(bin).filter((file) => file.startsWith('pdks')),
  [],
  `${bin} already has pdks executables`,
);
brew('tap-new', '--no-git', tap);
try {
  for (const name of names)
    copyFileSync(
      join(formulae, `${name}.rb`),
      join(brew('--repository', tap), 'Formula', `${name}.rb`),
    );
  run('git', ['init', '-q']);

  // pdks alone: one executable, the Rust judge, no host registration.
  brew('install', `${tap}/pdks`);
  assert.equal(run(join(bin, 'pdks'), ['--version']).stdout.trim(), `pdks ${version}`);
  assert.deepEqual(
    readdirSync(bin).filter((file) => file.startsWith('pdks-')),
    [],
    'pdks installed an extension',
  );
  run(join(bin, 'pdks'), ['init']);
  assert(!existsSync(join(consumer, '.claude')), 'pdks init wrote a Claude Code registration');
  assert(!existsSync(join(consumer, '.codex')), 'pdks init wrote a Codex registration');
  run(join(bin, 'pdks'), ['covenant', 'check', '--enforce', 'block'], {
    input: write('notes.txt'),
  });
  run(join(bin, 'pdks'), ['covenant', 'check', '--enforce', 'block'], {
    input: write('polydeukes.config.yaml'),
    expect: 2,
  });

  // `pdks memory` finds pdks-memory on PATH, and its keg holds the model's and dictionary's licenses.
  brew('install', `${tap}/pdks-memory`);
  const memoryKeg = brew('--prefix', '--installed', `${tap}/pdks-memory`);
  for (const license of ['GARU-LICENSE', 'EN-KO-LICENSE'])
    assert(existsSync(join(memoryKeg, license)), `the pdks-memory keg has no ${license}`);
  mkdirSync(join(consumer, 'docs'));
  writeFileSync(
    join(consumer, 'docs/release.md'),
    '# Release steps\n\nTag the commit, then publish.\n',
  );
  appendFileSync(
    join(consumer, 'polydeukes.config.yaml'),
    "\nmemory:\n  include:\n    - 'docs/**/*.md'\n",
  );
  const found = JSON.parse(
    run(join(bin, 'pdks'), ['memory', 'search', 'publish', '--json']).stdout,
  );
  assert.equal(
    found.results[0]?.conceptId,
    'docs/release',
    `memory search missed the document: ${JSON.stringify(found)}`,
  );

  // Each extension's init, found on PATH by its bare name, registers the $(brew --prefix)/bin
  // links, and the registered command blocks a protected write.
  brew('install', `${tap}/pdks-claude-code`, `${tap}/pdks-codex`);
  run('pdks-claude-code', ['init']);
  run('pdks-codex', ['init']);
  const hooks = hooksOf(join(consumer, '.claude/settings.json'));
  assert(hooks.length > 0, 'pdks-claude-code init registered no hook');
  for (const hook of hooks) {
    assert.equal(hook.command, join(bin, 'pdks-claude-code'));
    assert.equal(hook.args[hook.args.indexOf('--pdks') + 1], join(bin, 'pdks'));
  }
  const quoted = [
    join(bin, 'pdks-codex'),
    'hook',
    '--project-root',
    consumer,
    '--pdks',
    join(bin, 'pdks'),
  ]
    .map((word) => `'${word}'`)
    .join(' ');
  const codexHooks = hooksOf(join(consumer, '.codex/hooks.json'));
  assert(codexHooks.length > 0, 'pdks-codex init registered no hook');
  for (const hook of codexHooks) assert.equal(hook.command, quoted);
  run(hooks[0].command, hooks[0].args, {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 's-1',
      cwd: consumer,
      tool_name: 'Write',
      tool_input: { file_path: join(consumer, 'polydeukes.config.yaml'), content: 'x\n' },
    }),
    expect: 2,
  });
  run('sh', ['-c', quoted], {
    input: JSON.stringify({
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
    }),
    expect: 2,
  });
} finally {
  spawnSync('brew', ['uninstall', '--force', ...names.map((name) => `${tap}/${name}`)], { env });
  spawnSync('brew', ['untap', '--force', tap], { env });
  rmSync(consumer, { recursive: true, force: true });
}
