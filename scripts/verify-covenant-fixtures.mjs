#!/usr/bin/env node
// Runs every conformance/covenant/**/*.json case against a `pdks` executable, so any
// implementation of the judge is compared on the process boundary alone.
// Usage: node scripts/verify-covenant-fixtures.mjs --executable <absolute path> [<group>/<name> prefix]
//
// A case is one `pdks covenant check <args>` run in a fresh root (the cwd) with HOME set to a
// separate fresh directory. The child environment is PATH, HOME and the case's env only, and
// stdout must be empty:
//   description  one sentence naming the verdict the case pins
//   args, env    argv after `covenant check`; extra environment variables
//   tree         root-relative path -> content (a string as is, anything else as JSON text)
//   stdin        a string as is, anything else as JSON text
//   expect.exit  the exit code
//   expect.stderr          substrings that must occur; [] means stderr must be empty
//   expect.stderrExcludes  substrings that must not occur (optional)
//   expect.log   root-relative telemetry log (default .polydeukes/roi.log)
//   expect.rows  the rows this run appended, each without its leading timestamp field, in order;
//                that field is dropped from the comparison but must be an ISO-8601 UTC instant
//                (2026-10-30T01:23:45.678Z)
// Strings in args, env, tree, stdin and expect have @@ROOT@@ (the root's realpath, which is
// what the judge's cwd reports), @@HOME@@ and @@NOW_MS@@ / @@NOW_MS-<n>@@ (milliseconds,
// taken once just before the run) replaced. stdin numbers that need the clock are written
// inside a string stdin, since a JSON object would keep the placeholder quoted.
import { spawnSync } from 'node:child_process';
import {
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
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = join(repo, 'conformance/covenant');
const argv = process.argv.slice(2);
const flag = argv.indexOf('--executable');
const executable = flag === -1 ? undefined : argv[flag + 1];
if (!executable || !isAbsolute(executable)) {
  console.error(
    'usage: node scripts/verify-covenant-fixtures.mjs --executable <absolute path> [<group>/<name> prefix]',
  );
  process.exit(2);
}
const prefix = argv.filter((_, i) => i !== flag && i !== flag + 1)[0] ?? '';

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name))
        : entry.name.endsWith('.json')
          ? [join(dir, entry.name)]
          : [],
    );
}

function substitute(value, vars) {
  if (typeof value === 'string')
    return value
      .replaceAll('@@ROOT@@', vars.root)
      .replaceAll('@@HOME@@', vars.home)
      .replace(/@@NOW_MS(?:-(\d+))?@@/g, (_, n) => String(vars.now - Number(n ?? 0)));
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
  const missing = ['description', 'args', 'tree', 'stdin', 'expect']
    .filter((key) => spec[key] === undefined)
    .concat(
      ['exit', 'stderr', 'rows']
        .filter((key) => spec.expect?.[key] === undefined)
        .map((k) => `expect.${k}`),
    );
  if (missing.length) return [`missing required keys: ${missing.join(', ')}`];

  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-covenant-root-')));
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-covenant-home-')));
  try {
    const vars = { root, home, now: Date.now() };
    for (const [path, content] of Object.entries(spec.tree)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, substitute(text(content), vars));
    }
    const expect = substitute(spec.expect, vars);
    const logPath = join(root, expect.log ?? '.polydeukes/roi.log');
    const before = lines(logPath).length;
    const result = spawnSync(executable, ['covenant', 'check', ...substitute(spec.args, vars)], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: home, ...substitute(spec.env ?? {}, vars) },
      input: substitute(text(spec.stdin), vars),
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
    if (result.stdout !== '')
      diffs.push(`stdout: expected empty, actual ${JSON.stringify(result.stdout)}`);
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

let passed = 0;
let failed = 0;
for (const file of walk(casesDir)) {
  const name = relative(casesDir, file).replace(/\.json$/, '');
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
console.log(`${passed} covenant fixture cases passed.`);
