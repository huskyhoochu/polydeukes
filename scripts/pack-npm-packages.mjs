// Builds the four npm packages from a release's Rust executable archives:
//   node scripts/pack-npm-packages.mjs <archives-dir> <version> <out-dir>
// Each package carries the macOS arm64, Linux x64 and Linux arm64 executables and a Node
// launcher that runs the one for the current platform. The packages are made outside the pnpm workspace, whose
// members of the same names are the private TypeScript sources.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [archives, version, out] = process.argv.slice(2);
assert(
  archives && version && out,
  'usage: pack-npm-packages.mjs <archives-dir> <version> <out-dir>',
);

const repository = fileURLToPath(new URL('..', import.meta.url));
/** Node's `${process.platform} ${process.arch}` for each release archive target. */
const PLATFORMS = {
  'darwin arm64': 'aarch64-apple-darwin',
  'linux x64': 'x86_64-unknown-linux-musl',
  'linux arm64': 'aarch64-unknown-linux-musl',
};
const TARGETS = Object.values(PLATFORMS);
const PACKAGES = [
  { crate: 'pdks', npm: 'polydeukes' },
  { crate: 'pdks-claude-code', npm: '@polydeukes/adapter-claude-code' },
  { crate: 'pdks-codex', npm: '@polydeukes/adapter-codex' },
  { crate: 'pdks-memory', npm: '@polydeukes/memory' },
];
/** The license files each archive holds; `pdks-memory` adds its model's and dictionary's. */
const LICENSES = { 'pdks-memory': ['LICENSE', 'GARU-LICENSE', 'EN-KO-LICENSE'] };
const rootManifest = readFileSync(join(repository, 'Cargo.toml'), 'utf8');
const { author } = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));

/** The quoted value of `key = "..."` in a manifest's text, or undefined. */
const field = (text, key) => text.match(new RegExp(`^${key} = "([^"]*)"$`, 'm'))?.[1];

// The launcher's own failures exit 1, never 2: a host reads 2 from a hook as a block.
const launcher = (name) => `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { constants } from 'node:os';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const name = ${JSON.stringify(name)};
const targets = ${JSON.stringify(PLATFORMS)};
const target = targets[\`\${process.platform} \${process.arch}\`];
if (target === undefined) {
  process.stderr.write(\`\${name}: no prebuilt executable for \${process.platform} \${process.arch}\\n\`);
  process.exit(1);
}
// \`init\` registers argv[0] when it is a path and looks a bare name up on PATH. Run through a
// node_modules/.bin link, the link is passed on; otherwise (a package manager's shell shim) the
// bare name finds the .bin entry. Either way the registration outlives an upgrade, which this
// file's own install path does not.
const invoked = process.argv[1];
const result = spawnSync(
  fileURLToPath(new URL(\`./\${target}/\${name}\`, import.meta.url)),
  process.argv.slice(2),
  { stdio: 'inherit', argv0: basename(invoked) === name ? invoked : name },
);
if (result.error) {
  process.stderr.write(\`\${name}: cannot run the \${target} executable: \${result.error.message}\\n\`);
  process.exit(1);
}
process.exit(result.signal ? 128 + (constants.signals[result.signal] ?? 0) : result.status);
`;

const scratch = mkdtempSync(join(tmpdir(), 'pdks-npm-pack-'));
try {
  for (const { crate, npm } of PACKAGES) {
    const manifest = readFileSync(join(repository, 'packages', crate, 'Cargo.toml'), 'utf8');
    const target = resolve(out, crate);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(join(target, 'bin'), { recursive: true });
    for (const triple of TARGETS) {
      const stem = `${crate}-${triple}-v${version}`;
      const archive = resolve(archives, `${stem}.tar.gz`);
      assert(existsSync(archive), `missing archive ${archive}`);
      const result = spawnSync('tar', ['-xzf', archive, '-C', scratch], { encoding: 'utf8' });
      assert.equal(result.status, 0, `tar failed for ${archive}: ${result.stderr}`);
      mkdirSync(join(target, 'bin', triple));
      copyFileSync(join(scratch, stem, crate), join(target, 'bin', triple, crate));
      chmodSync(join(target, 'bin', triple, crate), 0o755);
      // Every target's archive carries the same license files.
      for (const license of LICENSES[crate] ?? ['LICENSE'])
        copyFileSync(join(scratch, stem, license), join(target, license));
    }
    writeFileSync(join(target, 'bin', `${crate}.js`), launcher(crate), { mode: 0o755 });
    copyFileSync(join(repository, 'packages', crate, 'README.md'), join(target, 'README.md'));
    const pkg = {
      name: npm,
      version,
      description: field(manifest, 'description'),
      license: field(manifest, 'license') ?? field(rootManifest, 'license'),
      author,
      repository: {
        type: 'git',
        url: 'git+https://github.com/huskyhoochu/polydeukes.git',
        directory: `packages/${crate}`,
      },
      type: 'module',
      bin: { [crate]: `bin/${crate}.js` },
    };
    writeFileSync(join(target, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
