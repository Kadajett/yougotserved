import { initNativeHostListener } from './native-host';

// Record-Replay V3 (feature flag)

/**
 * Feature flag for RR-V3
 * Set to true to enable the new Record-Replay V3 engine
 */

/**
 * Background script entry point
 * Initializes all background services and listeners
 */
export default defineBackground(() => {
  // Open welcome page on first install
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      // Open the welcome/onboarding page for new installations
      chrome.tabs.create({
        url: chrome.runtime.getURL('/welcome.html'),
      });
    }
  });

  // Initialize core services
  initNativeHostListener();

});
