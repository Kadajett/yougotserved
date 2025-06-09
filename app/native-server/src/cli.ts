#!/usr/bin/env node

import { program } from 'commander';
import {
  tryRegisterUserLevelHost,
  colorText,
  registerWithElevatedPermissions,
} from './scripts/utils';

program
  .version(require('../package.json').version)
  .description('Mcp Chrome Bridge - Local service for communicating with Chrome extension');

// Register Native Messaging host
program
  .command('register')
  .description('Register Native Messaging host')
  .option('-f, --force', 'Force re-registration')
  .option('-s, --system', 'Use system-level installation (requires administrator/sudo privileges)')
  .action(async (options) => {
    try {
      // Detect if running with root/administrator privileges
      const isRoot = process.getuid && process.getuid() === 0; // Unix/Linux/Mac
      const isAdmin = process.platform === 'win32' && require('is-admin')(); // Windows requires additional package
      const hasElevatedPermissions = isRoot || isAdmin;

      // If --system option is specified or running with root/administrator privileges
      if (options.system || hasElevatedPermissions) {
        await registerWithElevatedPermissions();
        console.log(colorText('System-level Native Messaging host registered successfully!', 'green'));
        console.log(colorText('You can now use connectNative in Chrome extension to connect to this service.', 'blue'));
      } else {
        // Regular user-level installation
        console.log(colorText('Registering user-level Native Messaging host...', 'blue'));
        const success = await tryRegisterUserLevelHost();

        if (success) {
          console.log(colorText('Native Messaging host registered successfully!', 'green'));
          console.log(colorText('You can now use connectNative in Chrome extension to connect to this service.', 'blue'));
        } else {
          console.log(colorText('User-level registration failed, please try the following methods:', 'yellow'));
          console.log(colorText('  1. sudo mcp-chrome-bridge register', 'yellow'));
          console.log(colorText('  2. mcp-chrome-bridge register --system', 'yellow'));
          process.exit(1);
        }
      }
    } catch (error: any) {
      console.error(colorText(`Registration failed: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

program.parse(process.argv);

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
