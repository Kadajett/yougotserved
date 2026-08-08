import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { setupTools } from './register-tools';

/**
 * Create one MCP protocol server per transport.
 *
 * The SDK binds a Server instance to exactly one transport. Reusing a global
 * instance made a second client fail with "Already connected to a transport",
 * which also prevented the adapter host from sharing the Chrome bridge with an
 * agent session.
 */
export const createMcpServer = () => {
  const mcpServer = new Server(
    {
      name: 'ChromeMcpServer',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  setupTools(mcpServer);
  return mcpServer;
};
