/**
 * Checks and publishes the packs in `adapters/`.
 *
 * A pull request runs `check`. A merge runs `publish`. The registry decides
 * what is new: identical bytes come back as unchanged, and different bytes
 * under a version that already exists come back as a conflict. So this script
 * sends every pack and never has to work out which ones changed.
 *
 *   node scripts/adapters.mjs check
 *   node scripts/adapters.mjs publish        # needs YGS_PUBLISH_TOKEN
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'adapters');
const sdk = path.join(root, 'packages/adapter-sdk/dist/index.mjs');
const { validatePack, packDigest, describePack } = await import(sdk);

const mode = process.argv[2] ?? 'check';
const registry = process.env.YGS_REGISTRY_URL ?? 'https://registry.yougotserved.dev';
const token = process.env.YGS_PUBLISH_TOKEN;

const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((name) => name.endsWith('.ygs.json')).sort()
  : [];

if (files.length === 0) {
  console.log('No packs in adapters/.');
  process.exit(0);
}

let failed = 0;

for (const name of files) {
  const file = path.join(dir, name);
  let pack;

  try {
    pack = validatePack(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    console.error(`FAIL ${name}\n  ${error.message}`);
    failed++;
    continue;
  }

  // The file name has to match the id, or two packs could claim one id and the
  // one that wins would depend on directory order.
  if (name !== `${pack.id}.ygs.json`) {
    console.error(`FAIL ${name}\n  id is "${pack.id}", so the file must be ${pack.id}.ygs.json`);
    failed++;
    continue;
  }

  const digest = await packDigest(pack);

  if (mode === 'check') {
    console.log(`ok   ${name}  ${pack.version}  ${digest.slice(0, 20)}...`);
    console.log(
      describePack(pack)
        .split('\n')
        .map((line) => `       ${line}`)
        .join('\n'),
    );
    continue;
  }

  if (!token) {
    console.error('YGS_PUBLISH_TOKEN is not set.');
    process.exit(1);
  }

  const response = await fetch(`${registry}/api/adapters`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ pack, digest, author: pack.author ?? '' }),
  });
  const body = await response.json();

  if (response.status === 409) {
    console.error(
      `FAIL ${name}\n  ${pack.id}@${pack.version} is already published with different content.\n` +
        '  Raise the version in the pack. A published version never changes.',
    );
    failed++;
  } else if (!response.ok) {
    console.error(`FAIL ${name}\n  ${body?.error?.message ?? response.status}`);
    failed++;
  } else if (body.unchanged) {
    console.log(`same ${name}  ${pack.version}`);
  } else {
    console.log(`sent ${name}  ${pack.version}  ${digest.slice(0, 20)}...`);
  }
}

if (failed) {
  console.error(`\n${failed} pack(s) failed.`);
  process.exit(1);
}
console.log(`\n${files.length} pack(s) ${mode === 'check' ? 'checked' : 'processed'}.`);
