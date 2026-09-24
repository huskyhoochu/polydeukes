import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');
const fixtures: string[] = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runFixture(failBuild: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'pdks-test-orchestration-'));
  fixtures.push(root);
  for (const file of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'turbo.json']) {
    copyFileSync(join(repoRoot, file), join(root, file));
  }
  symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'dir');

  const packages = readdirSync(join(repoRoot, 'packages')).flatMap((directory) => {
    const source = join(repoRoot, 'packages', directory);
    if (!existsSync(join(source, 'package.json'))) return [];
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    const target = join(root, 'packages', directory);
    mkdirSync(target, { recursive: true });
    if (existsSync(join(source, 'turbo.json'))) {
      copyFileSync(join(source, 'turbo.json'), join(target, 'turbo.json'));
    }
    const builds = typeof manifest.scripts?.build === 'string';
    const tests = typeof manifest.scripts?.test === 'string';
    if (builds) manifest.scripts.build = 'node fixture-build.cjs';
    if (tests) manifest.scripts.test = 'node fixture-test.cjs';
    writeFileSync(join(target, 'package.json'), JSON.stringify(manifest));
    return [{ directory, target, builds, tests }];
  });

  const producers = packages.filter((pkg) => pkg.builds).map((pkg) => pkg.directory);
  const consumers = packages.filter((pkg) => pkg.tests).map((pkg) => pkg.directory);
  const eventsPath = join(root, 'events.jsonl');
  const failingProducer = producers[producers.length - 1];
  for (const pkg of packages) {
    writeFileSync(
      join(pkg.target, 'fixture-build.cjs'),
      `const fs = require('node:fs');
const name = ${JSON.stringify(pkg.directory)};
const events = ${JSON.stringify(eventsPath)};
fs.appendFileSync(events, JSON.stringify({kind: 'build-start', name}) + '\\n');
if (${failBuild && pkg.directory === failingProducer}) {
  fs.appendFileSync(events, JSON.stringify({kind: 'build-failed', name}) + '\\n');
  process.exit(23);
}
fs.mkdirSync('dist', {recursive: true});
fs.writeFileSync('dist/ready', name);
fs.appendFileSync(events, JSON.stringify({kind: 'build-done', name}) + '\\n');
`,
    );
    writeFileSync(
      join(pkg.target, 'fixture-test.cjs'),
      `const fs = require('node:fs');
const path = require('node:path');
const root = ${JSON.stringify(root)};
const missing = ${JSON.stringify(producers)}.filter(name =>
  !fs.existsSync(path.join(root, 'packages', name, 'dist/ready')));
fs.appendFileSync(${JSON.stringify(eventsPath)}, JSON.stringify({
  kind: 'test', name: ${JSON.stringify(pkg.directory)}, missing
}) + '\\n');
if (missing.length) process.exit(24);
`,
    );
  }

  const env: NodeJS.ProcessEnv = { ...process.env, TURBO_TELEMETRY_DISABLED: '1' };
  delete env.TURBO_FORCE;
  const result = spawnSync('pnpm', ['test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env,
  });
  const events: { kind: string; name: string; missing?: string[] }[] = existsSync(eventsPath)
    ? readFileSync(eventsPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
  return { result, events, producers, consumers, failingProducer };
}

describe('root test build preparation', () => {
  it('finishes every workspace build before consumers inspect sibling artifacts', () => {
    // Removing build ordering exposes absent artifacts, including siblings outside dependencies.
    const { result, events, producers, consumers } = runFixture(false);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(
      events
        .filter((event) => event.kind === 'build-done')
        .map((event) => event.name)
        .sort(),
    ).toEqual([...producers].sort());
    const tests = events.filter((event) => event.kind === 'test');
    expect(tests.map((event) => event.name).sort()).toEqual([...consumers].sort());
    expect(tests.every((event) => event.missing?.length === 0)).toBe(true);
    const firstTest = events.findIndex((event) => event.kind === 'test');
    expect(events.slice(firstTest).some((event) => event.kind === 'build-done')).toBe(false);
  }, 90_000);

  it('fails before starting consumers when a required build fails', () => {
    // Continuing into test tasks after a failed producer exposes incomplete shared outputs.
    const { result, events, failingProducer } = runFixture(true);
    expect(events, `${result.stdout}\n${result.stderr}`).toContainEqual({
      kind: 'build-failed',
      name: failingProducer,
    });
    expect(result.status).not.toBeNull();
    expect(result.status).not.toBe(0);
    expect(events.filter((event) => event.kind === 'test')).toEqual([]);
  }, 90_000);
});
