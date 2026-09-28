import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDocs } from '../src/docs-library.ts';

const sourceRoot = resolve(import.meta.dirname, '../../../docs');
const version = '0.6.1-fixture';
let root: string;
let bundle: string;
let bin: string;
let offline: string;

function invoke(args: string[]) {
  return spawnSync(process.execPath, ['--import', offline, bin, 'docs', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5_000,
  });
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'pdks-docs-command-'));
  const dist = join(root, 'dist');
  bundle = join(dist, 'docs');
  mkdirSync(dist);
  buildDocs({ sourceRoot, outputRoot: bundle });
  // No judge, adapters, configuration loader, or dependency tree exists in this fixture.
  for (const name of [
    'bin.ts',
    'docs-library.ts',
    'docs-catalog.ts',
    'docs-markdown.ts',
    'docs-types.ts',
  ]) {
    copyFileSync(resolve(import.meta.dirname, '../src', name), join(dist, name));
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', version }));
  writeFileSync(join(root, 'polydeukes.config.yaml'), 'intentionally: [invalid');
  bin = join(dist, 'bin.ts');
  offline = join(root, 'offline.mjs');
  writeFileSync(
    offline,
    `
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
const denied = () => { throw new Error('network disabled for documentation test'); };
net.Socket.prototype.connect = denied;
http.request = http.get = https.request = https.get = denied;
globalThis.fetch = denied;
syncBuiltinESMExports();
`,
  );
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('real documentation through the CLI', () => {
  it.each(['install', 'config', 'discipline', 'covenant', 'witness'])(
    'keeps the legacy %s topic in Korean',
    (topic) => {
      const result = invoke([topic, '--lang', 'ko']);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('See also: pdks docs show');
      expect(result.stdout).toMatch(/[가-힣]/);
    },
  );

  it('returns an explicit empty successful result for an absent query', () => {
    const result = invoke(['search', 'zz-docs-no-such-phrase-539', '--json']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ count: 0, results: [] });
  });

  it.each([
    ['search'],
    ['search', 'x', '--limit', '0'],
    ['show', '../outside'],
    ['show', 'unknown'],
    ['install', '--lang', 'fr'],
    ['show', 'first-judgment', '--section', 'absent'],
  ])('leaves stdout empty on invalid arguments: %j', (...args) => {
    const result = invoke(args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('pdks docs:');
  });
});
