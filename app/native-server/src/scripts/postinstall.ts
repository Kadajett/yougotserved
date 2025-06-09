#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { COMMAND_NAME } from './constant';
import { colorText, tryRegisterUserLevelHost } from './utils';

// Check if this script is run directly
const isDirectRun = require.main === module;
const isGlobalInstall = process.env.npm_config_global === 'true';

/**
 * 尝试注册Native Messaging主机
 */
async function tryRegisterNativeHost(): Promise<void> {
  try {
    console.log(colorText('Attempting to register Chrome Native Messaging host...', 'blue'));

    if (isGlobalInstall) {
      // 1. Ensure native host has execution permissions
      const launcherPath = path.join(__dirname, '..', 'index.js');
      try {
        // Set execution permissions on non-Windows platforms
        if (process.platform !== 'win32') {
          fs.chmodSync(launcherPath, '755');
          console.log('✓ Set launcher execution permissions');
        }
      } catch (err: any) {
        console.warn('⚠️ Unable to set launcher execution permissions:', err.message);
        // Non-critical error, don't block
      }

      // First try user-level installation (no elevated permissions required)
      const userLevelSuccess = await tryRegisterUserLevelHost();

      if (!userLevelSuccess) {
        // User-level installation failed, suggest using register command
        console.log(colorText('User-level installation failed, system-level installation may be needed', 'yellow'));
        console.log(colorText('Please run the following command for system-level installation:', 'blue'));
        console.log(`  ${COMMAND_NAME} register --system`);
        printManualInstructions();
      }
    } else {
      // Local installation mode, don't attempt automatic registration
      console.log(colorText('Local installation detected, skipping automatic registration', 'yellow'));
      printManualInstructions();
    }
  } catch (error) {
    console.log(
      colorText(
        `注册过程中出现错误: ${error instanceof Error ? error.message : String(error)}`,
        'red',
      ),
    );
    printManualInstructions();
  }
}

/**
 * 打印手动安装指南
 */
function printManualInstructions(): void {
  console.log('\n' + colorText('===== Manual Registration Guide =====', 'blue'));

  console.log(colorText('1. Try user-level installation (recommended):', 'yellow'));
  if (isGlobalInstall) {
    console.log(`  ${COMMAND_NAME} register`);
  } else {
    console.log(`  npx ${COMMAND_NAME} register`);
  }

  console.log(colorText('\n2. If user-level installation fails, try system-level installation:', 'yellow'));

  console.log(colorText('   Use --system parameter (auto-elevate permissions):', 'yellow'));
  if (isGlobalInstall) {
    console.log(`  ${COMMAND_NAME} register --system`);
  } else {
    console.log(`  npx ${COMMAND_NAME} register --system`);
  }

  console.log(colorText('\n   Or use administrator privileges directly:', 'yellow'));
  if (os.platform() === 'win32') {
    console.log(colorText('   Please run Command Prompt or PowerShell as administrator and execute:', 'yellow'));
    if (isGlobalInstall) {
      console.log(`  ${COMMAND_NAME} register`);
    } else {
      console.log(`  npx ${COMMAND_NAME} register`);
    }
  } else {
    console.log(colorText('   Please run the following command in terminal:', 'yellow'));
    if (isGlobalInstall) {
      console.log(`  sudo ${COMMAND_NAME} register`);
    } else {
      console.log(`  sudo npx ${COMMAND_NAME} register`);
    }
  }

  console.log('\n' + colorText('Ensure Chrome extension is installed and refresh the extension to connect to local service.', 'blue'));
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  console.log(colorText(`Installing ${COMMAND_NAME}...`, 'green'));

  // If global installation, try automatic registration
  if (isGlobalInstall) {
    await tryRegisterNativeHost();
  } else {
    console.log(colorText('Local installation detected', 'yellow'));
    printManualInstructions();
  }
}

// Only execute main function when running this script directly
if (isDirectRun) {
  main().catch((error) => {
    console.error(
      colorText(`Installation script error: ${error instanceof Error ? error.message : String(error)}`, 'red'),
    );
  });
}
