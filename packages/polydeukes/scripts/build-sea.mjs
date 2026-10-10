#!/usr/bin/env node
/**
 * Build `pdks` as one single executable: `node scripts/build-sea.mjs <output path>`.
 *
 * Input is `dist` (run `pnpm build` first). The umbrella is bundled into one ESM file with
 * garu-ko's loader swapped for one that reads its wasm and model from the executable's assets.
 * A CommonJS main imports that bundle as a `data:` URL, since the runtime executes only a
 * CommonJS main. The blob is injected into a copy of the running node binary.
 */

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = join(packageRoot, 'dist');
// The real path, since esbuild hands its plugins symlink-resolved paths.
const garuRoot = realpathSync(join(packageRoot, '../memory/node_modules/garu-ko'));
const garuNode = join(garuRoot, 'dist', 'node.js');

/** garu-ko's `Garu.load`, reading the wasm and model bytes from the executable's assets. */
const GARU_LOADER = `import { getRawAsset } from 'node:sea';
import { GaruBase } from './core.js';
export { normalizeText, splitSentences } from './normalize.js';
import * as wasmModule from '../pkg/garu_wasm.js';

export class Garu extends GaruBase {
  static async load(options) {
    await wasmModule.default({ module_or_path: new Uint8Array(getRawAsset('garu_wasm_bg.wasm')).slice() });
    const modelBytes = options?.modelData
      ? new Uint8Array(options.modelData)
      : new Uint8Array(getRawAsset('base.gmdl')).slice();
    const wasmInstance = new wasmModule.GaruWasm(modelBytes, options?.normalizeJamo ?? false);
    return new Garu(wasmInstance, modelBytes.byteLength);
  }
}
`;

const MAIN = `const { getAsset } = require('node:sea');
import('data:text/javascript;base64,' + Buffer.from(getAsset('bundle.mjs', 'utf8')).toString('base64')).catch((error) => {
  process.stderr.write('pdks: ' + (error instanceof Error ? error.message : String(error)) + '\\n');
  process.exit(2);
});
`;

function filesUnder(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

const output = process.argv[2];
if (output === undefined) {
  process.stderr.write('usage: node scripts/build-sea.mjs <output path>\n');
  process.exit(2);
}
const out = resolve(output);
// The executable is a copy of this node binary, and its `pdks docs` lists its assets with
// `getAssetKeys`, which arrived in Node 24.8.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 8)) {
  process.stderr.write(
    `build-sea: Node ${process.versions.node} cannot host it; use 24.8 or later\n`,
  );
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'pdks-sea-'));

try {
  const bundle = join(work, 'bundle.mjs');
  await build({
    entryPoints: [join(distRoot, 'bin.js')],
    outfile: bundle,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    bundle: true,
    logLevel: 'warning',
    banner: {
      js: "import { createRequire as __pdksCreateRequire } from 'node:module'; const require = __pdksCreateRequire(process.execPath);",
    },
    plugins: [
      {
        name: 'garu-sea-loader',
        setup(builder) {
          builder.onLoad({ filter: /garu-ko[\\/]dist[\\/]node\.js$/ }, (args) =>
            args.path === garuNode
              ? { contents: GARU_LOADER, resolveDir: dirname(garuNode), loader: 'js' }
              : undefined,
          );
        },
      },
    ],
  });

  const main = join(work, 'main.cjs');
  writeFileSync(main, MAIN);
  const assets = {
    'bundle.mjs': bundle,
    'garu_wasm_bg.wasm': join(garuRoot, 'pkg', 'garu_wasm_bg.wasm'),
    'base.gmdl': join(garuRoot, 'models', 'base.gmdl'),
    'package.json': join(packageRoot, 'package.json'),
  };
  const docsRoot = join(distRoot, 'docs');
  for (const file of filesUnder(docsRoot)) {
    assets[`docs/${relative(docsRoot, file).split('\\').join('/')}`] = file;
  }

  const blob = join(work, 'sea.blob');
  const seaConfig = join(work, 'sea.json');
  writeFileSync(
    seaConfig,
    JSON.stringify({
      main,
      output: blob,
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      useSnapshot: false,
      assets,
    }),
  );
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfig]);

  const darwin = process.platform === 'darwin';
  copyFileSync(process.execPath, out);
  chmodSync(out, 0o755);
  if (darwin) execFileSync('codesign', ['--remove-signature', out]);
  await require('postject').inject(out, 'NODE_SEA_BLOB', readFileSync(blob), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(darwin ? { machoSegmentName: 'NODE_SEA' } : {}),
  });
  if (darwin) execFileSync('codesign', ['--sign', '-', out]);
} catch (error) {
  // A copy left at the output path is a plain node binary named like the executable.
  rmSync(out, { force: true });
  process.stderr.write(`build-sea: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
