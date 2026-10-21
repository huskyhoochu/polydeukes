import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const executable = process.argv[process.argv.indexOf('--executable') + 1];
assert(process.argv.includes('--executable') && executable, 'pass --executable <absolute-pdks>');
const scratch = mkdtempSync(join(tmpdir(), 'pdks-sdk-distributions-'));
function run(command, args, options = {}, success = true) {
  const result = spawnSync(command, args, {
    cwd: repository,
    encoding: 'utf8',
    timeout: 240000,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status === 0,
    success,
    `${command} ${args.join(' ')}\n${result.error ?? ''}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout + result.stderr;
}
try {
  const copied = join(scratch, 'generation');
  const sdk = join(copied, 'packages/sdk-ts');
  mkdirSync(sdk, { recursive: true });
  for (const directory of ['src', 'scripts'])
    cpSync(join(repository, 'packages/sdk-ts', directory), join(sdk, directory), {
      recursive: true,
    });
  symlinkSync(join(repository, 'packages/sdk-ts/node_modules'), join(sdk, 'node_modules'), 'dir');
  cpSync(join(repository, 'packages/core/schema'), join(copied, 'packages/core/schema'), {
    recursive: true,
  });
  const generator = join(sdk, 'scripts/generate-types.mjs');
  run(process.execPath, [generator, '--check']);
  const generated = join(sdk, 'src/ir.ts');
  const source = readFileSync(generated, 'utf8');
  writeFileSync(generated, `${source}\n// drift\n`);
  run(process.execPath, [generator, '--check'], {}, false);
  writeFileSync(generated, source);
  const schemaPath = join(copied, 'packages/core/schema/covenant-input.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  schema.required = schema.required.filter((key) => key !== 'toolCalls');
  writeFileSync(schemaPath, JSON.stringify(schema));
  run(process.execPath, [generator, '--check'], {}, false);
  unlinkSync(schemaPath);
  run(process.execPath, [generator, '--check'], {}, false);
  console.log(
    'TS generation: baseline passed; generated drift, required-field change, missing schema rejected',
  );

  const rustGeneration = join(copied, 'packages/sdk-rust');
  mkdirSync(join(rustGeneration, 'tests'), { recursive: true });
  cpSync(join(repository, 'packages/sdk-rust/src'), join(rustGeneration, 'src'), {
    recursive: true,
  });
  for (const file of ['Cargo.toml', 'README.md', 'LICENSE'])
    copyFileSync(join(repository, 'packages/sdk-rust', file), join(rustGeneration, file));
  copyFileSync(
    join(repository, 'packages/sdk-rust/tests/ir_generated.rs'),
    join(rustGeneration, 'tests/ir_generated.rs'),
  );
  copyFileSync(
    join(repository, 'packages/core/package.json'),
    join(copied, 'packages/core/package.json'),
  );
  cpSync(join(repository, 'packages/core/schema'), join(copied, 'packages/core/schema'), {
    recursive: true,
  });
  const rustGenerationArgs = [
    'test',
    '--quiet',
    '--manifest-path',
    join(rustGeneration, 'Cargo.toml'),
    '--test',
    'ir_generated',
  ];
  const rustGenerationOptions = {
    env: { ...process.env, CARGO_TARGET_DIR: join(repository, 'packages/sdk-rust/target') },
  };
  run('cargo', rustGenerationArgs, rustGenerationOptions);
  const rustGenerated = join(rustGeneration, 'src/ir.rs');
  const rustSource = readFileSync(rustGenerated, 'utf8');
  writeFileSync(rustGenerated, `${rustSource}\n// drift\n`);
  run('cargo', rustGenerationArgs, rustGenerationOptions, false);
  writeFileSync(rustGenerated, rustSource);
  writeFileSync(schemaPath, JSON.stringify(schema));
  run('cargo', rustGenerationArgs, rustGenerationOptions, false);
  unlinkSync(schemaPath);
  run('cargo', rustGenerationArgs, rustGenerationOptions, false);
  console.log(
    'Rust generation: baseline passed; generated drift, required-field change, missing schema rejected in an isolated source copy',
  );

  const artifacts = join(scratch, 'artifacts');
  mkdirSync(artifacts);
  run('pnpm', ['-F', '@polydeukes/sdk-ts', 'pack', '--pack-destination', artifacts]);
  const tarball = join(
    artifacts,
    readdirSync(artifacts).find((name) => name.endsWith('.tgz')),
  );
  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'sdk-contract-consumer', private: true, type: 'module' }),
  );
  run('pnpm', ['add', '--ignore-scripts', '--lockfile=false', tarball], { cwd: consumer });
  const installed = join(consumer, 'node_modules/@polydeukes/sdk-ts');
  const metadata = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0);
  assert.equal(Object.keys(metadata.peerDependencies ?? {}).length, 0);
  const packages = readdirSync(join(consumer, 'node_modules/@polydeukes'));
  assert.deepEqual(packages, ['sdk-ts']);
  const declarations = readdirSync(join(installed, 'dist'))
    .filter((file) => file.endsWith('.d.ts'))
    .map((file) => readFileSync(join(installed, 'dist', file), 'utf8'))
    .join('\n');
  assert(!/from\s+['"](?:@polydeukes\/core|polydeukes)(?:\/|['"])/.test(declarations));
  for (const file of ['valid', 'invalid'])
    copyFileSync(
      join(repository, `packages/sdk-ts/type-tests/${file}.ts`),
      join(consumer, `${file}.ts`),
    );
  const flags = [
    '-F',
    '@polydeukes/sdk-ts',
    'exec',
    'tsc',
    '--ignoreConfig',
    '--strict',
    '--noEmit',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
  ];
  run('pnpm', [...flags, join(consumer, 'valid.ts')]);
  const errors = run('pnpm', [...flags, join(consumer, 'invalid.ts')], {}, false);
  const lines = readFileSync(join(consumer, 'invalid.ts'), 'utf8').split('\n');
  for (const marker of ["kind: 'wrong'", "kind: 'create'", 'return unreachable(value)']) {
    const line = lines.findIndex((text) => text.includes(marker)) + 1;
    assert(
      new RegExp(`invalid\\.ts\\(${line},`).test(errors),
      `expected diagnostic for ${marker}\n${errors}`,
    );
  }
  console.log(
    'TS isolated tarball: no runtime peers/dependencies; strict valid consumer and three negative diagnostic locations verified',
  );

  run('cargo', ['package', '--allow-dirty', '--manifest-path', 'packages/sdk-rust/Cargo.toml']);
  const crate = join(
    repository,
    'packages/sdk-rust/target/package/polydeukes-sdk-' +
      JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')).version +
      '.crate',
  );
  assert(existsSync(crate));
  const unpacked = join(scratch, 'crate');
  mkdirSync(unpacked);
  run('tar', ['-xzf', crate, '-C', unpacked]);
  const rustCrate = join(unpacked, readdirSync(unpacked)[0]);
  console.log(
    run(process.execPath, [
      join(repository, 'scripts/verify-sdk-contract.mjs'),
      '--executable',
      resolve(executable),
      '--ts-module',
      join(installed, 'dist/index.js'),
      '--rust-crate',
      rustCrate,
    ]).trim(),
  );
  console.log('Packaged TS and Rust consumers passed the same three-language standalone contract');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
