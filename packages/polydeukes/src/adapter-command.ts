import { realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { isSea } from 'node:sea';
import { runAdapterProcess } from './adapter-process.ts';
import { scaffoldProject } from './scaffold-project.ts';

const hosts = {
  'claude-code': () => import('@polydeukes/adapter-claude-code'),
  codex: () => import('@polydeukes/adapter-codex'),
  grok: () => import('@polydeukes/adapter-grok'),
};

/** The current executable identity and finite adapter arguments. */
export type RunAdapterCommandSpec = {
  args: readonly string[];
  command: { executable: string; args: readonly string[] };
};

/** Output intended for the host, with the host's allow or deny exit status. */
export type RunAdapterCommandOutcome = { stdout: string; stderr: string; exitCode: 0 | 2 };

/** The pinned project root and the command this process was started with. */
export type RegistrationCommandSpec = {
  projectRoot: string;
  command: { executable: string; args: readonly string[] };
};

/**
 * Prefer the stable unversioned package path when the running script is that same file.
 *
 * A pnpm install links `node_modules/polydeukes` at the versioned store, so pinning the
 * versioned path breaks the registration on the next version bump. Any other script — or no
 * script at all, or a link that does not resolve — keeps the path this process was started
 * with.
 */
export function registrationCommand(spec: RegistrationCommandSpec): {
  executable: string;
  args: readonly string[];
} {
  const [script, ...rest] = spec.command.args;
  if (isSea() || script === undefined) return spec.command;
  const link = join(spec.projectRoot, 'node_modules', 'polydeukes', 'dist', 'bin.js');
  try {
    if (realpathSync(link) === realpathSync(script)) {
      return { ...spec.command, args: [link, ...rest] };
    }
  } catch {
    // A missing or dangling link is not the running script.
  }
  return spec.command;
}

async function readPayload(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const cleanup = () => {
      clearTimeout(timer);
      process.stdin.off('data', data);
      process.stdin.off('end', end);
      process.stdin.off('error', error);
      process.stdin.pause();
    };
    const error = (cause: Error) => {
      cleanup();
      reject(cause);
    };
    const data = (chunk: Buffer) => chunks.push(chunk);
    const end = () => {
      cleanup();
      try {
        resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      } catch (cause) {
        reject(cause);
      }
    };
    const timer = setTimeout(() => error(new Error('hook stdin deadline timed out')), 10_000);
    process.stdin.on('data', data);
    process.stdin.once('end', end);
    process.stdin.once('error', error);
  });
}

/** Register a host hook or translate one host event and ask this same executable to judge. */
export async function runAdapterCommand(
  spec: RunAdapterCommandSpec,
): Promise<RunAdapterCommandOutcome> {
  const [host, verb, flag, suppliedRoot] = spec.args;
  const root = verb === 'init' && spec.args.length === 2 ? process.cwd() : suppliedRoot;
  if (
    !Object.hasOwn(hosts, host) ||
    !(
      (verb === 'init' && spec.args.length === 2) ||
      (verb === 'hook' && spec.args.length === 4 && flag === '--project-root')
    ) ||
    !root ||
    !isAbsolute(root)
  ) {
    return {
      stdout: '',
      stderr:
        'usage: pdks adapter <claude-code|codex|grok> init | pdks adapter <claude-code|codex|grok> hook --project-root <absolute-path>\n',
      exitCode: 2,
    };
  }
  const adapter = await hosts[host as keyof typeof hosts]();
  if (verb === 'init') {
    try {
      const command = registrationCommand({ projectRoot: root, command: spec.command });
      const result = adapter.registerHook({
        projectRoot: root,
        command,
        beforeWrite: (ownedPaths: readonly string[]) => scaffoldProject(root, ownedPaths),
      });
      const stdout = [
        ...result.created.map((path: string) => `created ${path}`),
        ...result.updated.map((path: string) => `updated ${path}`),
        ...result.unchanged.map((path: string) => `unchanged ${path}`),
        ...result.preserved.map((path: string) => `preserved ${path}`),
        `required protected paths: ${result.ownedPaths.join(', ')}`,
      ].join('\n');
      return { stdout: stdout ? `${stdout}\n` : '', stderr: '', exitCode: 0 };
    } catch (error) {
      return {
        stdout: '',
        stderr: `pdks adapter ${host} init: ${error instanceof Error ? error.message : String(error)}\n`,
        exitCode: 2,
      };
    }
  }
  // Grok also discovers Claude registrations; its own adapter owns that observation.
  if (host === 'claude-code' && process.env.GROK_WORKSPACE_ROOT) {
    return adapter.renderHookResponse({ exitCode: 0 });
  }
  let prepared: ReturnType<typeof adapter.prepareHook>;
  try {
    const rawPayload = await readPayload();
    prepared = adapter.prepareHook({ repoRoot: root, rawPayload });
  } catch (error) {
    prepared = {
      outcome: 'unavailable' as const,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  // Observe-only events have no tool decision document in any of the supported hosts.
  if (prepared.outcome === 'recorded') return { exitCode: 0, stdout: '', stderr: '' };
  const unavailable = prepared.outcome === 'unavailable';
  const result = await runAdapterProcess({
    command: spec.command.executable,
    args: [
      ...spec.command.args,
      'covenant',
      'check',
      '--enforce',
      'block',
      ...(unavailable ? ['--input-failure'] : []),
    ],
    cwd: root,
    stdin: new TextEncoder().encode(
      JSON.stringify(
        prepared.outcome === 'unavailable' ? { reason: prepared.reason } : prepared.input,
      ),
    ),
    timeoutMs: 10_000,
  });
  const diagnostic = new TextDecoder().decode(result.stderr).trimEnd();
  const reason =
    result.reason ??
    (diagnostic ||
      (result.status !== 0 && result.status !== 2
        ? `judge returned unexpected status ${result.status}`
        : undefined));
  return adapter.renderHookResponse({
    exitCode: result.reason === undefined && result.status === 0 ? 0 : 2,
    ...(reason !== undefined && { reason }),
  });
}
