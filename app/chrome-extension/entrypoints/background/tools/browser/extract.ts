/**
 * Declarative extraction.
 *
 * The caller sends a spec, which is data, and gets back the fields it asked
 * for. No caller-supplied code enters the page. The runner is the SDK's
 * `runExtractSpec`, injected verbatim, so an installed adapter pack cannot
 * change what happens here.
 *
 * This is where the token saving lives. Reading a search page costs tens of
 * thousands of tokens; ten records with four fields each costs a few hundred.
 */

import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { runExtractSpec, validateExtractSpec, type ExtractSpec } from '@yougotserved/adapter-sdk';

interface ExtractToolParams {
  spec: ExtractSpec;
  /** Defaults to the active tab. */
  tabId?: number;
}

class ExtractTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.EXTRACT;

  async execute(args: ExtractToolParams): Promise<ToolResult> {
    const { spec, tabId } = args ?? {};

    if (!spec || typeof spec !== 'object') {
      return createErrorResponse('An extract spec is required.');
    }

    // Checked here as well as in the host. This tool is reachable on its own,
    // so it cannot assume anything ran before it.
    try {
      validateExtractSpec(spec);
    } catch (error) {
      return createErrorResponse(error instanceof Error ? error.message : String(error));
    }

    let target = tabId;
    if (target === undefined) {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!active?.id) return createErrorResponse('No active tab.');
      target = active.id;
    }

    let frames;
    try {
      frames = await chrome.scripting.executeScript({
        target: { tabId: target },
        world: 'ISOLATED',
        // `runExtractSpec` is stringified and sent, so it must not reference
        // anything outside itself. A test in the SDK holds that property.
        func: runExtractSpec as unknown as (spec: ExtractSpec) => unknown,
        args: [spec as unknown as never],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createErrorResponse(
        `Cannot read this tab: ${message}. Chrome blocks extensions on its own pages ` +
          'and on the Web Store.',
      );
    }

    const frame = frames?.[0];
    if (!frame) return createErrorResponse('The page returned nothing.');
    if (frame.result === undefined && (frame as { error?: unknown }).error) {
      return createErrorResponse(String((frame as { error?: unknown }).error));
    }

    const records = frame.result as unknown;
    const count = Array.isArray(records) ? records.length : 1;
    const tab = await chrome.tabs.get(target);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ url: tab.url, count, records }),
        },
      ],
      isError: false,
    };
  }
}

export const extractTool = new ExtractTool();
