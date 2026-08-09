import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const distDir = path.join(__dirname, '..', '..', 'dist');
// Clear the previous build.
console.log('Clearing the previous build...');
try {
  fs.rmSync(distDir, { recursive: true, force: true });
} catch (err) {
  // A missing directory is fine here.
  console.log(err);
}

// Create dist.
fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(path.join(distDir, 'logs'), { recursive: true }); // Create the logs directory.
console.log('Created/verified dist and dist/logs');

// Compile TypeScript
console.log('Compiling TypeScript...');
execSync('tsc', { stdio: 'inherit' });

/*
 * Inline the workspace packages.
 *
 * `chrome-mcp-shared` and the adapter SDK live in this repo and are not on
 * npm. tsc leaves them as ordinary requires, so a published tarball carried
 * `workspace:*` dependencies that npm cannot resolve, and the package would
 * not install for anyone. esbuild folds those two into the output and leaves
 * every real dependency external, including the native ones.
 */
console.log('Bundling workspace packages...');
{
  const esbuild = require('esbuild');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const inline = ['chrome-mcp-shared', '@yougotserved/adapter-sdk'];
  const external = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
  ].filter((name: string) => !inline.includes(name));

  const distDir = path.join(__dirname, '..', '..', 'dist');
  const entries = ['cli.js', 'index.js', path.join('mcp', 'mcp-server-stdio.js')];

  for (const entry of entries) {
    const file = path.join(distDir, entry);
    if (!fs.existsSync(file)) continue;
    // esbuild cannot write over the file it is reading, so bundle beside it.
    const staged = file + '.bundled';
    esbuild.buildSync({
      entryPoints: [file],
      outfile: staged,
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      external,
      logLevel: 'warning',
    });
    fs.renameSync(staged, file);
    console.log(`  bundled ${entry}`);
  }
}

// Copy the config file.
console.log('Copying config files...');
const configSourcePath = path.join(__dirname, '..', 'mcp', 'stdio-config.json');
const configDestPath = path.join(distDir, 'mcp', 'stdio-config.json');

try {
  // Make sure the target directory exists.
  fs.mkdirSync(path.dirname(configDestPath), { recursive: true });

  if (fs.existsSync(configSourcePath)) {
    fs.copyFileSync(configSourcePath, configDestPath);
    console.log(`Copied stdio-config.json -> ${configDestPath}`);
  } else {
    console.error(`Config file not found: ${configSourcePath}`);
  }
} catch (error) {
  console.error('Could not copy the config file:', error);
}

// Copy package.json and rewrite it for the published build.
console.log('Preparing package.json...');
const packageJson = require('../../package.json');

// Write the install notes that ship in dist.
const readmeContent = `# ${packageJson.name}

The native messaging host for the youGotServed Chrome extension.

## Install

1. Install Node.js.
2. Install this package:
   \`\`\`
   npm install -g ${packageJson.name}
   \`\`\`
3. Register the native messaging host:
   \`\`\`
   # For this user. Start here.
   ${packageJson.name} register

   # If that fails, register for every user on the machine.
   ${packageJson.name} register --system
   sudo ${packageJson.name} register
   \`\`\`

## Use

Chrome starts this program for you. There is nothing to run by hand.
`;

fs.writeFileSync(path.join(distDir, 'README.md'), readmeContent);

console.log('Copying wrapper scripts...');
const scriptsSourceDir = path.join(__dirname, '.');
const macOsWrapperSourcePath = path.join(scriptsSourceDir, 'run_host.sh');
const windowsWrapperSourcePath = path.join(scriptsSourceDir, 'run_host.bat');

const macOsWrapperDestPath = path.join(distDir, 'run_host.sh');
const windowsWrapperDestPath = path.join(distDir, 'run_host.bat');

try {
  if (fs.existsSync(macOsWrapperSourcePath)) {
    fs.copyFileSync(macOsWrapperSourcePath, macOsWrapperDestPath);
    console.log(`Copied ${macOsWrapperSourcePath} -> ${macOsWrapperDestPath}`);
  } else {
    console.error(`macOS wrapper script not found: ${macOsWrapperSourcePath}`);
  }

  if (fs.existsSync(windowsWrapperSourcePath)) {
    fs.copyFileSync(windowsWrapperSourcePath, windowsWrapperDestPath);
    console.log(`Copied ${windowsWrapperSourcePath} -> ${windowsWrapperDestPath}`);
  } else {
    console.error(`Windows wrapper script not found: ${windowsWrapperSourcePath}`);
  }
} catch (error) {
  console.error('Could not copy the wrapper scripts:', error);
}

// Chrome runs these directly, so they have to be executable.
console.log('Setting executable permissions...');
const filesToMakeExecutable = ['index.js', 'cli.js', 'run_host.sh']

filesToMakeExecutable.forEach((file) => {
  const filePath = path.join(distDir, file)
  try {
    if (fs.existsSync(filePath)) {
      fs.chmodSync(filePath, '755');
      console.log(`Set 755 on ${file} `);
    } else {
      console.warn(`${filePath} is missing, so it cannot be made executable`);
    }
  } catch (error) {
    console.error(`Could not make ${file} executable:`, error);
  }
});

// Write node_path.txt immediately after build to ensure Chrome uses the correct Node.js version.
// This is critical for development mode where dist is deleted on each rebuild.
// The file points to the same Node.js that compiled the native modules (better-sqlite3 etc.)
console.log('Writing node_path.txt...');
const nodePathFile = path.join(distDir, 'node_path.txt');
fs.writeFileSync(nodePathFile, process.execPath, 'utf8');
console.log(`Wrote Node.js path: ${process.execPath}`);

console.log('✅ Build complete');
