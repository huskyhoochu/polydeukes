// Writes the Homebrew formulae of the tap huskyhoochu/homebrew-polydeukes from a release's assets:
//   node scripts/homebrew-formulae.mjs <version> <assets.json> <out-dir>
// <assets.json> is `gh api repos/<repo>/releases/tags/v<version> --jq .assets`. Each formula
// installs the Release archive of one executable, checked against the sha256 digest GitHub
// recorded for that asset.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [version, assetsFile, out] = process.argv.slice(2);
assert(
  version && assetsFile && out,
  'usage: homebrew-formulae.mjs <version> <assets.json> <out-dir>',
);

const repository = fileURLToPath(new URL('..', import.meta.url));
const home = 'https://github.com/huskyhoochu/polydeukes';
const digests = new Map(
  JSON.parse(readFileSync(assetsFile, 'utf8')).map(({ name, digest }) => [name, digest]),
);
const rootManifest = readFileSync(join(repository, 'Cargo.toml'), 'utf8');
/** The quoted value of `key = "..."` in a manifest's text, or undefined. */
const field = (text, key) => text.match(new RegExp(`^${key} = "([^"]*)"$`, 'm'))?.[1];

/** The `url` and `sha256` lines of one target's archive. */
const source = (name, target, indent) => {
  const asset = `${name}-${target}-v${version}.tar.gz`;
  const digest = digests.get(asset);
  assert(digest?.startsWith('sha256:'), `no sha256 digest for ${asset}`);
  return [
    `${indent}url "${home}/releases/download/v${version}/${asset}"`,
    `${indent}sha256 "${digest.slice('sha256:'.length)}"`,
  ].join('\n');
};

const ruby = (value) => JSON.stringify(value);

mkdirSync(out, { recursive: true });
for (const name of ['pdks', 'pdks-claude-code', 'pdks-codex', 'pdks-memory']) {
  const manifest = readFileSync(join(repository, 'packages', name, 'Cargo.toml'), 'utf8');
  const license = field(manifest, 'license') ?? field(rootManifest, 'license');
  const licenses = license.split(' AND ');
  // The archive's LICENSE is installed by Homebrew itself; the others are named.
  const extra = name === 'pdks-memory' ? ['GARU-LICENSE', 'EN-KO-LICENSE'] : [];
  const className = name
    .split('-')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
  const lines = [
    `class ${className} < Formula`,
    `  desc ${ruby(field(manifest, 'description'))}`,
    `  homepage "${home}"`,
    `  version "${version}"`,
    licenses.length === 1
      ? `  license ${ruby(license)}`
      : `  license all_of: [${licenses.map(ruby).join(', ')}]`,
    ...(name === 'pdks' ? [] : ['', '  depends_on "huskyhoochu/polydeukes/pdks"']),
    '',
    '  on_macos do',
    '    depends_on arch: :arm64',
    source(name, 'aarch64-apple-darwin', '    '),
    '  end',
    '',
    '  on_linux do',
    '    on_intel do',
    source(name, 'x86_64-unknown-linux-musl', '      '),
    '    end',
    '    on_arm do',
    source(name, 'aarch64-unknown-linux-musl', '      '),
    '    end',
    '  end',
    '',
    '  def install',
    `    bin.install ${ruby(name)}`,
    ...(extra.length ? [`    prefix.install ${extra.map(ruby).join(', ')}`] : []),
    '  end',
    'end',
  ];
  writeFileSync(join(out, `${name}.rb`), `${lines.join('\n')}\n`);
}
