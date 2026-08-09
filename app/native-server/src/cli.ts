#!/usr/bin/env node

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import {
  tryRegisterUserLevelHost,
  colorText,
  registerWithElevatedPermissions,
  ensureExecutionPermissions,
  writeNodePathFile,
} from './scripts/utils';
import { COMMAND_NAME, DEFAULT_EXTENSION_ID, resolveExtensionId } from './scripts/constant';
import { BrowserType, parseBrowserType, detectInstalledBrowsers } from './scripts/browser-config';
import { runDoctor } from './scripts/doctor';
import { runReport } from './scripts/report';

program
  .name(COMMAND_NAME)
  .version(require('../package.json').version)
  .description('youGotServed bridge. Connects an MCP client to your own Chrome profile.');

// Register Native Messaging host
program
  .command('register')
  .description('Register Native Messaging host')
  .option('-f, --force', 'Force re-registration')
  .option('-s, --system', 'Use system-level installation (requires administrator/sudo privileges)')
  .option('-b, --browser <browser>', 'Register for specific browser (chrome, chromium, or all)')
  .option('-d, --detect', 'Auto-detect installed browsers')
  .option(
    '-e, --extension-id <id>',
    'Extension ID allowed to connect. Required for a locally built (unpacked) extension, whose ID Chrome derives from its folder path. Falls back to MCP_CHROME_EXTENSION_ID, then the published ID.',
  )
  .action(async (options) => {
    try {
      // Write Node.js path for run_host scripts
      writeNodePathFile(__dirname);

      const extensionId = resolveExtensionId(options.extensionId);
      if (extensionId !== DEFAULT_EXTENSION_ID) {
        console.log(colorText(`Allowing extension ID: ${extensionId}`, 'blue'));
      }

      // Determine which browsers to register
      let targetBrowsers: BrowserType[] | undefined;

      if (options.browser) {
        if (options.browser.toLowerCase() === 'all') {
          targetBrowsers = [BrowserType.CHROME, BrowserType.CHROMIUM];
          console.log(colorText('Registering for all supported browsers...', 'blue'));
        } else {
          const browserType = parseBrowserType(options.browser);
          if (!browserType) {
            console.error(
              colorText(
                `Invalid browser: ${options.browser}. Use 'chrome', 'chromium', or 'all'`,
                'red',
              ),
            );
            process.exit(1);
          }
          targetBrowsers = [browserType];
        }
      } else if (options.detect) {
        targetBrowsers = detectInstalledBrowsers();
        if (targetBrowsers.length === 0) {
          console.log(
            colorText(
              'No supported browsers detected, will register for Chrome and Chromium',
              'yellow',
            ),
          );
          targetBrowsers = undefined; // Will use default behavior
        }
      }
      // If neither option specified, tryRegisterUserLevelHost will detect browsers

      // Detect if running with root/administrator privileges
      const isRoot = process.getuid && process.getuid() === 0; // Unix/Linux/Mac

      let isAdmin = false;
      if (process.platform === 'win32') {
        try {
          isAdmin = require('is-admin')(); // Windows requires additional package
        } catch (error) {
          console.warn(
            colorText('Warning: Unable to detect administrator privileges on Windows', 'yellow'),
          );
          isAdmin = false;
        }
      }

      const hasElevatedPermissions = isRoot || isAdmin;

      // If --system option is specified or running with root/administrator privileges
      if (options.system || hasElevatedPermissions) {
        // TODO: Update registerWithElevatedPermissions to support multiple browsers
        await registerWithElevatedPermissions(extensionId);
        console.log(
          colorText('System-level Native Messaging host registered successfully!', 'green'),
        );
        console.log(
          colorText(
            'You can now use connectNative in Chrome extension to connect to this service.',
            'blue',
          ),
        );
      } else {
        // Regular user-level installation
        console.log(colorText('Registering user-level Native Messaging host...', 'blue'));
        const success = await tryRegisterUserLevelHost(targetBrowsers, extensionId);

        if (success) {
          console.log(colorText('Native Messaging host registered successfully!', 'green'));
          console.log(
            colorText(
              'You can now use connectNative in Chrome extension to connect to this service.',
              'blue',
            ),
          );
        } else {
          console.log(
            colorText(
              'User-level registration failed, please try the following methods:',
              'yellow',
            ),
          );
          console.log(colorText('  1. sudo ygs register', 'yellow'));
          console.log(colorText('  2. ygs register --system', 'yellow'));
          process.exit(1);
        }
      }
    } catch (error: any) {
      console.error(colorText(`Registration failed: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

// Fix execution permissions
program
  .command('fix-permissions')
  .description('Fix execution permissions for native host files')
  .action(async () => {
    try {
      console.log(colorText('Fixing execution permissions...', 'blue'));
      await ensureExecutionPermissions();
      console.log(colorText('✓ Execution permissions fixed successfully!', 'green'));
    } catch (error: any) {
      console.error(colorText(`Failed to fix permissions: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

// Update port in stdio-config.json
program
  .command('update-port <port>')
  .description('Update the port number in stdio-config.json')
  .action(async (port: string) => {
    try {
      const portNumber = parseInt(port, 10);
      if (isNaN(portNumber) || portNumber < 1 || portNumber > 65535) {
        console.error(colorText('Error: Port must be a valid number between 1 and 65535', 'red'));
        process.exit(1);
      }

      const configPath = path.join(__dirname, 'mcp', 'stdio-config.json');

      if (!fs.existsSync(configPath)) {
        console.error(colorText(`Error: Configuration file not found at ${configPath}`, 'red'));
        process.exit(1);
      }

      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);

      const currentUrl = new URL(config.url);
      currentUrl.port = portNumber.toString();
      config.url = currentUrl.toString();

      fs.writeFileSync(configPath, JSON.stringify(config, null, 4));

      console.log(colorText(`✓ Port updated successfully to ${portNumber}`, 'green'));
      console.log(colorText(`Updated URL: ${config.url}`, 'blue'));
    } catch (error: any) {
      console.error(colorText(`Failed to update port: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

// Diagnose installation and environment issues
program
  .command('doctor')
  .description('Diagnose installation and environment issues')
  .option('--json', 'Output diagnostics as JSON')
  .option('--fix', 'Attempt to fix common issues automatically')
  .option('-b, --browser <browser>', 'Target browser (chrome, chromium, or all)')
  .action(async (options) => {
    try {
      const exitCode = await runDoctor({
        json: Boolean(options.json),
        fix: Boolean(options.fix),
        browser: options.browser,
      });
      process.exit(exitCode);
    } catch (error: any) {
      console.error(colorText(`Doctor failed: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

// Export diagnostic report for GitHub Issues
program
  .command('report')
  .description('Export a diagnostic report for GitHub Issues')
  .option('--json', 'Output report as JSON (default: Markdown)')
  .option('--output <file>', 'Write report to file instead of stdout')
  .option('--copy', 'Copy report to clipboard')
  .option('--no-redact', 'Disable redaction of usernames/paths/tokens')
  .option('--include-logs <mode>', 'Include wrapper logs: none | tail | full', 'tail')
  .option('--log-lines <n>', 'Lines to include when --include-logs=tail', '200')
  .option('-b, --browser <browser>', 'Target browser (chrome, chromium, or all)')
  .action(async (options) => {
    try {
      const exitCode = await runReport({
        json: Boolean(options.json),
        output: options.output,
        copy: Boolean(options.copy),
        redact: options.redact,
        includeLogs: options.includeLogs,
        logLines: options.logLines ? parseInt(options.logLines, 10) : undefined,
        browser: options.browser,
      });
      process.exit(exitCode);
    } catch (error: any) {
      console.error(colorText(`Report failed: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

/*
 * Adapter commands.
 *
 * The registry page prints `ygs adapter add <id>`, so it has to exist. These
 * share their implementation with the MCP tools of the same name, which means
 * a pack installed here is checked exactly the way an agent's install is.
 */
const adapter = program.command('adapter').description('Manage installed adapter packs');

adapter
  .command('search [query]')
  .description('Search the registry, best match first')
  .option('-n, --limit <n>', 'How many to show', '10')
  .action(async (query: string | undefined, options) => {
    try {
      const { searchRegistry } = await import('./adapters/registry-tools.js');
      const found = await searchRegistry(query ?? '', parseInt(options.limit, 10) || 10);
      if (found.length === 0) {
        console.log(colorText(`No adapter matches "${query ?? ''}".`, 'yellow'));
        return;
      }
      for (const a of found) {
        const score = a.votes ? `${a.rating}/5 (${a.votes})` : 'unrated';
        console.log(`${colorText(a.id, 'green')} ${a.version}  ${score}  ${a.downloads} pulls`);
        console.log(`  ${a.description ?? ''}`);
        console.log(`  ${(a.origins ?? []).join(', ')}\n`);
      }
    } catch (error: any) {
      console.error(colorText(error.message, 'red'));
      process.exit(1);
    }
  });

adapter
  .command('list')
  .description('List adapters installed on this machine')
  .action(async () => {
    const { installedPacks, adaptersDir } = await import('./adapters/registry-tools.js');
    const packs = installedPacks();
    if (packs.length === 0) {
      console.log('No adapters installed. Try: ygs adapter search');
      return;
    }
    for (const pack of packs) {
      console.log(`${colorText(pack.id, 'green')} ${pack.version}  ${pack.tools.length} tools`);
    }
    console.log(colorText(`\n${adaptersDir()}`, 'blue'));
  });

adapter
  .command('add <id>')
  .description('Install an adapter from the registry')
  .option('-v, --version <version>', 'Pin a version. Defaults to the newest')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .action(async (id: string, options) => {
    try {
      const { fetchListing, downloadAndInstall } = await import('./adapters/registry-tools.js');
      const listing = await fetchListing(id);
      const target = options.version || listing.version;

      // The reach is printed before anything is downloaded, the same order the
      // MCP tool uses. Installing is the point where a stranger's pack gets
      // your logged-in browser, so it is worth reading twice.
      console.log(
        `\n${colorText(`${listing.id}@${target}`, 'green')}  ${listing.description ?? ''}`,
      );
      console.log(`  Origins:      ${(listing.origins ?? []).join(', ')}`);
      console.log(`  Capabilities: ${(listing.capabilities ?? []).join(', ')}`);
      console.log(`  Tools:        ${Object.keys(listing.pack?.tools ?? {}).join(', ')}\n`);

      if (!options.yes && !(await confirm('Install this adapter?'))) {
        console.log('Nothing was written.');
        return;
      }

      const receipt = await downloadAndInstall(id, target);
      console.log(colorText(`\nInstalled ${receipt.id}@${receipt.version}`, 'green'));
      console.log(`  ${receipt.digest}`);
      console.log(`  ${receipt.file}`);
      console.log('\nRestart your MCP client to pick up the new tools.');
    } catch (error: any) {
      console.error(colorText(error.message, 'red'));
      process.exit(1);
    }
  });

/** A yes/no on stdin. Returns false when there is no terminal to ask. */
function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    readline.question(`${question} [y/N] `, (answer: string) => {
      readline.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

program.parse(process.argv);

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
