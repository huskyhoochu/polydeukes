import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const sdk = await import(
  process.env.PDKS_SDK_MODULE ??
    pathToFileURL(new URL('../../packages/sdk-ts/dist/index.js', import.meta.url).pathname).href
);
const requests = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const names = {
  check_covenant: 'checkCovenant',
  check_change_set: 'checkChangeSet',
  memory_ingest: 'memoryIngest',
  memory_search: 'memorySearch',
};
const encode = (text = '') => new TextEncoder().encode(text);
const observations = [];
for (const request of requests) {
  const calls = [];
  const spec = { executable: request.executable, timeoutMs: request.timeoutMs };
  if (request.response) {
    spec.spawn = async (call) => {
      calls.push({
        args: call.args,
        stdin: new TextDecoder().decode(call.stdin),
        timeoutMs: call.timeoutMs ?? null,
      });
      const response = request.response;
      if (response.error)
        throw Object.assign(new Error(response.error), {
          name: response.error === 'timeout' ? 'TimeoutError' : 'Error',
        });
      return {
        status: response.status,
        stdout: response.stdoutBytes
          ? Uint8Array.from(response.stdoutBytes)
          : encode(response.stdout),
        stderr: encode(response.stderr),
      };
    };
  }
  if (request.verb.startsWith('check')) {
    Object.assign(spec, {
      repoRoot: request.root,
      enforce: request.enforce,
      configLayer: request.configLayer,
      telemetryPath: request.telemetryPath,
    });
    if (request.verb === 'check_covenant') spec.input = request.input;
    else spec.diff = request.diff;
  } else {
    Object.assign(spec, { root: request.root });
    if (request.verb === 'memory_search')
      Object.assign(spec, { query: request.query, limit: request.limit });
  }
  const result = await sdk[names[request.verb]](spec);
  const kind = result.verdict ?? result.outcome;
  observations.push({
    id: request.id,
    result: {
      kind: kind[0].toUpperCase() + kind.slice(1),
      ...(result.reason === undefined ? {} : { reason: result.reason }),
      ...(result.advisories === undefined ? {} : { advisories: result.advisories }),
      ...(result.hits === undefined ? {} : { hits: result.hits }),
    },
    calls,
  });
}
process.stdout.write(JSON.stringify(observations));
