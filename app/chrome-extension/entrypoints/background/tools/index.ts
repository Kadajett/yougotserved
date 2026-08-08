import { createErrorResponse } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import * as browserTools from './browser';
import { flowRunTool, listPublishedFlowsTool } from './record-replay';
import { ACTIVITY_CLEAR, ACTIVITY_REQUEST, clearFor, entriesFor, record } from '../activity-log';

const tools = { ...browserTools, flowRunTool, listPublishedFlowsTool } as any;
const toolsMap = new Map(Object.values(tools).map((tool: any) => [tool.name, tool]));

/**
 * Tool call parameter interface
 */
export interface ToolCallParam {
  name: string;
  args: any;
}

/**
 * Handle tool execution
 */
export const handleCallTool = async (param: ToolCallParam) => {
  const tool = toolsMap.get(param.name);
  if (!tool) {
    return createErrorResponse(`Tool ${param.name} not found`);
  }

  // Every call is recorded here, working or not, because this is the one place
  // they all pass through. A failed call is often the interesting one.
  const started = Date.now();
  try {
    const result = await tool.execute(param.args);
    record(param.name, param.args, result, Date.now() - started, param.args?.tabId);
    return result;
  } catch (error) {
    console.error(`Tool execution failed for ${param.name}:`, error);
    const failure = createErrorResponse(
      error instanceof Error ? error.message : ERROR_MESSAGES.TOOL_EXECUTION_FAILED,
    );
    record(param.name, param.args, failure, Date.now() - started, param.args?.tabId);
    return failure;
  }
};

// A tab that reloads has lost its list, so the overlay asks for it again.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (message?.type === ACTIVITY_REQUEST) {
    sendResponse({ entries: tabId === undefined ? [] : entriesFor(tabId) });
    return true;
  }
  if (message?.type === ACTIVITY_CLEAR) {
    if (tabId !== undefined) clearFor(tabId);
    sendResponse({ ok: true });
    return true;
  }
  return undefined;
});
