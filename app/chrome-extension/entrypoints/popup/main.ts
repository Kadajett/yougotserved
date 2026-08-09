import { createApp } from 'vue';
import { NativeMessageType } from 'chrome-mcp-shared';
import './style.css';
// Shared theme.
import '../styles/theme.css';
import { preloadAgentTheme } from '../shared/composables/useAgentTheme';
import App from './App.vue';

// Load the theme before mounting, so it does not flash.
preloadAgentTheme().then(() => {
  // Trigger ensure native connection (fire-and-forget, don't block UI mounting)
  void chrome.runtime.sendMessage({ type: NativeMessageType.ENSURE_NATIVE }).catch(() => {
    // Silent failure - background will handle reconnection
  });
  createApp(App).mount('#app');
});
