#!/usr/bin/env node
import path from 'path';
import { COMMAND_NAME } from './constant';
import { colorText, registerWithElevatedPermissions, writeNodePathFile } from './utils';

/**
 * Main
 */
async function main(): Promise<void> {
  console.log(colorText(`Registering ${COMMAND_NAME} Native Messaging host...`, 'blue'));

  try {
    // Write Node.js path before registration
    writeNodePathFile(path.join(__dirname, '..'));

    await registerWithElevatedPermissions();
    console.log(
      colorText(
        'Registered. The Chrome extension can now reach the local host over Native Messaging.',
        'green',
      ),
    );
  } catch (error: any) {
    console.error(colorText(`Registration failed: ${error.message}`, 'red'));
    process.exit(1);
  }
}

// Run it.
main();
