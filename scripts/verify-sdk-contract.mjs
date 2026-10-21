import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const option = (name) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const executable = resolve(option('--executable') ?? '');
assert(
  option('--executable') && existsSync(executable),
  '--executable must name a built standalone pdks',
);
const fixture = JSON.parse(readFileSync(join(repository, 'fixtures/sdk/contract.json'), 'utf8'));
const hitFields = Object.keys(fixture.hit);
const scratch = mkdtempSync(join(tmpdir(), 'pdks-sdk-contract-'));
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repository,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')}\n${result.error ?? ''}\n${result.stderr}\n${result.stdout}`,
  );
  return result.stdout;
};

try {
  const rustRoot = join(scratch, 'rust-observer');
  mkdirSync(join(rustRoot, 'src'), { recursive: true });
  copyFileSync(join(repository, 'scripts/sdk-contract/observe.rs'), join(rustRoot, 'src/main.rs'));
  writeFileSync(
    join(rustRoot, 'Cargo.toml'),
    `[package]\nname="sdk-contract-observer"\nversion="0.0.0"\nedition="2024"\n[dependencies]\npolydeukes-sdk={path=${JSON.stringify(resolve(option('--rust-crate') ?? join(repository, 'packages/sdk-rust')))}}\nserde_json="1"\n`,
  );
  run('cargo', ['build', '--quiet', '--manifest-path', join(rustRoot, 'Cargo.toml')]);
  const python =
    option('--python') ??
    run('uv', [
      'run',
      '--project',
      'packages/sdk-python',
      '--locked',
      'python',
      '-c',
      'import sys; print(sys.executable)',
    ]).trim();
  const tsModule = pathToFileURL(
    resolve(option('--ts-module') ?? join(repository, 'packages/sdk-ts/dist/index.js')),
  ).href;
  const commands = {
    ts: [process.execPath, [join(repository, 'scripts/sdk-contract/observe.mjs')]],
    rust: [join(rustRoot, 'target/debug/sdk-contract-observer'), []],
    python: [python, [join(repository, 'scripts/sdk-contract/observe.py')]],
  };
  const expected = new Map();
  const all = {};
  for (const [language, [command, args]] of Object.entries(commands)) {
    const root = join(scratch, language);
    mkdirSync(root);
    for (const [path, contents] of Object.entries({
      ...fixture.rootFiles,
      ...fixture.rankingFiles,
    })) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), contents);
    }
    writeFileSync(join(root, 'polydeukes.config.yaml'), JSON.stringify(fixture.config));
    const requests = fixture.processCases.map((value) => ({
      id: `seam-${value.id}`,
      verb: value.verb,
      input: fixture.input,
      diff: fixture.diff,
      query: fixture.query,
      root,
      executable,
      response: value,
      expected: value.result,
    }));
    requests.push(
      {
        id: 'seam-signal',
        verb: 'check_covenant',
        response: { status: null, stdout: '', stderr: '' },
        expected: 'Unjudged',
      },
      {
        id: 'seam-memory-failed',
        verb: 'memory_ingest',
        response: { status: 2, stderr: 'memory failure\n' },
        expected: 'Unavailable',
      },
      {
        id: 'seam-utf8',
        verb: 'memory_search',
        response: { status: 0, stdoutBytes: [255] },
        expected: 'Unavailable',
      },
      {
        id: 'seam-future-field-utf8',
        verb: 'memory_search',
        response: {
          status: 0,
          stdoutBytes: [
            ...new TextEncoder().encode('{"ingestedAt":"fixture-time","results":[],"future":"'),
            255,
            ...new TextEncoder().encode('"}'),
          ],
        },
        expected: 'Unavailable',
      },
      {
        id: 'seam-spawn',
        verb: 'check_covenant',
        response: { error: 'spawn fixture' },
        expected: 'Unjudged',
      },
      {
        id: 'seam-timeout',
        verb: 'memory_search',
        response: { error: 'timeout' },
        timeoutMs: 200,
        expected: 'Unavailable',
      },
    );
    const unchanged = structuredClone(fixture.input);
    unchanged.toolCalls[0].fileChange.post = unchanged.toolCalls[0].fileChange.pre;
    requests.push(
      { id: 'real-no-index', verb: 'memory_search', expected: 'Unavailable' },
      { id: 'real-ingest', verb: 'memory_ingest', expected: 'Ingested' },
      { id: 'real-found', verb: 'memory_search', expected: 'Found' },
      { id: 'real-empty', verb: 'memory_search', query: 'zzabsent98765', expected: 'Empty' },
      { id: 'real-limit', verb: 'memory_search', limit: 1, expected: 'Found' },
      { id: 'real-ir-blocked', verb: 'check_covenant', expected: 'Blocked' },
      { id: 'real-ir-upheld', verb: 'check_covenant', input: unchanged, expected: 'Upheld' },
      { id: 'real-ir-advised', verb: 'check_covenant', enforce: 'advise', expected: 'Upheld' },
      { id: 'real-diff-blocked', verb: 'check_change_set', expected: 'Blocked' },
      { id: 'real-diff-upheld', verb: 'check_change_set', diff: '', expected: 'Upheld' },
      { id: 'real-diff-advised', verb: 'check_change_set', enforce: 'advise', expected: 'Upheld' },
    );
    const broken = join(root, 'broken');
    mkdirSync(broken);
    writeFileSync(join(broken, 'polydeukes.config.yaml'), 'disciplines: invalid');
    requests.push({
      id: 'real-invalid-config',
      verb: 'memory_ingest',
      root: broken,
      expected: 'Unavailable',
    });
    for (const request of requests) {
      Object.assign(request, {
        root: request.root ?? root,
        executable,
        input: request.input ?? fixture.input,
        diff: request.diff ?? fixture.diff,
        query: request.query ?? fixture.query,
      });
      if (!request.response && request.verb.startsWith('check'))
        request.telemetryPath = join(root, `${request.id}.log`);
      expected.set(request.id, request.expected);
    }
    const manifest = join(root, 'requests.json');
    writeFileSync(manifest, JSON.stringify(requests));
    const output = JSON.parse(
      run(command, [...args, manifest], {
        env: {
          ...process.env,
          PATH: join(scratch, 'empty-path'),
          PYTHONPATH: join(repository, 'packages/sdk-python/src'),
          PDKS_SDK_MODULE: tsModule,
        },
      }),
    );
    assert.equal(output.length, requests.length, `${language} must observe every request`);
    all[language] = output.map((observation, index) => {
      const request = requests[index];
      assert.equal(observation.id, request.id);
      assert.equal(observation.result.kind, expected.get(request.id), `${language} ${request.id}`);
      if (request.response?.args)
        assert.deepEqual(
          observation.calls[0].args,
          request.response.args,
          `${language} ${request.id} argv`,
        );
      const result = observation.result;
      if (
        request.response?.error ||
        request.response?.status === null ||
        (request.response?.status === 0 && result.kind === 'Unavailable')
      ) {
        assert(result.reason, `${language} ${request.id} must explain failure`);
        result.reason =
          request.response.error ??
          (request.response.status === null ? 'signal' : 'invalid-response');
      }
      if (result.hits)
        result.hits = result.hits.map((hit) =>
          Object.fromEntries(hitFields.map((field) => [field, hit[field]])),
        );
      for (const call of observation.calls)
        if (request.verb === 'check_covenant') call.stdin = JSON.parse(call.stdin);
      const log = request.telemetryPath;
      observation.telemetry =
        log && existsSync(log)
          ? readFileSync(log, 'utf8')
              .trim()
              .split('\n')
              .filter(Boolean)
              .map((line) => line.split('\t').slice(1))
          : [];
      if (request.id === 'real-ir-blocked' || request.id === 'real-diff-blocked') {
        assert(
          observation.telemetry.some((row) => row[0] === 'blocked' && row[1] === 'sdk-no-todo'),
          `${language} must record actual discipline judgment`,
        );
      }
      if (request.id.startsWith('real-') && request.id.endsWith('-advised'))
        assert(result.advisories.includes('sdk-no-todo'), `${language} must retain actual advice`);
      if (request.id === 'real-found')
        assert.equal(result.hits.length, 2, `${language} must expose a ranking with multiple hits`);
      if (request.id === 'real-limit')
        assert.equal(result.hits.length, 1, `${language} must pass limit to the CLI`);
      return JSON.parse(JSON.stringify(observation).split(root).join('<root>'));
    });
  }
  assert.deepEqual(all.ts, all.python, 'TS/Python observations differ');
  assert.deepEqual(all.rust, all.python, 'Rust/Python observations differ');
  const digest = createHash('sha256').update(readFileSync(executable)).digest('hex');
  console.log(
    `SDK contract: ${all.ts.length} cases × 3 languages agree; executable=${executable}; sha256=${digest}; ${process.platform}/${process.arch}; ${process.version}; ${run('rustc', ['--version']).trim()}; ${run(python, ['--version']).trim()}`,
  );
} finally {
  if (process.env.PDKS_KEEP_CONTRACT_FIXTURES) console.log(`SDK fixtures: ${scratch}`);
  else rmSync(scratch, { recursive: true, force: true });
}
