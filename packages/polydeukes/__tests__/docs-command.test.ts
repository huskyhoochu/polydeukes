import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
const queries = [
  ['en', 'install claude-code', 'first-judgment', 'claude-code'],
  ['ko', '클로드 코드 설치', 'first-judgment', 'claude-code'],
  ['en', 'invalid config', 'troubleshooting', 'invalid-config'],
  ['ko', '설정 오류', 'troubleshooting', 'invalid-config'],
  ['en', 'locale key pairing', 'write-disciplines', 'locale-key-pairing'],
  ['ko', '번역 키 짝 맞춤', 'write-disciplines', 'locale-key-pairing'],
  ['en', 'Grok witness', 'troubleshooting', 'grok-witness'],
  ['ko', 'Grok 증인', 'troubleshooting', 'grok-witness'],
  ['en', 'config-fault', 'troubleshooting', 'config-fault'],
  ['ko', '미판정 config-fault', 'troubleshooting', 'config-fault'],
  ['en', '--worktree', 'cli-covenant-check', 'worktree'],
  ['ko', '작업 트리 검사', 'cli-covenant-check', 'worktree'],
] as const;

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
  it.each(
    queries,
  )('%s search %s returns %s#%s in the top three offline', (language, query, documentId, sectionId) => {
    const start = performance.now();
    const result = invoke(['search', query, '--lang', language, '--limit', '3', '--json']);
    const elapsed = performance.now() - start;
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    const answer = JSON.parse(result.stdout);
    expect(answer.packageVersion).toBe(version);
    expect(answer.language).toBe(language);
    expect(answer.results).toContainEqual(expect.objectContaining({ documentId, sectionId }));
    expect(elapsed).toBeLessThan(1_000);
  });

  it.each([
    'install',
    'config',
    'discipline',
    'covenant',
    'witness',
  ])('keeps the legacy %s topic in Korean', (topic) => {
    const result = invoke([topic, '--lang', 'ko']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('See also: pdks docs show');
    expect(result.stdout).toMatch(/[가-힣]/);
  });

  it('shows the exact full source document and stable section', () => {
    const full = invoke(['show', 'first-judgment', '--lang', 'ko', '--json']);
    expect(full.status, full.stderr).toBe(0);
    const answer = JSON.parse(full.stdout);
    expect(answer.markdown).toBe(
      readFileSync(join(sourceRoot, 'tutorials/first-judgment.ko.md'), 'utf8'),
    );
    expect(answer.sectionId).toBeNull();
    const part = invoke(['show', 'first-judgment', '--section', 'claude-code']);
    expect(part.status, part.stderr).toBe(0);
    expect(part.stdout).toMatch(/^<a id="claude-code"><\/a>/);
    expect(part.stdout).not.toContain('<a id="next-step">');
  });

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

  it('keeps the uncompressed bundle within five MiB', () => {
    let bytes = 0;
    function visit(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else bytes += readFileSync(path).byteLength;
      }
    }
    visit(bundle);
    expect(bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it('returns exit two and no partial answer when raw Markdown is damaged', () => {
    const path = join(bundle, 'tutorials/first-judgment.md');
    const original = readFileSync(path, 'utf8');
    try {
      writeFileSync(path, `${original}\nUnexpected change\n`);
      for (const args of [
        ['search', 'install'],
        ['show', 'first-judgment'],
      ]) {
        const result = invoke(args);
        expect(result.status).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('pdks docs:');
      }
    } finally {
      writeFileSync(path, original);
    }
  });
});
