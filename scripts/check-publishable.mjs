/**
 * Refuses to pack a package that declares a workspace dependency.
 *
 * npm cannot resolve the `workspace:` protocol. ygs-bridge 0.1.0 shipped with
 * two of them and could not be installed by anyone, which nothing caught,
 * because `npm publish` is happy to upload it and the package works on a
 * machine that has the workspace.
 *
 *   node scripts/check-publishable.mjs app/native-server
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ?? '.';
const file = path.join(dir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

const bad = Object.entries(pkg.dependencies ?? {}).filter(([, range]) =>
  String(range).startsWith('workspace:'),
);

if (bad.length > 0) {
  console.error(
    `${pkg.name} declares ${bad.length} workspace dependency(s) that npm cannot resolve:\n` +
      bad.map(([name, range]) => `  ${name}: ${range}`).join('\n') +
      '\n\nBundle them into dist and move them to devDependencies.',
  );
  process.exit(1);
}

console.log(`${pkg.name}@${pkg.version}: no workspace dependencies`);
