#!/usr/bin/env node
// Runs every conformance/adapter/claude-code/**/*.json case against an adapter hook command, so
// any implementation of the Claude Code adapter is compared on the process boundary alone.
// Usage: node scripts/verify-adapter-fixtures.mjs --command '<JSON argv array>'
//          [--cases-dir <directory>] [<group>/<name> prefix]
//
//   --command    the adapter's argv as a JSON array of strings; every @@ROOT@@ in it is replaced
//                by the case root. The first element is the executable.
//   --cases-dir  read the cases from this directory instead of conformance/adapter/claude-code;
//                case names are relative to it. A relative path resolves against the process cwd.
//
// A case is one hook invocation in a fresh root (the cwd) with HOME set to a separate fresh
// directory. The child environment is PATH, HOME and the case's env only:
//   description  one sentence naming the behavior the case pins
//   env          extra environment variables
//   tree         root-relative path -> content (a string as is, anything else as JSON text)
//   links        root-relative path -> symlink target text, created after the tree (optional)
//   stdin        the payload: a string as is, anything else as JSON text
//   stdinBase64  the payload as base64 bytes, for input that is not text (instead of stdin)
//   expect.exit  the exit code
//   expect.stdout          the exact stdout (default "")
//   expect.stderr          substrings that must occur; [] means stderr must be empty
//   expect.stderrExcludes  substrings that must not occur (optional)
//   expect.rows  the rows the judge appended to .polydeukes/roi.log, each without its leading
//                timestamp field, in order; that field is dropped from the comparison but must be
//                an ISO-8601 UTC instant (2026-10-30T01:23:45.678Z)
// Strings in the command, env, tree, links, stdin and expect have @@ROOT@@ (the root's realpath),
// @@HOME@@, @@NOW_MS@@ / @@NOW_MS-<n>@@ (milliseconds) and @@NOW_ISO@@ / @@NOW_ISO-<n>@@ (the same
// instant as an ISO-8601 UTC string; <n> is milliseconds earlier) replaced, the clock being read
// once just before the run.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const usage =
  "usage: node scripts/verify-adapter-fixtures.mjs --command '<JSON argv array>' [--cases-dir <directory>] [<group>/<name> prefix]";
const optionOf = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? { at, value: undefined } : { at, value: argv[at + 1] };
};
const cmd = optionOf('--command');
const dir = optionOf('--cases-dir');
let command;
try {
  command = JSON.parse(cmd.value ?? '');
} catch {
  command = undefined;
}
if (
  !Array.isArray(command) ||
  command.length === 0 ||
  command.some((word) => typeof word !== 'string') ||
  (dir.at !== -1 && !dir.value)
) {
  console.error(usage);
  process.exit(2);
}
const casesDir = dir.value ? resolve(dir.value) : join(repo, 'conformance/adapter/claude-code');
const used = new Set([cmd, dir].filter((o) => o.at !== -1).flatMap((o) => [o.at, o.at + 1]));
const prefix = argv.filter((_, i) => !used.has(i))[0] ?? '';

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(directory, entry.name))
        : entry.name.endsWith('.json')
          ? [join(directory, entry.name)]
          : [],
    );
}

function substitute(value, vars) {
  if (typeof value === 'string')
    return value
      .replaceAll('@@ROOT@@', vars.root)
      .replaceAll('@@HOME@@', vars.home)
      .replace(/@@NOW_MS(?:-(\d+))?@@/g, (_, n) => String(vars.now - Number(n ?? 0)))
      .replace(/@@NOW_ISO(?:-(\d+))?@@/g, (_, n) =>
        new Date(vars.now - Number(n ?? 0)).toISOString(),
      );
  if (Array.isArray(value)) return value.map((item) => substitute(item, vars));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, vars)]));
  return value;
}

const text = (value) => (typeof value === 'string' ? value : JSON.stringify(value));
const lines = (path) =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
    : [];

function runCase(file) {
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  const missing = ['description', 'tree', 'expect']
    .filter((key) => spec[key] === undefined)
    .concat(
      spec.stdin === undefined && spec.stdinBase64 === undefined ? ['stdin'] : [],
      ['exit', 'stderr', 'rows']
        .filter((key) => spec.expect?.[key] === undefined)
        .map((k) => `expect.${k}`),
    );
  if (missing.length) return [`missing required keys: ${missing.join(', ')}`];

  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-adapter-root-')));
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-adapter-home-')));
  try {
    const vars = { root, home, now: Date.now() };
    for (const [path, content] of Object.entries(spec.tree)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, substitute(text(content), vars));
    }
    for (const [path, target] of Object.entries(spec.links ?? {})) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      symlinkSync(substitute(target, vars), join(root, path));
    }
    const expect = substitute(spec.expect, vars);
    const logPath = join(root, '.polydeukes/roi.log');
    const before = lines(logPath).length;
    const [executable, ...args] = substitute(command, vars);
    const result = spawnSync(executable, args, {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: home, ...substitute(spec.env ?? {}, vars) },
      input:
        spec.stdinBase64 === undefined
          ? substitute(text(spec.stdin), vars)
          : Buffer.from(spec.stdinBase64, 'base64'),
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error) return [`spawn failed: ${result.error.message}`];
    const stderr = result.stderr;
    const appended = lines(logPath)
      .slice(before)
      .map((line) => line.split('\t'));
    const rows = appended.map((fields) => fields.slice(1));
    const diffs = [];
    if (result.status !== expect.exit)
      diffs.push(`exit: expected ${expect.exit}, actual ${result.status}`);
    if (result.stdout !== (expect.stdout ?? ''))
      diffs.push(
        `stdout: expected ${JSON.stringify(expect.stdout ?? '')}, actual ${JSON.stringify(result.stdout)}`,
      );
    const badStamps = appended
      .map((fields) => fields[0])
      .filter((stamp) => !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(stamp));
    if (badStamps.length)
      diffs.push(
        `rows: first field expected an ISO-8601 UTC instant, actual ${JSON.stringify(badStamps)}`,
      );
    if (expect.stderr.length === 0 ? stderr !== '' : expect.stderr.some((s) => !stderr.includes(s)))
      diffs.push(
        `stderr: expected ${expect.stderr.length === 0 ? 'empty' : `to contain ${JSON.stringify(expect.stderr)}`}, actual ${JSON.stringify(stderr)}`,
      );
    const present = (expect.stderrExcludes ?? []).filter((s) => stderr.includes(s));
    if (present.length)
      diffs.push(
        `stderr: expected to exclude ${JSON.stringify(present)}, actual ${JSON.stringify(stderr)}`,
      );
    if (JSON.stringify(rows) !== JSON.stringify(expect.rows))
      diffs.push(`rows: expected ${JSON.stringify(expect.rows)}, actual ${JSON.stringify(rows)}`);
    return diffs;
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

const nameOf = (file) => relative(casesDir, file).replace(/\.json$/, '');
let passed = 0;
let failed = 0;
for (const file of walk(casesDir)) {
  const name = nameOf(file);
  if (!name.startsWith(prefix)) continue;
  let diffs;
  try {
    diffs = runCase(file);
  } catch (error) {
    diffs = [`error: ${error.message}`];
  }
  if (diffs.length === 0) passed++;
  else {
    failed++;
    console.log(`FAIL ${name}`);
    for (const diff of diffs) console.log(`  ${diff}`);
  }
}
if (passed + failed === 0) {
  console.log(`no case matched prefix ${JSON.stringify(prefix)}`);
  process.exit(1);
}
if (failed) {
  console.log(`${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} adapter fixture cases passed.`);
