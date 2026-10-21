#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requestedExecutable = process.argv[process.argv.indexOf('--executable') + 1];
assert(process.argv.includes('--executable') && isAbsolute(requestedExecutable));
const executable = realpathSync(requestedExecutable);
const legacy = JSON.parse(readFileSync(join(repo, 'fixtures/adapters/legacy-0.19.1.json'), 'utf8'));
const root = realpathSync(mkdtempSync(join(tmpdir(), "pdks-adapter's space-")));
const emptyPath = join(root, 'empty-path');
mkdirSync(emptyPath);
const env = { ...process.env, PATH: emptyPath };
delete env.GROK_WORKSPACE_ROOT;
delete env.GROK_SESSION_ID;
let checks = 0;
const movedExecutable = join(root, 'moved pdks');
copyFileSync(executable, movedExecutable);
chmodSync(movedExecutable, 0o755);
const linkedExecutable = join(root, 'linked pdks');
symlinkSync(movedExecutable, linkedExecutable);
const collision = join(emptyPath, 'pdks');
writeFileSync(collision, '#!/bin/sh\nexit 77\n');
chmodSync(collision, 0o755);

function run(args, cwd, input = '', extra = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    input,
    env: { ...env, ...extra },
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  return { ...result, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
function settings(host) {
  return host === 'claude-code'
    ? '.claude/settings.json'
    : host === 'codex'
      ? '.codex/hooks.json'
      : '.grok/hooks/covenant-pretooluse.json';
}
function readSettings(host, project) {
  return JSON.parse(readFileSync(join(project, settings(host)), 'utf8'));
}
function entries(value, event) {
  return value.hooks[event].flatMap((entry) =>
    entry.hooks.map((handler) => ({ ...handler, matcher: entry.matcher })),
  );
}
function payload(host, project, path = 'allowed.txt', extra = {}) {
  const common = { cwd: project, session_id: 'fixture-main', hook_event_name: 'PreToolUse' };
  return host === 'grok'
    ? {
        hookEventName: 'pre_tool_use',
        sessionId: 'fixture-main',
        cwd: project,
        toolName: 'write',
        toolInput: { file_path: path, content: 'new text\n' },
        ...extra,
      }
    : {
        ...common,
        tool_name: host === 'codex' ? 'apply_patch' : 'Write',
        tool_input:
          host === 'codex'
            ? { command: `*** Begin Patch\n*** Add File: ${path}\n+new text\n*** End Patch\n` }
            : { file_path: path, content: 'new text\n' },
        ...extra,
      };
}
function hook(host, project, value, extra) {
  return run(
    ['adapter', host, 'hook', '--project-root', project],
    project,
    Buffer.isBuffer(value) ? value : JSON.stringify(value),
    extra,
  );
}
function rows(project) {
  const log = join(project, '.polydeukes/roi.log');
  return existsSync(log)
    ? readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [timestamp, event, label, subject] = line.split('\t');
          return { timestamp, event, label, subject };
        })
    : [];
}
function checkResponse(host, result, status) {
  assert.equal(result.status, status, `${host}: ${result.stderr || result.stdout}`);
  if (host === 'grok') {
    assert.equal(JSON.parse(result.stdout).decision, status === 0 ? 'allow' : 'deny');
    assert.equal(result.stderr, '');
  } else assert.equal(result.stdout, '');
  checks++;
}

try {
  for (const host of ['claude-code', 'codex', 'grok']) {
    const project = join(root, host);
    mkdirSync(project);
    const installed = run(['adapter', host, 'init'], project);
    assert.equal(installed.status, 0, installed.stderr);
    assert(!existsSync(join(project, legacy[host].relative)));
    const configPath = join(project, 'polydeukes.config.yaml');
    const scaffold = readFileSync(configPath, 'utf8');
    const owned = settings(host);
    assert(
      [owned, dirname(owned)].some(
        (path) => scaffold.includes(`'${path}'`) || scaffold.includes(JSON.stringify(path)),
      ),
    );
    const before = readFileSync(join(project, owned), 'utf8');
    assert.equal(run(['adapter', host, 'init'], project).status, 0);
    assert.equal(readFileSync(join(project, owned), 'utf8'), before);
    const registration = readSettings(host, project);
    assert.deepEqual(
      Object.keys(registration.hooks).sort(),
      ['PostToolUse', 'PreToolUse', 'SessionEnd', 'UserPromptSubmit'].sort(),
    );
    for (const event of Object.keys(registration.hooks)) {
      const handlers = entries(registration, event);
      assert.equal(handlers.length, 1);
      const handler = handlers[0];
      assert.equal(handler.timeout, event === 'PreToolUse' ? 60 : event === 'SessionEnd' ? 5 : 30);
      assert.notEqual(handler.async, true);
      if (host === 'claude-code') {
        assert.equal(handler.command, executable);
        assert.deepEqual(handler.args, ['adapter', host, 'hook', '--project-root', project]);
        assert.equal(handler.onFailure, 'block');
      } else {
        assert(handler.command.includes(project.replaceAll("'", "'\"'\"'")));
        assert(!handler.command.includes('covenant-pretooluse.mjs'));
      }
    }
    writeFileSync(
      configPath,
      'protectedPaths: [gate.txt]\nwitness: { token: fixture-witness, ttlMinutes: 1 }\n',
    );
    writeFileSync(join(project, 'gate.txt'), 'old text\n');
    checkResponse(host, hook(host, project, payload(host, project)), 0);
    const offset = rows(project).length;
    checkResponse(host, hook(host, project, payload(host, project, 'gate.txt')), 2);
    const blocked = rows(project).slice(offset);
    assert.equal(
      blocked.filter(
        (row) => row.label === 'self-mod' && row.event === 'blocked' && row.subject === 'gate.txt',
      ).length,
      1,
    );
    const failureOffset = rows(project).length;
    const bad = hook(host, project, Buffer.from('null'));
    checkResponse(host, bad, 2);
    assert.equal(`${bad.stdout}${bad.stderr}`.split('payload must be an object').length - 1, 1);
    assert.equal(
      rows(project)
        .slice(failureOffset)
        .filter((row) => row.event === 'blocked' && row.label === 'covenant-check').length,
      1,
    );
    checkResponse(host, hook(host, project, Buffer.from([255])), 2);
    checkResponse(host, hook(host, project, Buffer.from('{"tool')), 2);
    checkResponse(
      host,
      hook(host, project, payload(host, project, 'gate.txt', { toolInputTruncated: true })),
      2,
    );
    mkdirSync(join(project, 'sub'));
    checkResponse(
      host,
      hook(host, project, payload(host, project, '../gate.txt', { cwd: join(project, 'sub') })),
      2,
    );
    const lifecycle =
      host === 'grok'
        ? {
            hookEventName: 'user_prompt_submit',
            sessionId: 'fixture-main',
            cwd: project,
            prompt: 'fixture-witness',
          }
        : {
            hook_event_name: 'UserPromptSubmit',
            session_id: 'fixture-main',
            cwd: project,
            prompt: 'fixture-witness',
          };
    const recorded = hook(host, project, lifecycle);
    assert.equal(recorded.status, 0);
    assert.equal(recorded.stdout, '');
    checkResponse(host, hook(host, project, payload(host, project, 'gate.txt')), 2);

    // The fixture was captured from the released installer, independently of new migration code.
    const old = legacy[host];
    writeFileSync(
      join(project, settings(host)),
      JSON.stringify({
        permissions: { allow: ['user-choice'] },
        hooks: {
          PreToolUse: [
            {
              matcher: '.*',
              hooks: [
                { type: 'command', command: old.command },
                { type: 'command', command: old.command },
                { type: 'command', command: 'printf user-owned-handler' },
              ],
            },
          ],
        },
      }),
    );
    mkdirSync(dirname(join(project, old.relative)), { recursive: true });
    writeFileSync(join(project, old.relative), old.delegator);
    assert.equal(run(['adapter', host, 'init'], project).status, 0);
    const migrated = readSettings(host, project);
    assert.deepEqual(migrated.permissions, { allow: ['user-choice'] });
    assert.equal(entries(migrated, 'PreToolUse').length, 2);
    assert(!JSON.stringify(migrated).includes(old.command));
    assert(!existsSync(join(project, old.relative)), `${host}: unchanged legacy delegator remains`);
    assert.equal(
      readFileSync(configPath, 'utf8'),
      'protectedPaths: [gate.txt]\nwitness: { token: fixture-witness, ttlMinutes: 1 }\n',
    );
    checks++;
    // A relocated executable re-pins the registration; a symlink resolves to that file.
    const relocated = spawnSync(linkedExecutable, ['adapter', host, 'init'], {
      cwd: project,
      env,
      encoding: 'utf8',
    });
    assert.ifError(relocated.error);
    assert.equal(relocated.status, 0, relocated.stderr);
    const pinned =
      host === 'claude-code' ? movedExecutable : movedExecutable.replaceAll("'", "'\"'\"'");
    const handler = entries(readSettings(host, project), 'PreToolUse').find((entry) =>
      entry.command.includes(pinned),
    );
    assert(handler, `${host}: relocated executable was not pinned`);
    const invoked =
      host === 'claude-code'
        ? spawnSync(handler.command, handler.args, {
            cwd: project,
            env,
            input: JSON.stringify(payload(host, project)),
            encoding: 'utf8',
          })
        : spawnSync('/bin/sh', ['-c', handler.command], {
            cwd: project,
            env,
            input: JSON.stringify(payload(host, project)),
            encoding: 'utf8',
          });
    assert.ifError(invoked.error);
    checkResponse(host, invoked, 0);

    const contextProject = join(root, `context-${host}`);
    mkdirSync(contextProject);
    assert.equal(run(['adapter', host, 'init'], contextProject).status, 0);
    mkdirSync(join(contextProject, 'sub'));
    writeFileSync(join(contextProject, 'sub/gate.txt'), 'protected\n');
    writeFileSync(
      join(contextProject, 'polydeukes.config.yaml'),
      'protectedPaths: [sub/gate.txt]\nwitness: { token: fixture-witness, ttlMinutes: 1 }\n',
    );
    for (const [command, status] of [
      ['printf changed > gate.txt', 2],
      ['cat gate.txt', 0],
      ['printf changed > other.txt', 0],
    ]) {
      const event = payload(host, contextProject);
      event.cwd = join(contextProject, 'sub');
      if (host === 'grok') {
        event.toolName = 'run_terminal_command';
        event.toolInput = { command };
      } else {
        event.tool_name = 'Bash';
        event.tool_input = { command };
      }
      const before = rows(contextProject).length;
      checkResponse(host, hook(host, contextProject, event), status);
      if (status === 2)
        assert.equal(
          rows(contextProject)
            .slice(before)
            .filter(
              (row) =>
                row.event === 'blocked' &&
                row.label === 'shell-mod' &&
                row.subject === 'sub/gate.txt',
            ).length,
          1,
        );
    }
  }
  // Compatibility registration is silent; Grok's native registration owns the call.
  const project = join(root, 'grok');
  const offset = rows(project).length;
  const skipped = hook('claude-code', project, payload('grok', project), {
    GROK_WORKSPACE_ROOT: project,
  });
  assert.equal(skipped.status, 0);
  assert.equal(skipped.stdout, '');
  assert.equal(rows(project).length, offset);
  checks++;

  // A pipe writer that never sends EOF must still receive an explicit denial.
  const child = spawn(executable, ['adapter', 'grok', 'hook', '--project-root', project], {
    cwd: project,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stderr.resume();
  const result = await new Promise((settle, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('stdin EOF deadline missing'));
    }, 14000);
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      settle(status);
    });
  });
  assert.equal(result, 2);
  assert.match(JSON.parse(Buffer.concat(chunks).toString()).reason, /deadline/);
  child.stdin.destroy();
  checks++;
  console.log(
    JSON.stringify({
      executable,
      sha256: createHash('sha256').update(readFileSync(executable)).digest('hex'),
      platform: `${process.platform}-${process.arch}`,
      checks,
      node: process.version,
    }),
  );
  console.log(
    'Standalone adapter registration, translation, refusal, migration and EOF checks passed.',
  );
} finally {
  if (process.env.PDKS_KEEP_ADAPTER_FIXTURES === '1') console.log(`Fixtures: ${root}`);
  else rmSync(root, { recursive: true, force: true });
}
